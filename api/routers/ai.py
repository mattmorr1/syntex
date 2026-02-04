from fastapi import APIRouter, HTTPException, Depends
from typing import Optional

from api.models.schemas import (
    AutocompleteRequest, AutocompleteResponse,
    ChatRequest, ChatResponse,
    AgentEditRequest, AgentEditResponse, DiffChange
)
from api.services.firestore import db_service
from api.services.gemini import gemini_service
from api.routers.auth import get_current_user

router = APIRouter(prefix="/ai", tags=["AI"])

@router.post("/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(request: AutocompleteRequest, user: dict = Depends(get_current_user)):
    suggestion, tokens = await gemini_service.autocomplete(
        request.context,
        request.cursor_position,
        request.file_name
    )
    
    # Update user token count (flash model)
    await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
    
    return AutocompleteResponse(suggestion=suggestion, tokens=tokens)

@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user: dict = Depends(get_current_user)):
    response_text, tokens = await gemini_service.chat(
        request.message,
        request.context,
        request.model or "flash"
    )
    
    # Update tokens based on model
    if request.model == "pro":
        await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
    else:
        await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
    
    # Save chat history
    await db_service.save_chat(
        uid=user["uid"],
        project_id=request.project_id,
        messages=[
            {"role": "user", "content": request.message, "tokens": 0},
            {"role": "assistant", "content": response_text, "tokens": tokens}
        ]
    )
    
    return ChatResponse(response=response_text, tokens=tokens)

@router.post("/agent-edit", response_model=AgentEditResponse)
async def agent_edit(request: AgentEditRequest, user: dict = Depends(get_current_user)):
    try:
        result, tokens = await gemini_service.agent_edit(
            request.document,
            request.instruction,
            request.model or "pro"
        )
        
        # Update tokens
        if request.model == "flash":
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
    except Exception as e:
        error_msg = str(e)
        # Return a user-friendly error response
        return AgentEditResponse(
            explanation=f"Error: {error_msg}",
            changes=[],
            tokens=0
        )

@router.get("/chat-history")
async def get_chat_history(
    project_id: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    history = await db_service.get_chat_history(user["uid"], project_id)
    return {"chat_history": history}
