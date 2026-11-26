from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import Optional
import asyncio
import base64
import binascii
import json as json_lib
import logging
import re

logger = logging.getLogger(__name__)

from api.models.schemas import (
    AutocompleteRequest, AutocompleteResponse,
    ChatRequest, ChatResponse,
    AgentEditRequest, AgentEditResponse, DiffChange, AgentAttachment
)
from api.services.firestore import db_service
from api.services.llm_provider import get_provider_for_user
from api.routers.auth import get_current_user
from config import Config

router = APIRouter(prefix="/ai", tags=["AI"])


async def _get_full_user_with_cap_check(user: dict) -> dict:
    """Load full user doc, reset monthly tokens if needed, and enforce token cap."""
    full_user = await db_service.get_user(user["uid"])
    if not full_user:
        full_user = user
    full_user = await db_service.check_and_reset_monthly_tokens(user["uid"], full_user)
    cap = full_user.get("token_cap", Config.DEFAULT_TOKEN_CAP)
    used = full_user.get("tokens_used_this_month", {}).get("total", 0)
    if used >= cap:
        raise HTTPException(
            status_code=429,
            detail=f"Monthly token cap of {cap:,} reached. Usage resets on the 1st of each month."
        )
    return full_user


@router.post("/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(request: AutocompleteRequest, user: dict = Depends(get_current_user)):
    full_user = await _get_full_user_with_cap_check(user)
    provider = get_provider_for_user(full_user)

    suggestion, tokens = await provider.autocomplete(
        request.context,
        request.cursor_position,
        request.file_name
    )

    await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
    await db_service.update_monthly_tokens(user["uid"], flash_tokens=tokens)

    return AutocompleteResponse(suggestion=suggestion, tokens=tokens)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user: dict = Depends(get_current_user)):
    full_user = await _get_full_user_with_cap_check(user)
    provider = get_provider_for_user(full_user)

    response_text, tokens = await provider.chat(
        request.message,
        request.context,
        request.model or "flash"
    )

    if request.model == "pro":
        await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
        await db_service.update_monthly_tokens(user["uid"], pro_tokens=tokens)
    else:
        await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
        await db_service.update_monthly_tokens(user["uid"], flash_tokens=tokens)

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
    full_user = await _get_full_user_with_cap_check(user)
    provider = get_provider_for_user(full_user)
    try:
        result, tokens = await provider.agent_edit(
            request.document,
            request.instruction,
            request.model or "pro",
            selection=request.selection.model_dump() if request.selection else None
        )

        if request.model == "flash":
            await db_service.update_user_tokens(user["uid"], flash_tokens=tokens)
            await db_service.update_monthly_tokens(user["uid"], flash_tokens=tokens)
        else:
            await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
            await db_service.update_monthly_tokens(user["uid"], pro_tokens=tokens)

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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"agent_edit failed: {e}")
        return AgentEditResponse(
            explanation="An error occurred while processing your request.",
            changes=[],
            tokens=0
        )


def _pdf_text(raw: bytes) -> str:
    import fitz
    with fitz.open(stream=raw, filetype="pdf") as doc:
        return "\n".join(f"--- page {i} ---\n{page.get_text()}" for i, page in enumerate(doc, 1))


async def _read_attachment(att: AgentAttachment) -> dict:
    """Validate a base64 PDF and extract its text off the event loop (fitz is CPU-bound)."""
    try:
        raw = base64.b64decode(att.data, validate=True)
    except binascii.Error as e:
        raise HTTPException(status_code=400, detail="Attachment is not valid base64") from e
    if len(raw) > Config.MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"Attachment exceeds the {Config.MAX_FILE_SIZE // (1024 * 1024)}MB limit")
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Attachment must be a PDF")
    try:
        text = await asyncio.to_thread(_pdf_text, raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail="Could not read the PDF") from e
    stem = re.sub(r"[^\w.-]", "_", att.name.rsplit(".", 1)[0])[:100] or "attachment"
    return {"name": f"{stem}.pdf.txt", "text": text, "pdf": att.data, "pages": text.count("--- page ")}


@router.post("/agent-edit/stream")
async def agent_edit_stream(request: AgentEditRequest, user: dict = Depends(get_current_user)):
    full_user = await _get_full_user_with_cap_check(user)
    provider = get_provider_for_user(full_user)
    model = request.model or "pro"
    attachment = await _read_attachment(request.attachment) if request.attachment else None

    async def event_generator():
        total_tokens = 0
        try:
            selection_dict = request.selection.model_dump() if request.selection else None
            async for event in provider.agent_run_stream(
                request.document, request.instruction, model, selection=selection_dict,
                project_files=request.project_files, file_name=request.file_name,
                cursor_line=request.cursor_line, main_file=request.main_file, attachment=attachment,
            ):
                total_tokens = event["tokens"] if event["type"] == "result" else total_tokens + event.get("tokens", 0)
                yield f"data: {json_lib.dumps(event)}\n\n"
        except Exception:
            logger.exception("agent run failed for uid=%s", user["uid"])
            yield f"data: {json_lib.dumps({'type': 'error', 'message': 'An error occurred while processing your request.'})}\n\n"
        finally:
            if total_tokens > 0:
                tier = {"flash_tokens": total_tokens} if model == "flash" else {"pro_tokens": total_tokens}
                try:
                    await db_service.update_user_tokens(user["uid"], **tier)
                    await db_service.update_monthly_tokens(user["uid"], **tier)
                except Exception:
                    logger.exception("token accounting failed for uid=%s (%d tokens)", user["uid"], total_tokens)
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/chat-history")
async def get_chat_history(
    project_id: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    history = await db_service.get_chat_history(user["uid"], project_id)
    return {"chat_history": history}
