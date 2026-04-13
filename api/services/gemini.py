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

# Schema for direct changes format (used in agent_edit primary path)
AGENT_EDIT_CHANGES_SCHEMA = {
    "type": "object",
    "properties": {
        "explanation": {"type": "string"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"},
                    "original": {"type": "string"},
                    "replacement": {"type": "string"},
                    "reason": {"type": "string"}
                },
                "required": ["start_line", "end_line", "original", "replacement", "reason"]
            }
        }
    },
    "required": ["explanation", "changes"]
}

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
        temperature: float = 0.1,
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
            response = await client.post(url, json=payload, timeout=httpx.Timeout(connect=10.0, read=540.0, write=30.0, pool=10.0))
            
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

                # Extract parts (available even on truncated responses)
                parts = content.get("parts", [])
                partial_text = parts[0].get("text", "") if parts else ""

                if finish_reason == "MAX_TOKENS":
                    raise TokenLimitError(
                        "Response truncated at token limit.",
                        partial_text=partial_text,
                        tokens=tokens
                    )

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
        temperature: float = 0.1,
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
    
    async def _extract_content_inventory(
        self, content: str, api_key: Optional[str]
    ) -> str:
        """
        ReAct step 1 — Reason about what the document contains.
        Returns a structured checklist of every technical element that must
        appear verbatim in the LaTeX output.
        """
        prompt = (
            "You are auditing an academic document before typesetting it in LaTeX.\n"
            "List EVERY technical element that must be reproduced exactly:\n\n"
            "1. EQUATIONS — number, notation, and full formula\n"
            "2. TABLES — title, all column headers, all data rows\n"
            "3. MODELS — every model name and specification (e.g. AR(p), GARCH(1,1))\n"
            "4. STATISTICS — every reported coefficient, p-value, t-stat, R², AIC, etc.\n"
            "5. SECTIONS — every heading and subheading in order\n"
            "6. ALGORITHMS / PROOFS — any pseudocode or step-by-step derivations\n\n"
            "Be EXHAUSTIVE. Missing items will cause the LaTeX to be incomplete.\n\n"
            "DOCUMENT:\n"
            f"{content[:25000]}\n\n"
            "OUTPUT: structured inventory only."
        )
        text, _ = await self._call_api(
            FLASH_MODEL, prompt, temperature=0.0, max_tokens=8192, api_key=api_key
        )
        return text

    @staticmethod
    def _extract_cls_commands(cls_content: str) -> str:
        """Pull out user-facing command names from a .cls file for the prompt."""
        commands = []
        for line in cls_content.splitlines():
            line = line.strip()
            # \newcommand\Foo or \long\def\Foo or \def\Foo (not \@internal)
            m = re.match(r'\\(?:long\\)?(?:newcommand|def)\\([A-Z][A-Za-z]+)', line)
            if m:
                commands.append('\\' + m.group(1))
        # deduplicate, keep order
        seen = set()
        unique = []
        for c in commands:
            if c not in seen:
                seen.add(c)
                unique.append(c)
        return ', '.join(unique[:20]) if unique else ''

    # ------------------------------------------------------------------ #
    #  Section-chunked generation helpers                                  #
    # ------------------------------------------------------------------ #

    # JSON schema for structure pass response
    _STRUCTURE_SCHEMA = {
        "type": "object",
        "properties": {
            "preamble": {"type": "string"},
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "placeholder": {"type": "string"},
                        "source_start": {"type": "integer"},
                        "source_end": {"type": "integer"},
                    },
                    "required": ["heading", "placeholder", "source_start", "source_end"],
                },
            },
            "postamble": {"type": "string"},
        },
        "required": ["preamble", "sections", "postamble"],
    }

    async def _generate_structure(
        self, content: str, theme_desc: str, cls_instruction: str,
        custom_preamble: str, api_key: Optional[str]
    ) -> Optional[Dict]:
        """
        Pass 1: Flash generates the LaTeX skeleton — preamble, section list with
        source char offsets, and postamble. Returns parsed dict or None on failure.
        """
        prompt = (
            f"You are a LaTeX document architect. Analyse the academic paper below "
            f"and produce a JSON document skeleton using {theme_desc} style.\n\n"
            "RULES:\n"
            "- preamble: full \\documentclass + \\usepackage block + \\title + "
            "\\author + \\date + \\begin{document} + \\maketitle + \\begin{abstract}...\\end{abstract}\n"
            "- sections: array of top-level sections (Introduction, Methods, etc.), "
            "each with a unique placeholder string (SECTION_0, SECTION_1, …) and the "
            "approximate start/end character offsets in the source text\n"
            "- postamble: \\bibliographystyle + \\bibliography + \\end{document}\n"
            f"{cls_instruction}"
            f"{('Extra preamble: ' + custom_preamble + chr(10)) if custom_preamble else ''}"
            "\nSOURCE PAPER:\n"
            f"{content[:40000]}\n\n"
            "Return ONLY the JSON object."
        )
        try:
            text, _ = await self._call_api(
                FLASH_MODEL, prompt, temperature=0.1,
                max_tokens=4096, api_key=api_key,
                response_schema=self._STRUCTURE_SCHEMA
            )
            return json.loads(text)
        except Exception as e:
            print(f"_generate_structure failed: {e}")
            return None

    async def _fill_section(
        self, section_text: str, heading: str, preamble: str,
        inventory: str, theme_desc: str, cls_instruction: str,
        api_key: Optional[str], max_tokens: int
    ) -> Tuple[str, int]:
        """
        Pass 2: Pro fills one section with full token budget.
        Returns (latex_body, tokens) — no preamble, no \\begin{document}.
        """
        inventory_block = (
            "CONTENT CHECKLIST for this section (all items MUST appear):\n"
            f"{inventory}\n\n"
        ) if inventory else ""

        prompt = (
            f"You are a LaTeX typesetter filling the '{heading}' section of a document.\n\n"
            "RULES:\n"
            "- Output ONLY the LaTeX body for this section (\\section{...} through to "
            "the last line before the next section).\n"
            "- REPRODUCE ALL CONTENT VERBATIM: every equation, table, model, statistic, "
            "and result must appear exactly as in the source.\n"
            "- Transcribe all equations into LaTeX math notation.\n"
            "- Reproduce every table completely using tabular or booktabs.\n"
            "- Do NOT include \\documentclass, \\begin{document}, or \\end{document}.\n"
            "OVERFLOW PREVENTION (mandatory):\n"
            "- Wrap EVERY tabular in \\resizebox{\\textwidth}{!}{\\begin{tabular}...\\end{tabular}}.\n"
            "- For wide equations use \\small or split with align/multline.\n"
            "- Use p{} or X columns for text-heavy columns, never wide l/c/r.\n\n"
            f"{cls_instruction}"
            f"{inventory_block}"
            f"PREAMBLE CONTEXT (for package awareness — do not repeat):\n{preamble[:1500]}\n\n"
            f"SOURCE TEXT FOR THIS SECTION:\n{section_text}\n\n"
            "BEGIN LATEX SECTION OUTPUT NOW:\n"
        )
        text, tokens = await self._call_api(
            PRO_MODEL, prompt, temperature=0.15,
            max_tokens=max_tokens, api_key=api_key
        )
        return self._strip_code_fences(text), tokens

    async def _fix_labels(self, latex: str, api_key: Optional[str]) -> str:
        """
        Pass 3: Flash normalises \\label / \\ref names across the stitched document.
        Returns fixed LaTeX or original on failure.
        """
        if len(latex) > 80000:
            return latex  # too large to fix in one pass — skip
        prompt = (
            "The LaTeX document below was assembled from independently generated sections. "
            "Ensure all \\label{} and \\ref{} names are consistent — if a \\ref{} has no "
            "matching \\label{}, fix one of them. Do NOT change any mathematical content, "
            "text, or structure. Return ONLY the corrected LaTeX.\n\n"
            f"{latex}"
        )
        try:
            text, _ = await self._call_api(
                FLASH_MODEL, prompt, temperature=0.0,
                max_tokens=65536, api_key=api_key
            )
            fixed = self._strip_code_fences(text)
            # Sanity check: result should still contain \end{document}
            if r"\end{document}" in fixed:
                return fixed
        except Exception as e:
            print(f"_fix_labels failed: {e}")
        return latex

    async def _generate_document_chunked(
        self,
        content: str,
        theme_desc: str,
        cls_instruction: str,
        extra_instructions: str,
        custom_preamble: str,
        images: Optional[List[str]],
        api_key: Optional[str],
        max_tokens: int
    ) -> Optional[Tuple[str, int]]:
        """
        Three-pass section-chunked generation. Returns (latex, total_tokens) or None on failure.
        """
        # Pass 1: structure
        structure = await self._generate_structure(content, theme_desc, cls_instruction, custom_preamble, api_key)
        if not structure or not structure.get("sections"):
            return None

        preamble = structure["preamble"]
        sections = structure["sections"]
        postamble = structure["postamble"]
        total_tokens = 0

        print(f"_generate_document_chunked: {len(sections)} sections detected")

        # Pass 2: fill sections in parallel, each with its own inventory
        async def fill_one(section: Dict, idx: int) -> Tuple[int, str, int]:
            src_start = section.get("source_start", 0)
            src_end = section.get("source_end", len(content))
            section_text = content[src_start:src_end]
            if not section_text.strip():
                section_text = content[max(0, src_start - 500): min(len(content), src_end + 500)]

            # Per-section inventory (lightweight)
            inv = ""
            if len(section_text) > 500:
                try:
                    inv = await self._extract_content_inventory(section_text, api_key)
                except Exception:
                    pass

            body, tokens = await self._fill_section(
                section_text, section["heading"], preamble,
                inv, theme_desc, cls_instruction, api_key, max_tokens
            )
            return idx, body, tokens

        results = await asyncio.gather(*[fill_one(s, i) for i, s in enumerate(sections)])

        # Stitch in order
        section_bodies: Dict[int, str] = {}
        for idx, body, tokens in results:
            section_bodies[idx] = body
            total_tokens += tokens

        assembled = preamble + "\n\n"
        for i, section in enumerate(sections):
            assembled += section_bodies.get(i, f"% SECTION {i} MISSING\n") + "\n\n"
        assembled += postamble

        # Pass 3: fix labels (best-effort)
        assembled = await self._fix_labels(assembled, api_key)

        print(f"_generate_document_chunked: complete, {total_tokens} total tokens")
        return self._fix_latex_artifacts(assembled), total_tokens

    # ------------------------------------------------------------------ #

    async def generate_document(
        self,
        content: str,
        theme: str,
        custom_theme: Optional[str] = None,
        api_key: Optional[str] = None,
        custom_prompt: Optional[str] = None,
        custom_preamble: Optional[str] = None,
        images: Optional[List[str]] = None,
        custom_cls_content: Optional[str] = None,
        max_tokens: int = 65536
    ) -> Tuple[str, int]:
        theme_desc = custom_theme if theme == "custom" else self._get_theme_description(theme)

        # Allow up to 40 000 chars — roughly 20 pages of academic text
        content = content[:40000]

        cls_instruction = ""
        if custom_cls_content:
            cls_commands = self._extract_cls_commands(custom_cls_content)
            cls_instruction = (
                "A custom LaTeX class file (custom.cls) has been provided.\n"
                "You MUST use \\documentclass{custom} as the document class.\n"
                "Do NOT load packages already included by the class or redefine its commands.\n"
            )
            if cls_commands:
                cls_instruction += f"Class-specific commands available: {cls_commands}\n"
            cls_instruction += (
                "Class file (first 2500 chars):\n"
                "---\n"
                f"{custom_cls_content[:2500]}\n"
                "---\n"
            )

        extra_instructions = ("Additional instructions: " + custom_prompt + "\n") if custom_prompt else ""
        extra_preamble = ("Extra preamble: " + custom_preamble + "\n") if custom_preamble else ""
        images_note = "Images supplied — include each with \\includegraphics in a figure environment.\n" if images else ""

        # For long documents (>6000 chars), try section-chunked generation first
        if len(content) > 6000:
            try:
                chunked_result = await self._generate_document_chunked(
                    content, theme_desc, cls_instruction,
                    extra_instructions, custom_preamble or "",
                    images, api_key, max_tokens
                )
                if chunked_result is not None:
                    print("generate_document: chunked path succeeded")
                    return chunked_result
                print("generate_document: chunked path returned None, falling back to single-pass")
            except Exception as chunk_err:
                print(f"generate_document: chunked path failed ({chunk_err}), falling back to single-pass")

        # ReAct step 1 — extract content inventory for substantial documents
        inventory = ""
        if len(content) > 3000:
            try:
                inventory = await self._extract_content_inventory(content, api_key)
                print(f"generate_document inventory extracted ({len(inventory)} chars)")
            except Exception as inv_err:
                print(f"generate_document inventory extraction failed: {inv_err}")

        inventory_block = (
            "CONTENT CHECKLIST (every item below MUST appear in your output):\n"
            "---\n"
            f"{inventory}\n"
            "---\n\n"
        ) if inventory else ""

        initial_prompt = (
            f"You are a LaTeX typesetter. Convert the following document into a complete, "
            f"compilable LaTeX file using {theme_desc} style.\n\n"
            "RULES:\n"
            "- OUTPUT ONLY LATEX CODE — no explanation, no markdown fences.\n"
            "- REPRODUCE ALL CONTENT VERBATIM: every equation, table, model, statistic, "
            "and result must appear exactly as in the source — do not summarise or omit.\n"
            "- Transcribe all equations into LaTeX math notation ($...$ or \\begin{equation}).\n"
            "- Reproduce every table completely using tabular or booktabs.\n"
            "- Keep all section headings in their original order.\n"
            "- Prose may be lightly reformatted for LaTeX style but must be complete.\n"
            "- End the file with \\end{document}.\n"
            "OVERFLOW PREVENTION (mandatory):\n"
            "- Include \\usepackage{geometry} with margin=1in and \\usepackage{microtype}.\n"
            "- Wrap EVERY tabular in \\resizebox{\\textwidth}{!}{\\begin{tabular}...\\end{tabular}}.\n"
            "- For wide equations use the \\small font size or split with align/multline.\n"
            "- Use p{} or X columns (tabularx) for text-heavy columns, never fixed wide l/c/r.\n"
            "- Long strings of text or URLs inside cells must be wrapped with \\seqsplit{} or truncated.\n\n"
            f"{inventory_block}"
            f"{cls_instruction}"
            f"{extra_instructions}"
            f"{extra_preamble}"
            f"{images_note}"
            "\nSOURCE DOCUMENT:\n"
            f"{content}\n\n"
            "BEGIN LATEX OUTPUT NOW:\n"
        )

        accumulated = ""
        total_tokens = 0
        max_iterations = 8
        used_fallback_prompt = False

        for iteration in range(max_iterations):
            try:
                if iteration == 0:
                    current_prompt = initial_prompt
                    current_images = images
                else:
                    tail = accumulated[-800:]
                    current_prompt = (
                        "Continue the LaTeX document from exactly where it was cut off.\n\n"
                        f"Document so far ends with:\n{tail}\n\n"
                        "Output ONLY the continuation. Do NOT repeat any content. "
                        "Continue until \\end{document}:"
                    )
                    current_images = None

                text, tokens = await self._call_api(
                    PRO_MODEL, current_prompt,
                    temperature=0.1 if iteration > 0 else 0.15,
                    max_tokens=max_tokens,
                    api_key=api_key,
                    images=current_images
                )

                chunk = self._strip_code_fences(text) if iteration == 0 else self._deduplicate_continuation(accumulated, text)
                accumulated += chunk
                total_tokens += tokens
                complete = r"\end{document}" in accumulated
                print(f"generate_document iteration {iteration + 1}: {tokens} tokens, complete={complete}")

                if complete:
                    break

            except TokenLimitError as e:
                chunk = self._strip_code_fences(e.partial_text) if iteration == 0 else self._deduplicate_continuation(accumulated, e.partial_text)
                accumulated += chunk
                total_tokens += e.tokens
                print(f"generate_document iteration {iteration + 1} truncated at {e.tokens} tokens, continuing...")
                if r"\end{document}" in accumulated:
                    break

            except ContentBlockedError as e:
                total_tokens += 0
                print(f"generate_document ContentBlockedError (reason={e.reason}) on iteration {iteration + 1}")
                if not used_fallback_prompt and iteration == 0:
                    used_fallback_prompt = True
                    excerpt = content[:3000]
                    initial_prompt = (
                        f"You are a LaTeX typesetter. Create a complete LaTeX document "
                        f"({theme_desc} style) from the academic paper below.\n\n"
                        "RULES:\n"
                        "- OUTPUT ONLY LATEX CODE.\n"
                        "- Reproduce ALL equations, tables, models, and statistics exactly.\n"
                        "- Keep all section headings and structure intact.\n"
                        "- End the file with \\end{document}.\n\n"
                        f"{inventory_block}"
                        f"{cls_instruction}"
                        f"{extra_instructions}"
                        "\nPAPER (first portion):\n"
                        f"{excerpt}\n\n"
                        "BEGIN LATEX OUTPUT NOW:\n"
                    )
                    current_prompt = initial_prompt
                    # retry immediately (don't increment iteration)
                    try:
                        text, tokens = await self._call_api(
                            PRO_MODEL, current_prompt,
                            temperature=0.15,
                            max_tokens=max_tokens,
                            api_key=api_key,
                            images=None,
                        )
                        chunk = self._strip_code_fences(text)
                        accumulated += chunk
                        total_tokens += tokens
                        print(f"generate_document fallback prompt: {tokens} tokens")
                        if r"\end{document}" in accumulated:
                            break
                    except (ContentBlockedError, TokenLimitError) as inner_e:
                        if isinstance(inner_e, TokenLimitError):
                            accumulated += self._strip_code_fences(inner_e.partial_text)
                            total_tokens += inner_e.tokens
                        else:
                            raise ContentBlockedError(
                                f"Content blocked even after restructuring retry: {inner_e}",
                                reason=getattr(inner_e, 'reason', 'UNKNOWN')
                            )
                else:
                    raise

        if r"\end{document}" not in accumulated:
            # Ensure document is closed even if we ran out of iterations
            accumulated = accumulated.rstrip() + "\n\\end{document}\n"

        return self._fix_latex_artifacts(accumulated), total_tokens

    # Maps (package_name → [regex patterns that require it]).
    # If any pattern is found in the document body and the package isn't loaded, inject it.
    _PACKAGE_TRIGGERS: List[Tuple[str, List[str]]] = [
        ("booktabs",    [r"\\toprule", r"\\midrule", r"\\bottomrule", r"\\cmidrule"]),
        ("graphicx",    [r"\\includegraphics"]),
        ("amsmath",     [r"\\begin\{align", r"\\begin\{equation\*\}", r"\\begin\{gather",
                         r"\\begin\{multline", r"\\DeclareMathOperator", r"\\text\{"]),
        ("amssymb",     [r"\\mathbb\{", r"\\mathfrak\{"]),
        ("tabularx",    [r"\\begin\{tabularx\}"]),
        ("multirow",    [r"\\multirow\{"]),
        ("xcolor",      [r"\\textcolor\{", r"\\colorbox\{", r"\\definecolor\{"]),
        ("subcaption",  [r"\\begin\{subfigure\}"]),
        ("caption",     [r"\\captionof\{"]),
        ("float",       [r"\\begin\{figure\}\[H\]", r"\\begin\{table\}\[H\]"]),
        ("algorithm",   [r"\\begin\{algorithm\}"]),
        ("algpseudocode", [r"\\begin\{algorithmic\}"]),
        ("listings",    [r"\\begin\{lstlisting\}", r"\\lstset\{"]),
        ("enumitem",    [r"\\begin\{enumerate\}\s*\["]),
        ("url",         [r"\\url\{"]),
        ("hyperref",    [r"\\href\{"]),
        ("cleveref",    [r"\\cref\{", r"\\Cref\{"]),
        ("siunitx",     [r"\\SI\{", r"\\si\{"]),
        ("bm",          [r"\\bm\{"]),
    ]

    @staticmethod
    def _fix_latex_artifacts(text: str) -> str:
        """
        Fix common model-generated LaTeX artifacts before saving.

        1. \\t<whitespace>  → t<space>  (LaTeX \\t is tie-after accent, not letter t)
        2. Bare tabulars   → wrapped in \\resizebox{\\textwidth}{!}{...}
        3. Auto-inject missing \\usepackage{} declarations needed by used commands
        4. Ensure geometry + microtype are present
        5. Remove duplicate \\begin{document} (chunked generation artefact)
        6. Truncate content after \\end{document}
        """
        # 1. \t<space> → t<space>
        text = re.sub(r'\\t(\s)', r't\1', text)

        # 2. Wrap any \begin{tabular} not already inside \resizebox
        def wrap_tabular(m: re.Match) -> str:
            before = text[:m.start()]
            if r'\resizebox' in before[-100:]:
                return m.group(0)
            return r'\resizebox{\textwidth}{!}{' + m.group(0) + r'}'

        text = re.sub(
            r'\\begin\{tabular\}.*?\\end\{tabular\}',
            wrap_tabular,
            text,
            flags=re.DOTALL,
        )

        # 3 + 4. Build a set of packages already loaded, then inject missing ones
        existing_pkgs = set(re.findall(r'\\usepackage(?:\[.*?\])?\{([^}]+)\}', text))
        # Flatten comma-separated packages: \usepackage{a,b,c}
        flat_pkgs: set = set()
        for pkg_str in existing_pkgs:
            for p in pkg_str.split(','):
                flat_pkgs.add(p.strip())

        # Also keep hyperref last (it redefines many things) — collect to append
        deferred_pkgs: list = []
        inject_lines: list = []

        for pkg, patterns in GeminiService._PACKAGE_TRIGGERS:
            if pkg in flat_pkgs:
                continue
            if any(re.search(pat, text) for pat in patterns):
                if pkg in ("hyperref",):
                    deferred_pkgs.append(pkg)
                else:
                    inject_lines.append(f"\\usepackage{{{pkg}}}")

        # geometry + microtype always present (overflow / typography)
        if 'geometry' not in flat_pkgs:
            inject_lines.insert(0, r'\usepackage[margin=1in]{geometry}')
        if 'microtype' not in flat_pkgs:
            inject_lines.insert(1, r'\usepackage{microtype}')

        all_inject = inject_lines + [f"\\usepackage{{{p}}}" for p in deferred_pkgs]
        if all_inject and r'\documentclass' in text:
            inject_block = "\n".join(all_inject)
            text = re.sub(
                r'(\\documentclass(?:\[.*?\])?\{.*?\})',
                lambda m: m.group(0) + "\n" + inject_block,
                text,
                count=1,
            )

        # 5. Remove duplicate \begin{document} — keep only the first occurrence
        doc_starts = [m.start() for m in re.finditer(r'\\begin\{document\}', text)]
        if len(doc_starts) > 1:
            # Remove all but the first \begin{document}
            for pos in reversed(doc_starts[1:]):
                text = text[:pos] + text[pos + len(r'\begin{document}'):]

        # 6. Truncate anything after \end{document}
        end_pos = text.rfind(r'\end{document}')
        if end_pos != -1:
            text = text[:end_pos + len(r'\end{document}')] + '\n'

        return text

    @staticmethod
    def _extract_image_references(latex: str) -> List[str]:
        """Return list of unique filenames referenced via \\includegraphics."""
        refs = re.findall(r'\\includegraphics(?:\[.*?\])?\{([^}]+)\}', latex)
        # Normalise: strip leading path components
        normalised = []
        for ref in refs:
            name = ref.strip().rsplit('/', 1)[-1]
            if name:
                normalised.append(name)
        return list(dict.fromkeys(normalised))  # unique, order-preserving

    async def _generate_bibliography(
        self, source_text: str, latex: str, api_key: Optional[str]
    ) -> str:
        """
        Extract \\cite{} keys from generated LaTeX, then ask Flash to produce
        matching BibTeX entries from the source reference list.
        Returns a BibTeX string, or empty string on failure.
        """
        # Extract all cited keys
        cited_keys = sorted(set(re.findall(r'\\cite\{([^}]+)\}', latex)))
        if not cited_keys:
            return ""

        # Find the References / Bibliography section in the source text
        ref_match = re.search(
            r'(?:References|Bibliography|Works Cited)\s*\n([\s\S]{200,8000})',
            source_text, re.IGNORECASE
        )
        ref_section = ref_match.group(1)[:6000] if ref_match else source_text[-4000:]

        prompt = (
            "You are a BibTeX formatter. Given the citation keys used in a LaTeX document "
            "and the reference list from the source paper, produce a .bib file with a "
            "BibTeX entry for every cited key.\n\n"
            f"CITATION KEYS NEEDED: {', '.join(cited_keys)}\n\n"
            f"SOURCE REFERENCE LIST:\n{ref_section}\n\n"
            "RULES:\n"
            "- Use the citation keys exactly as listed above.\n"
            "- Infer author, title, year, journal/booktitle, volume, pages, doi from the reference list.\n"
            "- If a key cannot be matched to a reference, create a placeholder entry.\n"
            "- Output ONLY valid BibTeX — no explanations, no markdown fences.\n"
            "- Start the first entry immediately.\n"
        )
        try:
            text, _ = await self._call_api(
                FLASH_MODEL, prompt, temperature=0.1,
                max_tokens=8192, api_key=api_key
            )
            bib = self._strip_code_fences(text).strip()
            # Sanity check: must contain at least one @article/@book/@misc
            if re.search(r'@\w+\{', bib):
                return bib
        except Exception as e:
            print(f"_generate_bibliography failed: {e}")
        return ""

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
    
    def _build_project_context(self, project_files: Optional[List[Dict]], active_document: str) -> str:
        """Build a context block from supporting project files (bib, cls, other tex)."""
        if not project_files:
            return ""
        context_parts = []
        for f in project_files:
            content = f.get("content", "")
            if not content or content == active_document:
                continue
            # Skip binary files and images
            if f.get("type") in ("png", "jpg", "pdf"):
                continue
            truncated_content = content[:3000]
            suffix = "..." if len(content) > 3000 else ""
            context_parts.append(f"--- {f['name']} ---\n{truncated_content}{suffix}")
        if not context_parts:
            return ""
        return "\nPROJECT FILES (for reference — do not reproduce unless instructed):\n" + "\n\n".join(context_parts) + "\n"

    async def agent_edit(self, document: str, instruction: str,
                        model: str = "pro",
                        selection: Optional[dict] = None,
                        project_files: Optional[List[Dict]] = None) -> Tuple[Dict[str, Any], int]:
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

        project_context = self._build_project_context(project_files, document)

        # Number the document lines so the model can reference them accurately
        numbered_lines = "\n".join(f"{i+1}: {line}" for i, line in enumerate(document.split("\n")))

        prompt = f"""You are an expert LaTeX editor. Your job is to make precise, surgical edits to LaTeX source files.
{project_context}

DOCUMENT (with line numbers):
{numbered_lines}
{"[Document truncated due to length]" if truncated else ""}
{selection_context}

USER INSTRUCTION: {instruction}

RULES:
1. The "original" field MUST be copied verbatim from the document — it will be used for exact string matching.
2. "start_line" and "end_line" are 1-based. For a single-line change they are equal.
3. Multi-line originals must include ALL lines from start_line to end_line, joined with \\n.
4. Make the MINIMUM number of changes needed. Do not reformat unrelated content.
5. Preserve the document's existing indentation, spacing, and LaTeX conventions.
6. For bibliography/citations: use \\cite{{key}}, ensure matching \\bibitem{{key}} in .bib section.
7. For new environments, commands, or packages: add \\usepackage{{}} to preamble if not already present.
8. Never break existing \\label{{}}–\\ref{{}} pairs unless explicitly asked.
9. If the instruction cannot be safely fulfilled (e.g., removing a label that is referenced), explain why in "explanation" and return an empty changes list.

Return a JSON object matching the schema exactly."""

        text, tokens = await self._call_api(
            model_name, prompt, temperature=0.2, max_tokens=16384,
            response_schema=AGENT_EDIT_CHANGES_SCHEMA,
        )
        
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

        text, tokens = await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=65536)
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

    def _try_repair_json(self, text: str) -> Optional[Dict]:
        """Try to repair and parse potentially truncated JSON."""
        if not text:
            return None
        text = text.strip()
        # Strip code fences
        if text.startswith("```"):
            first_newline = text.find("\n")
            if first_newline != -1:
                text = text[first_newline + 1:]
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3].rstrip()

        # Try direct parse first
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try to close incomplete JSON at the last complete object boundary
        for close_suffix in [']}', ']}\n', '\n]}']:
            last_brace = text.rfind('},')
            if last_brace > 0:
                try:
                    return json.loads(text[:last_brace + 1] + close_suffix)
                except json.JSONDecodeError:
                    pass

        return None

    async def agent_edit_stream(
        self,
        document: str,
        instruction: str,
        model: str = "pro",
        selection: Optional[dict] = None,
        project_files: Optional[List[Dict]] = None
    ):
        """
        Async generator for agent edit with automatic continuation on token cap.

        Yields:
          {"type": "chunk", "text": str}
          {"type": "result", "data": dict, "tokens": int}
        """
        yield {"type": "chunk", "text": "Analyzing your document..."}

        total_tokens = 0

        try:
            result, tokens = await self.agent_edit(document, instruction, model, selection, project_files)
            total_tokens = tokens
            yield {"type": "result", "data": result, "tokens": total_tokens}

        except TokenLimitError as e:
            # Response was truncated — try to salvage partial JSON first
            total_tokens = e.tokens
            repaired = self._try_repair_json(e.partial_text) if e.partial_text else None

            if repaired and repaired.get("changes"):
                yield {"type": "chunk", "text": "\nPartial result recovered."}
                yield {"type": "result", "data": repaired, "tokens": total_tokens}
            else:
                # Fall back to batched processing for large documents
                yield {"type": "chunk", "text": "\nDocument is large — switching to batch mode..."}
                batch_result, batch_tokens = await self.agent_edit_batched(document, instruction, model)
                total_tokens += batch_tokens
                yield {"type": "result", "data": batch_result, "tokens": total_tokens}

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
