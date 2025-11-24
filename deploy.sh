#!/bin/bash

# LatexUEA Deployment Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 LatexUEA Deployment Script${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found. Please copy env.example to .env and configure it.${NC}"
    exit 1
fi

# Load environment variables
source .env

# Validate required environment variables
required_vars=("GCP_PROJECT_ID" "GCP_BUCKET_NAME" "FIREBASE_KEY_PATH")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}❌ Required environment variable $var is not set${NC}"
        exit 1
    fi
done

# Check if Firebase key file exists
if [ ! -f "$FIREBASE_KEY_PATH" ]; then
    echo -e "${RED}❌ Firebase key file not found at: $FIREBASE_KEY_PATH${NC}"
    echo -e "${YELLOW}Please download your Firebase service account key and place it at the specified path.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Environment validation passed${NC}"

# Choose deployment method
echo -e "${YELLOW}Choose deployment method:${NC}"
echo "1) Docker Compose (Local/VPS)"
echo "2) Google Cloud Run"
echo "3) Build Docker image only"
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        echo -e "${GREEN}🐳 Deploying with Docker Compose...${NC}"
        
        # Build and start services
        docker-compose -f docker-compose.prod.yml build
        docker-compose -f docker-compose.prod.yml up -d
        
        echo -e "${GREEN}✅ Deployment complete!${NC}"
        echo -e "${YELLOW}Your application is running at: http://localhost${NC}"
        
        # Show logs
        echo -e "${YELLOW}Showing logs (Ctrl+C to exit):${NC}"
        docker-compose -f docker-compose.prod.yml logs -f
        ;;
        
    2)
        echo -e "${GREEN}☁️ Deploying to Google Cloud Run...${NC}"
        
        # Check if gcloud is installed
        if ! command -v gcloud &> /dev/null; then
            echo -e "${RED}❌ gcloud CLI is not installed. Please install it first.${NC}"
            exit 1
        fi
        
        # Build and push to Google Container Registry
        gcloud builds submit --tag gcr.io/$GCP_PROJECT_ID/uea-latex
        
        # Deploy to Cloud Run
        gcloud run deploy uea-latex \
            --image gcr.io/$GCP_PROJECT_ID/uea-latex \
            --platform managed \
            --region $GCP_REGION \
            --allow-unauthenticated \
            --memory 2Gi \
            --cpu 2 \
            --timeout 900 \
            --set-env-vars FIREBASE_KEY_PATH=/app/firebase-key.json,GCP_PROJECT_ID=$GCP_PROJECT_ID,GCP_BUCKET_NAME=$GCP_BUCKET_NAME,GCP_REGION=$GCP_REGION
        
        echo -e "${GREEN}✅ Cloud Run deployment complete!${NC}"
        ;;
        
    3)
        echo -e "${GREEN}🔨 Building Docker image...${NC}"
        docker build -t uea-latex:latest .
        echo -e "${GREEN}✅ Docker image built successfully!${NC}"
        echo -e "${YELLOW}You can now push it to your container registry of choice.${NC}"
        ;;
        
    *)
        echo -e "${RED}❌ Invalid choice${NC}"
        exit 1
        ;;
esac

