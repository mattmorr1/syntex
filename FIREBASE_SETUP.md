# Firebase Setup Guide for DocuCraft

This guide will help you set up Firebase for both user authentication (passwords) and project history storage.

## **1. Firebase Project Setup**

### **Create Firebase Project**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" or "Add project"
3. Enter project name: `docucraft-latex` (or your preferred name)
4. Enable Google Analytics (optional, but recommended)
5. Click "Create project"

### **Get Project Configuration**
1. Go to Project Settings (gear icon in top left)
2. Note your **Project ID** - you'll need this for GCP setup

## **2. Authentication Setup (Passwords)**

### **Enable Email/Password Authentication**
1. In Firebase Console, go to **Authentication** → **Sign-in method**
2. Click on **"Email/Password"**
3. Toggle **"Enable"**
4. Optional: Enable "Email link (passwordless sign-in)"
5. Click **"Save"**

### **Create Test User**
1. Go to **Authentication** → **Users**
2. Click **"Add user"**
3. Enter:
   - Email: `test@docucraft.com`
   - Password: `testpass123`
4. Click **"Add user"**

### **Authentication Rules**
Firebase Auth automatically handles password hashing and security. No additional configuration needed.

## **3. Firestore Database Setup (Project History)**

### **Create Firestore Database**
1. Go to **Firestore Database** in the left sidebar
2. Click **"Create database"**
3. Choose security mode:
   - Select **"Start in production mode"** (recommended)
   - Click **"Next"**
4. Choose location: Select a region close to your users
5. Click **"Done"**

### **Database Structure**
The application will automatically create these collections:

```
firestore/
├── users/
│   └── {userId}/
│       ├── email: string
│       ├── created_at: timestamp
│       ├── updated_at: timestamp
│       ├── last_login: timestamp
│       ├── projects_count: number
│       └── subscription_tier: string
├── projects/
│   └── {projectId}/
│       ├── user_id: string
│       ├── filename: string
│       ├── latex_content: string
│       ├── created_at: timestamp
│       ├── updated_at: timestamp
│       └── status: string
├── chat_history/
│   └── {chatId}/
│       ├── user_id: string
│       ├── selected_text: string
│       ├── user_message: string
│       ├── ai_response: string
│       └── timestamp: timestamp
└── feedback/
    └── {feedbackId}/
        ├── feedback: string
        └── timestamp: timestamp
```

### **Security Rules**
Replace the default rules in **Firestore Database** → **Rules** with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Projects - users can only access their own projects
    match /projects/{projectId} {
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.user_id;
    }
    
    // Chat history - users can only access their own chats
    match /chat_history/{chatId} {
      allow read, write: if request.auth != null && 
        request.auth.uid == resource.data.user_id;
    }
    
    // Feedback - anyone can read, only authenticated users can write
    match /feedback/{feedbackId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

## **4. Service Account Setup**

### **Generate Service Account Key**
1. Go to **Project Settings** → **Service accounts**
2. Click **"Generate new private key"**
3. Click **"Generate key"**
4. Download the JSON file
5. Rename it to `firebase-key.json` and place it in your project root

### **Service Account Permissions**
The service account needs these roles:
- Firebase Admin SDK Administrator Service Agent
- Cloud Datastore User
- Firebase Authentication Admin

## **5. Environment Configuration**

### **Create Environment File**
Create a `.env` file in your project root:

```env
# Firebase Configuration
FIREBASE_KEY_PATH=firebase-key.json

# Google Cloud Configuration
GCP_PROJECT_ID=your-firebase-project-id
GCP_BUCKET_NAME=your-bucket-name
GCP_REGION=us-central1

# AI Platform Configuration
GEMINI_MODEL=gemini-pro

# LaTeX Configuration
LATEX_COMPILER=pdflatex
LATEX_TIMEOUT=30

# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=False

# Security Configuration

ACCESS_TOKEN_EXPIRE_MINUTES=30

# File Upload Configuration
MAX_FILE_SIZE=10485760
```

## **6. Testing the Setup**

### **Test Authentication**
1. Start the application: `docker compose -f docker-compose.dev.yml up --build`
2. Go to `http://localhost:8000/signup`
3. Create a new account
4. Go to `http://localhost:8000/login`
5. Log in with your credentials

### **Test Project History**
1. Upload a DOCX file
2. Go to `http://localhost:8000/history`
3. Verify your project appears in the list

### **Verify in Firebase Console**
1. **Authentication** → **Users**: Should show your created user
2. **Firestore Database** → **Data**: Should show collections and documents

## **7. Production Considerations**

### **Security**
- Use strong passwords
- Enable Firebase App Check
- Set up proper CORS policies
- Use environment variables for secrets

### **Scaling**
- Monitor Firestore usage
- Set up billing alerts
- Consider Firestore indexes for complex queries

### **Backup**
- Export Firestore data regularly
- Set up automated backups
- Document recovery procedures

## **8. Troubleshooting**

### **Common Issues**

**"Firebase key file not found"**
- Ensure `firebase-key.json` is in project root
- Check file permissions

**"Permission denied"**
- Verify Firestore security rules
- Check service account permissions

**"Authentication failed"**
- Verify user exists in Firebase Auth
- Check email/password combination

**"Project not found"**
- Verify project ID in configuration
- Check service account has access

### **Debug Mode**
If Firebase setup fails, the application will run in development mode:
- No real authentication
- In-memory project storage
- Sample LaTeX generation
- Limited functionality

## **9. API Endpoints**

### **Authentication**
- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `GET /login` - Login page
- `GET /signup` - Signup page

### **Projects**
- `GET /projects` - List user projects
- `GET /projects/{project_id}` - Get specific project
- `POST /upload` - Upload DOCX file
- `POST /save-project` - Save project

### **AI Features**
- `POST /ai/autocomplete` - AI code completion
- `POST /ai/chat` - AI chat assistance
- `GET /ai/chat-history` - Get chat history

## **10. Cost Estimation**

### **Firebase Costs (Monthly)**
- **Authentication**: Free for first 10,000 users
- **Firestore**: Free tier includes 1GB storage, 50K reads, 20K writes/day
- **Beyond free tier**: ~$0.18/GB storage, $0.06/100K reads

### **Typical Usage**
- **100 users, 500 projects**: Likely within free tier
- **1000 users, 5000 projects**: ~$5-10/month
- **Enterprise usage**: $20-50/month

## **11. Next Steps**

1. **Set up Google Cloud Platform** for AI features
2. **Configure SSL certificates** for production
3. **Set up monitoring and alerts**
4. **Implement user management features**
5. **Add subscription tiers and billing**

---

**Need Help?**
- Check Firebase documentation: https://firebase.google.com/docs
- Review Firestore security rules: https://firebase.google.com/docs/firestore/security
- Contact support if issues persist
