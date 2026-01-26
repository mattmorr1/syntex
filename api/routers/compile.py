import base64
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response

from api.models.schemas import CompileRequest, CompileResponse, ProjectFile
from api.services.firestore import db_service
from api.services.latex import latex_service
from api.routers.auth import get_current_user

router = APIRouter(tags=["Compile"])

@router.post("/compile", response_model=CompileResponse)
async def compile_latex(request: CompileRequest, user: dict = Depends(get_current_user)):
    files = [f.dict() for f in request.files]
    
    success, pdf_content, error = await latex_service.compile(files, request.main_file)
    
    if success and pdf_content:
        # Store PDF temporarily or return base64
        pdf_base64 = base64.b64encode(pdf_content).decode()
        return CompileResponse(
            success=True,
            pdf_url=f"data:application/pdf;base64,{pdf_base64}"
        )
    
    return CompileResponse(
        success=False,
        error=error
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
