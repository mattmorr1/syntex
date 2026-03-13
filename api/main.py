from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from datetime import datetime
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import sys

from config import Config

print(f"Starting syntex...")
print(f"Python path: {sys.path}")
print(f"Working directory: {os.getcwd()}")
print(f"PORT env: {os.environ.get('PORT', 'not set')}")
print(f"FIREBASE_KEY_PATH: {os.environ.get('FIREBASE_KEY_PATH', 'not set')}")

# Check if firebase key exists
firebase_key = os.environ.get('FIREBASE_KEY_PATH', 'firebase-key.json')
if os.path.exists(firebase_key):
    print(f"Firebase key found at: {firebase_key}")
else:
    print(f"WARNING: Firebase key not found at: {firebase_key}")

try:
    from api.routers import auth, projects, compile, ai, admin
    from api.routers.projects import upload_router, feedback_router
    print("Routers imported successfully")
except Exception as e:
    print(f"ERROR importing routers: {e}")
    import traceback
    traceback.print_exc()
    raise

# Rate limiter
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="syntex",
    description="syntex - AI-powered LaTeX document editor",
    version="2.0.0"
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS - use configured origins instead of wildcard
app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.ALLOWED_ORIGINS,
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
print(f"Frontend dist path: {frontend_dist}")
print(f"Frontend exists: {os.path.exists(frontend_dist)}")

if os.path.exists(frontend_dist):
    assets_path = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")
        print("Assets mounted successfully")
    else:
        print(f"Warning: Assets directory not found at {assets_path}")

@app.on_event("startup")
async def startup_event():
    print(f"App started successfully on port {os.environ.get('PORT', '8080')}")

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
    return {"message": "syntex API running. Frontend not built."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
