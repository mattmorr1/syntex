import os
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
from jose import jwt, JWTError
from passlib.context import CryptContext
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.models.schemas import (
    LoginRequest, RegisterRequest, ResetPasswordRequest,
    AuthResponse, UserResponse, TokenUsage
)
from api.services.firestore import db_service
from config import Config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer(auto_error=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
limiter = Limiter(key_func=get_remote_address)

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "mmorristwo@gmail.com").lower().strip()
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "matt")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "password")
INVITE_ONLY = os.getenv("INVITE_ONLY", "true").lower() == "true"


def create_jwt_token(uid: str, email: str, role: str) -> str:
    """Create a signed JWT token with expiration."""
    payload = {
        "sub": uid,
        "email": email,
        "role": role,
        "exp": datetime.utcnow() + timedelta(minutes=Config.ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, Config.JWT_SECRET, algorithm=Config.ALGORITHM)


def verify_jwt_token(token: str) -> dict:
    """Verify a locally-issued JWT token."""
    return jwt.decode(token, Config.JWT_SECRET, algorithms=[Config.ALGORITHM])


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials

    # Dev mode: no Firebase, use local JWT only
    if not db_service.enabled:
        try:
            payload = verify_jwt_token(token)
            return {
                "uid": payload["sub"],
                "email": payload.get("email", ""),
                "username": payload.get("email", "").split("@")[0],
                "role": payload.get("role", "user"),
            }
        except JWTError:
            raise HTTPException(status_code=401, detail="Invalid token")

    # Production: try Firebase ID token first, then local JWT
    try:
        decoded = auth.verify_id_token(token)
        user = await db_service.get_user(decoded["uid"])
        if user:
            await db_service.update_last_accessed(decoded["uid"])
            return user
        return {"uid": decoded["uid"], "email": decoded.get("email", ""), "role": "user"}
    except auth.InvalidIdTokenError:
        logger.warning("Invalid Firebase ID token presented")
        raise HTTPException(status_code=401, detail="Invalid token")
    except auth.ExpiredIdTokenError:
        logger.info("Expired Firebase ID token presented")
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        # Not a Firebase token — try local JWT (for admin login)
        try:
            payload = verify_jwt_token(token)
            uid = payload["sub"]
            user = await db_service.get_user(uid)
            if user:
                await db_service.update_last_accessed(uid)
                return user
            return {"uid": uid, "email": payload.get("email", ""), "role": payload.get("role", "user")}
        except JWTError:
            logger.warning("Token failed both Firebase and JWT verification")
            raise HTTPException(status_code=401, detail="Invalid token")


async def get_admin_user(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest):
    request_email = body.email.lower().strip()

    if request_email == ADMIN_EMAIL and body.password == ADMIN_PASSWORD:
        user = await db_service.get_user_by_email(ADMIN_EMAIL)
        if not user:
            user = await db_service.create_user(
                uid="admin_user",
                email=ADMIN_EMAIL,
                username=ADMIN_USERNAME,
                role="admin"
            )

        token = create_jwt_token(user["uid"], user["email"], "admin")

        return AuthResponse(
            token=token,
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role="admin",
                tokensUsed=TokenUsage(**user.get("tokens_used", {}))
            )
        )

    if not db_service.enabled:
        uid = "dev_" + str(datetime.now().timestamp())
        token = create_jwt_token(uid, body.email, "user")
        return AuthResponse(
            token=token,
            user=UserResponse(
                uid=uid,
                email=body.email,
                username=body.email.split("@")[0],
                role="user",
                tokensUsed=TokenUsage()
            )
        )

    try:
        user_record = auth.get_user_by_email(body.email)
        user = await db_service.get_user(user_record.uid)

        if not user:
            user = await db_service.create_user(
                uid=user_record.uid,
                email=body.email,
                username=body.email.split("@")[0]
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
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=401, detail="Login failed")


@router.post("/register", response_model=AuthResponse)
@limiter.limit("3/minute")
async def register(request: Request, body: RegisterRequest):
    request_email = body.email.lower().strip()

    # Check invite code if required
    if INVITE_ONLY and request_email != ADMIN_EMAIL:
        if not body.invite_code:
            raise HTTPException(status_code=400, detail="Invite code required")
        invite = await db_service.validate_invite(body.invite_code)
        if not invite:
            raise HTTPException(status_code=400, detail="Invalid or expired invite code")

    if not db_service.enabled:
        uid = "dev_" + str(datetime.now().timestamp())
        user = await db_service.create_user(
            uid=uid,
            email=body.email,
            username=body.username
        )
        if body.invite_code:
            await db_service.use_invite(body.invite_code, user["uid"])
        token = create_jwt_token(uid, body.email, "user")
        return AuthResponse(
            token=token,
            user=UserResponse(
                uid=user["uid"],
                email=user["email"],
                username=user["username"],
                role="user",
                tokensUsed=TokenUsage()
            )
        )

    try:
        role = "admin" if request_email == ADMIN_EMAIL else "user"

        user_record = auth.create_user(
            email=body.email,
            password=body.password,
            display_name=body.username
        )

        user = await db_service.create_user(
            uid=user_record.uid,
            email=body.email,
            username=body.username,
            role=role
        )

        # Use the invite code
        if body.invite_code:
            await db_service.use_invite(body.invite_code, user_record.uid)

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
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=400, detail="Registration failed")


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
        if not user and INVITE_ONLY and email.lower().strip() != ADMIN_EMAIL:
            if not invite_code:
                raise HTTPException(status_code=400, detail="Invite code required for new accounts")
            invite = await db_service.validate_invite(invite_code)
            if not invite:
                raise HTTPException(status_code=400, detail="Invalid or expired invite code")

        if not user:
            role = "admin" if email.lower().strip() == ADMIN_EMAIL else "user"
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
    except auth.InvalidIdTokenError:
        logger.warning("Invalid Firebase ID token in Google auth")
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        logger.error(f"Google auth error: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed")


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
        logger.error(f"Password reset error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send reset email")


@router.get("/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    return UserResponse(
        uid=user["uid"],
        email=user["email"],
        username=user.get("username", user["email"].split("@")[0]),
        role=user.get("role", "user"),
        tokensUsed=TokenUsage(**user.get("tokens_used", {"total": 0, "flash": 0, "pro": 0}))
    )
