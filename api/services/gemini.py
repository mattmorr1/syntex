import os
import json
import httpx
from typing import Tuple, List, Optional, Dict, Any
from config import Config

FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-2.0-flash")
PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-1.5-pro")

class GeminiService:
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"
        self.enabled = bool(self.api_key)
        
        if not self.enabled:
            print("Warning: GEMINI_API_KEY not set. AI features disabled.")
    
    async def _call_api(self, model: str, prompt: str, temperature: float = 0.2, 
                       max_tokens: int = 2048) -> Tuple[str, int]:
        if not self.enabled:
            return self._dev_response(prompt), 0
        
        url = f"{self.base_url}/models/{model}:generateContent?key={self.api_key}"
        
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=120.0)
            
            if response.status_code != 200:
                err_msg = response.text[:500] if len(response.text) > 500 else response.text
                raise Exception(f"Gemini API Error: {response.status_code} - {err_msg}")
            
            result = response.json()
            
            try:
                candidate = result["candidates"][0]
                finish_reason = candidate.get("finishReason", "")
                tokens = result.get("usageMetadata", {}).get("totalTokenCount", 0)
                
                # Handle MAX_TOKENS or empty content
                if finish_reason == "MAX_TOKENS":
                    raise Exception(f"Response exceeded token limit. Try using a shorter document or simpler instruction. Used {tokens} tokens.")
                
                # Check if content exists and has parts
                content = candidate.get("content", {})
                parts = content.get("parts", [])
                
                if not parts or not parts[0].get("text"):
                    raise Exception(f"Empty response from API. Finish reason: {finish_reason}")
                
                text = parts[0]["text"]
                return text, tokens
            except (KeyError, IndexError) as e:
                raise Exception(f"Failed to parse response: {result}")

    async def _stream_api(self, model: str, prompt: str, temperature: float = 0.2,
                          max_tokens: int = 4096):
        """Yield text chunks from the Gemini streaming API."""
        if not self.enabled:
            yield self._dev_response(prompt)
            return

        url = f"{self.base_url}/models/{model}:streamGenerateContent?alt=sse&key={self.api_key}"

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
                "topP": 0.8,
                "topK": 40
            }
        }

        async with httpx.AsyncClient() as client:
            async with client.stream("POST", url, json=payload, timeout=120.0) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    raise Exception(f"Gemini API Error: {response.status_code} - {error_body.decode()}")

                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data.strip() == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            candidates = chunk.get("candidates", [])
                            if candidates:
                                parts = candidates[0].get("content", {}).get("parts", [])
                                if parts and parts[0].get("text"):
                                    yield parts[0]["text"]
                        except json.JSONDecodeError:
                            continue

    async def agent_edit_stream(self, document: str, instruction: str,
                                model: str = "pro",
                                selection: Optional[dict] = None):
        """Yield SSE events for agent edit. Streams chunks, then emits parsed result."""
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL

        max_doc_length = 15000
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
Focus your changes on these selected lines.
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

        accumulated = ""
        async for chunk in self._stream_api(model_name, prompt, temperature=0.2, max_tokens=4096):
            accumulated += chunk
            yield {"type": "chunk", "text": chunk}

        # Parse the full response
        try:
            clean_text = self._strip_code_fences(accumulated)
            result = json.loads(clean_text)
            if not isinstance(result, dict):
                raise ValueError("Not a JSON object")
            if "explanation" not in result:
                result["explanation"] = "AI suggested changes"
            if "changes" not in result:
                result["changes"] = []
            yield {"type": "result", "data": result}
        except (json.JSONDecodeError, ValueError) as e:
            yield {"type": "result", "data": {
                "explanation": f"Could not parse AI response: {str(e)[:100]}",
                "changes": [],
            }}

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
    
    async def generate_document(self, content: str, theme: str, 
                                custom_theme: Optional[str] = None) -> Tuple[str, int]:
        theme_desc = custom_theme if theme == "custom" else self._get_theme_description(theme)
        
        # Check if content needs chunking (rough estimate: 1 char ≈ 0.3 tokens)
        estimated_tokens = len(content) * 0.3
        if estimated_tokens < 20000:  # Single pass if small enough
            return await self._generate_single(content, theme_desc)
        
        # Large document - use chunking
        return await self._generate_chunked(content, theme_desc)
    
    async def _generate_single(self, content: str, theme_desc: str) -> Tuple[str, int]:
        prompt = f"""Convert the following content to a complete LaTeX document.

Theme/Style: {theme_desc}

Content to convert:
{content}

Requirements:
1. Create a complete, compilable LaTeX document
2. Use appropriate packages for the theme
3. Structure with proper sections
4. Include document class, packages, title, author, date
5. Use professional formatting

Return ONLY the LaTeX code, no explanations. Do NOT wrap in markdown code fences."""

        text, tokens = await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=8192)
        return self._strip_code_fences(text), tokens
    
    async def _generate_chunked(self, content: str, theme_desc: str) -> Tuple[str, int]:
        chunks = self._split_content_smart(content)
        latex_parts = []
        total_tokens = 0
        
        for i, chunk in enumerate(chunks):
            is_first = i == 0
            is_last = i == len(chunks) - 1
            
            if is_first:
                prompt = f"""Convert this content to LaTeX. This is the FIRST part of a multi-part document.

Theme/Style: {theme_desc}

Content:
{chunk}

Requirements:
1. Include complete preamble: \\documentclass, \\usepackage statements, \\title, \\author, \\date
2. Include \\begin{{document}} and \\maketitle
3. Convert the content with proper sections
4. DO NOT include \\end{{document}} - more content will follow
5. End at a natural section boundary

Return ONLY the LaTeX code."""
            elif is_last:
                prompt = f"""Continue the LaTeX document. This is the FINAL part.

Content to convert:
{chunk}

Requirements:
1. NO preamble or \\begin{{document}} - continue from previous sections
2. Convert content with proper sections
3. Include \\end{{document}} at the end
4. Maintain consistent formatting with previous parts

Return ONLY the LaTeX code."""
            else:
                prompt = f"""Continue the LaTeX document. This is a MIDDLE section.

Content to convert:
{chunk}

Requirements:
1. NO preamble or \\begin{{document}} - continue from previous sections
2. Convert content with proper sections
3. DO NOT include \\end{{document}} - more content follows
4. Maintain consistent formatting

Return ONLY the LaTeX code."""
            
            text, tokens = await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=8192)
            latex_parts.append(self._strip_code_fences(text))
            total_tokens += tokens
        
        # Merge chunks
        merged = self._merge_latex_chunks(latex_parts)
        return merged, total_tokens
    
    def _split_content_smart(self, content: str, max_chunk_chars: int = 12000) -> List[str]:
        """Split content intelligently at section/paragraph boundaries."""
        if len(content) <= max_chunk_chars:
            return [content]
        
        chunks = []
        current_chunk = ""
        paragraphs = content.split('\n\n')
        
        for para in paragraphs:
            # If single paragraph exceeds limit, force split
            if len(para) > max_chunk_chars:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                # Split long paragraph by sentences
                sentences = para.split('. ')
                for sent in sentences:
                    if len(current_chunk) + len(sent) > max_chunk_chars:
                        chunks.append(current_chunk.strip())
                        current_chunk = sent + '. '
                    else:
                        current_chunk += sent + '. '
            # Normal paragraph
            elif len(current_chunk) + len(para) + 2 > max_chunk_chars:
                chunks.append(current_chunk.strip())
                current_chunk = para + '\n\n'
            else:
                current_chunk += para + '\n\n'
        
        if current_chunk.strip():
            chunks.append(current_chunk.strip())
        
        return chunks
    
    def _merge_latex_chunks(self, chunks: List[str]) -> str:
        """Merge LaTeX chunks, removing duplicate preambles and document tags."""
        if len(chunks) == 1:
            return chunks[0]
        
        merged = chunks[0]  # First chunk has full preamble
        
        for chunk in chunks[1:]:
            # Strip any preamble/begin from continuation chunks
            lines = chunk.split('\n')
            content_start = 0
            
            for i, line in enumerate(lines):
                stripped = line.strip()
                # Skip common preamble commands
                if (stripped.startswith('\\documentclass') or 
                    stripped.startswith('\\usepackage') or
                    stripped.startswith('\\title') or
                    stripped.startswith('\\author') or
                    stripped.startswith('\\date') or
                    stripped.startswith('\\begin{document}') or
                    stripped.startswith('\\maketitle')):
                    content_start = i + 1
                else:
                    break
            
            # Remove \end{document} from middle chunks
            clean_chunk = '\n'.join(lines[content_start:])
            clean_chunk = clean_chunk.replace('\\end{document}', '').strip()
            
            merged += '\n\n' + clean_chunk
        
        # Ensure document ends properly
        if '\\end{document}' not in merged:
            merged += '\n\\end{document}'
        
        return merged
    
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
