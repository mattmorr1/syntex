import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Firebase Configuration
    FIREBASE_KEY_PATH = os.getenv("FIREBASE_KEY_PATH", "firebase-key.json")
    
    # Google Cloud Configuration
    GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "your-gcp-project-id")
    GCP_BUCKET_NAME = os.getenv("GCP_BUCKET_NAME", "your-bucket-name")
    GCP_REGION = os.getenv("GCP_REGION", "us-central1")
    
    # AI Platform Configuration
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-pro")
    
    # LaTeX Configuration
    LATEX_COMPILER = os.getenv("LATEX_COMPILER", "pdflatex")
    LATEX_TIMEOUT = int(os.getenv("LATEX_TIMEOUT", "30"))
    
    # Server Configuration
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"
    
    # Security Configuration
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    # File Upload Configuration
    MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", "10485760"))  # 10MB
    ALLOWED_EXTENSIONS = [".docx"]
    
    # Database Configuration
    FIRESTORE_COLLECTION_PROJECTS = "projects"
    FIRESTORE_COLLECTION_USERS = "users"
    FIRESTORE_COLLECTION_FEEDBACK = "feedback"
