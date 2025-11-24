# uea LaTeX Renderer

A server-client based LaTeX renderer that transforms DOCX files into LaTeX documents using AI and provides an integrated development environment for editing and compiling LaTeX code.

## Features

- **DOCX to LaTeX Conversion**: Upload DOCX files and convert them to LaTeX using Google's Gemini AI
- **Integrated Development Environment**: Modern IDE interface with syntax highlighting and real-time editing
- **LaTeX Compilation**: Compile LaTeX documents to PDF using pdflatex
- **User Authentication**: Firebase-based user management and project history
- **Cloud Storage**: Google Cloud Storage integration for PDF storage
- **Real-time Preview**: Live rendering of LaTeX documents
- **Project Management**: Save and load projects with version history
- **AI Autocomplete**: Intelligent LaTeX code completion using Gemini AI
- **AI Chat Assistant**: Select text and get AI-powered improvements and suggestions

## Architecture

- **Backend**: FastAPI with Python
- **Frontend**: HTML/CSS/JavaScript with modern UI
- **Database**: Firebase Firestore
- **AI Processing**: Google Cloud AI Platform (Gemini)
- **File Storage**: Google Cloud Storage
- **Authentication**: Firebase Authentication

## Prerequisites

- Python 3.8+
- Google Cloud Platform account
- Firebase project
- LaTeX installation (pdflatex)
- Docker (optional)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd LatexUEA
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up Google Cloud Platform**
   - Create a GCP project
   - Enable AI Platform API
   - Enable Cloud Storage API
   - Create a service account and download the key
   - Create a storage bucket

4. **Set up Firebase**
   - Create a Firebase project
   - Enable Authentication and Firestore
   - Download the service account key as `firebase-key.json`

5. **Configure environment variables**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Firebase Configuration
FIREBASE_KEY_PATH=firebase-key.json

# Google Cloud Configuration
GCP_PROJECT_ID=your-gcp-project-id
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

### Firebase Setup

1. Place your Firebase service account key as `firebase-key.json` in the project root
2. Enable Authentication methods (Email/Password recommended)
3. Create Firestore database in production mode

### Google Cloud Setup

1. Set up authentication:
   ```bash
   gcloud auth application-default login
   ```

2. Set your project:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```

3. Enable required APIs:
   ```bash
   gcloud services enable aiplatform.googleapis.com
   gcloud services enable storage.googleapis.com
   ```

## Running the Application

### Development

```bash
python main.py
```

The application will be available at `http://localhost:8000`

### Production

For production deployment, use a WSGI server:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

### Docker Deployment

#### Development (with hot reloading):
```bash
docker compose -f docker-compose.dev.yml up --build
```

#### Production:
```bash
docker compose up --build
```

#### Production with nginx reverse proxy:
```bash
docker compose --profile production up --build
```

#### Individual Docker commands:
```bash
docker build -t uea .
docker run -p 8000:8000 uea
```

## API Endpoints

### Authentication
- `POST /auth/login` - User login
- `GET /login` - Login page

### File Upload
- `POST /upload` - Upload DOCX file
- `GET /` - Upload page

### IDE
- `GET /ide` - IDE interface
- `POST /compile` - Compile LaTeX
- `POST /regenerate` - Regenerate AI content
- `POST /save-project` - Save project
- `POST /ai/autocomplete` - AI-powered code completion
- `POST /ai/chat` - AI chat assistance for selected text
- `GET /ai/chat-history` - Get chat history

### Projects
- `GET /projects` - List user projects
- `GET /projects/{project_id}` - Get specific project

## Usage Flow

1. **Login**: Users authenticate via the login page
2. **Upload**: Upload a DOCX file through the drag-and-drop interface
3. **AI Processing**: The system converts the DOCX to LaTeX using Gemini AI
4. **IDE**: Users are redirected to the IDE for editing and compilation
5. **AI Assistance**: Intelligent autocomplete and chat-based improvements
6. **Compilation**: LaTeX documents are compiled to PDF using pdflatex
7. **Storage**: Generated PDFs are stored in Google Cloud Storage
8. **History**: Users can view, manage, and access all their projects

## Test Account

For development and testing purposes, a test account is available:

- **Email**: `test@uea.com`
- **Password**: `testpass123`

To populate the history page with sample data, run:
```bash
python test_data.py
```

This will create 15 sample projects in Firebase for testing the history functionality.

## Security Considerations

- All API endpoints require authentication
- File uploads are validated for type and size
- LaTeX compilation runs in isolated environments
- Sensitive configuration is stored in environment variables
- Firebase security rules should be configured for production

## Performance Optimization

- LaTeX compilation uses temporary directories
- File uploads are streamed to avoid memory issues
- AI processing is asynchronous
- PDF storage uses Google Cloud Storage for scalability

## Troubleshooting

### Common Issues

1. **LaTeX compilation fails**
   - Ensure pdflatex is installed
   - Check LaTeX syntax in the document
   - Verify LaTeX packages are available

2. **Firebase connection issues**
   - Verify firebase-key.json is in the correct location
   - Check Firebase project configuration
   - Ensure Firestore is enabled

3. **Google Cloud authentication**
   - Run `gcloud auth application-default login`
   - Verify service account permissions
   - Check API enablement

4. **File upload errors**
   - Verify file size limits
   - Check file format (.docx only)
   - Ensure proper authentication

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the repository or contact the development team.
