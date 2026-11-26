import hashlib
import json
import logging
from typing import Optional, Tuple, Dict, Any, List, AsyncGenerator

from config import Config

logger = logging.getLogger(__name__)

PROVIDER_MODELS = {
    "gemini":    {"flash": "gemini-3.8-flash",            "pro": "gemini-3.1-pro-preview"},
    "openai":    {"flash": "gpt-4o-mini",                 "pro": "gpt-4o"},
    "anthropic": {"flash": "claude-3-5-haiku-20241022",   "pro": "claude-opus-4-5"},
    "mistral":   {"flash": "mistral-small-latest",        "pro": "mistral-large-latest"},
}

SUPPORTED_PROVIDERS = list(PROVIDER_MODELS.keys())


# ─── Encryption helpers ──────────────────────────────────────────────────────

def encrypt_key(plaintext: str) -> str:
    from cryptography.fernet import Fernet
    key = Config.FERNET_KEY
    if not key:
        raise RuntimeError("FERNET_KEY not configured")
    f = Fernet(key.encode() if isinstance(key, str) else key)
    return f.encrypt(plaintext.encode()).decode()


def decrypt_key(ciphertext: str) -> str:
    from cryptography.fernet import Fernet
    key = Config.FERNET_KEY
    if not key:
        raise RuntimeError("FERNET_KEY not configured")
    f = Fernet(key.encode() if isinstance(key, str) else key)
    return f.decrypt(ciphertext.encode()).decode()


# ─── Provider resolution ─────────────────────────────────────────────────────

def get_provider_for_user(user: dict) -> "LLMProvider":
    """Resolve which LLMProvider to use for a given user dict."""
    settings = user.get("settings") or {}
    preferred = settings.get("preferred_provider", "gemini")
    encrypted_keys = settings.get("providers") or {}
    encrypted = encrypted_keys.get(preferred)

    api_key: Optional[str] = None
    if encrypted:
        try:
            api_key = decrypt_key(encrypted)
        except Exception:
            logger.warning("Failed to decrypt API key for provider %s — falling back to system key", preferred)
            preferred = "gemini"
            api_key = None
    elif preferred != "gemini":
        # No key stored for requested provider — fall back to Gemini system key
        logger.info("No custom key for provider %s; falling back to Gemini", preferred)
        preferred = "gemini"

    return LLMProvider(provider=preferred, api_key=api_key)


# ─── LLMProvider class ───────────────────────────────────────────────────────

class LLMProvider:
    """
    Unified interface for all LLM providers. Gemini uses the existing
    GeminiService (raw httpx) to preserve caching and structured output.
    Other providers use LangChain.
    """

    def __init__(self, provider: str = "gemini", api_key: Optional[str] = None):
        self.provider = provider if provider in SUPPORTED_PROVIDERS else "gemini"
        self.api_key = api_key  # None → use system default (Gemini only)

    # ── Autocomplete ──────────────────────────────────────────────────────────

    async def autocomplete(self, context: str, cursor_pos: int, file_name: str) -> Tuple[str, int]:
        if self.provider == "gemini":
            from api.services.gemini import gemini_service
            return await gemini_service.autocomplete(context, cursor_pos, file_name, api_key=self.api_key)
        return await self._lc_autocomplete(context, cursor_pos, file_name)

    async def _lc_autocomplete(self, context: str, cursor_pos: int, file_name: str) -> Tuple[str, int]:
        trimmed = context[:cursor_pos][-2000:]
        prompt = (
            f"You are a LaTeX expert providing intelligent autocomplete.\n\n"
            f"Context (code before cursor):\n{trimmed}\n\nFile: {file_name}\n\n"
            "Provide a SINGLE short completion (1-2 lines max) that would logically follow. "
            "Return ONLY the completion text, nothing else."
        )
        text, tokens = await self._lc_call("flash", prompt, temperature=0.1, max_tokens=100)
        return text.strip(), tokens

    # ── Chat ──────────────────────────────────────────────────────────────────

    async def chat(self, message: str, context: str, model: str = "flash") -> Tuple[str, int]:
        if self.provider == "gemini":
            from api.services.gemini import gemini_service
            return await gemini_service.chat(message, context, model, api_key=self.api_key)
        return await self._lc_chat(message, context, model)

    async def _lc_chat(self, message: str, context: str, model: str) -> Tuple[str, int]:
        prompt = (
            f"You are a LaTeX expert assistant.\n\nDocument context:\n{context[:2000]}\n\n"
            f"User message: {message}\n\n"
            "Provide helpful, concise assistance. If suggesting code changes, show the LaTeX code clearly."
        )
        return await self._lc_call(model, prompt, temperature=0.3, max_tokens=1024)

    # ── Agent edit ────────────────────────────────────────────────────────────

    async def agent_edit(
        self, document: str, instruction: str, model: str = "pro",
        selection: Optional[dict] = None,
        project_files: Optional[List[Dict]] = None,
        file_name: Optional[str] = None,
        cursor_line: Optional[int] = None,
    ) -> Tuple[Dict[str, Any], int]:
        if self.provider == "gemini":
            from api.services.gemini import gemini_service
            return await gemini_service.agent_edit(
                document, instruction, model, selection=selection,
                project_files=project_files, file_name=file_name,
                cursor_line=cursor_line, api_key=self.api_key,
            )
        return await self._lc_agent_edit(document, instruction, model, selection)

    async def _lc_agent_edit(
        self, document: str, instruction: str, model: str,
        selection: Optional[dict],
    ) -> Tuple[Dict[str, Any], int]:
        numbered = "\n".join(f"{i+1}: {l}" for i, l in enumerate(document[:12000].split("\n")))
        sel_ctx = ""
        if selection:
            sel_ctx = (
                f"\nSELECTED LINES {selection['start_line']}-{selection['end_line']}:\n"
                f"---\n{selection['text'][:2000]}\n---\n"
                "Focus your changes on this selection.\n"
            )
        schema_str = json.dumps({
            "explanation": "string",
            "changes": [{"start_line": 0, "end_line": 0, "original": "string", "replacement": "string", "reason": "string"}]
        }, indent=2)
        prompt = (
            f"You are an expert LaTeX editor. Make precise, minimal edits.\n\n"
            f"DOCUMENT (with line numbers):\n{numbered}\n{sel_ctx}\n"
            f"USER INSTRUCTION: {instruction}\n\n"
            "RULES:\n"
            "1. 'original' MUST be copied verbatim — used for exact string matching.\n"
            "2. line numbers are 1-based.\n"
            "3. Return ONLY valid JSON matching this schema exactly (no markdown fences):\n"
            f"{schema_str}"
        )
        text, tokens = await self._lc_call(model, prompt, temperature=0.2, max_tokens=8192)
        try:
            clean = text.strip()
            if clean.startswith("```"):
                parts = clean.split("```")
                clean = parts[1] if len(parts) >= 2 else clean
                if clean.startswith("json"):
                    clean = clean[4:].strip()
            result = json.loads(clean)
            if not isinstance(result, dict):
                raise ValueError("not a dict")
            result.setdefault("explanation", "AI suggested changes")
            result.setdefault("changes", [])
            return result, tokens
        except Exception as e:
            return {"explanation": f"Parse error: {str(e)[:100]}", "changes": []}, tokens

    # ── Agent edit stream ─────────────────────────────────────────────────────

    async def agent_edit_stream(
        self, document: str, instruction: str, model: str = "pro",
        selection: Optional[dict] = None,
        project_files: Optional[List[Dict]] = None,
        file_name: Optional[str] = None,
        cursor_line: Optional[int] = None,
    ) -> AsyncGenerator:
        if self.provider == "gemini":
            from api.services.gemini import gemini_service
            async for event in gemini_service.agent_edit_stream(
                document, instruction, model,
                selection=selection, project_files=project_files,
                file_name=file_name, cursor_line=cursor_line,
                api_key=self.api_key,
            ):
                yield event
            return

        yield {"type": "chunk", "text": "Analyzing your document..."}
        result, tokens = await self._lc_agent_edit(document, instruction, model, selection)
        yield {"type": "result", "data": result, "tokens": tokens}

    # ── Agent loop (ReAct, JSON actions) ─────────────────────────────────────

    async def complete_json(self, model: str, turns: List[Tuple[str, str]], schema: Dict[str, Any], images: Optional[List[str]] = None,
                            cached_content: Optional[str] = None, thinking: Optional[str] = None) -> Tuple[Dict[str, Any], int, int]:
        """One structured step over a (role, text) conversation -> (object, total tokens, cached tokens); ValueError on a non-object."""
        usage: Dict[str, Any] = {}
        if self.provider == "gemini":
            from api.services.gemini import gemini_service, FLASH_MODEL, PRO_MODEL
            text, tokens = await gemini_service._call_api(
                FLASH_MODEL if model == "flash" else PRO_MODEL, "", temperature=0.2, max_tokens=4096, response_schema=schema,
                api_key=self.api_key, images=images, cached_content=cached_content, thinking_level=thinking, turns=turns, usage_out=usage)
        else:
            convo = "\n\n".join(f"[{'assistant' if r == 'model' else 'user'}]\n{t}" for r, t in turns)
            text, tokens = await self._lc_call(model, f"{convo}\n\nReturn ONLY a JSON object matching: {json.dumps(schema)}", 0.2, 4096)
        clean = text.strip()
        if clean.startswith("```"):
            clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0]
        data = json.loads(clean)
        if not isinstance(data, dict):
            raise ValueError("response is not a JSON object")
        return data, tokens, int(usage.get("cachedContentTokenCount", 0))

    async def agent_run_stream(
        self, document: str, instruction: str, model: str = "pro",
        selection: Optional[dict] = None, project_files: Optional[List[Dict]] = None,
        file_name: Optional[str] = None, cursor_line: Optional[int] = None, main_file: Optional[str] = None,
        attachment: Optional[Dict[str, Any]] = None, settings: Optional[Dict[str, Any]] = None,
        base_document: Optional[str] = None, prior_steps: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator:
        from api.services.agent_loop import ACTION_SCHEMA, build_loop
        from api.services.latex import latex_service

        # Gemini also sees the PDF itself (cached once per run; inline when below the cache floor).
        images, cache = None, None
        if attachment and self.provider == "gemini":
            from api.services.gemini import FLASH_MODEL, PRO_MODEL, gemini_service
            url = f"data:application/pdf;base64,{attachment['pdf']}"
            key = gemini_service.get_api_key(self.api_key)
            if key:
                cache = await gemini_service._create_cached_content(
                    gemini_service._build_image_parts([url]), FLASH_MODEL if model == "flash" else PRO_MODEL, key,
                    hashlib.sha256(attachment["pdf"].encode()).hexdigest(), display_name="chat_pdf")
            images = None if cache else [url]

        thinking = (settings or {}).get("thinking") or "low"

        async def llm(turns: List[Tuple[str, str]]) -> Tuple[Dict[str, Any], int, int]:
            return await self.complete_json(model, turns, ACTION_SCHEMA, images=images, cached_content=cache, thinking=thinking)

        loop = build_loop(llm, latex_service.compile_log, document=document, instruction=instruction,
                          file_name=file_name, project_files=project_files, main_file=main_file,
                          selection=selection, cursor_line=cursor_line, attachment=attachment,
                          pdf_visible=bool(images or cache), settings=settings, base_document=base_document,
                          prior_steps=prior_steps)
        async for event in loop.run():
            yield event

    # ── LangChain call helper ─────────────────────────────────────────────────

    async def _lc_call(
        self, model_tier: str, prompt: str,
        temperature: float = 0.1, max_tokens: int = 2048,
    ) -> Tuple[str, int]:
        llm = self._get_lc_llm(model_tier, temperature, max_tokens)
        from langchain_core.messages import HumanMessage
        msg = await llm.ainvoke([HumanMessage(content=prompt)])
        text = msg.content if hasattr(msg, "content") else str(msg)
        tokens = 0
        if hasattr(msg, "usage_metadata") and msg.usage_metadata:
            um = msg.usage_metadata
            tokens = um.get("input_tokens", 0) + um.get("output_tokens", 0)
        return text, tokens

    def _get_lc_llm(self, model_tier: str, temperature: float, max_tokens: int):
        model_name = PROVIDER_MODELS[self.provider][model_tier if model_tier in ("flash", "pro") else "pro"]
        key = self.api_key

        if self.provider == "openai":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(model=model_name, api_key=key, temperature=temperature, max_tokens=max_tokens)

        if self.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(model=model_name, api_key=key, temperature=temperature, max_tokens=max_tokens)

        if self.provider == "mistral":
            from langchain_mistralai import ChatMistralAI
            return ChatMistralAI(model=model_name, api_key=key, temperature=temperature, max_tokens=max_tokens)

        raise ValueError(f"Unknown non-Gemini provider: {self.provider}")
