from fastapi import APIRouter, HTTPException, Depends
from typing import List

from api.models.schemas import UserResponse, TokenUsage, AdminStats
from api.services.firestore import db_service
from api.routers.auth import get_admin_user

router = APIRouter(prefix="/admin", tags=["Admin"])

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
        total_users=stats["totalUsers"],
        total_projects=stats["totalProjects"],
        total_tokens=stats["totalTokens"],
        active_today=stats["activeToday"]
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
