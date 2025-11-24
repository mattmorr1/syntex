#!/usr/bin/env python3
"""
Test Data Generator for uea
This script creates sample projects in Firebase for testing the history page.
"""

import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timedelta
import uuid
import random

# Initialize Firebase (make sure firebase-key.json exists)
try:
    cred = credentials.Certificate("firebase-key.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Firebase initialization failed: {e}")
    print("Please ensure firebase-key.json exists in the project root")
    exit(1)

# Sample LaTeX content templates
LATEX_TEMPLATES = [
    """\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage{geometry}

\\geometry{a4paper, margin=1in}

\\title{Research Paper on Machine Learning}
\\author{Test User}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}
Machine learning has revolutionized the way we approach complex problems in various domains.

\\section{Methodology}
We employed several algorithms including Random Forest, SVM, and Neural Networks.

\\section{Results}
Our experiments showed significant improvements in accuracy and performance.

\\end{document}""",
    
    """\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{Business Report Q4 2023}
\\author{Business Team}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Executive Summary}
This report outlines the key performance indicators for Q4 2023.

\\section{Financial Analysis}
Revenue increased by 15\\% compared to Q3.

\\section{Recommendations}
Based on our analysis, we recommend expanding into new markets.

\\end{document}""",
    
    """\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{Technical Documentation}
\\author{Engineering Team}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{System Architecture}
The system consists of three main components: frontend, backend, and database.

\\section{API Documentation}
All endpoints follow RESTful principles and return JSON responses.

\\section{Deployment}
The application is deployed using Docker containers on cloud infrastructure.

\\end{document}"""
]

# Sample filenames
FILENAMES = [
    "Research_Paper_ML.docx",
    "Business_Report_Q4.docx", 
    "Technical_Documentation.docx",
    "Project_Proposal.docx",
    "Meeting_Notes.docx",
    "Analysis_Report.docx",
    "Presentation_Content.docx",
    "User_Manual.docx",
    "Data_Analysis.docx",
    "Strategy_Document.docx"
]

# Sample statuses
STATUSES = ["completed", "processing", "error", "pending"]

def create_test_projects(user_id="test_user_123", num_projects=10):
    """Create test projects in Firebase"""
    
    print(f"Creating {num_projects} test projects for user: {user_id}")
    
    for i in range(num_projects):
        # Generate random date within last 30 days
        days_ago = random.randint(0, 30)
        created_date = datetime.now() - timedelta(days=days_ago)
        
        # Random project data
        project_data = {
            "user_id": user_id,
            "filename": random.choice(FILENAMES),
            "latex_content": random.choice(LATEX_TEMPLATES),
            "created_at": created_date,
            "status": random.choice(STATUSES),
            "project_name": f"Test Project {i+1}"
        }
        
        # Create project document
        project_id = str(uuid.uuid4())
        db.collection("projects").document(project_id).set(project_data)
        
        print(f"Created project {i+1}: {project_data['filename']} (ID: {project_id})")
    
    print(f"\nSuccessfully created {num_projects} test projects!")
    print("You can now test the history page with these projects.")

def create_test_user():
    """Create a test user document"""
    user_data = {
        "email": "test@uea.com",
        "created_at": datetime.now(),
        "last_login": datetime.now(),
        "projects_count": 0
    }
    
    db.collection("users").document("test_user_123").set(user_data)
    print("Created test user: test_user_123")

def main():
    print("uea Test Data Generator")
    print("=" * 40)
    
    try:
        # Create test user
        create_test_user()
        
        # Create test projects
        create_test_projects(num_projects=15)
        
        print("\nTest data generation completed!")
        print("\nTest Account Details:")
        print("Email: test@uea.com")
        print("Password: testpass123")
        print("\nYou can now login and view the history page with sample projects.")
        
    except Exception as e:
        print(f"Error creating test data: {e}")

if __name__ == "__main__":
    main()
