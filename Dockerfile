# Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Main application
FROM python:3.11-slim

# Install system dependencies including full LaTeX
RUN apt-get update && apt-get install -y --no-install-recommends \
    # LaTeX packages
    texlive-full \
    texlive-xetex \
    texlive-luatex \
    texlive-bibtex-extra \
    biber \
    latexmk \
    # Fonts
    texlive-fonts-extra \
    fonts-liberation \
    fonts-dejavu \
    # Utilities
    curl \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY config.py .
COPY main.py .
COPY cli.py .
COPY api/ ./api/
COPY templates/ ./templates/

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./static/dist

# Create directories
RUN mkdir -p static/dist tmp

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the application
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
