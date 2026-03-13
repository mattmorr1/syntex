import os
import re
import json
import asyncio
import hashlib
import httpx
from datetime import datetime, timedelta
from typing import Tuple, List, Optional, Dict, Any
from config import Config

# Gemini models
FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-3.0-flash-preview")
PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-3.1-pro-preview")

class TokenLimitError(Exception):
    """Raised when response is truncated due to max_tokens limit."""
    def __init__(self, message: str, partial_text: str = "", tokens: int = 0):
        super().__init__(message)
        self.partial_text = partial_text
        self.tokens = tokens

class ContentBlockedError(Exception):
    """Raised when content is blocked by safety filters (RECITATION, SAFETY, etc)."""
    def __init__(self, message: str, reason: str = ""):
        super().__init__(message)
        self.reason = reason

# Structured output schemas - Operation-based for token efficiency
AGENT_EDIT_SCHEMA = {
    "type": "object",
    "properties": {
        "explanation": {"type": "string"},
        "operations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": ["wrap", "replace", "insert", "delete"]
                    },
                    "line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                    "start_char": {"type": "integer"},
                    "end_char": {"type": "integer"},
                    "content": {"type": "string"},
                    "wrapper": {"type": "string"},
                    "position": {"type": "string", "enum": ["before", "after"]},
                    "reason": {"type": "string"}
                },
                "required": ["type", "line", "reason"]
            }
        }
    },
    "required": ["explanation", "operations"]
}

class PromptCache:
    """Redis-backed cache for Gemini prompt context names, with in-memory fallback."""
    def __init__(self, ttl_minutes: int = 30):
        self.ttl_seconds = ttl_minutes * 60
        self._local: Dict[str, Dict] = {}
        self._redis = None

        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            try:
                import redis.asyncio as aioredis
                self._redis = aioredis.from_url(redis_url, decode_responses=True)
                print(f"Prompt cache: Redis enabled ({redis_url})")
            except ImportError:
                print("Prompt cache: redis package not installed, using in-memory fallback")
            except Exception as e:
                print(f"Prompt cache: Redis init failed ({e}), using in-memory fallback")

    def _hash_key(self, content: str, model: str) -> str:
        h = hashlib.md5(f"{model}:{content[:1000]}".encode()).hexdigest()
        return f"prompt_cache:{h}"

    async def get(self, content: str, model: str) -> Optional[str]:
        key = self._hash_key(content, model)
        if self._redis:
            try:
                return await self._redis.get(key)
            except Exception as e:
                print(f"Redis get failed: {e}")
        # Fallback to local dict
        entry = self._local.get(key)
        if entry:
            if datetime.now() < entry["expires"]:
                return entry["cache_name"]
            del self._local[key]
        return None

    async def set(self, content: str, model: str, cache_name: str):
        key = self._hash_key(content, model)
        if self._redis:
            try:
                await self._redis.set(key, cache_name, ex=self.ttl_seconds)
                return
            except Exception as e:
                print(f"Redis set failed: {e}")
        # Fallback to local dict
        self._local[key] = {
            "cache_name": cache_name,
            "expires": datetime.now() + timedelta(seconds=self.ttl_seconds)
        }

    def cleanup(self):
        """Clean expired entries from local fallback cache (Redis handles TTL natively)."""
        now = datetime.now()
        expired = [k for k, v in self._local.items() if now >= v["expires"]]
        for k in expired:
            del self._local[k]

class GeminiService:
    def __init__(self):
        self.gemini_api_key = os.getenv("GEMINI_API_KEY")
        self.gemini_base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.enabled = bool(self.gemini_api_key)
        self.prompt_cache = PromptCache(ttl_minutes=30)

        if self.gemini_api_key:
            print("Gemini AI enabled")
        else:
            print("Warning: GEMINI_API_KEY not set. AI features disabled.")
    
    def get_api_key(self, custom_key: Optional[str] = None) -> Optional[str]:
        if custom_key and custom_key.strip():
            return custom_key.strip()
        return self.gemini_api_key

    async def _create_cached_content(
        self,
        content: str,
        model: str,
        api_key: str,
        display_name: str = "document_cache"
    ) -> Optional[str]:
        """Create a cached content object in Gemini API."""
        # Only cache if content is substantial (>2000 chars)
        if len(content) < 2000:
            return None

        # Check cache first
        cached = await self.prompt_cache.get(content, model)
        if cached:
            return cached

        url = f"{self.gemini_base_url}/cachedContents?key={api_key}"
        payload = {
            "model": f"models/{model}",
            "contents": [{"role": "user", "parts": [{"text": content}]}],
            "displayName": display_name
        }
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=30.0)
                if response.status_code == 200:
                    result = response.json()
                    cache_name = result.get("name")
                    if cache_name:
                        await self.prompt_cache.set(content, model, cache_name)
                        return cache_name
        except Exception as e:
            print(f"Cache creation failed: {e}")
        
        return None
    
    def _build_image_parts(self, images: Optional[List[str]]) -> List[Dict]:
        """Convert base64 images to API format."""
        parts = []
        if not images:
            return parts
        for img_data in images:
            if img_data.startswith('data:'):
                header, data = img_data.split(',', 1)
                mime_type = header.split(':')[1].split(';')[0]
            else:
                data = img_data
                mime_type = 'image/jpeg'
            parts.append({"inline_data": {"mime_type": mime_type, "data": data}})
        return parts
    
    async def _call_gemini_api(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        api_key: Optional[str] = None,
        images: Optional[List[str]] = None,
        response_schema: Optional[Dict] = None,
        cached_content: Optional[str] = None
    ) -> Tuple[str, int]:
        key = self.get_api_key(api_key)
        if not key:
            return self._dev_response(prompt), 0

        url = f"{self.gemini_base_url}/models/{model}:generateContent?key={key}"

        # Build parts
        parts = self._build_image_parts(images)
        parts.append({"text": prompt})

        # Build generation config
        gen_config: Dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }

        # Add structured output if schema provided
        if response_schema:
            gen_config["responseMimeType"] = "application/json"
            gen_config["responseSchema"] = response_schema

        payload: Dict[str, Any] = {
            "contents": [{"parts": parts}],
            "generationConfig": gen_config,
            # Relaxed safety settings - let content through for formatting tasks
            "safetySettings": [
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            ]
        }

        # Use cached content if available
        if cached_content:
            payload["cachedContent"] = cached_content

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=120.0)
            
            if response.status_code != 200:
                err_msg = response.text[:500] if len(response.text) > 500 else response.text
                raise Exception(f"Gemini API Error: {response.status_code} - {err_msg}")
            
            result = response.json()
            
            try:
                candidate = result["candidates"][0]
                finish_reason = candidate.get("finishReason", "")
                # Handle blocked/empty responses - raise specific error for fallback handling
                content = candidate.get("content", {})
                if not content or "parts" not in content:
                    blocked_reasons = {
                        "RECITATION": "Detected potential copyrighted content",
                        "SAFETY": "Content filtered by safety settings",
                        "OTHER": "Content blocked by filter",
                    }
                    msg = blocked_reasons.get(finish_reason, f"Empty response (finishReason: {finish_reason})")
                    raise ContentBlockedError(msg, reason=finish_reason)

                # Track cached vs non-cached tokens
                usage = result.get("usageMetadata", {})
                tokens = usage.get("totalTokenCount", 0)
                cached_tokens = usage.get("cachedContentTokenCount", 0)
                if cached_tokens > 0:
                    print(f"Used {cached_tokens} cached tokens out of {tokens} total")
                if finish_reason == "MAX_TOKENS":
                    raise Exception(f"Response exceeded token limit. Try using a shorter document or simpler instruction. Used {tokens} tokens.")
                
                # Check if content exists and has parts
                content = candidate.get("content", {})
                parts = content.get("parts", [])
                
                if not parts or not parts[0].get("text"):
                    raise Exception(f"Empty response from API. Finish reason: {finish_reason}")
                
                text = parts[0]["text"]
                return text, tokens
            except (TokenLimitError, ContentBlockedError):
                raise
            except Exception:
                raise Exception(f"Failed to parse Gemini response: {result}")

    async def _call_api(
        self,
        model: str,
        prompt: str,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        api_key: Optional[str] = None,
        images: Optional[List[str]] = None,
        response_schema: Optional[Dict] = None,
        cached_content: Optional[str] = None,
    ) -> Tuple[str, int]:
        if not self.gemini_api_key and not api_key:
            return self._dev_response(prompt), 0
        return await self._call_gemini_api(
            model, prompt, temperature, max_tokens,
            api_key, images, response_schema, cached_content
        )

    def _dev_response(self, prompt: str) -> str:
        if "autocomplete" in prompt.lower():
            return "\\section{"
        if "convert" in prompt.lower() or "latex" in prompt.lower():
            return self._sample_latex()
        if "edit" in prompt.lower() or "change" in prompt.lower():
            return json.dumps({
                "explanation": "Dev mode: Sample edit suggestion",
                "changes": [{
                    "start_line": 1,
                    "end_line": 2,
                    "original": "Original text",
                    "replacement": "Improved text",
                    "reason": "Dev mode suggestion"
                }]
            })
        return "This is a development mode response."
    
    def _sample_latex(self) -> str:
        return r"""\documentclass{article}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{geometry}

\geometry{a4paper, margin=1in}

\title{Sample Document}
\author{UEA AI}
\date{\today}

\begin{document}
\maketitle

\section{Introduction}
This is a sample LaTeX document generated for development purposes.

\section{Content}
Lorem ipsum dolor sit amet, consectetur adipiscing elit.

\section{Conclusion}
This document demonstrates the basic LaTeX structure.

\end{document}"""

    async def autocomplete(self, context: str, cursor_pos: int, file_name: str) -> Tuple[str, int]:
        # Only use the last ~2000 chars of context to save tokens
        trimmed_context = context[:cursor_pos]
        if len(trimmed_context) > 2000:
            trimmed_context = trimmed_context[-2000:]

        prompt = f"""You are a LaTeX expert providing intelligent autocomplete.

Context (code before cursor):
{trimmed_context}

File: {file_name}

Provide a SINGLE short completion (1-2 lines max) that would logically follow.
Return ONLY the completion text, nothing else. No explanations."""

        text, tokens = await self._call_api(FLASH_MODEL, prompt, temperature=0.1, max_tokens=100)
        return text.strip(), tokens
    
    async def generate_document(
        self,
        content: str,
        theme: str,
        custom_theme: Optional[str] = None,
        api_key: Optional[str] = None,
        custom_prompt: Optional[str] = None,
        custom_preamble: Optional[str] = None,
        images: Optional[List[str]] = None
    ) -> Tuple[str, int]:
        theme_desc = custom_theme if theme == "custom" else self._get_theme_description(theme)

        # Truncate content if too long
        content = content[:8000] if len(content) > 8000 else content

        initial_prompt = f"""Transform and convert the following content into a LaTeX document ({theme_desc}).

IMPORTANT: You are reformatting and structuring user-provided content into LaTeX format.
The user owns this content and is authorized to convert it. Focus on document structure and LaTeX markup.

Content to transform:
{content}

{f'Additional instructions: {custom_prompt}' if custom_prompt else ''}
{f'Preamble to include: {custom_preamble}' if custom_preamble else ''}
{'Reference images provided - incorporate visual content.' if images else ''}

Output COMPLETE compilable LaTeX. You MUST include \\end{{document}} at the end:"""

        accumulated = ""
        total_tokens = 0
        max_iterations = 6

        for iteration in range(max_iterations):
            try:
                if iteration == 0:
                    current_prompt = initial_prompt
                    current_images = images
                else:
                    tail = accumulated[-800:]
                    current_prompt = (
                        f"Continue the LaTeX document from exactly where it was cut off.\n\n"
                        f"The document so far ends with:\n{tail}\n\n"
                        f"Output ONLY the continuation starting from where it ends. "
                        f"Do NOT repeat any content. Continue until \\end{{document}}:"
                    )
                    current_images = None

                text, tokens = await self._call_api(
                    PRO_MODEL, current_prompt,
                    temperature=0.1 if iteration > 0 else 0.2,
                    max_tokens=4096,
                    api_key=api_key,
                    images=current_images
                )

                chunk = self._strip_code_fences(text) if iteration == 0 else self._deduplicate_continuation(accumulated, text)
                accumulated += chunk
                total_tokens += tokens
                complete = r"\end{document}" in accumulated
                print(f"generate_document iteration {iteration + 1}: {tokens} tokens, complete={complete}")

                if r"\end{document}" in accumulated:
                    break

            except TokenLimitError as e:
                chunk = self._strip_code_fences(e.partial_text) if iteration == 0 else self._deduplicate_continuation(accumulated, e.partial_text)
                accumulated += chunk
                total_tokens += e.tokens
                print(f"generate_document iteration {iteration + 1} truncated at {e.tokens} tokens, continuing...")

                if r"\end{document}" in accumulated:
                    break
                # loop continues to next iteration

        if r"\end{document}" not in accumulated:
            # Ensure document is closed even if we ran out of iterations
            accumulated = accumulated.rstrip() + "\n\\end{document}\n"

        return accumulated, total_tokens

    def _deduplicate_continuation(self, accumulated: str, new_chunk: str) -> str:
        """Remove overlapping prefix from new_chunk that already exists at the end of accumulated."""
        new_chunk = self._strip_code_fences(new_chunk)
        if not accumulated or not new_chunk:
            return new_chunk
        # Check for overlap of decreasing lengths (up to 300 chars)
        check_len = min(300, len(accumulated), len(new_chunk))
        for length in range(check_len, 20, -1):
            if new_chunk.startswith(accumulated[-length:]):
                return new_chunk[length:]
        return new_chunk

    async def chat(self, message: str, context: str,
                  model: str = "flash") -> Tuple[str, int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL
        
        prompt = f"""You are a LaTeX expert assistant.

Document context:
{context[:2000]}

User message: {message}

Provide helpful, concise assistance. If suggesting code changes, show the LaTeX code clearly."""

        return await self._call_api(model_name, prompt, temperature=0.3, max_tokens=1024)
    
    async def agent_edit(self, document: str, instruction: str,
                        model: str = "pro",
                        selection: Optional[dict] = None) -> Tuple[Dict[str, Any], int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL

        # Truncate document if too long to prevent token limit issues
        max_doc_length = 15000  # characters
        truncated = False
        if len(document) > max_doc_length:
            document = document[:max_doc_length]
            truncated = True

        selection_context = ""
        if selection:
            selection_context = f"""
IMPORTANT - The user has selected lines {selection['start_line']}-{selection['end_line']}:
---
{selection['text'][:3000]}
---
Focus your changes on these selected lines. The user's instruction likely refers to this selection.
"""

        prompt = f"""You are an AI agent that edits LaTeX documents.

Document:
{document}
{"[Document truncated due to length]" if truncated else ""}
{selection_context}
User instruction: {instruction}

Analyze the document and provide specific changes. Return a JSON object with:
{{
  "explanation": "Brief explanation of what you will do",
  "changes": [
    {{
      "start_line": <line number>,
      "end_line": <line number>,
      "original": "exact original text",
      "replacement": "new text",
      "reason": "why this change"
    }}
  ]
}}

Return ONLY valid JSON, no markdown formatting. Keep your response concise."""

        text, tokens = await self._call_api(model_name, prompt, temperature=0.2, max_tokens=4096)
        
        # Parse JSON from response
        try:
            # Clean potential markdown code blocks
            clean_text = text.strip()
            if clean_text.startswith("```"):
                parts = clean_text.split("```")
                if len(parts) >= 2:
                    clean_text = parts[1]
                    if clean_text.startswith("json"):
                        clean_text = clean_text[4:].strip()
            
            result = json.loads(clean_text)
            
            # Validate response structure
            if not isinstance(result, dict):
                raise ValueError("Response is not a JSON object")
            if "explanation" not in result:
                result["explanation"] = "AI suggested changes"
            if "changes" not in result:
                result["changes"] = []
            
            return result, tokens
        except (json.JSONDecodeError, ValueError) as e:
            # Fallback response with more info
            return {
                "explanation": f"Could not parse AI response: {str(e)[:100]}",
                "changes": [],
                "raw_response": text[:500] if text else "No response"
            }, tokens

    def _process_operations(self, operations: List[Dict], lines: List[str]) -> List[Dict]:
        """Convert operations into concrete changes with original/replacement text."""
        changes = []

        for op in operations:
            try:
                op_type = op.get("type")
                line_num = op.get("line", 1)
                reason = op.get("reason", "")

                # Validate line number
                if line_num < 1 or line_num > len(lines):
                    continue

                line_idx = line_num - 1
                line_text = lines[line_idx]

                if op_type == "wrap":
                    start_char = op.get("start_char", 0)
                    end_char = op.get("end_char", -1)
                    wrapper = op.get("wrapper", "$")

                    if end_char == -1:
                        end_char = len(line_text)

                    # Get the text to wrap
                    original_text = line_text[start_char:end_char]
                    # Apply wrapper ($ is placeholder for original text)
                    wrapped_text = wrapper.replace("$", original_text)
                    # Build full replacement line
                    replacement = line_text[:start_char] + wrapped_text + line_text[end_char:]

                    changes.append({
                        "start_line": line_num,
                        "end_line": line_num,
                        "original": line_text,
                        "replacement": replacement,
                        "reason": reason
                    })

                elif op_type == "replace":
                    start_char = op.get("start_char", 0)
                    end_char = op.get("end_char", len(line_text))
                    content = op.get("content", "")

                    if end_char == -1:
                        end_char = len(line_text)

                    original_text = line_text
                    replacement = line_text[:start_char] + content + line_text[end_char:]

                    changes.append({
                        "start_line": line_num,
                        "end_line": line_num,
                        "original": original_text,
                        "replacement": replacement,
                        "reason": reason
                    })

                elif op_type == "insert":
                    position = op.get("position", "after")
                    content = op.get("content", "")

                    if position == "before":
                        changes.append({
                            "start_line": line_num,
                            "end_line": line_num,
                            "original": line_text,
                            "replacement": content + "\n" + line_text,
                            "reason": reason
                        })
                    else:  # after
                        changes.append({
                            "start_line": line_num,
                            "end_line": line_num,
                            "original": line_text,
                            "replacement": line_text + "\n" + content,
                            "reason": reason
                        })

                elif op_type == "delete":
                    end_line = op.get("end_line", line_num)
                    if end_line > len(lines):
                        end_line = len(lines)

                    original_lines = lines[line_idx:end_line]

                    changes.append({
                        "start_line": line_num,
                        "end_line": end_line,
                        "original": "\n".join(original_lines),
                        "replacement": "",
                        "reason": reason
                    })

            except Exception as e:
                print(f"Error processing operation: {op}, error: {e}")
                continue

        return changes

    def _chunk_document(self, lines: List[str], max_lines_per_chunk: int = 100) -> List[Dict]:
        """
        Split document into chunks, preferring natural LaTeX boundaries.
        Returns list of {start_line, end_line, lines} dicts.
        """
        chunks = []
        current_start = 0
        total_lines = len(lines)

        # Patterns that indicate good split points
        section_patterns = [
            r'\\section\{',
            r'\\subsection\{',
            r'\\chapter\{',
            r'\\begin\{document\}',
            r'\\end\{document\}',
            r'^\\begin\{(figure|table|equation|align|itemize|enumerate)\}',
            r'^$',  # Empty lines
        ]
        section_regex = re.compile('|'.join(section_patterns))

        while current_start < total_lines:
            chunk_end = min(current_start + max_lines_per_chunk, total_lines)

            # If not at the end, try to find a natural break point
            if chunk_end < total_lines:
                # Look backwards for a good split point
                best_split = chunk_end
                for i in range(chunk_end, max(current_start + 20, chunk_end - 30), -1):
                    if i < total_lines and section_regex.search(lines[i]):
                        best_split = i
                        break
                chunk_end = best_split

            chunks.append({
                'start_line': current_start + 1,  # 1-indexed
                'end_line': chunk_end,
                'lines': lines[current_start:chunk_end]
            })
            current_start = chunk_end

        return chunks

    async def _process_chunk(
        self,
        chunk: Dict,
        instruction: str,
        full_lines: List[str],
        model_name: str,
        api_key: Optional[str],
        images: Optional[List[str]] = None
    ) -> Tuple[List[Dict], int]:
        """Process a single chunk and return operations with adjusted line numbers."""

        # Build numbered view of this chunk with context
        start_line = chunk['start_line']

        # Add a few lines of context before/after
        context_before = max(0, start_line - 4)
        context_after = min(len(full_lines), chunk['end_line'] + 3)

        # Build the view
        view_lines = []
        for i in range(context_before, context_after):
            prefix = ">>>" if start_line <= i + 1 <= chunk['end_line'] else "   "
            view_lines.append(f"{prefix}{i+1:4d}| {full_lines[i]}")

        numbered_chunk = '\n'.join(view_lines)

        prompt = f"""You are a LaTeX formatting assistant. TRANSFORM and apply LaTeX markup to the marked lines.

IMPORTANT: You are reformatting - NOT reproducing content. Focus on adding LaTeX commands/environments.
The user owns this content and has authorized these formatting changes.

DOCUMENT CHUNK (>>> marks editable lines):
{numbered_chunk}

INSTRUCTION: {instruction}
{'REFERENCE IMAGES: Analyze the provided images.' if images else ''}

OUTPUT OPERATIONS for lines {start_line}-{chunk['end_line']} only. Use:
- WRAP: {{"type": "wrap", "line": N, "start_char": 0, "end_char": -1, "wrapper": "\\\\textbf{{$}}", "reason": "..."}}
- REPLACE: {{"type": "replace", "line": N, "start_char": 0, "end_char": 10, "content": "new", "reason": "..."}}
- INSERT: {{"type": "insert", "line": N, "position": "after", "content": "...", "reason": "..."}}
- DELETE: {{"type": "delete", "line": N, "end_line": M, "reason": "..."}}

RULES:
- Only output operations for lines {start_line}-{chunk['end_line']}
- Use $ as placeholder for original text in WRAP
- Be precise with line numbers

JSON with explanation and operations:"""

        try:
            text, tokens = await self._call_api(
                model_name,
                prompt,
                temperature=0.1,
                max_tokens=2048,
                api_key=api_key,
                images=images if chunk['start_line'] == 1 else None,  # Only send images to first chunk
                response_schema=AGENT_EDIT_SCHEMA
            )
        except TokenLimitError as e:
            # Try to salvage partial result from truncated response
            repaired = self._try_repair_json(e.partial_text)
            if repaired:
                operations = repaired.get("operations", [])
                valid_ops = [
                    op for op in operations
                    if start_line <= op.get('line', 0) <= chunk['end_line']
                ]
                return valid_ops, e.tokens
            return [], e.tokens

        try:
            result = json.loads(text)
            operations = result.get("operations", [])

            # Filter operations to only include those in this chunk's range
            valid_ops = [
                op for op in operations
                if start_line <= op.get('line', 0) <= chunk['end_line']
            ]

            return valid_ops, tokens
        except json.JSONDecodeError:
            repaired = self._try_repair_json(text)
            if repaired:
                operations = repaired.get("operations", [])
                valid_ops = [
                    op for op in operations
                    if start_line <= op.get('line', 0) <= chunk['end_line']
                ]
                return valid_ops, tokens
            return [], tokens

    async def agent_edit_batched(
        self,
        document: str,
        instruction: str,
        model: str = "pro",
        api_key: Optional[str] = None,
        images: Optional[List[str]] = None,
        max_lines_per_chunk: int = 80
    ) -> Tuple[Dict[str, Any], int]:
        """
        Process large documents in batches for better handling.
        Chunks the document, processes in parallel, merges results.
        """
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL
        key = self.get_api_key(api_key)
        lines = document.split('\n')

        # Chunk the document (even small docs get chunked when called as fallback)
        chunks = self._chunk_document(lines, max_lines_per_chunk)
        print(f"Processing {len(chunks)} chunks for {len(lines)} lines")

        # Process chunks in parallel (with concurrency limit)
        semaphore = asyncio.Semaphore(3)  # Max 3 concurrent requests

        async def process_with_limit(chunk):
            async with semaphore:
                return await self._process_chunk(chunk, instruction, lines, model_name, key, images)

        # Run all chunks
        results = await asyncio.gather(*[process_with_limit(c) for c in chunks])

        # Merge operations and count tokens
        all_operations = []
        total_tokens = 0
        for ops, tokens in results:
            all_operations.extend(ops)
            total_tokens += tokens

        # Sort by line number and remove duplicates
        all_operations.sort(key=lambda x: (x.get('line', 0), x.get('start_char', 0)))

        # Remove duplicate operations on same line
        seen_lines = set()
        unique_ops = []
        for op in all_operations:
            line_key = (op.get('line'), op.get('type'), op.get('start_char', 0))
            if line_key not in seen_lines:
                seen_lines.add(line_key)
                unique_ops.append(op)

        # Process operations into changes
        processed = self._process_operations(unique_ops, lines)

        return {
            "explanation": f"Processed {len(chunks)} sections, found {len(processed)} changes",
            "changes": processed
        }, total_tokens

    async def improve_content(self, content: str) -> Tuple[str, int]:
        prompt = f"""Improve the following LaTeX content. Make it more professional and well-structured.

Current content:
{content}

Return ONLY the improved LaTeX code. Do NOT wrap in markdown code fences."""

        text, tokens = await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=4096)
        return self._strip_code_fences(text), tokens

    @staticmethod
    def _strip_code_fences(text: str) -> str:
        """Strip markdown code fences (```latex ... ```) from AI responses."""
        text = text.strip()
        if text.startswith("```"):
            # Remove opening fence (```latex, ```tex, or just ```)
            first_newline = text.find('\n')
            if first_newline != -1:
                text = text[first_newline + 1:]
            # Remove closing fence
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3].rstrip()
        return text

    def _get_theme_description(self, theme: str) -> str:
        themes = {
            "journal": "Academic journal style (IEEE/ACM format) with abstract, two-column layout option, proper citations",
            "problem_set": "Homework/problem set format with numbered problems, solution spaces, mathematical notation",
            "thesis": "Thesis/dissertation format with chapters, table of contents, bibliography, formal structure",
            "report": "Technical report with executive summary, sections, figures, tables",
            "letter": "Formal business letter with letterhead, date, salutation, signature block"
        }
        return themes.get(theme, "Standard academic document format")

gemini_service = GeminiService()
