from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from datetime import datetime
import os

from api.routers import auth, projects, compile, ai, admin
from api.routers.projects import upload_router, feedback_router

app = FastAPI(
    title="UEA AI LaTeX Editor",
    description="AI-powered LaTeX document editor with Gemini integration",
    version="2.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(upload_router)
app.include_router(feedback_router)
app.include_router(compile.router)
app.include_router(ai.router)
app.include_router(admin.router)

# Serve React frontend in production
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "static", "dist")
if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "2.0.0"
    }

@app.get("/")
@app.get("/{full_path:path}")
async def serve_spa(full_path: str = ""):
    # Serve React app for all non-API routes
    index_path = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    
    # Fallback for development
    return {"message": "UEA API running. Frontend not built."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
