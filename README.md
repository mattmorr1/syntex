# UEA - AI LaTeX Editor

AI-powered LaTeX document editor with Gemini integration, similar to Overleaf but with intelligent AI assistance.

## Features

- **AI Document Conversion**: Upload DOCX files and convert to LaTeX using Gemini AI
- **Smart Autocomplete**: Ghost text suggestions with Tab to accept (powered by Gemini 2.0 Flash)
- **AI Agent**: Cursor-like AI assistant for document editing with diff preview
- **Full LaTeX Support**: Compile with pdflatex, xelatex, or lualatex with bibtex/biber
- **Material 3 UI**: Modern React frontend with dark/light theme toggle
- **Preset Templates**: Journal, Problem Set, Thesis, Report, Letter templates
- **Admin Dashboard**: User management and token usage tracking

## Tech Stack

- **Frontend**: React 18, MUI v6 (Material 3), Monaco Editor, Zustand
- **Backend**: FastAPI, Firebase Auth, Firestore
- **AI**: Gemini 2.0 Flash (autocomplete), Gemini 1.5 Pro (document generation)
- **LaTeX**: TeX Live (full), XeLaTeX, Biber

## Quick Start

### Development

1. Clone the repository
2. Copy `env.example` to `.env` and configure:
   ```
   GEMINI_API_KEY=your-api-key
   ```
3. Run with Docker Compose:
   ```bash
   docker-compose -f docker-compose.dev.yml up
   ```
4. Access:
   - Frontend: http://localhost:3000
   - API: http://localhost:8000

### Production

```bash
docker-compose up -d
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `FIREBASE_KEY_PATH` | Path to Firebase service account JSON | `firebase-key.json` |
| `ADMIN_EMAIL` | Admin user email | `mmorristwo@gmail.com` |
| `ADMIN_USERNAME` | Admin username | `matt` |
| `ADMIN_PASSWORD` | Admin password | Required for production |
| `LATEX_COMPILER` | Default LaTeX compiler | `pdflatex` |
| `LATEX_TIMEOUT` | Compilation timeout (seconds) | `60` |

## Project Structure

```
/UEA-app
├── /frontend          # React frontend
│   ├── /src
│   │   ├── /components
│   │   │   ├── /editor    # Monaco editor + PDF viewer
│   │   │   ├── /ai        # AI agent panel
│   │   │   ├── /auth      # Login, register, reset
│   │   │   └── /admin     # Admin dashboard
│   │   ├── /hooks
│   │   ├── /services
│   │   ├── /store         # Zustand state
│   │   └── /themes
├── /api               # FastAPI backend
│   ├── /routers
│   │   ├── auth.py
│   │   ├── projects.py
│   │   ├── compile.py
│   │   ├── ai.py
│   │   └── admin.py
│   ├── /services
│   │   ├── gemini.py
│   │   ├── firestore.py
│   │   └── latex.py
│   └── /models
├── /templates         # LaTeX preset templates
├── Dockerfile
└── docker-compose.yml
```

## API Endpoints

### Authentication
- `POST /auth/login` - User login
- `POST /auth/register` - User registration
- `POST /auth/reset-password` - Password reset

### Projects
- `GET /projects` - List user projects
- `POST /projects` - Create new project
- `POST /upload` - Upload DOCX and convert to LaTeX

### AI
- `POST /ai/autocomplete` - Get autocomplete suggestion
- `POST /ai/chat` - Chat with AI about document
- `POST /ai/agent-edit` - Get AI-suggested edits with diff

### Admin
- `GET /admin/users` - List all users
- `GET /admin/stats` - System statistics

## Firestore Schema

### Users Collection
```javascript
{
  uid: string,
  email: string,
  username: string,
  role: "user" | "admin",
  tokens_used: { total: number, flash: number, pro: number },
  created_at: timestamp,
  last_accessed: timestamp
}
```

### Projects Collection
```javascript
{
  user_id: string,
  name: string,
  files: [{ name, content, type }],
  main_file: string,
  theme: string,
  created_at: timestamp,
  updated_at: timestamp
}
```

## License

MIT
