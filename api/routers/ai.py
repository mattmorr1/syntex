from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.models.schemas import (
    AutocompleteRequest, AutocompleteResponse,
    ChatRequest, ChatResponse,
    AgentEditRequest, AgentEditResponse, DiffChange
)
from api.services.firestore import db_service
from api.services.gemini import gemini_service
from api.routers.auth import get_current_user

# Rate limiter - 60 requests per minute for AI endpoints
limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/ai", tags=["AI"])

async def get_user_api_key(user: dict) -> Optional[str]:
    """Get user's custom API key if set."""
    settings = await db_service.get_user_settings(user["uid"])
    return settings.get("gemini_api_key")

@router.post("/autocomplete", response_model=AutocompleteResponse)
@limiter.limit("120/minute")
async def autocomplete(request: Request, body: AutocompleteRequest, user: dict = Depends(get_current_user)):
    api_key = await get_user_api_key(user)
    suggestion, tokens = await gemini_service.autocomplete(
        body.context,
        body.cursor_position,
        body.file_name,
        api_key=api_key
    )
    
    # Update user token count (flash model)
    await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
    
    return AutocompleteResponse(suggestion=suggestion, tokens=tokens)

@router.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(request: Request, body: ChatRequest, user: dict = Depends(get_current_user)):
    api_key = await get_user_api_key(user)
    response_text, tokens = await gemini_service.chat(
        body.message,
        body.context,
        body.model or "flash",
        api_key=api_key
    )
    
    # Update tokens based on model
    if body.model == "pro":
        await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
    else:
        await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
    
    # Save chat history
    await db_service.save_chat(
        uid=user["uid"],
        project_id=body.project_id,
        messages=[
            {"role": "user", "content": body.message, "tokens": 0},
            {"role": "assistant", "content": response_text, "tokens": tokens}
        ]
    )
    
    return ChatResponse(response=response_text, tokens=tokens)

@router.post("/agent-edit", response_model=AgentEditResponse)
@limiter.limit("20/minute")
async def agent_edit(request: Request, body: AgentEditRequest, user: dict = Depends(get_current_user)):
    api_key = await get_user_api_key(user)

    # Use batched processing if forced or for large documents
    if body.force_batch:
        result, tokens = await gemini_service.agent_edit_batched(
            body.document,
            body.instruction,
            body.model or "pro",
            api_key=api_key,
            images=body.images
        )
    else:
        result, tokens = await gemini_service.agent_edit(
            body.document,
            body.instruction,
            body.model or "pro",
            api_key=api_key,
            images=body.images
        )
    
    # Update tokens
    if body.model == "flash":
        await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
    else:
        await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
    
    changes = [
        DiffChange(
            start_line=c.get("start_line", 0),
            end_line=c.get("end_line", 0),
            original=c.get("original", ""),
            replacement=c.get("replacement", ""),
            reason=c.get("reason", "")
        ) for c in result.get("changes", [])
    ]
    
    return AgentEditResponse(
        explanation=result.get("explanation", ""),
        changes=changes,
        tokens=tokens
    )

@router.get("/chat-history")
async def get_chat_history(
    project_id: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    history = await db_service.get_chat_history(user["uid"], project_id)
    return {"chat_history": history}
