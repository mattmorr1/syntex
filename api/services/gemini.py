import os
import json
import httpx
import hashlib
import asyncio
import re
from typing import Tuple, List, Optional, Dict, Any
from datetime import datetime, timedelta
from config import Config

FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-2.0-flash")
PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-1.5-pro")

class TokenLimitError(Exception):
    """Raised when Gemini response is truncated due to max_tokens limit."""
    def __init__(self, message: str, partial_text: str = "", tokens: int = 0):
        super().__init__(message)
        self.partial_text = partial_text
        self.tokens = tokens

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
    """Simple in-memory cache for document contexts."""
    def __init__(self, ttl_minutes: int = 30):
        self.cache: Dict[str, Dict] = {}
        self.ttl = timedelta(minutes=ttl_minutes)
    
    def _hash_key(self, content: str, model: str) -> str:
        return hashlib.md5(f"{model}:{content[:1000]}".encode()).hexdigest()
    
    def get(self, content: str, model: str) -> Optional[str]:
        key = self._hash_key(content, model)
        if key in self.cache:
            entry = self.cache[key]
            if datetime.now() < entry["expires"]:
                return entry["cache_name"]
            del self.cache[key]
        return None
    
    def set(self, content: str, model: str, cache_name: str):
        key = self._hash_key(content, model)
        self.cache[key] = {
            "cache_name": cache_name,
            "expires": datetime.now() + self.ttl
        }
    
    def cleanup(self):
        now = datetime.now()
        expired = [k for k, v in self.cache.items() if now >= v["expires"]]
        for k in expired:
            del self.cache[k]

class GeminiService:
    def __init__(self):
        self.default_api_key = os.getenv("GEMINI_API_KEY")
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.enabled = bool(self.default_api_key)
        self.prompt_cache = PromptCache(ttl_minutes=30)
        
        if not self.enabled:
            print("Warning: GEMINI_API_KEY not set. AI features disabled.")
    
    def get_api_key(self, custom_key: Optional[str] = None) -> Optional[str]:
        if custom_key and custom_key.strip():
            return custom_key.strip()
        return self.default_api_key
    
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
        
        # Check local cache first
        cached = self.prompt_cache.get(content, model)
        if cached:
            return cached
        
        url = f"{self.base_url}/cachedContents?key={api_key}"
        
        payload = {
            "model": f"models/{model}",
            "displayName": display_name,
            "contents": [{"parts": [{"text": content}], "role": "user"}],
            "ttl": "1800s"  # 30 minutes
        }
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=30.0)
                if response.status_code == 200:
                    result = response.json()
                    cache_name = result.get("name")
                    if cache_name:
                        self.prompt_cache.set(content, model, cache_name)
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
    
    async def _call_api(
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

        url = f"{self.base_url}/models/{model}:generateContent?key={key}"

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
            "generationConfig": gen_config
        }

        # Use cached content if available
        if cached_content:
            payload["cachedContent"] = cached_content

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=120.0)

            if response.status_code != 200:
                raise Exception(f"Gemini API Error: {response.status_code} - {response.text}")

            result = response.json()

            try:
                candidate = result["candidates"][0]
                text = candidate["content"]["parts"][0]["text"]
                finish_reason = candidate.get("finishReason", "")

                # Track cached vs non-cached tokens
                usage = result.get("usageMetadata", {})
                tokens = usage.get("totalTokenCount", 0)
                cached_tokens = usage.get("cachedContentTokenCount", 0)
                if cached_tokens > 0:
                    print(f"Used {cached_tokens} cached tokens out of {tokens} total")

                # Check if response was truncated due to token limit
                if finish_reason == "MAX_TOKENS":
                    raise TokenLimitError(
                        f"Response truncated at {tokens} tokens (max_output={max_tokens})",
                        partial_text=text,
                        tokens=tokens
                    )

                return text, tokens
            except TokenLimitError:
                raise
            except (KeyError, IndexError):
                raise Exception(f"Failed to parse response: {result}")
    
    def _dev_response(self, prompt: str) -> str:
        if "autocomplete" in prompt.lower():
            return "\\section{"
        if "convert" in prompt.lower() or "latex" in prompt.lower():
            return self._sample_latex()
        if "edit" in prompt.lower() or "operation" in prompt.lower():
            return json.dumps({
                "explanation": "Dev mode: Sample edit using operations",
                "operations": [
                    {"type": "wrap", "line": 1, "start_char": 0, "end_char": -1, "wrapper": "\\textbf{$}", "reason": "Dev: make bold"}
                ]
            })
        return "Development mode response."
    
    def _sample_latex(self) -> str:
        return r"""\documentclass{article}
\usepackage{amsmath}
\begin{document}
\title{Sample}
\maketitle
\section{Introduction}
Sample content.
\end{document}"""

    async def autocomplete(self, context: str, cursor_pos: int, file_name: str, 
                          api_key: Optional[str] = None) -> Tuple[str, int]:
        # Only send last 500 chars for context (token optimization)
        ctx = context[max(0, cursor_pos-500):cursor_pos]
        
        prompt = f"LaTeX autocomplete. Context:\n{ctx}\n\nProvide 1 short completion (max 50 chars). Output ONLY the completion:"
        
        text, tokens = await self._call_api(FLASH_MODEL, prompt, temperature=0.1, max_tokens=50, api_key=api_key)
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
        
        prompt = f"""Convert to LaTeX ({theme_desc}).

Content:
{content}

{f'Instructions: {custom_prompt}' if custom_prompt else ''}
{f'Preamble to include: {custom_preamble}' if custom_preamble else ''}
{'Reference images provided - incorporate visual content.' if images else ''}

Output complete compilable LaTeX only:"""

        return await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=4096, api_key=api_key, images=images)
    
    async def chat(self, message: str, context: str, 
                  model: str = "flash", api_key: Optional[str] = None) -> Tuple[str, int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL
        key = self.get_api_key(api_key)
        
        # Try to cache the document context for repeated chats
        cached_content = None
        if key and len(context) > 2000:
            cached_content = await self._create_cached_content(
                f"LaTeX document context:\n{context}",
                model_name,
                key,
                "chat_context"
            )
        
        if cached_content:
            prompt = f"LaTeX assistant. Context is cached.\n\nUser: {message}\n\nBrief helpful response:"
        else:
            ctx = context[:1500] if len(context) > 1500 else context
            prompt = f"LaTeX assistant. Doc context:\n{ctx}\n\nUser: {message}\n\nBrief helpful response:"

        return await self._call_api(
            model_name, 
            prompt, 
            temperature=0.3, 
            max_tokens=800, 
            api_key=api_key,
            cached_content=cached_content
        )
    
    def _try_repair_json(self, text: str) -> Optional[Dict]:
        """Attempt to repair truncated JSON from a cut-off response."""
        text = text.strip()
        if not text:
            return None

        # Try parsing as-is first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try closing truncated JSON structures
        # Common case: operations array was cut mid-object
        repairs = [
            text + '}]}',       # close object + array + root
            text + ']}',        # close array + root
            text + '}',         # close root object
            text + '"]]}',      # close string + array + root
            text + '"}]}',      # close string value + object + array + root
        ]

        for attempt in repairs:
            try:
                result = json.loads(attempt)
                if isinstance(result, dict) and "operations" in result:
                    return result
            except json.JSONDecodeError:
                continue

        # Try extracting valid operations up to the truncation point
        try:
            # Find the last complete operation object
            ops_match = re.search(r'"operations"\s*:\s*\[', text)
            if ops_match:
                ops_start = ops_match.end()
                # Find all complete JSON objects in the operations array
                depth = 0
                last_complete = ops_start
                for i in range(ops_start, len(text)):
                    if text[i] == '{':
                        depth += 1
                    elif text[i] == '}':
                        depth -= 1
                        if depth == 0:
                            last_complete = i + 1

                if last_complete > ops_start:
                    # Extract explanation
                    exp_match = re.search(r'"explanation"\s*:\s*"([^"]*)"', text)
                    explanation = exp_match.group(1) if exp_match else "Partial result (response was truncated)"

                    truncated = text[:ops_match.end()] + text[ops_match.end():last_complete] + ']}'
                    # Prepend the explanation if needed
                    if '"explanation"' not in truncated:
                        truncated = '{"explanation":"' + explanation + '",' + truncated[1:]
                    return json.loads(truncated)
        except (json.JSONDecodeError, Exception):
            pass

        return None

    async def agent_edit(
        self,
        document: str,
        instruction: str,
        model: str = "pro",
        api_key: Optional[str] = None,
        images: Optional[List[str]] = None
    ) -> Tuple[Dict[str, Any], int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL
        key = self.get_api_key(api_key)

        lines = document.split('\n')

        # Auto-batch for large documents (>100 lines)
        if len(lines) > 100:
            print(f"Large document ({len(lines)} lines), using batched processing")
            return await self.agent_edit_batched(document, instruction, model, api_key, images)

        # Add line numbers to document for reference
        numbered_doc = '\n'.join(f"{i+1:4d}| {line}" for i, line in enumerate(lines))

        # Truncate if too long, but keep more context with line numbers
        if len(numbered_doc) > 12000:
            numbered_doc = numbered_doc[:12000] + "\n... (truncated)"

        # Operation-based prompt - saves tokens by not repeating content
        prompt = f"""You are a LaTeX editor. Edit the document using OPERATIONS (not full text).

DOCUMENT (with line numbers):
{numbered_doc}

INSTRUCTION: {instruction}
{'REFERENCE IMAGES: Analyze the provided images for context.' if images else ''}

OUTPUT FORMAT - Use these operation types:

1. WRAP - Wrap existing text with LaTeX command (use $ as placeholder for original text)
   {{"type": "wrap", "line": 5, "start_char": 0, "end_char": -1, "wrapper": "\\\\textbf{{$}}", "reason": "Make bold"}}
   - start_char/end_char: character positions within line (0-indexed, -1 = end of line)
   - wrapper: LaTeX command with $ placeholder for original text

2. REPLACE - Replace specific text (only for small changes like typos, symbols)
   {{"type": "replace", "line": 10, "start_char": 5, "end_char": 15, "content": "new text", "reason": "Fix typo"}}

3. INSERT - Add new content before/after a line
   {{"type": "insert", "line": 20, "position": "after", "content": "\\\\newpage", "reason": "Add page break"}}

4. DELETE - Remove lines
   {{"type": "delete", "line": 30, "end_line": 32, "reason": "Remove section"}}

RULES:
- Use WRAP for formatting (bold, italic, colors, environments) - this saves tokens
- Use REPLACE only for small text changes (< 50 chars), not for formatting
- For multi-line formatting, use multiple WRAP operations
- Line numbers are 1-indexed (first line is 1)
- Be precise with line numbers - check the document carefully
- Keep operations concise - minimize the number of operations needed

Respond with JSON containing explanation and operations array."""

        try:
            text, tokens = await self._call_api(
                model_name,
                prompt,
                temperature=0.1,
                max_tokens=4096,
                api_key=api_key,
                images=images,
                response_schema=AGENT_EDIT_SCHEMA
            )
        except TokenLimitError as e:
            # Response was truncated - try to salvage partial result
            print(f"Token limit hit in agent_edit ({e.tokens} tokens), attempting repair")
            repaired = self._try_repair_json(e.partial_text)
            if repaired:
                processed = self._process_operations(repaired.get("operations", []), lines)
                if processed:
                    return {
                        "explanation": repaired.get("explanation", "") + " (some changes may be missing due to response size limit)",
                        "changes": processed
                    }, e.tokens

            # Repair failed - fall back to batched processing
            print(f"JSON repair failed, falling back to batched processing")
            return await self.agent_edit_batched(document, instruction, model, api_key, images)

        try:
            result = json.loads(text)
            processed = self._process_operations(result.get("operations", []), lines)
            return {
                "explanation": result.get("explanation", ""),
                "changes": processed
            }, tokens
        except json.JSONDecodeError:
            # Try repairing malformed JSON
            repaired = self._try_repair_json(text)
            if repaired:
                processed = self._process_operations(repaired.get("operations", []), lines)
                if processed:
                    return {
                        "explanation": repaired.get("explanation", "") + " (response required repair)",
                        "changes": processed
                    }, tokens

            # Last resort: fall back to batched processing
            print(f"Parse error in agent_edit, falling back to batched processing")
            return await self.agent_edit_batched(document, instruction, model, api_key, images)

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
        chunk_lines = chunk['lines']
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

        prompt = f"""You are a LaTeX editor. Edit ONLY the lines marked with >>> (lines {start_line}-{chunk['end_line']}).

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
        prompt = f"Improve this LaTeX:\n{content[:3000]}\n\nOutput improved LaTeX only:"
        return await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=4096)
    
    def _get_theme_description(self, theme: str) -> str:
        themes = {
            "journal": "IEEE/ACM journal",
            "problem_set": "homework/problem set",
            "thesis": "thesis/dissertation",
            "report": "technical report",
            "letter": "formal letter"
        }
        return themes.get(theme, "academic document")

gemini_service = GeminiService()
