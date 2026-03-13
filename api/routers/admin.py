import os
import hmac
from fastapi import APIRouter, HTTPException, Depends, Request
from typing import List
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.models.schemas import UserResponse, TokenUsage, AdminStats
from api.services.firestore import db_service
from api.routers.auth import get_admin_user

router = APIRouter(prefix="/admin", tags=["Admin"])
limiter = Limiter(key_func=get_remote_address)

# Bootstrap secret for creating initial invite (set via env var)
BOOTSTRAP_SECRET = os.getenv("BOOTSTRAP_SECRET", "")

@router.post("/bootstrap-invite")
@limiter.limit("3/minute")
async def bootstrap_invite(request: Request):
    """Create initial invite code. Only works once when no invites exist."""
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    existing = await db_service.get_all_invites()
    if existing:
        raise HTTPException(status_code=403, detail="Bootstrap disabled - invites already exist")

    secret = body.get("secret", "")
    if not BOOTSTRAP_SECRET or not hmac.compare_digest(secret, BOOTSTRAP_SECRET):
        raise HTTPException(status_code=403, detail="Invalid bootstrap secret")

    uses = body.get("uses", 5)
    if uses < 1 or uses > 100:
        raise HTTPException(status_code=400, detail="Uses must be between 1 and 100")
    invite = await db_service.create_invite("bootstrap", uses)
    return {"code": invite["code"], "uses": uses}

@router.get("/users")
async def get_all_users(admin: dict = Depends(get_admin_user)):
    users = await db_service.get_all_users()

    return [
        {
            "uid": u["uid"],
            "username": u.get("username", ""),
            "email": u.get("email", ""),
            "role": u.get("role", "user"),
            "createdAt": u.get("created_at"),
            "lastAccessed": u.get("last_accessed"),
            "tokensUsed": u.get("tokens_used", {"total": 0, "flash": 0, "pro": 0})
        }
        for u in users
    ]

@router.get("/stats", response_model=AdminStats)
async def get_stats(admin: dict = Depends(get_admin_user)):
    stats = await db_service.get_stats()
    return AdminStats(
        totalUsers=stats["totalUsers"],
        totalProjects=stats["totalProjects"],
        totalTokens=stats["totalTokens"],
        activeToday=stats["activeToday"]
    )

@router.post("/user/{uid}/reset-tokens")
async def reset_user_tokens(uid: str, admin: dict = Depends(get_admin_user)):
    await db_service.reset_user_tokens(uid)
    return {"message": "Tokens reset successfully"}

@router.delete("/user/{uid}")
async def delete_user(uid: str, admin: dict = Depends(get_admin_user)):
    # Prevent self-deletion
    if uid == admin["uid"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    # Check if user is admin
    user = await db_service.get_user(uid)
    if user and user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")

    await db_service.delete_user(uid)
    return {"message": "User deleted successfully"}

# Invite management
@router.get("/invites")
async def get_invites(admin: dict = Depends(get_admin_user)):
    invites = await db_service.get_all_invites()
    return invites

@router.post("/invites")
async def create_invite(request: dict, admin: dict = Depends(get_admin_user)):
    uses = request.get("uses", 1)
    if uses < 1 or uses > 100:
        raise HTTPException(status_code=400, detail="Uses must be between 1 and 100")

    invite = await db_service.create_invite(admin["uid"], uses)
    return invite

@router.delete("/invites/{code}")
async def deactivate_invite(code: str, admin: dict = Depends(get_admin_user)):
    success = await db_service.deactivate_invite(code)
    if not success:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"message": "Invite deactivated"}
