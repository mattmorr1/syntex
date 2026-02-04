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
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": max_tokens,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=60.0)
            
            if response.status_code != 200:
                raise Exception(f"Gemini API Error: {response.status_code} - {response.text}")
            
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
        prompt = f"""You are a LaTeX expert providing intelligent autocomplete.

Context (code before cursor):
{context[:cursor_pos]}

File: {file_name}

Provide a SINGLE short completion (1-2 lines max) that would logically follow.
Return ONLY the completion text, nothing else. No explanations."""

        text, tokens = await self._call_api(FLASH_MODEL, prompt, temperature=0.1, max_tokens=100)
        return text.strip(), tokens
    
    async def generate_document(self, content: str, theme: str, 
                                custom_theme: Optional[str] = None) -> Tuple[str, int]:
        theme_desc = custom_theme if theme == "custom" else self._get_theme_description(theme)
        
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

Return ONLY the LaTeX code, no explanations."""

        return await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=4096)
    
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
                        model: str = "pro") -> Tuple[Dict[str, Any], int]:
        model_name = FLASH_MODEL if model == "flash" else PRO_MODEL
        
        # Truncate document if too long to prevent token limit issues
        max_doc_length = 15000  # characters
        truncated = False
        if len(document) > max_doc_length:
            document = document[:max_doc_length]
            truncated = True
        
        prompt = f"""You are an AI agent that edits LaTeX documents.

Document:
{document}
{"[Document truncated due to length]" if truncated else ""}

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

Return ONLY the improved LaTeX code."""

        return await self._call_api(PRO_MODEL, prompt, temperature=0.2, max_tokens=4096)
    
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
