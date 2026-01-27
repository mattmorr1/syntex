import os
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
from passlib.context import CryptContext

from api.models.schemas import (
    LoginRequest, RegisterRequest, ResetPasswordRequest, 
    AuthResponse, UserResponse, TokenUsage
)
from api.services.firestore import db_service

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer(auto_error=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "mmorristwo@gmail.com")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "matt")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "password")
INVITE_ONLY = os.getenv("INVITE_ONLY", "true").lower() == "true"

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    if not db_service.enabled:
        return {
            "uid": "dev_user_123",
            "email": "dev@example.com",
            "username": "dev_user",
            "role": "admin"
        }
    
    try:
        decoded = auth.verify_id_token(credentials.credentials)
        user = await db_service.get_user(decoded["uid"])
        if user:
            await db_service.update_last_accessed(decoded["uid"])
            return user
        return {"uid": decoded["uid"], "email": decoded.get("email", ""), "role": "user"}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_admin_user(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    if request.email == ADMIN_EMAIL and request.password == ADMIN_PASSWORD:
        user = await db_service.get_user_by_email(ADMIN_EMAIL)
        if not user:
            user = await db_service.create_user(
                uid="admin_user",
                email=ADMIN_EMAIL,
                username=ADMIN_USERNAME,
                role="admin"
            )
        
        return AuthResponse(
            token="admin_token_" + str(datetime.now().timestamp()),
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role="admin",
                tokensUsed=TokenUsage(**user.get("tokens_used", {}))
            )
        )
    
    if not db_service.enabled:
        return AuthResponse(
            token="dev_token_" + str(datetime.now().timestamp()),
            user=UserResponse(
                uid="dev_user_123",
                email=request.email,
                username=request.email.split("@")[0],
                role="user",
                tokensUsed=TokenUsage()
            )
        )
    
    try:
        user_record = auth.get_user_by_email(request.email)
        user = await db_service.get_user(user_record.uid)
        
        if not user:
            user = await db_service.create_user(
                uid=user_record.uid,
                email=request.email,
                username=request.email.split("@")[0]
            )
        
        custom_token = auth.create_custom_token(user_record.uid)
        
        return AuthResponse(
            token=custom_token.decode() if isinstance(custom_token, bytes) else custom_token,
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role=user.get("role", "user"),
                tokensUsed=TokenUsage(**user.get("tokens_used", {}))
            )
        )
    except auth.UserNotFoundError:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest):
    # Check invite code if required
    if INVITE_ONLY and request.email != ADMIN_EMAIL:
        if not request.invite_code:
            raise HTTPException(status_code=400, detail="Invite code required")
        invite = await db_service.validate_invite(request.invite_code)
        if not invite:
            raise HTTPException(status_code=400, detail="Invalid or expired invite code")
    
    if not db_service.enabled:
        user = await db_service.create_user(
            uid="dev_" + str(datetime.now().timestamp()),
            email=request.email,
            username=request.username
        )
        if request.invite_code:
            await db_service.use_invite(request.invite_code, user["uid"])
        return AuthResponse(
            token="dev_token_" + str(datetime.now().timestamp()),
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role="user",
                tokensUsed=TokenUsage()
            )
        )
    
    try:
        role = "admin" if request.email == ADMIN_EMAIL else "user"
        
        user_record = auth.create_user(
            email=request.email,
            password=request.password,
            display_name=request.username
        )
        
        user = await db_service.create_user(
            uid=user_record.uid,
            email=request.email,
            username=request.username,
            role=role
        )
        
        # Use the invite code
        if request.invite_code:
            await db_service.use_invite(request.invite_code, user_record.uid)
        
        custom_token = auth.create_custom_token(user_record.uid)
        
        return AuthResponse(
            token=custom_token.decode() if isinstance(custom_token, bytes) else custom_token,
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role=role,
                tokensUsed=TokenUsage()
            )
        )
    except auth.EmailAlreadyExistsError:
        raise HTTPException(status_code=400, detail="Email already registered")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/google")
async def google_auth(request: dict):
    id_token = request.get("id_token")
    invite_code = request.get("invite_code")
    
    if not id_token:
        raise HTTPException(status_code=400, detail="ID token required")
    
    if not db_service.enabled:
        raise HTTPException(status_code=400, detail="Firebase required for Google auth")
    
    try:
        decoded = auth.verify_id_token(id_token)
        uid = decoded["uid"]
        email = decoded.get("email", "")
        name = decoded.get("name", email.split("@")[0] if email else "user")
        
        # Check if user already exists
        user = await db_service.get_user(uid)
        
        # For new users, check invite code if required
        if not user and INVITE_ONLY and email != ADMIN_EMAIL:
            if not invite_code:
                raise HTTPException(status_code=400, detail="Invite code required for new accounts")
            invite = await db_service.validate_invite(invite_code)
            if not invite:
                raise HTTPException(status_code=400, detail="Invalid or expired invite code")
        
        if not user:
            role = "admin" if email == ADMIN_EMAIL else "user"
            user = await db_service.create_user(
                uid=uid,
                email=email,
                username=name,
                role=role
            )
            # Use the invite code for new users
            if invite_code:
                await db_service.use_invite(invite_code, uid)
        
        await db_service.update_last_accessed(uid)
        
        return AuthResponse(
            token=id_token,
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role=user.get("role", "user"),
                tokensUsed=TokenUsage(**user.get("tokens_used", {}))
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

@router.post("/reset-password")
async def reset_password(request: ResetPasswordRequest):
    if not db_service.enabled:
        return {"message": "Password reset email sent (dev mode)"}
    
    try:
        auth.generate_password_reset_link(request.email)
        return {"message": "Password reset email sent"}
    except auth.UserNotFoundError:
        return {"message": "If account exists, reset email sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    return UserResponse(
        uid=user["uid"],
        email=user["email"],
        username=user.get("username", user["email"].split("@")[0]),
        role=user.get("role", "user"),
        tokensUsed=TokenUsage(**user.get("tokens_used", {"total": 0, "flash": 0, "pro": 0}))
    )
