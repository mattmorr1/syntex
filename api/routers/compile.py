import base64
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response

from api.models.schemas import CompileRequest, CompileResponse, ProjectFile
from api.services.firestore import db_service
from api.services.latex import latex_service
from api.routers.auth import get_current_user

router = APIRouter(tags=["Compile"])

# In-memory cache for compiled PDFs (keyed by random ID)
_pdf_cache: dict[str, bytes] = {}
_MAX_CACHE = 50

@router.post("/compile", response_model=CompileResponse)
async def compile_latex(request: CompileRequest, user: dict = Depends(get_current_user)):
    files = [f.dict() for f in request.files]

    success, pdf_content, error = await latex_service.compile(files, request.main_file)

    if success and pdf_content:
        # Store PDF in memory and return a URL to fetch it
        pdf_id = uuid.uuid4().hex
        # Evict oldest entries if cache is full
        if len(_pdf_cache) >= _MAX_CACHE:
            oldest = next(iter(_pdf_cache))
            del _pdf_cache[oldest]
        _pdf_cache[pdf_id] = pdf_content
        return CompileResponse(
            success=True,
            pdf_url=f"/compiled-pdf/{pdf_id}"
        )

    return CompileResponse(
        success=False,
        error=error
    )

@router.get("/compiled-pdf/{pdf_id}")
async def get_compiled_pdf(pdf_id: str):
    pdf_content = _pdf_cache.get(pdf_id)
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
    
    success, pdf_content, error = await latex_service.compile(files, main_file)
    
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
