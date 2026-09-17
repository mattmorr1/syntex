import asyncio
import base64
import re
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response

from api.models.schemas import (
    CompileRequest, CompileResponse, ProjectFile, SyncTexRequest, SyncTexResponse,
    SyncTexForwardRequest, SyncTexForwardResponse,
)
from api.services.firestore import db_service
from api.services.latex import latex_service
from api.services.storage import put_blob, get_blob
from api.routers.auth import get_current_user

router = APIRouter(tags=["Compile"])

# Build artifacts live in the bucket, not in-process: with more than one instance
# the request that compiles and the request that fetches land on different ones.
# ponytail: expiry is a bucket lifecycle rule on builds/, not application code.
_BUILD_PREFIX = "builds"
_PDF_ID = re.compile(r"^[0-9a-f]{32}$")


def _pdf_path(pdf_id: str) -> str:
    return f"{_BUILD_PREFIX}/{pdf_id}.pdf"


def _synctex_path(pdf_id: str) -> str:
    return f"{_BUILD_PREFIX}/{pdf_id}.synctex.gz"


@router.post("/compile", response_model=CompileResponse)
async def compile_latex(request: CompileRequest, user: dict = Depends(get_current_user)):
    files = [f.dict() for f in request.files]

    success, pdf_content, error, synctex = await latex_service.compile(files, request.main_file)

    if success and pdf_content:
        pdf_id = uuid.uuid4().hex
        await asyncio.to_thread(put_blob, _pdf_path(pdf_id), pdf_content, "application/pdf")
        if synctex:
            await asyncio.to_thread(put_blob, _synctex_path(pdf_id), synctex, "application/gzip")
        return CompileResponse(
            success=True,
            pdf_url=f"/compiled-pdf/{pdf_id}",
            synctex=bool(synctex),
        )

    return CompileResponse(
        success=False,
        error=error
    )


@router.post("/synctex/{pdf_id}", response_model=SyncTexResponse)
async def synctex_backward(pdf_id: str, request: SyncTexRequest,
                           user: dict = Depends(get_current_user)):
    """Map a click in the rendered PDF back to a source file and line."""
    if not _PDF_ID.match(pdf_id):
        raise HTTPException(status_code=404, detail="Build not found or expired")

    data = await asyncio.to_thread(get_blob, _synctex_path(pdf_id))
    if not data:
        raise HTTPException(status_code=404, detail="No SyncTeX data for this build")

    hit = await asyncio.to_thread(
        latex_service.synctex_edit, data, request.page, request.x, request.y
    )
    if not hit:
        raise HTTPException(status_code=404, detail="No source location at that point")

    file_name, line = hit
    return SyncTexResponse(file=file_name, line=line)

@router.post("/synctex/{pdf_id}/forward", response_model=SyncTexForwardResponse)
async def synctex_forward(pdf_id: str, request: SyncTexForwardRequest,
                          user: dict = Depends(get_current_user)):
    """Map a source line to the point in the PDF it produced."""
    if not _PDF_ID.match(pdf_id):
        raise HTTPException(status_code=404, detail="Build not found or expired")

    data = await asyncio.to_thread(get_blob, _synctex_path(pdf_id))
    if not data:
        raise HTTPException(status_code=404, detail="No SyncTeX data for this build")

    hit = await asyncio.to_thread(latex_service.synctex_view, data, request.file, request.line)
    if not hit:
        raise HTTPException(status_code=404, detail="That line produced no output")

    page, x, y = hit
    return SyncTexForwardResponse(page=page, x=x, y=y)

@router.get("/compiled-pdf/{pdf_id}")
async def get_compiled_pdf(pdf_id: str):
    if not _PDF_ID.match(pdf_id):
        raise HTTPException(status_code=404, detail="PDF not found or expired")
    pdf_content = await asyncio.to_thread(get_blob, _pdf_path(pdf_id))
    if not pdf_content:
        raise HTTPException(status_code=404, detail="PDF not found or expired")
    return Response(
        content=pdf_content,
        media_type="application/pdf",
        headers={"Cache-Control": "private, max-age=300"},
    )

@router.get("/download-pdf/{project_id}")
async def download_pdf(project_id: str, user: dict = Depends(get_current_user)):
    project = await db_service.get_project(project_id, user["uid"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    files = project.get("files", [])
    main_file = project.get("main_file", "main.tex")
    
    success, pdf_content, error, _ = await latex_service.compile(files, main_file)
    
    if not success:
        raise HTTPException(status_code=500, detail=error or "Compilation failed")
    
    return Response(
        content=pdf_content,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={project.get('name', 'document')}.pdf"
        }
    )

@router.post("/regenerate")
async def regenerate_content(
    current_content: str,
    user: dict = Depends(get_current_user)
):
    from api.services.gemini import gemini_service
    
    improved, tokens = await gemini_service.improve_content(current_content)
    await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
    
    return {"latex_content": improved, "tokens_used": tokens}
