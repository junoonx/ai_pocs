#!/bin/bash
# ==============================================================================
# Deploy OmniShare-MCP to Google Cloud Run (Private & Enterprise-Hardened)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="${SCRIPT_DIR}/mcp-server"

# Default configuration (override via env or flags)
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo "")}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="sharepoint-mcp-server"
DEPLOY_MOCK="${MOCK_MODE:-false}"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -p, --project PROJECT_ID   Target Google Cloud Project ID (default: current gcloud project)"
    echo "  -r, --region REGION        Target GCP region (default: us-central1)"
    echo "  -m, --mock                 Deploy in standalone Mock Sandbox mode (zero M365 dependency)"
    echo "  -h, --help                 Show this help message"
    echo ""
    exit 1
}

# Parse flags
while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--project) PROJECT_ID="$2"; shift 2 ;;
        -r|--region) REGION="$2"; shift 2 ;;
        -m|--mock) DEPLOY_MOCK="true"; shift ;;
        -h|--help) usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

if [ -z "$PROJECT_ID" ]; then
    echo "❌ Error: Google Cloud Project ID must be specified via -p <PROJECT_ID> or GCP_PROJECT_ID."
    exit 1
fi

echo "=============================================================================="
echo "🚀 Deploying Enterprise SharePoint MCP Server"
echo "Target Project : $PROJECT_ID"
echo "Target Region  : $REGION"
echo "Mode           : $([ "$DEPLOY_MOCK" = "true" ] && echo "STANDALONE MOCK SANDBOX" || echo "LIVE MICROSOFT GRAPH")"
echo "=============================================================================="

# 1. Ensure gcloud is configured to target project
gcloud config set project "$PROJECT_ID" >/dev/null 2>&1

# 2. Enable Required GCP APIs
echo "🔧 Enabling Google Cloud APIs..."
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    discoveryengine.googleapis.com \
    secretmanager.googleapis.com

# 3. Handle Credentials & Secrets
ENV_ARGS=()
if [ "$DEPLOY_MOCK" = "true" ]; then
    echo "📦 Configuring Standalone Mock Mode..."
    ENV_ARGS+=(--set-env-vars "MOCK_MODE=true,GCP_PROJECT_ID=${PROJECT_ID}")
else
    # Check for .env or local environment variables
    if [ -f "${SCRIPT_DIR}/.env" ]; then
        echo "📋 Loading credentials from .env..."
        export $(grep -v '^#' "${SCRIPT_DIR}/.env" | xargs)
    fi

    TENANT_ID="${MS_GRAPH_TENANT_ID:-}"
    CLIENT_ID="${MS_GRAPH_CLIENT_ID:-}"
    CLIENT_SECRET="${MS_GRAPH_CLIENT_SECRET:-}"

    if [ -z "$TENANT_ID" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
        echo "⚠️  Live M365 credentials not found in environment or .env."
        read -p "Deploy in Standalone Mock Mode instead? [Y/n]: " choice
        case "$choice" in
            [nN]*) echo "Deployment aborted. Provide credentials in .env and retry."; exit 1 ;;
            *) DEPLOY_MOCK="true"; ENV_ARGS+=(--set-env-vars "MOCK_MODE=true,GCP_PROJECT_ID=${PROJECT_ID}") ;;
        esac
    fi

    if [ "$DEPLOY_MOCK" = "false" ]; then
        SECRET_NAME="m365-client-secret"
        echo "🔒 Storing client secret securely in Secret Manager ($SECRET_NAME)..."
        if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
            gcloud secrets create "$SECRET_NAME" --replication-policy="automatic" --project="$PROJECT_ID"
        fi
        echo -n "$CLIENT_SECRET" | gcloud secrets versions add "$SECRET_NAME" --data-file=- --project="$PROJECT_ID"

        ENV_ARGS+=(
            --set-secrets "MS_GRAPH_CLIENT_SECRET=${SECRET_NAME}:latest"
            --set-env-vars "MS_GRAPH_TENANT_ID=${TENANT_ID},MS_GRAPH_CLIENT_ID=${CLIENT_ID},GCP_PROJECT_ID=${PROJECT_ID},MOCK_MODE=false"
        )
    fi
fi

# 4. Build and Deploy Private Cloud Run Service
echo "☁️  Building container and deploying private service to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
    --source "$SERVER_DIR" \
    --region "$REGION" \
    --no-allow-unauthenticated \
    --port 3000 \
    "${ENV_ARGS[@]}"

# 5. Retrieve Service URL & Project Number
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DISCOVERY_ENGINE_SA="service-${PROJECT_NUMBER}@gcp-sa-discoveryengine.iam.gserviceaccount.com"

# 6. Grant Invoker Permission to Discovery Engine Service Agent
echo "🛡️  Authorizing Gemini Enterprise (Discovery Engine Service Agent) to invoke Cloud Run..."
gcloud run services add-iam-policy-binding "$SERVICE_NAME" \
    --region "$REGION" \
    --member="serviceAccount:${DISCOVERY_ENGINE_SA}" \
    --role="roles/run.invoker" >/dev/null 2>&1 || echo "Note: If Discovery Engine SA is not yet initialized, bind roles/run.invoker after activating Gemini Enterprise."

echo "=============================================================================="
echo "✅ Cloud Run Service deployed successfully!"
echo "🔗 Service URL : ${SERVICE_URL}"
echo "🌐 MCP Endpoint: ${SERVICE_URL}/mcp"
echo ""
echo "Next step: Register this MCP endpoint in Gemini Enterprise Console:"
echo "👉 https://console.cloud.google.com/gemini-enterprise/data-stores/create?project=${PROJECT_ID}"
echo "=============================================================================="
