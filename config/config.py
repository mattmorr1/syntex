import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Firebase Configuration
    FIREBASE_KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "firebase-key.json")
    
    # Gemini AI Configuration
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    GEMINI_FLASH_MODEL = os.getenv("GEMINI_FLASH_MODEL", "gemini-2.0-flash")
    GEMINI_PRO_MODEL = os.getenv("GEMINI_PRO_MODEL", "gemini-1.5-pro")
    
    # Legacy GCP (for Vertex AI if needed)
    GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
    GCP_BUCKET_NAME = os.getenv("GCP_BUCKET_NAME", "")
    GCP_REGION = os.getenv("GCP_REGION", "us-central1")
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-pro")
    
    # LaTeX Configuration
    LATEX_COMPILER = os.getenv("LATEX_COMPILER", "pdflatex")
    LATEX_TIMEOUT = int(os.getenv("LATEX_TIMEOUT", "60"))
    
    # Server Configuration
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"
    
    # Admin Configuration
    ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "mmorristwo@gmail.com")
    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "matt")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "password")
    
    # Security Configuration
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    
    # File Upload Configuration
    MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", "10485760"))  # 10MB
    ALLOWED_EXTENSIONS = [".docx", ".doc"]
    
    # Database Collections
    FIRESTORE_COLLECTION_PROJECTS = "projects"
    FIRESTORE_COLLECTION_USERS = "users"
    FIRESTORE_COLLECTION_CHATS = "chats"
    FIRESTORE_COLLECTION_FEEDBACK = "feedback"
