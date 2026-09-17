import os
import re
import json
import asyncio
import hashlib
import logging
import random
import httpx
from datetime import datetime, timedelta
from typing import Tuple, List, Optional, Dict, Any
from config import Config

logger = logging.getLogger(__name__)

# Gemini models
FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-3.8-flash")
PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-3.1-pro-preview")
# Concurrent section fills. Unbounded fan-out on a long paper collected 429s, which the
# TokenLimitError path then turned into silently truncated sections.
SECTION_CONCURRENCY = int(os.getenv("SECTION_CONCURRENCY", "4"))
GEMINI_MAX_RETRIES = int(os.getenv("GEMINI_MAX_RETRIES", "4"))
# Roughly 20 pages of academic text. Named so callers can warn on the same number rather
# than silently dropping the tail of a long paper.
MAX_SOURCE_CHARS = int(os.getenv("MAX_SOURCE_CHARS", "40000"))

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

    async def _get_client(self) -> httpx.AsyncClient:
        """One pooled client for the process. A per-call client re-did the TLS handshake
        on every request, which the parallel section fills paid for N times over."""
        client = getattr(self, "_client", None)
        if client is None or client.is_closed:
            client = httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=540.0, write=30.0, pool=10.0),
                limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
            )
            self._client = client
        return client

    async def aclose(self):
        client = getattr(self, "_client", None)
        if client is not None and not client.is_closed:
            await client.aclose()

    async def _post_with_retry(self, client: httpx.AsyncClient, url: str,
                               headers: Dict, payload: Dict) -> httpx.Response:
        """Retry the retryable statuses with exponential backoff plus jitter.
        429/503 are the ones the parallel section fills actually produce."""
        delay = 1.0
        for attempt in range(GEMINI_MAX_RETRIES):
            response = await client.post(url, json=payload, headers=headers)
            if response.status_code not in (429, 500, 502, 503, 504):
                return response
            if attempt == GEMINI_MAX_RETRIES - 1:
                return response
            retry_after = response.headers.get("retry-after")
            wait = float(retry_after) if (retry_after or "").replace(".", "", 1).isdigit() else delay
            wait = min(wait, 30.0) + random.uniform(0, 0.5)
            logger.warning("Gemini %s, retrying in %.1fs (attempt %d/%d)",
                           response.status_code, wait, attempt + 1, GEMINI_MAX_RETRIES)
            await asyncio.sleep(wait)
            delay = min(delay * 2, 30.0)
        return response

    async def _create_cached_content(
        self,
        parts: List[Dict],
        model: str,
        api_key: str,
        fingerprint: str,
        display_name: str = "document_cache"
    ) -> Optional[str]:
        """
        Cache a set of content parts server-side and return its name, or None if the API
        declines. Takes parts rather than text so the cache can hold an inline PDF, which is
        the whole point: the source is uploaded once and every section fill references it.

        Caching has a minimum token floor, so a short source will legitimately fail here.
        Callers must treat None as "send it inline or go without", never as an error.
        """
        cached = await self.prompt_cache.get(fingerprint, model)
        if cached:
            return cached

        url = f"{self.gemini_base_url}/cachedContents"
        payload = {
            "model": f"models/{model}",
            "contents": [{"role": "user", "parts": parts}],
            "displayName": display_name,
            # Matches the local TTL, so a name we hand back is still live on their side.
            "ttl": f"{self.prompt_cache.ttl_seconds}s",
        }
        try:
            client = await self._get_client()
            response = await client.post(
                url, json=payload, headers={"x-goog-api-key": api_key}, timeout=30.0
            )
            if response.status_code == 200:
                cache_name = response.json().get("name")
                if cache_name:
                    await self.prompt_cache.set(fingerprint, model, cache_name)
                    return cache_name
            else:
                logger.info("Content caching declined (%s): %.200s",
                            response.status_code, response.text)
        except Exception as e:
            logger.warning("Cache creation failed: %s", e)
        
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
        cached_content: Optional[str] = None,
        thinking_level: Optional[str] = None
    ) -> Tuple[str, int]:
        key = self.get_api_key(api_key)
        if not key:
            return self._dev_response(prompt), 0

        # Key travels in a header, not the query string, so it stays out of access logs.
        url = f"{self.gemini_base_url}/models/{model}:generateContent"
        headers = {"x-goog-api-key": key, "Content-Type": "application/json"}

        # Build parts
        parts = self._build_image_parts(images)
        parts.append({"text": prompt})

        # Build generation config
        gen_config: Dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        }

        # Measured on this key: flash spends 0 thinking tokens at "low" and ~477 at "high";
        # pro 355 and 710. Worth it where one call decides the shape of everything after it,
        # wasteful on transcription under a fixed schema.
        if thinking_level:
            gen_config["thinkingConfig"] = {"thinkingLevel": thinking_level}

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
                {"category": "HARM_CATEGORY_CIVIC_INTEGRITY", "threshold": "BLOCK_NONE"},
            ]
        }

        # Use cached content if available
        if cached_content:
            payload["cachedContent"] = cached_content

        client = await self._get_client()
        response = await self._post_with_retry(client, url, headers, payload)

        if response.status_code != 200:
            err_msg = response.text[:500]
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
        except Exception as parse_err:
            # The full response echoes prompt content; log it, do not raise it outward.
            logger.error("Failed to parse Gemini response (%s): %.2000s", parse_err, result)
            raise Exception("Malformed response from the model provider") from parse_err

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
        thinking_level: Optional[str] = None,
    ) -> Tuple[str, int]:
        if not self.gemini_api_key and not api_key:
            return self._dev_response(prompt), 0
        return await self._call_gemini_api(
            model, prompt, temperature, max_tokens,
            api_key, images, response_schema, cached_content, thinking_level
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

    async def autocomplete(self, context: str, cursor_pos: int, file_name: str,
                           api_key: Optional[str] = None) -> Tuple[str, int]:
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

        try:
            text, tokens = await self._call_api(FLASH_MODEL, prompt, temperature=0.1, max_tokens=100,
                                                api_key=api_key, thinking_level="low")
        except TokenLimitError as e:
            # Partial text is still a usable completion suggestion
            return e.partial_text.strip(), e.tokens
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
        try:
            text, _ = await self._call_api(
                FLASH_MODEL, prompt, temperature=0.0, max_tokens=8192, api_key=api_key
            )
        except TokenLimitError as e:
            # Partial inventory is still useful — return what we got
            text = e.partial_text
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

    # JSON schema for structure pass response.
    # Sections are located by a verbatim anchor, never by character offset: models cannot
    # count characters, and invented offsets produced overlapping/gapped slices of the source.
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
                        "anchor": {"type": "string"},
                        "figures": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["heading", "placeholder", "anchor", "figures"],
                    "propertyOrdering": ["heading", "placeholder", "anchor", "figures"],
                },
            },
            "postamble": {"type": "string"},
        },
        "required": ["preamble", "sections", "postamble"],
        "propertyOrdering": ["preamble", "sections", "postamble"],
    }

    async def _generate_structure(
        self, content: str, theme_desc: str, cls_instruction: str,
        custom_preamble: str, api_key: Optional[str],
        figure_names: Optional[List[str]] = None,
        source_pdf: Optional[str] = None
    ) -> Optional[Dict]:
        """
        Pass 1: Flash generates the LaTeX skeleton — preamble, section list with verbatim
        source anchors, and postamble. Returns parsed dict or None on failure.
        """
        # Figures already exist on disk under these names; the model assigns them rather
        # than inventing filenames the project has no file for.
        figures_rule = (
            "- figures: for each section, the subset of these figure files that belongs in "
            f"it, in order: {', '.join(figure_names)}. Use each file in exactly one section, "
            "matching where the source refers to it. Sections with no figure get an empty "
            "array. Do not invent filenames.\n"
        ) if figure_names else (
            "- figures: always an empty array (no figures were supplied).\n"
        )

        # With the PDF attached the text below is still what anchors resolve against, so it
        # must stay the reference for anchor text even though the PDF is the better read.
        pdf_note = (
            "\nThe original PDF is attached. Read structure and figure placement from it, "
            "but copy anchors verbatim from the SOURCE PAPER text below, which is what the "
            "anchors are matched against.\n"
        ) if source_pdf else ""

        prompt = (
            f"You are a LaTeX document architect. Analyse the academic paper below "
            f"and produce a JSON document skeleton using {theme_desc} style.\n\n"
            "RULES:\n"
            "- preamble: \\documentclass + \\usepackage block (include "
            "\\usepackage[backend=bibtex,style=authoryear]{biblatex} and "
            "\\addbibresource{references.bib}) + \\title + "
            "\\author + \\date + \\begin{document} + \\maketitle + "
            "\\begin{abstract}ABSTRACT_PLACEHOLDER\\end{abstract}\n"
            "  (use the literal text ABSTRACT_PLACEHOLDER — do NOT write the abstract content here)\n"
            "- sections: array of top-level sections (Introduction, Methods, etc.) in the order "
            "they appear, each with a unique placeholder string (SECTION_0, SECTION_1, …) and an "
            "'anchor': the first 8-12 words of the source text where that section begins, copied "
            "EXACTLY character-for-character from the source below. The anchor must be text you "
            "can see in the source — do not paraphrase, renumber, or reformat it. Do NOT report "
            "character offsets or positions.\n"
            "- postamble: \\printbibliography + \\end{document} (use biblatex, NOT \\bibliographystyle or \\bibliography)\n"
            f"{figures_rule}"
            f"{cls_instruction}"
            f"{('Extra preamble: ' + custom_preamble + chr(10)) if custom_preamble else ''}"
            f"{pdf_note}"
            "\nSOURCE PAPER:\n"
            f"{content[:MAX_SOURCE_CHARS]}\n\n"
            "Return ONLY the JSON object."
        )
        try:
            text, _ = await self._call_api(
                FLASH_MODEL, prompt, temperature=0.1,
                max_tokens=32768, api_key=api_key,
                images=[source_pdf] if source_pdf else None,
                response_schema=self._STRUCTURE_SCHEMA,
                thinking_level="high"
            )
            return json.loads(text)
        except TokenLimitError as e:
            # Truncated JSON is unparseable — structure pass must be complete
            print(f"_generate_structure hit token limit ({e.tokens} tokens), structure response incomplete")
            return None
        except Exception as e:
            print(f"_generate_structure failed: {e}")
            return None

    async def _fill_section(
        self, section_text: str, heading: str, preamble: str,
        inventory: str, theme_desc: str, cls_instruction: str,
        api_key: Optional[str], max_tokens: int,
        images: Optional[List[str]] = None, figure_names: Optional[List[str]] = None,
        cached_content: Optional[str] = None
    ) -> Tuple[str, int]:
        """
        Pass 2: Pro fills one section with full token budget.
        Returns (latex_body, tokens) — no preamble, no \\begin{document}.
        """
        inventory_block = (
            "CONTENT CHECKLIST for this section (all items MUST appear):\n"
            f"{inventory}\n\n"
        ) if inventory else ""

        # The files are already saved under these names, so \includegraphics must use them
        # verbatim; an invented name resolves to nothing at compile time.
        figures_block = (
            "FIGURES for this section — include each in a figure environment with a caption, "
            f"using exactly these filenames: {', '.join(figure_names)}\n\n"
        ) if figure_names else ""

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
            "- Use p{} or X columns for text-heavy columns, never wide l/c/r.\n"
            "- For figures use [width=0.7\\textwidth] or smaller — NEVER [width=\\textwidth].\n"
            "- Use \\cite{key} for citations (biblatex). Do NOT use \\t for indentation — just start text directly.\n\n"
            f"{cls_instruction}"
            f"{inventory_block}"
            f"{figures_block}"
            f"{source_note}"
            f"PREAMBLE CONTEXT (for package awareness — do not repeat):\n{preamble[:1500]}\n\n"
            f"SOURCE TEXT FOR THIS SECTION:\n{section_text}\n\n"
            "BEGIN LATEX SECTION OUTPUT NOW:\n"
        )
        try:
            text, tokens = await self._call_api(
                PRO_MODEL, prompt, temperature=0.15,
                max_tokens=max_tokens, api_key=api_key, images=images,
                cached_content=cached_content, thinking_level="low"
            )
        except TokenLimitError as e:
            # Partial section content is better than a missing section
            return self._strip_code_fences(e.partial_text), e.tokens
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
        except TokenLimitError as e:
            # Use partial output if it's still a complete document
            fixed = self._strip_code_fences(e.partial_text)
            return fixed if r"\end{document}" in fixed else latex
        except Exception as e:
            print(f"_fix_labels failed: {e}")
            return latex
        fixed = self._strip_code_fences(text)
        # Sanity check: result should still contain \end{document}
        if r"\end{document}" in fixed:
            return fixed
        return latex

    @staticmethod
    def _extract_abstract(content: str) -> str:
        r"""
        Extract the abstract text from source content.
        Returns the raw text to embed in \begin{abstract}...\end{abstract}.
        Falls back to the first 800 chars of content if no abstract section is found.
        """
        # Common abstract header patterns
        m = re.search(
            r'(?:^|\n)\s*[Aa]bstract[:\s]*\n([\s\S]{50,3000?}?)(?=\n\s*(?:[IVXivx]+[.\s]|[A-Z][a-z]+\s*\n|\d+\s*[.)]?\s*[A-Z]|Keywords?|Introduction))',
            content
        )
        if m:
            return m.group(1).strip()
        # Fallback: first paragraph of meaningful length
        for para in content.split('\n\n'):
            para = para.strip()
            if 100 < len(para) < 2000 and not para.startswith('\\'):
                return para
        return content[:800].strip()

    @staticmethod
    def _section_figures(section: Dict, by_name: Dict[str, str]) -> List[str]:
        """Figures the structure pass assigned to this section, minus any it invented."""
        return [n for n in (section.get("figures") or []) if n in by_name]

    @staticmethod
    def _locate_sections(content: str, sections: List[Dict]) -> Tuple[List[Tuple[int, int]], int]:
        """
        Resolve each section's verbatim anchor to a source offset. Searching is forward-only
        so sections stay in document order, whitespace-flexible because models re-wrap text
        they copy, and falls back to shorter prefixes when the tail of an anchor drifts.
        Unresolved anchors are spread evenly between their located neighbours.
        Returns (spans, resolved_count).
        """
        n = len(sections)
        starts: List[Optional[int]] = []
        cursor = 0
        resolved = 0
        for sec in sections:
            words = (sec.get("anchor") or "").split()
            pos = None
            for take in sorted({len(words), 8, 6, 4}, reverse=True):
                if take < 3 or take > len(words):
                    continue
                pat = re.compile(r"\s+".join(map(re.escape, words[:take])), re.IGNORECASE)
                m = pat.search(content, cursor)
                if m:
                    pos = m.start()
                    break
            starts.append(pos)
            if pos is not None:
                resolved += 1
                cursor = pos + 1

        i = 0
        while i < n:
            if starts[i] is not None:
                i += 1
                continue
            j = i
            while j < n and starts[j] is None:
                j += 1
            lo = starts[i - 1] if i > 0 else 0
            hi = starts[j] if j < n else len(content)
            span = max(1, hi - lo)
            for k in range(i, j):
                starts[k] = lo + span * (k - i + 1) // (j - i + 1)
            i = j

        spans = [(starts[k], starts[k + 1] if k + 1 < n else len(content)) for k in range(n)]
        return [(a, max(a + 1, b)) for a, b in spans], resolved

    async def _generate_document_chunked(
        self,
        content: str,
        theme_desc: str,
        cls_instruction: str,
        extra_instructions: str,
        custom_preamble: str,
        images: Optional[List[str]],
        api_key: Optional[str],
        max_tokens: int,
        image_names: Optional[List[str]] = None,
        source_pdf: Optional[str] = None
    ) -> Optional[Tuple[str, int]]:
        """
        Three-pass section-chunked generation. Returns (latex, total_tokens) or None on failure.
        """
        # Figures were saved under these names before generation; map them so each section
        # fill receives only its own, instead of every figure or (until now) none at all.
        image_names = image_names or []
        by_name = dict(zip(image_names, images or []))

        # Pass 1: structure
        structure = await self._generate_structure(content, theme_desc, cls_instruction,
                                                   custom_preamble, api_key, image_names,
                                                   source_pdf)
        if not structure or not structure.get("sections"):
            return None

        preamble = structure["preamble"]
        sections = structure["sections"]
        postamble = structure["postamble"]
        total_tokens = 0

        # Fill ABSTRACT_PLACEHOLDER with extracted abstract text from source
        if "ABSTRACT_PLACEHOLDER" in preamble:
            abstract_text = self._extract_abstract(content)
            preamble = preamble.replace("ABSTRACT_PLACEHOLDER", abstract_text)

        spans, resolved = self._locate_sections(content, sections)
        print(f"_generate_document_chunked: {len(sections)} sections, {resolved} anchors resolved")

        # Too few anchors located means the skeleton does not describe this source; a
        # single-pass generation is better than stitching sections from guessed spans.
        if resolved < max(1, len(sections) // 2):
            print("_generate_document_chunked: anchor resolution too low, abandoning chunked path")
            return None

        # The PDF goes up once and every section fill references it. Sending it inline per
        # section instead would re-upload the whole paper N times; without it the fills see
        # only the flattened text extract, which is what loses equations and tables.
        # Caches are model-scoped, so this one is for the fill model only — the single
        # structure call on FLASH_MODEL carries the PDF inline instead.
        pdf_cache = None
        if source_pdf:
            key = self.get_api_key(api_key)
            if key:
                fingerprint = hashlib.sha256(source_pdf.encode()).hexdigest()
                pdf_cache = await self._create_cached_content(
                    self._build_image_parts([source_pdf]), PRO_MODEL, key, fingerprint,
                    display_name="source_pdf",
                )
            if not pdf_cache:
                # Not fatal: fills fall back to the text slice, which is today's behaviour.
                print("_generate_document_chunked: PDF not cached, sections use text only")

        # Pass 2: fill sections, bounded so a long document cannot fire dozens of
        # concurrent calls and collect rate-limit truncations instead of content.
        gate = asyncio.Semaphore(SECTION_CONCURRENCY)

        async def fill_one(section: Dict, idx: int) -> Tuple[int, str, int]:
            src_start, src_end = spans[idx]
            section_text = content[src_start:src_end]
            if not section_text.strip():
                section_text = content[max(0, src_start - 500): min(len(content), src_end + 500)]

            async with gate:
                inv = ""
                if len(section_text) > 500:
                    try:
                        inv = await self._extract_content_inventory(section_text, api_key)
                    except Exception as inv_err:
                        # Non-fatal: the section is still filled, just without a checklist.
                        print(f"  inventory failed for section {idx} ({section.get('heading')}): {inv_err}")

                names = self._section_figures(section, by_name)
                body, tokens = await self._fill_section(
                    section_text, section["heading"], preamble,
                    inv, theme_desc, cls_instruction, api_key, max_tokens,
                    images=[by_name[n] for n in names] or None,
                    figure_names=names or None,
                    cached_content=pdf_cache,
                )
            return idx, body, tokens

        results = await asyncio.gather(
            *[fill_one(s, i) for i, s in enumerate(sections)], return_exceptions=True
        )

        # Stitch in order
        section_bodies: Dict[int, str] = {}
        failed = 0
        for res in results:
            if isinstance(res, BaseException):
                failed += 1
                print(f"  section failed: {res}")
                continue
            idx, body, tokens = res
            section_bodies[idx] = body
            total_tokens += tokens

        if failed > len(sections) // 2:
            print(f"_generate_document_chunked: {failed}/{len(sections)} sections failed, falling back")
            return None

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
        max_tokens: int = 65536,
        image_names: Optional[List[str]] = None,
        source_pdf: Optional[str] = None
    ) -> Tuple[str, int]:
        theme_desc = custom_theme if theme == "custom" else self._get_theme_description(theme)

        content = content[:MAX_SOURCE_CHARS]

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
        # The attached PDF holds what the text extract dropped: math, tables, layout.
        pdf_note = (
            "The original PDF is attached. Transcribe equations, tables and numbers from it "
            "rather than from the text below, which is a flattened extract.\n"
        ) if source_pdf else ""

        # Naming the files matters: they are already saved under these names, so an invented
        # one compiles to a missing-figure error and shows up as a spurious missing_images.
        images_note = (
            "FIGURES — include each in a figure environment with a caption, using exactly "
            f"these filenames: {', '.join(image_names)}\n"
        ) if images and image_names else (
            "Images supplied — include each with \\includegraphics in a figure environment.\n"
            if images else ""
        )

        # For long documents (>6000 chars), try section-chunked generation first
        if len(content) > 6000:
            try:
                chunked_result = await self._generate_document_chunked(
                    content, theme_desc, cls_instruction,
                    extra_instructions, custom_preamble or "",
                    images, api_key, max_tokens, image_names, source_pdf
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
            f"{pdf_note}"
            "\nSOURCE DOCUMENT:\n"
            f"{content}\n\n"
            "BEGIN LATEX OUTPUT NOW:\n"
        )

        accumulated = ""
        total_tokens = 0
        max_iterations = 8
        used_fallback_prompt = False
        # Cap per-call tokens so the non-streaming API can respond within its server deadline
        # (~60s). The iteration loop continues until \end{document} is reached.
        per_call_max_tokens = min(max_tokens, 16384)

        for iteration in range(max_iterations):
            try:
                if iteration == 0:
                    current_prompt = initial_prompt
                    # PDF first so the model reads the real document, then the figure files.
                    current_images = ([source_pdf] + (images or [])) if source_pdf else images
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
                    max_tokens=per_call_max_tokens,
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
                            max_tokens=per_call_max_tokens,
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
        # 1. Strip model-generated \t (LaTeX tie-after accent — not a tab/indent):
        #    \t{X} → X  (braced form, e.g. \t{T}his → This, \t{h}is → his)
        text = re.sub(r'\\t\{(.)\}', r'\1', text)
        #    \t<space>+<lowercase> → uppercase letter  (model used \t as indent before a word)
        #    e.g. \t his paper → His paper
        text = re.sub(r'\\t\s+([a-z])', lambda m: m.group(1).upper(), text)
        #    \t<space>+ (remaining cases, before uppercase or non-letter) → remove
        text = re.sub(r'\\t\s+', '', text)

        # 1b. Decorative first-letter commands the model generates that have no package:
        #    \lettrine{T}{his} → This, \dropcap{T}his → This, etc.
        for _dc in ['lettrine', 'Lettrine', 'dropcap', 'initial', 'drop', 'yinipar']:
            # two-arg form: \cmd[opts]{T}{his} → This  (optional [...] before first brace)
            text = re.sub(rf'\\{_dc}(?:\[.*?\])?\{{([A-Za-z])\}}\{{([^}}]*)\}}', r'\1\2', text)
            # one-arg form: \cmd[opts]{T}his → This
            text = re.sub(rf'\\{_dc}(?:\[.*?\])?\{{([A-Za-z])\}}', r'\1', text)

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

        # 5a. Cap figure widths — model often uses [width=\textwidth] which makes graphs
        #     fill the entire page.  Clamp to 0.7\textwidth as a sensible default.
        text = re.sub(
            r'\\includegraphics\[([^\]]*?)width\\?=?\\textwidth([^\]]*?)\]',
            lambda m: r'\includegraphics[' + m.group(1) + r'width=0.7\textwidth' + m.group(2) + ']',
            text,
        )

        # 5b. Convert traditional BibTeX bibliography commands → biblatex if needed
        # Replace \bibliographystyle{...} + \bibliography{...} with \printbibliography
        text = re.sub(r'\\bibliographystyle\{[^}]+\}\s*', '', text)
        text = re.sub(r'\\bibliography\{([^}]+)\}', r'\\printbibliography', text)
        # Ensure biblatex is loaded if \printbibliography is present
        if r'\printbibliography' in text and 'biblatex' not in text:
            text = re.sub(
                r'(\\documentclass(?:\[.*?\])?\{.*?\})',
                lambda m: m.group(0) + '\n\\usepackage[backend=bibtex,style=authoryear]{biblatex}\n\\addbibresource{references.bib}',
                text, count=1,
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
        Extract \\cite{} keys from generated LaTeX, ask Flash to produce matching
        BibTeX entries, and return the raw BibTeX content (no filecontents wrapper).
        Returns an empty string on failure.
        """
        # Extract all cited keys (handle \cite{key1,key2} multi-key form)
        raw_keys = re.findall(r'\\cite(?:\[.*?\])?\{([^}]+)\}', latex)
        cited_keys = sorted(set(
            k.strip() for group in raw_keys for k in group.split(',') if k.strip()
        ))
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
            "and the reference list from the source paper, produce valid BibTeX entries.\n\n"
            f"CITATION KEYS NEEDED: {', '.join(cited_keys)}\n\n"
            f"SOURCE REFERENCE LIST:\n{ref_section}\n\n"
            "RULES:\n"
            "- Output one BibTeX entry (@article, @book, @misc, @techreport, etc.) per citation key.\n"
            "- Use the citation key exactly as listed in CITATION KEYS NEEDED.\n"
            "- Populate author, title, year, journal/booktitle, volume, number, pages, doi, url "
            "fields from the reference list — omit fields you cannot determine.\n"
            "- For institutional authors (e.g. government agencies) use double braces: "
            "author = {{Bureau of Labor Statistics}}.\n"
            "- If a key cannot be matched to a source reference, create a plausible placeholder.\n"
            "- Output ONLY valid BibTeX — no explanations, no markdown fences, no comments.\n"
            "- Start the first @entry immediately on line 1.\n"
        )
        try:
            text, _ = await self._call_api(
                FLASH_MODEL, prompt, temperature=0.1,
                max_tokens=8192, api_key=api_key
            )
        except TokenLimitError as e:
            # Use whatever BibTeX was generated before the limit was hit
            text = e.partial_text
        except Exception as e:
            print(f"_generate_bibliography failed: {e}")
            return ""
        bib = self._strip_code_fences(text).strip()
        if re.search(r'@\w+\{', bib):
            return bib
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
                  model: str = "flash", api_key: Optional[str] = None) -> Tuple[str, int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL

        prompt = f"""You are a LaTeX expert assistant.

Document context:
{context[:2000]}

User message: {message}

Provide helpful, concise assistance. If suggesting code changes, show the LaTeX code clearly."""

        return await self._call_api(model_name, prompt, temperature=0.3, max_tokens=1024, api_key=api_key)
    
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

    @staticmethod
    def _file_type_rules(file_name: Optional[str]) -> str:
        """Return file-type-specific editing rules for the prompt."""
        if not file_name:
            return ""
        ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        if ext == "cls":
            return (
                f"FILE TYPE: LaTeX class file ({file_name})\n"
                "Class-file-specific rules:\n"
                "- Use \\RequirePackage{{}} instead of \\usepackage{{}} to load packages.\n"
                "- Use \\ProvidesClass{{}} or \\ProvidesPackage{{}} for identification.\n"
                "- Define commands with \\newcommand, \\renewcommand, or \\def.\n"
                "- Do NOT add \\begin{{document}} or \\end{{document}} — class files have no document body.\n"
                "- Class options are handled with \\DeclareOption / \\ProcessOptions.\n"
            )
        if ext == "bib":
            return (
                f"FILE TYPE: BibTeX bibliography file ({file_name})\n"
                "BibTeX-specific rules:\n"
                "- Entries are @type{{key, field = {{value}}, ...}} — preserve this syntax exactly.\n"
                "- Do not add LaTeX commands outside of entry field values.\n"
            )
        if ext == "sty":
            return (
                f"FILE TYPE: LaTeX package file ({file_name})\n"
                "Package-file-specific rules:\n"
                "- Use \\RequirePackage{{}} to load dependencies.\n"
                "- Use \\ProvidesPackage{{}} for identification.\n"
                "- Do NOT add \\begin{{document}} or \\end{{document}}.\n"
            )
        # Default: treat as .tex
        return (
            f"FILE TYPE: LaTeX source file ({file_name})\n"
            "Source-file rules:\n"
            "- For new packages: add \\usepackage{{}} to the preamble if not already present.\n"
            "- Never break existing \\label{{}}–\\ref{{}} pairs unless explicitly asked.\n"
            "- For bibliography/citations: use \\cite{{key}}, ensure matching \\bibitem{{key}} in .bib.\n"
        )

    @staticmethod
    def _window_document(
        document: str,
        cursor_line: Optional[int] = None,
        selection: Optional[dict] = None,
        window_half: int = 120,
    ) -> Tuple[str, int, int]:
        """
        Return (windowed_doc, preamble_line_count, body_window_start).

        preamble_line_count  — number of leading lines kept verbatim (up to and
                               including \\begin{document}).
        body_window_start    — 0-based index into the *body* (post-preamble) lines
                               where the window begins.  Used to translate the
                               model's line numbers back to the original document.

        Translation rule for a change at windowed line W (1-based):
          - If W <= preamble_line_count → original line = W  (no offset)
          - Otherwise                  → original line = W + body_window_start
        """
        lines = document.split('\n')

        # Locate end of preamble
        preamble_end = 0
        for i, line in enumerate(lines):
            if r'\begin{document}' in line:
                preamble_end = i + 1  # exclusive upper bound
                break

        preamble = lines[:preamble_end]
        body = lines[preamble_end:]

        # Determine centre of window inside body (0-based body index)
        if selection:
            start_b = max(0, selection['start_line'] - preamble_end - 1)
            end_b   = max(0, selection['end_line']   - preamble_end - 1)
            center_b = (start_b + end_b) // 2
            half = max(window_half, (end_b - start_b) + 30)
        elif cursor_line:
            center_b = max(0, cursor_line - preamble_end - 1)
            half = window_half
        else:
            # No cursor hint — send preamble + first portion of body unchanged
            return document, preamble_end, 0

        center_b  = max(0, min(center_b, len(body) - 1))
        body_start = max(0, center_b - half)
        body_end   = min(len(body), center_b + half + 1)

        windowed = '\n'.join(preamble + body[body_start:body_end])
        return windowed, preamble_end, body_start

    async def agent_edit(self, document: str, instruction: str,
                        model: str = "pro",
                        selection: Optional[dict] = None,
                        project_files: Optional[List[Dict]] = None,
                        file_name: Optional[str] = None,
                        cursor_line: Optional[int] = None,
                        api_key: Optional[str] = None) -> Tuple[Dict[str, Any], int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL

        # Window the document around the cursor / selection instead of a hard truncation
        windowed_doc, preamble_lines, body_window_start = self._window_document(
            document, cursor_line=cursor_line, selection=selection
        )

        # Hard-cap only when no cursor hint is available (legacy fallback)
        max_doc_length = 15000
        truncated = False
        if cursor_line is None and selection is None and len(windowed_doc) > max_doc_length:
            windowed_doc = windowed_doc[:max_doc_length]
            truncated = True
        document = windowed_doc

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
        file_type_rules = self._file_type_rules(file_name)

        # Number the document lines so the model can reference them accurately
        numbered_lines = "\n".join(f"{i+1}: {line}" for i, line in enumerate(document.split("\n")))

        prompt = f"""You are an expert LaTeX editor. Your job is to make precise, surgical edits to the file shown below.
{project_context}
{file_type_rules}
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
9. If the instruction cannot be safely fulfilled, explain why in "explanation" and return an empty changes list.

Return a JSON object matching the schema exactly."""

        text, tokens = await self._call_api(
            model_name, prompt, temperature=0.2, max_tokens=16384,
            response_schema=AGENT_EDIT_CHANGES_SCHEMA,
            api_key=api_key,
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

            # Translate windowed line numbers back to original document line numbers.
            # Rule: for body lines (windowed_line > preamble_lines):
            #   original_line = windowed_line + body_window_start
            if body_window_start > 0:
                for change in result["changes"]:
                    for key in ("start_line", "end_line"):
                        val = change.get(key)
                        if isinstance(val, int) and val > preamble_lines:
                            change[key] = val + body_window_start

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
        project_files: Optional[List[Dict]] = None,
        file_name: Optional[str] = None,
        cursor_line: Optional[int] = None,
        api_key: Optional[str] = None,
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
            result, tokens = await self.agent_edit(document, instruction, model, selection, project_files, file_name, cursor_line, api_key=api_key)
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
                batch_result, batch_tokens = await self.agent_edit_batched(document, instruction, model, api_key=api_key)
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
