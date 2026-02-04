import os
import json
import httpx
import hashlib
from typing import Tuple, List, Optional, Dict, Any
from datetime import datetime, timedelta
from config import Config

FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-2.0-flash")
PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-1.5-pro")

# Structured output schemas
AGENT_EDIT_SCHEMA = {
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
                text = result["candidates"][0]["content"]["parts"][0]["text"]
                # Track cached vs non-cached tokens
                usage = result.get("usageMetadata", {})
                tokens = usage.get("totalTokenCount", 0)
                cached_tokens = usage.get("cachedContentTokenCount", 0)
                if cached_tokens > 0:
                    print(f"Used {cached_tokens} cached tokens out of {tokens} total")
                return text, tokens
            except (KeyError, IndexError):
                raise Exception(f"Failed to parse response: {result}")
    
    def _dev_response(self, prompt: str) -> str:
        if "autocomplete" in prompt.lower():
            return "\\section{"
        if "convert" in prompt.lower() or "latex" in prompt.lower():
            return self._sample_latex()
        if "edit" in prompt.lower() or "change" in prompt.lower():
            return json.dumps({
                "explanation": "Dev mode: Sample edit",
                "changes": [{"start_line": 1, "end_line": 2, "original": "Original", "replacement": "New", "reason": "Dev"}]
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
        
        # Try to cache the document for repeated edits
        cached_content = None
        if key and len(document) > 2000:
            cached_content = await self._create_cached_content(
                f"LaTeX document to edit:\n{document}",
                model_name,
                key,
                "latex_document"
            )
        
        # If cached, we only send the instruction
        if cached_content:
            prompt = f"""Edit the cached LaTeX document per this instruction.
{'Reference images provided.' if images else ''}

Instruction: {instruction}

Provide changes as JSON with explanation and changes array."""
        else:
            # Fallback: include document in prompt (truncated)
            doc = document[:4000] if len(document) > 4000 else document
            prompt = f"""Edit LaTeX document per instruction.
{'Images provided for reference.' if images else ''}

Document:
{doc}

Instruction: {instruction}

Provide changes as JSON with explanation and changes array."""

        text, tokens = await self._call_api(
            model_name, 
            prompt, 
            temperature=0.2, 
            max_tokens=2048, 
            api_key=api_key, 
            images=images,
            response_schema=AGENT_EDIT_SCHEMA,
            cached_content=cached_content
        )
        
        try:
            result = json.loads(text)
            return result, tokens
        except json.JSONDecodeError:
            return {"explanation": "Parse error", "changes": []}, tokens
    
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
