import os
import secrets
from dotenv import load_dotenv

load_dotenv()


def _secret(name: str, debug: bool) -> str:
    """Required in production; ephemeral per-process value under DEBUG so dev needs no setup."""
    val = os.getenv(name)
    if val:
        return val
    if not debug:
        raise RuntimeError(f"{name} is not set. Provide it via Secret Manager; refusing to start.")
    return secrets.token_urlsafe(32)

class Config:
    # Firebase Configuration
    FIREBASE_KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "firebase-key.json")
    FIREBASE_STORAGE_BUCKET = os.getenv("FIREBASE_STORAGE_BUCKET", "uea-app-470816.firebasestorage.app")
    
    # Gemini AI Configuration
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-3.8-flash")
    GEMINI_PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-3.1-pro-preview")
    
    # Legacy GCP (for Vertex AI if needed)
    GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
    GCP_BUCKET_NAME = os.getenv("GCP_BUCKET_NAME", "")
    GCP_REGION = os.getenv("GCP_REGION", "us-central1")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-pro-preview")
    
    # LaTeX Configuration
    LATEX_COMPILER = os.getenv("LATEX_COMPILER", "pdflatex")
    LATEX_TIMEOUT = int(os.getenv("LATEX_TIMEOUT", "60"))
    LATEX_CONCURRENCY = int(os.getenv("LATEX_CONCURRENCY", "2"))  # match deployed --cpu
    
    # Server Configuration
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"
    
    # Admin Configuration
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "mmorristwo@gmail.com")
    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "matt")
    ADMIN_PASSWORD = _secret("ADMIN_PASSWORD", DEBUG)
    
    # Security Configuration
    ALGORITHM = "HS256"
    JWT_SECRET = _secret("JWT_SECRET", DEBUG)
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    
    # File Upload Configuration
    MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", "10485760"))  # 10MB
    ALLOWED_EXTENSIONS = [".docx", ".doc"]
    
    # Token caps
    DEFAULT_TOKEN_CAP = int(os.getenv("DEFAULT_TOKEN_CAP", "2000000"))
    FERNET_KEY = os.getenv("FERNET_KEY", "")  # feature-gated: llm_provider raises at use

    # Email (SMTP)
    SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASS = os.getenv("SMTP_PASS", "")
    SMTP_FROM = os.getenv("SMTP_FROM", "")
    # Preferred transport: an API key scoped to sending, revocable without touching a
    # mailbox account. Falls back to SMTP when unset.
    RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
    EMAIL_FROM = os.getenv("EMAIL_FROM", "") or SMTP_FROM or SMTP_USER
    APP_URL = os.getenv("APP_URL", "http://localhost:5173")

    # Database Collections
    FIRESTORE_COLLECTION_PROJECTS = "projects"
    FIRESTORE_COLLECTION_USERS = "users"
    FIRESTORE_COLLECTION_CHATS = "chats"
    FIRESTORE_COLLECTION_FEEDBACK = "feedback"
