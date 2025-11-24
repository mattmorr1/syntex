from fastapi import FastAPI, File, UploadFile, HTTPException, Depends, status, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import firebase_admin
from firebase_admin import credentials, firestore, auth
import google.auth
from google.cloud import storage
import os
import uuid
import json
from typing import Optional
import asyncio
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime
from config import Config

# Initialize Firebase (optional for development)
try:
    if os.path.exists(Config.FIREBASE_KEY_PATH):
        cred = credentials.Certificate(Config.FIREBASE_KEY_PATH)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        FIREBASE_ENABLED = True
    else:
        print(f"Warning: Firebase key file not found at {Config.FIREBASE_KEY_PATH}")
        print("Running in development mode without Firebase")
        FIREBASE_ENABLED = False
        db = None
except Exception as e:
    print(f"Warning: Firebase initialization failed: {e}")
    print("Running in development mode without Firebase")
    FIREBASE_ENABLED = False
    db = None

# Initialize Google Cloud AI Platform (optional for development)
try:
    if Config.GCP_PROJECT_ID != "your-gcp-project-id":
        # aiplatform.init(project=Config.GCP_PROJECT_ID) # Removed to save space
        GCP_ENABLED = True
    else:
        print("Warning: GCP Project ID not configured")
        print("Running in development mode without AI features")
        GCP_ENABLED = False
except Exception as e:
    print(f"Warning: GCP initialization failed: {e}")
    print("Running in development mode without AI features")
    GCP_ENABLED = False

app = FastAPI(title="uea LaTeX Renderer")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

# Authentication dependency
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not FIREBASE_ENABLED:
        # Development mode - accept any token
        return {
            "uid": "dev_user_123",
            "email": "dev@example.com"
        }
    
    try:
        decoded_token = auth.verify_id_token(credentials.credentials)
        return decoded_token
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.get("/", response_class=HTMLResponse)
async def root():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>uea</title>
        <link rel="stylesheet" href="/static/styles.css">
    </head>
    <body>
        <div class="container">
            <header class="page-header">
                <div class="logo">
                    <div class="x-logo">X</div>
                    <h1>uea</h1>
                </div>
                <nav class="nav-menu">
                    <a href="/" class="nav-link active">Upload</a>
                    <a href="/history" class="nav-link">History</a>
                    <a href="/ide" class="nav-link">IDE</a>
                    <button onclick="logout()" class="logout-btn">Logout</button>
                </nav>
            </header>
            <h2>Upload your DOCX file</h2>
            <p class="subtitle">Transform your documents with the power of AI and LaTeX</p>
            
            <div class="upload-area" id="uploadArea">
                <div class="upload-icon">☁️</div>
                <p>Drag and drop your file here, or</p>
                <button class="browse-btn" onclick="document.getElementById('fileInput').click()">Browse files</button>
                <input type="file" id="fileInput" accept=".docx" style="display: none;" onchange="handleFileSelect(event)">
            </div>
            
            <div class="progress-container" id="progressContainer" style="display: none;">
                <div class="progress-text">
                    <span>Uploading...</span>
                    <span id="progressPercent">0% complete</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill"></div>
                </div>
            </div>
            
            <div class="feedback-section">
                <h3>Enjoying the experience?</h3>
                <p>Help us improve by sharing your feedback</p>
                <div class="feedback-input">
                    <input type="text" placeholder="Your feedback..." id="feedbackInput">
                    <button onclick="submitFeedback()">Submit</button>
                </div>
            </div>
        </div>
        <script src="/static/script.js"></script>
    </body>
    </html>
    """

@app.get("/login", response_class=HTMLResponse)
async def login_page():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login - DocuCraft</title>
        <link rel="stylesheet" href="/static/styles.css">
    </head>
    <body>
        <div class="login-container">
            <div class="logo">
                <div class="hourglass-logo">⏳</div>
                <h1>Welcome Back</h1>
                <p>Sign in to continue to DocuCraft</p>
            </div>
            
            <div class="login-card">
                <form id="loginForm">
                    <div class="form-group">
                        <label for="email">Username or Email</label>
                        <input type="email" id="email" placeholder="you@example.com" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" required>
                    </div>
                    
                    <div class="form-options">
                        <label class="checkbox-label">
                            <input type="checkbox" id="remember">
                            <span>Remember me</span>
                        </label>
                        <a href="#" class="forgot-link">Forgot your password?</a>
                    </div>
                    
                    <button type="submit" class="login-btn">Login</button>
                </form>
            </div>
            
            <div class="signup-link">
                <p>Don't have an account? <a href="/signup">Sign up</a></p>
            </div>
        </div>
        <script src="/static/auth.js"></script>
    </body>
    </html>
    """

@app.get("/signup", response_class=HTMLResponse)
async def signup_page():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sign Up - DocuCraft</title>
        <link rel="stylesheet" href="/static/styles.css">
    </head>
    <body>
        <div class="login-container">
            <div class="logo">
                <div class="hourglass-logo">⏳</div>
                <h1>Create Account</h1>
                <p>Join DocuCraft to start converting documents</p>
            </div>
            
            <div class="login-card">
                <form id="signupForm">
                    <div class="form-group">
                        <label for="email">Email Address</label>
                        <input type="email" id="email" placeholder="you@example.com" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="password">Password</label>
                        <input type="password" id="password" placeholder="Minimum 6 characters" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="confirmPassword">Confirm Password</label>
                        <input type="password" id="confirmPassword" placeholder="Repeat your password" required>
                    </div>
                    
                    <div class="form-options">
                        <label class="checkbox-label">
                            <input type="checkbox" id="terms" required>
                            <span>I agree to the <a href="#" class="terms-link">Terms of Service</a></span>
                        </label>
                    </div>
                    
                    <button type="submit" class="login-btn">Create Account</button>
                </form>
            </div>
            
            <div class="signup-link">
                <p>Already have an account? <a href="/login">Sign in</a></p>
            </div>
        </div>
        <script src="/static/auth.js"></script>
    </body>
    </html>
    """

@app.get("/ide", response_class=HTMLResponse)
async def ide_page():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>uea AI IDE</title>
        <link rel="stylesheet" href="/static/ide.css">
    </head>
    <body>
        <div class="ide-container">
            <header class="ide-header">
                <h1>uea AI IDE</h1>
                <div class="header-buttons">
                    <button class="regenerate-btn">Regenerate AI</button>
                    <button class="compile-btn">Compile & Render</button>
                    <button class="save-btn">Save</button>
                </div>
            </header>
            
            <div class="ide-content">
                <div class="sidebar">
                    <h3>EXPLORER</h3>
                    <ul class="file-list" id="fileList">
                        <li class="file-item active" data-file="generated_document.tex">generated_document.tex</li>
                        <li class="file-item" data-file="references.bib">references.bib</li>
                        <li class="file-item" data-file="style.cls">style.cls</li>
                    </ul>
                </div>
                
                <div class="editor-pane">
                    <div class="editor-header">
                        <span id="currentFile">generated_document.tex</span>
                        <div class="editor-controls">
                            <button class="undo-btn">↶</button>
                            <button class="redo-btn">↷</button>
                            <button class="ai-chat-btn" onclick="openAIChat()">💬 AI Chat</button>
                        </div>
                    </div>
                    <div class="editor-container">
                        <textarea id="codeEditor" class="code-editor"></textarea>
                        <div id="autocompleteBox" class="autocomplete-box" style="display: none;">
                            <div class="autocomplete-header">
                                <span>AI Suggestions</span>
                                <button onclick="closeAutocomplete()">×</button>
                            </div>
                            <div id="autocompleteList" class="autocomplete-list">
                                <!-- Suggestions will be populated here -->
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="output-pane">
                    <div class="output-header">
                        <h3>Rendered Output</h3>
                        <div class="output-controls">
                            <button class="zoom-in">+</button>
                            <button class="zoom-out">-</button>
                        </div>
                    </div>
                    <div class="output-content" id="outputContent">
                        <div class="rendered-document">
                            <h1>Analysis of AI Impact on Modern Workflows</h1>
                            <p><strong>uea AI</strong></p>
                            <p>November 26, 2023</p>
                            <h2>1 Introduction</h2>
                            <p>Artificial Intelligence (AI) is transforming industries by automating tasks, enabling data-driven decisions, and creating new opportunities for innovation. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
                            <h3>1.1 Problem Statement</h3>
                            <p>The primary challenge is to integrate AI models seamlessly into existing enterprise workflows without causing significant disruption.</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- AI Chat Modal -->
            <div id="aiChatModal" class="ai-chat-modal" style="display: none;">
                <div class="ai-chat-content">
                    <div class="ai-chat-header">
                        <h3>AI LaTeX Assistant</h3>
                        <button onclick="closeAIChat()">×</button>
                    </div>
                    <div class="ai-chat-body">
                        <div class="selected-text-section">
                            <label>Selected Text:</label>
                            <div id="selectedTextDisplay" class="selected-text-display">No text selected</div>
                        </div>
                        <div class="chat-input-section">
                            <textarea id="chatInput" placeholder="Ask AI to help with the selected text... (e.g., 'Improve this table', 'Fix the formatting', 'Add more mathematical notation')"></textarea>
                            <button onclick="sendChatMessage()" class="send-chat-btn">Send</button>
                        </div>
                        <div class="chat-history" id="chatHistory">
                            <!-- Chat messages will appear here -->
                        </div>
                    </div>
                </div>
            </div>
                </div>
            </div>
        </div>
        <script src="/static/ide.js"></script>
    </body>
    </html>
    """

@app.get("/history", response_class=HTMLResponse)
async def history_page():
    return """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Project History - uea</title>
        <link rel="stylesheet" href="/static/styles.css">
        <link rel="stylesheet" href="/static/history.css">
    </head>
    <body>
        <div class="history-container">
            <header class="history-header">
                <div class="header-content">
                    <div class="logo">
                        <div class="x-logo">X</div>
                        <h1>uea</h1>
                    </div>
                    <nav class="nav-menu">
                        <a href="/" class="nav-link">Upload</a>
                        <a href="/history" class="nav-link active">History</a>
                        <a href="/ide" class="nav-link">IDE</a>
                        <button onclick="logout()" class="logout-btn">Logout</button>
                    </nav>
                </div>
            </header>
            
            <main class="history-main">
                <div class="history-content">
                    <h2>Project History</h2>
                    <p class="subtitle">Your LaTeX projects and conversions</p>
                    
                    <div class="filters">
                        <div class="search-box">
                            <input type="text" id="searchInput" placeholder="Search projects...">
                            <button onclick="searchProjects()">Search</button>
                        </div>
                        <div class="filter-options">
                            <select id="sortSelect" onchange="sortProjects()">
                                <option value="date-desc">Newest First</option>
                                <option value="date-asc">Oldest First</option>
                                <option value="name-asc">Name A-Z</option>
                                <option value="name-desc">Name Z-A</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="projects-grid" id="projectsGrid">
                        <!-- Projects will be loaded here -->
                    </div>
                    
                    <div class="loading" id="loading" style="display: none;">
                        <div class="spinner"></div>
                        <p>Loading projects...</p>
                    </div>
                    
                    <div class="no-projects" id="noProjects" style="display: none;">
                        <div class="empty-state">
                            <div class="empty-icon">📄</div>
                            <h3>No projects yet</h3>
                            <p>Start by uploading a DOCX file to create your first LaTeX project</p>
                            <a href="/" class="upload-link">Upload Document</a>
                        </div>
                    </div>
                </div>
            </main>
        </div>
        <script src="/static/history.js"></script>
    </body>
    </html>
    """

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    if not file.filename.endswith('.docx'):
        raise HTTPException(status_code=400, detail="Only DOCX files are supported")
    
    # Save file temporarily
    temp_dir = tempfile.mkdtemp()
    file_path = os.path.join(temp_dir, file.filename)
    
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    # Process with Gemini AI
    try:
        latex_content = await process_docx_with_ai(file_path)
        
        # Save to Firebase if available
        project_id = str(uuid.uuid4())
        if FIREBASE_ENABLED and db:
            project_data = {
                "user_id": user["uid"],
                "filename": file.filename,
                "latex_content": latex_content,
                "created_at": firestore.SERVER_TIMESTAMP,
                "status": "completed"
            }
            db.collection("projects").document(project_id).set(project_data)
        else:
            # Store in memory for development
            if not hasattr(app.state, 'dev_projects'):
                app.state.dev_projects = {}
            app.state.dev_projects[project_id] = {
                "user_id": user["uid"],
                "filename": file.filename,
                "latex_content": latex_content,
                "created_at": datetime.now(),
                "status": "completed"
            }
        
        return {"project_id": project_id, "latex_content": latex_content}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup
        os.remove(file_path)
        os.rmdir(temp_dir)

@app.post("/auth/login")
async def login(request_data: dict):
    try:
        email = request_data.get("email")
        password = request_data.get("password")
        
        if not email or not password:
            raise HTTPException(status_code=400, detail="Email and password required")
        
        # Test account for development
        if email == "test@docucraft.com" and password == "testpass123":
            return {
                "token": "test_token_12345",
                "user_id": "test_user_123",
                "email": "test@docucraft.com"
            }
        
        # Regular Firebase authentication
        if FIREBASE_ENABLED:
            user = auth.get_user_by_email(email)
            # In production, verify password properly
            return {"token": "mock_token", "user_id": user.uid}
        else:
            # Development mode - accept any credentials
            return {
                "token": "dev_token_12345",
                "user_id": "dev_user_123",
                "email": email
            }
    except Exception as e:
        if "Email and password required" in str(e):
            raise e
        raise HTTPException(status_code=401, detail="Invalid credentials")

@app.post("/auth/register")
async def register(request_data: dict):
    try:
        email = request_data.get("email")
        password = request_data.get("password")
        
        if not email or not password:
            raise HTTPException(status_code=400, detail="Email and password required")
        
        if FIREBASE_ENABLED:
            # Create user in Firebase
            user = auth.create_user(
                email=email,
                password=password
            )
            
            # Create user document in Firestore
            user_data = {
                "email": email,
                "created_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "last_login": firestore.SERVER_TIMESTAMP,
                "projects_count": 0,
                "subscription_tier": "free"
            }
            db.collection("users").document(user.uid).set(user_data)
            
            return {
                "token": "mock_token",
                "user_id": user.uid,
                "email": email,
                "message": "User created successfully"
            }
        else:
            # Development mode
            return {
                "token": "dev_token_12345",
                "user_id": "dev_user_123",
                "email": email,
                "message": "User created successfully (dev mode)"
            }
    except Exception as e:
        if "Email and password required" in str(e):
            raise e
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/projects")
async def get_user_projects(user: dict = Depends(get_current_user)):
    if FIREBASE_ENABLED and db:
        projects = db.collection("projects").where("user_id", "==", user["uid"]).stream()
        return [{"id": doc.id, **doc.to_dict()} for doc in projects]
    else:
        # Return development projects
        if hasattr(app.state, 'dev_projects'):
            return [{"id": pid, **project} for pid, project in app.state.dev_projects.items() 
                   if project["user_id"] == user["uid"]]
        return []

@app.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    if FIREBASE_ENABLED and db:
        doc = db.collection("projects").document(project_id).get()
        if not doc.exists or doc.to_dict()["user_id"] != user["uid"]:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"id": doc.id, **doc.to_dict()}
    else:
        # Return development project
        if hasattr(app.state, 'dev_projects') and project_id in app.state.dev_projects:
            project = app.state.dev_projects[project_id]
            if project["user_id"] == user["uid"]:
                return {"id": project_id, **project}
        raise HTTPException(status_code=404, detail="Project not found")

@app.post("/compile")
async def compile_latex(latex_content: str, user: dict = Depends(get_current_user)):
    try:
        # Create temporary LaTeX file
        temp_dir = tempfile.mkdtemp()
        tex_file = os.path.join(temp_dir, "document.tex")
        
        with open(tex_file, "w") as f:
            f.write(latex_content)
        
        # Compile with pdflatex (if available)
        try:
            result = subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", tex_file],
                cwd=temp_dir,
                capture_output=True,
                text=True
            )
            
            if result.returncode != 0:
                # Return compilation error for debugging
                return {
                    "success": False,
                    "error": f"LaTeX compilation failed: {result.stderr}",
                    "pdf_url": None
                }
            
            # Read generated PDF
            pdf_file = os.path.join(temp_dir, "document.pdf")
            if os.path.exists(pdf_file):
                # In development mode, just return success without uploading
                return {
                    "success": True,
                    "pdf_url": "/static/sample.pdf",  # Mock URL for development
                    "message": "PDF compiled successfully (dev mode)"
                }
            else:
                return {
                    "success": False,
                    "error": "PDF generation failed - no output file created",
                    "pdf_url": None
                }
        except FileNotFoundError:
            # pdflatex not installed
            return {
                "success": False,
                "error": "pdflatex not installed. LaTeX compilation requires a LaTeX distribution like TeX Live or MiKTeX.",
                "pdf_url": None
            }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup
        import shutil
        shutil.rmtree(temp_dir)

async def process_docx_with_ai(file_path: str) -> str:
    if not GCP_ENABLED:
        # Return a sample LaTeX document for development
        return """\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{geometry}

\\geometry{a4paper, margin=1in}

\\title{Sample Document}
\\author{uea AI}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
This is a sample LaTeX document generated for development purposes.

\\section{Content}
Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

\\section{Conclusion}
This document demonstrates the basic LaTeX structure.

\\end{document}"""
    
    # Use Vertex AI REST API with Gemini
    # This avoids the heavy google-cloud-aiplatform dependency
    
    try:
        import google.auth
        from google.auth.transport.requests import Request
        import httpx
        
        # Get credentials
        credentials, project_id = google.auth.default()
        if not credentials.token:
            credentials.refresh(Request())
            
        access_token = credentials.token
        
        # API Endpoint
        # Format: https://{region}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{region}/publishers/google/models/{model_id}:streamGenerateContent
        location = "us-central1" # Default location
        api_endpoint = f"https://{location}-aiplatform.googleapis.com/v1/projects/{Config.GCP_PROJECT_ID}/locations/{location}/publishers/google/models/{Config.GEMINI_MODEL}:streamGenerateContent"
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        
        # Read DOCX content (simplified - in production use python-docx)
        with open(file_path, "rb") as f:
            content = f.read()
            
        # Construct prompt
        prompt_text = f"""
        Convert the following DOCX content to LaTeX format. 
        Generate a complete LaTeX document with proper structure, sections, and formatting.
        
        Content: {content[:1000]}...
        
        Return only the LaTeX code without any explanations.
        """
        
        payload = {
            "contents": [{
                "role": "user",
                "parts": [{"text": prompt_text}]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 2048,
                "topP": 0.8,
                "topK": 40
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(api_endpoint, json=payload, headers=headers, timeout=60.0)
            
            if response.status_code != 200:
                raise Exception(f"Vertex AI API Error: {response.status_code} - {response.text}")
                
            result = response.json()
            # Parse streaming response (simplified for non-streaming endpoint usage if applicable, but we used streamGenerateContent)
            # Actually, let's use generateContent (non-streaming) for simplicity if available, or handle stream
            # The endpoint above is streamGenerateContent. Let's switch to generateContent for simpler parsing
            
        # Retry with generateContent for simpler parsing
        api_endpoint = f"https://{location}-aiplatform.googleapis.com/v1/projects/{Config.GCP_PROJECT_ID}/locations/{location}/publishers/google/models/{Config.GEMINI_MODEL}:generateContent"
        
        async with httpx.AsyncClient() as client:
            response = await client.post(api_endpoint, json=payload, headers=headers, timeout=60.0)
            
            if response.status_code != 200:
                raise Exception(f"Vertex AI API Error: {response.status_code} - {response.text}")
                
            result = response.json()
            
            # Extract text from response
            try:
                generated_text = result["candidates"][0]["content"]["parts"][0]["text"]
                return generated_text
            except (KeyError, IndexError) as e:
                raise Exception(f"Failed to parse Vertex AI response: {result}")
                
    except Exception as e:
        print(f"Error calling Vertex AI: {e}")
        # Fallback to sample content if API fails
        return """\\documentclass{article}
\\usepackage{amsmath}
\\title{Error Generating Content}
\\begin{document}
\\maketitle
\\section{Error}
Failed to generate content via Vertex AI. Please check logs.
\\end{document}"""

@app.post("/regenerate")
async def regenerate_content(current_content: str, file: str, user: dict = Depends(get_current_user)):
    try:
        if not GCP_ENABLED:
            # Return enhanced sample content for development
            enhanced_content = current_content.replace(
                "This is a sample LaTeX document generated for development purposes.",
                "This is an enhanced sample LaTeX document with improved structure and additional content for development purposes."
            )
            if enhanced_content == current_content:
                enhanced_content += "\n\n\\section{Enhanced Content}\nThis content has been regenerated with AI assistance (simulated in development mode)."
            
            return {"latex_content": enhanced_content}
        
        # Use Vertex AI REST API
        import google.auth
        from google.auth.transport.requests import Request
        import httpx
        
        # Get credentials
        credentials, project_id = google.auth.default()
        if not credentials.token:
            credentials.refresh(Request())
            
        access_token = credentials.token
        
        location = "us-central1"
        api_endpoint = f"https://{location}-aiplatform.googleapis.com/v1/projects/{Config.GCP_PROJECT_ID}/locations/{location}/publishers/google/models/{Config.GEMINI_MODEL}:generateContent"
        
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }
        
        prompt = f"""
        Improve and regenerate the following LaTeX content. 
        Make it more professional, well-structured, and comprehensive.
        
        Current content: {current_content}
        
        Return only the improved LaTeX code without any explanations.
        """
        
        payload = {
            "contents": [{
                "role": "user",
                "parts": [{"text": prompt}]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 2048
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(api_endpoint, json=payload, headers=headers, timeout=60.0)
            
            if response.status_code != 200:
                raise Exception(f"Vertex AI API Error: {response.status_code} - {response.text}")
                
            result = response.json()
            generated_text = result["candidates"][0]["content"]["parts"][0]["text"]
            return {"latex_content": generated_text}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/save-project")
async def save_project(files: dict, current_file: str, user: dict = Depends(get_current_user)):
    try:
        project_id = str(uuid.uuid4())
        project_data = {
            "user_id": user["uid"],
            "files": files,
            "current_file": current_file,
            "created_at": firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP
        }
        
        db.collection(Config.FIRESTORE_COLLECTION_PROJECTS).document(project_id).set(project_data)
        return {"project_id": project_id, "message": "Project saved successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/feedback")
async def submit_feedback(feedback_data: dict):
    try:
        if FIREBASE_ENABLED and db:
            feedback_record = {
                "feedback": feedback_data["feedback"],
                "timestamp": firestore.SERVER_TIMESTAMP
            }
            db.collection(Config.FIRESTORE_COLLECTION_FEEDBACK).add(feedback_record)
        else:
            # In development mode, just log the feedback
            print(f"Feedback received: {feedback_data.get('feedback', 'No feedback provided')}")
        
        return {"message": "Feedback submitted successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/download-pdf/{project_id}")
async def download_pdf(project_id: str, user: dict = Depends(get_current_user)):
    try:
        # Get project from Firebase
        doc = db.collection(Config.FIRESTORE_COLLECTION_PROJECTS).document(project_id).get()
        if not doc.exists or doc.to_dict()["user_id"] != user["uid"]:
            raise HTTPException(status_code=404, detail="Project not found")
        
        project = doc.to_dict()
        
        # Compile LaTeX to PDF
        temp_dir = tempfile.mkdtemp()
        tex_file = os.path.join(temp_dir, "document.tex")
        
        with open(tex_file, "w") as f:
            f.write(project.get("latex_content", ""))
        
        # Compile with pdflatex
        result = subprocess.run(
            [Config.LATEX_COMPILER, "-interaction=nonstopmode", tex_file],
            cwd=temp_dir,
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            raise Exception(f"LaTeX compilation failed: {result.stderr}")
        
        # Read generated PDF
        pdf_file = os.path.join(temp_dir, "document.pdf")
        if os.path.exists(pdf_file):
            with open(pdf_file, "rb") as f:
                pdf_content = f.read()
            
            # Return PDF as response
            from fastapi.responses import Response
            return Response(
                content=pdf_content,
                media_type="application/pdf",
                headers={"Content-Disposition": f"attachment; filename=project-{project_id}.pdf"}
            )
        else:
            raise Exception("PDF generation failed")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup
        import shutil
        shutil.rmtree(temp_dir)

@app.post("/duplicate-project/{project_id}")
async def duplicate_project(project_id: str, user: dict = Depends(get_current_user)):
    try:
        # Get original project
        doc = db.collection(Config.FIRESTORE_COLLECTION_PROJECTS).document(project_id).get()
        if not doc.exists or doc.to_dict()["user_id"] != user["uid"]:
            raise HTTPException(status_code=404, detail="Project not found")
        
        original_project = doc.to_dict()
        
        # Create duplicate
        new_project_id = str(uuid.uuid4())
        duplicate_data = {
            "user_id": user["uid"],
            "filename": f"{original_project.get('filename', 'Document')} (Copy)",
            "latex_content": original_project.get("latex_content", ""),
            "created_at": firestore.SERVER_TIMESTAMP,
            "status": "completed",
            "original_project_id": project_id
        }
        
        db.collection(Config.FIRESTORE_COLLECTION_PROJECTS).document(new_project_id).set(duplicate_data)
        
        return {"project_id": new_project_id, "message": "Project duplicated successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/delete-project/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    try:
        # Verify project ownership
        doc = db.collection(Config.FIRESTORE_COLLECTION_PROJECTS).document(project_id).get()
        if not doc.exists or doc.to_dict()["user_id"] != user["uid"]:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Delete project
        db.collection(Config.FIRESTORE_COLLECTION_PROJECTS).document(project_id).delete()
        
        return {"message": "Project deleted successfully"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/autocomplete")
async def ai_autocomplete(
    current_text: str,
    cursor_position: int,
    context: str = "",
    user: dict = Depends(get_current_user)
):
    try:
        # Use Gemini for intelligent autocomplete
        model = aiplatform.TextGenerationModel.from_pretrained(Config.GEMINI_MODEL)
        
        # Get text before and after cursor
        before_cursor = current_text[:cursor_position]
        after_cursor = current_text[cursor_position:]
        
        prompt = f"""
        You are a LaTeX expert. Provide intelligent autocomplete suggestions for the following LaTeX code.
        
        Context: {context}
        Code before cursor: {before_cursor}
        Code after cursor: {after_cursor}
        Cursor position: {cursor_position}
        
        Provide 3-5 autocomplete suggestions that would be most helpful at this position.
        Focus on:
        - LaTeX commands and environments
        - Mathematical expressions
        - Document structure elements
        - Common LaTeX packages and their commands
        
        Return only the suggestions as a JSON array, each with 'text' and 'description' fields.
        Example: [{{"text": "\\\\section{{", "description": "Start a new section"}}]
        """
        
        response = model.predict(prompt)
        
        # Parse the response as JSON
        import json
        try:
            suggestions = json.loads(response.text)
            return {"suggestions": suggestions}
        except json.JSONDecodeError:
            # Fallback if JSON parsing fails
            return {
                "suggestions": [
                    {"text": "\\\\section{", "description": "Start a new section"},
                    {"text": "\\\\begin{{equation}}", "description": "Mathematical equation environment"},
                    {"text": "\\\\item", "description": "List item"}
                ]
            }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/chat")
async def ai_chat(
    selected_text: str,
    user_message: str,
    full_document: str = "",
    user: dict = Depends(get_current_user)
):
    try:
        # Use Gemini for chat-based assistance
        model = aiplatform.TextGenerationModel.from_pretrained(Config.GEMINI_MODEL)
        
        prompt = f"""
        You are a LaTeX expert assistant. The user has selected some text and is asking for help.
        
        Selected text: {selected_text}
        User message: {user_message}
        Full document context: {full_document[:2000]}...
        
        Provide helpful assistance that includes:
        1. Analysis of the selected text
        2. Suggestions for improvement
        3. Corrected/improved version of the selected text
        4. Explanation of any changes made
        
        Focus on:
        - LaTeX syntax and best practices
        - Mathematical notation improvements
        - Table formatting and structure
        - Document organization
        - Common LaTeX errors and fixes
        
        Return your response in a clear, helpful format with the improved code clearly marked.
        """
        
        response = model.predict(prompt)
        
        # Store chat history in Firebase
        chat_data = {
            "user_id": user["uid"],
            "selected_text": selected_text,
            "user_message": user_message,
            "ai_response": response.text,
            "timestamp": firestore.SERVER_TIMESTAMP
        }
        
        db.collection("chat_history").add(chat_data)
        
        return {
            "response": response.text,
            "improved_text": extract_improved_text(response.text, selected_text)
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/ai/chat-history")
async def get_chat_history(user: dict = Depends(get_current_user)):
    try:
        # Get recent chat history for the user
        chats = db.collection("chat_history").where("user_id", "==", user["uid"]).order_by("timestamp", direction=firestore.Query.DESCENDING).limit(20).stream()
        
        chat_history = []
        for chat in chats:
            chat_data = chat.to_dict()
            chat_data["id"] = chat.id
            chat_history.append(chat_data)
        
        return {"chat_history": chat_history}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def extract_improved_text(ai_response: str, original_text: str) -> str:
    """Extract improved LaTeX code from AI response"""
    # Look for code blocks or marked improvements
    import re
    
    # Look for ```latex ... ``` blocks
    latex_blocks = re.findall(r'```latex\s*(.*?)\s*```', ai_response, re.DOTALL)
    if latex_blocks:
        return latex_blocks[0].strip()
    
    # Look for \begin{...} ... \end{...} patterns
    begin_end_pattern = r'\\\\begin\{[^}]+\}.*?\\\\end\{[^}]+\}'
    matches = re.findall(begin_end_pattern, ai_response, re.DOTALL)
    if matches:
        return matches[0]
    
    # Look for section commands
    section_pattern = r'\\\\section\{[^}]*\}.*?(?=\\\\section|$)'
    matches = re.findall(section_pattern, ai_response, re.DOTALL)
    if matches:
        return matches[0]
    
    # Fallback: return the original text
    return original_text

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
