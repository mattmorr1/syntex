import os
import hmac
import logging
from fastapi import APIRouter, HTTPException, Depends, Request
from typing import List, Optional
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.models.schemas import UserResponse, TokenUsage, AdminStats, SetTokenCapRequest, RejectAccessRequestBody
from api.services.firestore import db_service
from api.routers.auth import get_admin_user
from config import Config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])
limiter = Limiter(key_func=get_remote_address)

BOOTSTRAP_SECRET = os.getenv("BOOTSTRAP_SECRET", "")


@router.post("/bootstrap-invite")
@limiter.limit("3/minute")
async def bootstrap_invite(request: Request):
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
            "tokensUsed": u.get("tokens_used", {"total": 0, "flash": 0, "pro": 0}),
            "tokenCap": u.get("token_cap", Config.DEFAULT_TOKEN_CAP),
            "tokensUsedThisMonth": u.get("tokens_used_this_month", {"total": 0, "flash": 0, "pro": 0}),
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


@router.patch("/user/{uid}/token-cap")
async def set_token_cap(uid: str, body: SetTokenCapRequest, admin: dict = Depends(get_admin_user)):
    await db_service.set_user_token_cap(uid, body.cap)
    return {"message": "Token cap updated", "cap": body.cap}


@router.delete("/user/{uid}")
async def delete_user(uid: str, admin: dict = Depends(get_admin_user)):
    if uid == admin["uid"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = await db_service.get_user(uid)
    if user and user.get("role") == "admin":
        raise HTTPException(status_code=400, detail="Cannot delete admin users")
    await db_service.delete_user(uid)
    return {"message": "User deleted successfully"}


# Invite management

@router.get("/invites")
async def get_invites(admin: dict = Depends(get_admin_user)):
    return await db_service.get_all_invites()


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


# Access request management

@router.get("/access-requests")
async def get_access_requests(status: Optional[str] = None, admin: dict = Depends(get_admin_user)):
    reqs = await db_service.get_access_requests(status=status)
    # Serialize datetimes
    result = []
    for r in reqs:
        entry = dict(r)
        for field in ("created_at", "reviewed_at"):
            val = entry.get(field)
            if val and hasattr(val, "isoformat"):
                entry[field] = val.isoformat()
            elif val and hasattr(val, "_seconds"):
                from datetime import datetime
                entry[field] = datetime.fromtimestamp(val._seconds).isoformat()
        result.append(entry)
    return result


@router.post("/access-requests/{req_id}/approve")
async def approve_access_request(req_id: str, admin: dict = Depends(get_admin_user)):
    req = await db_service.get_access_request(req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req['status']}")

    email = req["email"]
    name = req["name"]
    setup_link = ""

    # Create Firebase Auth account and Firestore user doc if Firebase is enabled
    if db_service.enabled:
        try:
            from firebase_admin import auth
            try:
                user_record = auth.get_user_by_email(email)
            except auth.UserNotFoundError:
                user_record = auth.create_user(email=email, email_verified=True, display_name=name)

            await db_service.create_user(
                uid=user_record.uid, email=email, username=name, role="user"
            )

            try:
                setup_link = auth.generate_password_reset_link(email)
            except Exception as e:
                logger.warning("Could not generate password reset link: %s", e)
                setup_link = Config.APP_URL
        except Exception as e:
            logger.error("Failed to create Firebase user for %s: %s", email, e)
            raise HTTPException(status_code=500, detail=f"Failed to create account: {e}")
    else:
        setup_link = Config.APP_URL

    await db_service.update_access_request(req_id, "approved", admin["uid"])

    try:
        from api.services.email import send_access_approved
        await send_access_approved(email, name, setup_link or Config.APP_URL)
    except Exception as e:
        logger.warning("Failed to send approval email: %s", e)

    return {"message": f"Access approved for {email}"}


@router.post("/access-requests/{req_id}/reject")
async def reject_access_request(req_id: str, body: RejectAccessRequestBody, admin: dict = Depends(get_admin_user)):
    req = await db_service.get_access_request(req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Access request not found")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {req['status']}")

    await db_service.update_access_request(req_id, "rejected", admin["uid"], body.reason)

    try:
        from api.services.email import send_access_rejected
        await send_access_rejected(req["email"], req["name"], body.reason or "")
    except Exception as e:
        logger.warning("Failed to send rejection email: %s", e)

    return {"message": f"Access request rejected"}
