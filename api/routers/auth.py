import os
import time
import asyncio
import logging
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
import jwt
from jwt.exceptions import PyJWTError as JWTError
from passlib.context import CryptContext
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.models.schemas import (
    LoginRequest, RegisterRequest, ResetPasswordRequest,
    AuthResponse, UserResponse, TokenUsage,
    UpdateProviderKeyRequest, UpdatePreferredProviderRequest, UserSettingsResponse,
    AccessRequestCreate, RedeemInviteRequest, ProvisionRequest,
)
from api.services.firestore import db_service
from config import Config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer(auto_error=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
limiter = Limiter(key_func=get_remote_address)

ADMIN_EMAIL = Config.ADMIN_EMAIL.lower().strip()
ADMIN_USERNAME = Config.ADMIN_USERNAME
ADMIN_PASSWORD = Config.ADMIN_PASSWORD
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


LAST_ACCESS_INTERVAL_S = 300.0
_last_access: dict[str, float] = {}
NOT_PROVISIONED = {"code": "not_provisioned", "message": "This account has no access. Redeem an invite on the Register page."}


async def _touch(uid: str) -> None:
    """Throttle the last_accessed write to once per interval per uid; it ran on every request before."""
    now = time.monotonic()
    if now - _last_access.get(uid, 0.0) >= LAST_ACCESS_INTERVAL_S:
        _last_access[uid] = now
        await db_service.update_last_accessed(uid)


async def _provisioned(uid: str) -> dict:
    """Only a Firestore user doc grants access; a valid Firebase identity alone never does."""
    user = await db_service.get_user(uid)
    if not user:
        logger.warning("Rejected authenticated but unprovisioned uid=%s", uid)
        raise HTTPException(status_code=403, detail=NOT_PROVISIONED)
    await _touch(uid)
    return user


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

    # Production: Firebase ID token first, then the locally-signed admin JWT (InvalidIdTokenError: "no kid claim").
    try:
        uid = auth.verify_id_token(token)["uid"]
    except auth.ExpiredIdTokenError as e:
        logger.info("Expired Firebase ID token presented")
        raise HTTPException(status_code=401, detail="Token expired") from e
    except Exception as fb_err:
        try:
            uid = verify_jwt_token(token)["sub"]
        except JWTError as e:
            logger.warning("Token failed both Firebase (%s) and JWT (%s) verification", type(fb_err).__name__, e)
            raise HTTPException(status_code=401, detail="Invalid token") from e
    return await _provisioned(uid)


async def get_firebase_identity(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Verified Firebase identity WITHOUT the provisioning check; only for the provisioning endpoint."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not db_service.enabled:
        raise HTTPException(status_code=400, detail="Firebase required")
    try:
        return auth.verify_id_token(credentials.credentials)
    except auth.ExpiredIdTokenError as e:
        raise HTTPException(status_code=401, detail="Token expired") from e
    except Exception as e:
        logger.info("Firebase ID token rejected at provisioning: %s", type(e).__name__)
        raise HTTPException(status_code=401, detail="Invalid token") from e


def _auth_response(user: dict, token: str = "") -> AuthResponse:
    return AuthResponse(token=token, user=UserResponse(
        uid=user["uid"], email=user["email"], username=user.get("username") or user["email"].split("@")[0],
        role=user.get("role", "user"), tokensUsed=TokenUsage(**user.get("tokens_used", {}))))


async def get_admin_user(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest):
    request_email = body.email.lower().strip()

    if request_email == ADMIN_EMAIL and secrets.compare_digest(body.password, ADMIN_PASSWORD):
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

    # Everyone else authenticates against Firebase in the browser and presents the
    # resulting ID token; the profile then comes from /auth/me. Nothing here can check a
    # password -- the Admin SDK has no such call -- so there is nothing to issue a token
    # against, and minting one on an email lookup alone would admit anyone who knows an
    # address.
    raise HTTPException(status_code=401, detail="Invalid credentials")


@router.post("/register", response_model=AuthResponse)
@limiter.limit("3/minute")
async def register(request: Request, body: RegisterRequest):
    """Dev-mode only. With Firebase, the client signs up itself and then calls /auth/provision."""
    if db_service.enabled:
        raise HTTPException(status_code=410, detail="Use /auth/redeem-invite, Firebase sign-up, then /auth/provision")
    email = body.email.lower().strip()
    if INVITE_ONLY and email != ADMIN_EMAIL:
        if not body.invite_code or not await db_service.redeem_invite(body.invite_code, email):
            raise HTTPException(status_code=400, detail="Invalid or expired invite code")
    uid = "dev_" + str(datetime.now().timestamp())
    user = await db_service.create_user(uid=uid, email=body.email, username=body.username)
    return _auth_response(user, create_jwt_token(uid, body.email, "user"))


@router.post("/redeem-invite")
@limiter.limit("5/hour")
async def redeem_invite(request: Request, body: RedeemInviteRequest):
    """Bind an invite to an email before sign-up so the beforeCreate blocking function admits it."""
    email = body.email.lower().strip()
    if await db_service.get_user_by_email(email):
        raise HTTPException(status_code=400, detail="Email already registered; sign in instead")
    if not await db_service.redeem_invite(body.code, email):
        raise HTTPException(status_code=400, detail="Invalid or expired invite code")
    return {"message": "Invite redeemed. Create your account with this email within 24 hours.", "email": email}


@router.post("/provision", response_model=AuthResponse)
@limiter.limit("10/minute")
async def provision(request: Request, body: ProvisionRequest, identity: dict = Depends(get_firebase_identity)):
    """Idempotent: returns the existing profile, or creates it iff the email is allowlisted."""
    uid, email = identity["uid"], (identity.get("email") or "").lower().strip()
    if user := await db_service.get_user(uid):
        await _touch(uid)
        return _auth_response(user)
    entry = await db_service.get_allowed_email(email) if email else None
    role = "admin" if email == ADMIN_EMAIL else (entry or {}).get("role", "user")
    if not (entry or email == ADMIN_EMAIL):
        # Pre-blocking-function sign-ups land here; drop the orphaned Firebase account rather than keep it.
        await asyncio.to_thread(auth.delete_user, uid)
        logger.warning("Provision refused and Firebase user deleted: uid=%s email=%s", uid, email)
        raise HTTPException(status_code=403, detail={"code": "not_invited", "message": "No invite has been redeemed for this email."})
    if role == "admin" and not identity.get("email_verified"):
        raise HTTPException(status_code=403, detail={"code": "email_unverified", "message": "Verify this email before admin access is granted."})
    name = (body.username or identity.get("name") or email.split("@")[0]).strip()
    user = await db_service.create_user(uid=uid, email=email, username=name, role=role)
    await db_service.delete_allowed_email(email)
    logger.info("Provisioned uid=%s email=%s role=%s", uid, email, role)
    return _auth_response(user)


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


# ─── Settings endpoints ───────────────────────────────────────────────────────

@router.get("/settings", response_model=UserSettingsResponse)
async def get_settings(user: dict = Depends(get_current_user)):
    settings = user.get("settings") or {}
    providers = settings.get("providers") or {}
    configured = {p: bool(providers.get(p)) for p in ("gemini", "openai", "anthropic", "mistral")}
    return UserSettingsResponse(
        preferred_provider=settings.get("preferred_provider", "gemini"),
        providers_configured=configured,
    )


@router.put("/settings/provider-key")
async def save_provider_key(body: UpdateProviderKeyRequest, user: dict = Depends(get_current_user)):
    from api.services.llm_provider import encrypt_key
    try:
        encrypted = encrypt_key(body.api_key)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    await db_service.update_provider_key(user["uid"], body.provider, encrypted)
    return {"message": f"{body.provider} API key saved"}


@router.delete("/settings/provider-key/{provider}")
async def remove_provider_key(provider: str, user: dict = Depends(get_current_user)):
    valid = ["gemini", "openai", "anthropic", "mistral"]
    if provider not in valid:
        raise HTTPException(status_code=400, detail="Unknown provider")
    await db_service.update_provider_key(user["uid"], provider, None)
    return {"message": f"{provider} API key removed"}


@router.put("/settings/preferred-provider")
async def set_preferred_provider(body: UpdatePreferredProviderRequest, user: dict = Depends(get_current_user)):
    await db_service.update_preferred_provider(user["uid"], body.provider)
    return {"message": f"Preferred provider set to {body.provider}"}


# ─── Request access endpoint ──────────────────────────────────────────────────

@router.post("/request-access")
@limiter.limit("3/hour")
async def request_access(request: Request, body: AccessRequestCreate):
    email = body.email.lower().strip()

    existing_user = await db_service.get_user_by_email(email)
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    existing_req = await db_service.get_access_request_by_email(email)
    if existing_req and existing_req.get("status") == "pending":
        raise HTTPException(status_code=400, detail="A request for this email is already pending")

    req = await db_service.create_access_request(
        name=body.name,
        email=email,
        institution=body.institution,
        use_case=body.use_case,
    )
    return {"message": "Request submitted successfully", "id": req["id"]}
