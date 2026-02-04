from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from typing import List, Optional
import tempfile
import os

from api.models.schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectFile, FeedbackRequest
)
from api.services.firestore import db_service
from api.services.gemini import gemini_service
from api.services.latex import latex_service
from api.routers.auth import get_current_user

router = APIRouter(prefix="/projects", tags=["Projects"])

@router.get("", response_model=List[ProjectResponse])
async def list_projects(user: dict = Depends(get_current_user)):
    projects = await db_service.get_user_projects(user["uid"])
    return [_format_project(p) for p in projects]

@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    project = await db_service.get_project(project_id, user["uid"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _format_project(project)

@router.post("", response_model=ProjectResponse)
async def create_project(request: ProjectCreate, user: dict = Depends(get_current_user)):
    # Get template content
    templates = latex_service.get_sample_templates()
    template_content = templates.get(request.theme, templates["report"])
    
    files = [
        {"name": "main.tex", "content": template_content, "type": "tex"},
        {"name": "references.bib", "content": "@misc{example,\n  author = {Author},\n  title = {Title},\n  year = {2024}\n}", "type": "bib"}
    ]
    
    project = await db_service.create_project(
        uid=user["uid"],
        name=request.name,
        theme=request.theme,
        files=files,
        main_file="main.tex",
        custom_theme=request.custom_theme
    )
    
    return _format_project(project)

@router.post("/save-project")
async def save_project(request: ProjectUpdate, user: dict = Depends(get_current_user)):
    files = [f.dict() for f in request.files]
    success = await db_service.update_project(request.project_id, user["uid"], files)
    
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {"message": "Project saved", "project_id": request.project_id}

@router.patch("/{project_id}/rename")
async def rename_project(project_id: str, request: dict, user: dict = Depends(get_current_user)):
    name = request.get("name")
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    
    success = await db_service.update_project_name(project_id, user["uid"], name.strip())
    
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {"message": "Project renamed", "name": name.strip()}

@router.post("/duplicate-project/{project_id}")
async def duplicate_project(project_id: str, user: dict = Depends(get_current_user)):
    project = await db_service.duplicate_project(project_id, user["uid"])
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return _format_project(project)

@router.delete("/delete-project/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    success = await db_service.delete_project(project_id, user["uid"])
    if not success:
        raise HTTPException(status_code=404, detail="Project not found")
    
    return {"message": "Project deleted"}

def _format_project(project: dict) -> ProjectResponse:
    files = project.get("files", [])
    formatted_files = [
        ProjectFile(
            name=f.get("name", "unknown"),
            content=f.get("content", ""),
            type=f.get("type", "tex")
        ) for f in files
    ]
    
    return ProjectResponse(
        id=project["id"],
        name=project.get("name", "Untitled"),
        files=formatted_files,
        main_file=project.get("main_file", "main.tex"),
        theme=project.get("theme", "report"),
        custom_theme=project.get("custom_theme"),
        created_at=project.get("created_at"),
        updated_at=project.get("updated_at")
    )

# Upload endpoint at root level
upload_router = APIRouter(tags=["Upload"])

@upload_router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    theme: str = Form("report"),
    custom_theme: Optional[str] = Form(None),
    custom_prompt: Optional[str] = Form(None),
    custom_cls: Optional[str] = Form(None),
    custom_preamble: Optional[str] = Form(None),
    images: Optional[str] = Form(None),  # JSON array of base64 images
    user: dict = Depends(get_current_user)
):
    import json as json_module
    
    if not file.filename.endswith(('.docx', '.doc')):
        raise HTTPException(status_code=400, detail="Only DOCX/DOC files supported")
    
    # Parse images from JSON
    image_list = None
    if images:
        try:
            image_list = json_module.loads(images)
        except:
            pass
    
    # Save file temporarily
    temp_dir = tempfile.mkdtemp()
    file_path = os.path.join(temp_dir, file.filename)
    
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        
        # Extract text from DOCX
        try:
            from docx import Document
            doc = Document(file_path)
            text_content = "\n".join([para.text for para in doc.paragraphs])
        except:
            text_content = content.decode("utf-8", errors="ignore")[:5000]
        
        # Convert to LaTeX using Gemini with custom options
        latex_content, tokens = await gemini_service.generate_document(
            text_content, 
            theme, 
            custom_theme,
            custom_prompt=custom_prompt,
            custom_preamble=custom_preamble,
            images=image_list
        )
        
        # Update user tokens
        await db_service.update_user_tokens(user["uid"], pro_tokens=tokens)
        
        # Build project files
        files = [
            {"name": "main.tex", "content": latex_content, "type": "tex"},
            {"name": "references.bib", "content": "", "type": "bib"}
        ]
        
        # Add custom class file if provided
        if custom_cls and custom_cls.strip():
            files.append({"name": "custom.cls", "content": custom_cls, "type": "cls"})
        
        project = await db_service.create_project(
            uid=user["uid"],
            name=file.filename.rsplit(".", 1)[0],
            theme=theme,
            files=files,
            main_file="main.tex",
            custom_theme=custom_theme
        )
        
        return {"project_id": project["id"], "tokens_used": tokens}
    
    finally:
        os.remove(file_path)
        os.rmdir(temp_dir)

# Feedback endpoint
feedback_router = APIRouter(tags=["Feedback"])

@feedback_router.post("/feedback")
async def submit_feedback(
    request: FeedbackRequest,
    user: dict = Depends(get_current_user)
):
    await db_service.save_feedback(request.feedback, user.get("uid"))
    return {"message": "Feedback submitted"}
