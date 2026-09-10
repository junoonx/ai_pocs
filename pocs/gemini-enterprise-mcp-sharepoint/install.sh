#!/bin/bash
# ==============================================================================
# OmniShare-MCP – Interactive Pre-Flight Setup Wizard & Deployer
# Prompts for all prerequisites upfront and guides automated deployment
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=============================================================================="
echo "⚡ OmniShare-MCP: Gemini Enterprise SharePoint Integration Setup"
echo "Zero-Copy Model Context Protocol (MCP) Middleware"
echo "=============================================================================="
echo ""

# 1. Verify Google Cloud SDK
if ! command -v gcloud >/dev/null 2>&1; then
    echo "❌ Error: Google Cloud SDK ('gcloud') is not installed or not in PATH."
    echo "Install gcloud from https://cloud.google.com/sdk/docs/install and retry."
    exit 1
fi

CURRENT_GCP_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
echo "📋 Step 1: Target Google Cloud Environment"
read -p "Enter Google Cloud Project ID [${CURRENT_GCP_PROJECT}]: " TARGET_PROJECT
TARGET_PROJECT="${TARGET_PROJECT:-$CURRENT_GCP_PROJECT}"

if [ -z "$TARGET_PROJECT" ]; then
    echo "❌ Error: Google Cloud Project ID is required."
    exit 1
fi

read -p "Enter Target Region [us-central1]: " TARGET_REGION
TARGET_REGION="${TARGET_REGION:-us-central1}"

# 2. Select Operational Mode
echo ""
echo "📋 Step 2: Select Deployment Mode"
echo "  [1] Live Microsoft 365 (Requires Entra ID App & Admin Consent)"
echo "  [2] Standalone Mock Sandbox (Zero credentials, instant Day 1 trial)"
read -p "Select mode [1/2, default: 2]: " MODE_SELECTION
MODE_SELECTION="${MODE_SELECTION:-2}"

if [ "$MODE_SELECTION" = "1" ]; then
    echo ""
    echo "🔐 Step 3: Microsoft Entra ID & SharePoint Prerequisites"
    echo "Refer to PREREQUISITES.md for app registration instructions."
    echo ""

    read -p "Enter Directory (Tenant) ID: " TENANT_ID
    read -p "Enter Application (Client) ID: " CLIENT_ID
    read -s -p "Enter Application Client Secret: " CLIENT_SECRET
    echo ""
    read -p "Enter SharePoint Instance Root [https://company.sharepoint.com]: " SP_URL
    SP_URL="${SP_URL:-https://company.sharepoint.com}"

    if [ -z "$TENANT_ID" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
        echo "❌ Error: All Entra ID credential fields are required for Live Mode."
        exit 1
    fi

    # Write .env
    cat << ENV_FILE > .env
GCP_PROJECT_ID=${TARGET_PROJECT}
GCP_REGION=${TARGET_REGION}
MOCK_MODE=false
ENABLE_DLP=false
MS_GRAPH_TENANT_ID=${TENANT_ID}
MS_GRAPH_CLIENT_ID=${CLIENT_ID}
MS_GRAPH_CLIENT_SECRET=${CLIENT_SECRET}
SHAREPOINT_INSTANCE_URL=${SP_URL}
READ_ONLY_MODE=false
PURVIEW_BLOCKED_LABELS=Restricted,Do Not Export,Highly Confidential
MAX_EXTRACTED_CHARS=50000
PORT=3000
ENV_FILE
    echo "✅ Configuration saved to .env (Live Mode enabled)."
else
    # Mock Mode Setup
    cat << ENV_FILE > .env
GCP_PROJECT_ID=${TARGET_PROJECT}
GCP_REGION=${TARGET_REGION}
MOCK_MODE=true
ENABLE_DLP=false
READ_ONLY_MODE=false
PURVIEW_BLOCKED_LABELS=Restricted,Do Not Export,Highly Confidential
MAX_EXTRACTED_CHARS=50000
PORT=3000
ENV_FILE
    echo "✅ Configuration saved to .env (Standalone Mock Sandbox enabled)."
fi

# 3. Prompt for Automated Deployment
echo ""
echo "🚀 Step 4: Google Cloud Run Deployment"
read -p "Deploy private Cloud Run service now to project '${TARGET_PROJECT}'? [Y/n]: " DEPLOY_NOW
DEPLOY_NOW="${DEPLOY_NOW:-Y}"

case "$DEPLOY_NOW" in
    [yY][eE][sS]|[yY])
        echo ""
        if [ "$MODE_SELECTION" = "2" ]; then
            ./deploy_gcp_environment.sh --project "$TARGET_PROJECT" --region "$TARGET_REGION" --mock
        else
            ./deploy_gcp_environment.sh --project "$TARGET_PROJECT" --region "$TARGET_REGION"
        fi
        ;;
    *)
        echo "ℹ️  Skipping immediate deployment."
        echo "You can deploy anytime using: ./deploy_gcp_environment.sh --project ${TARGET_PROJECT}"
        ;;
esac

echo ""
echo "=============================================================================="
echo "🎉 Setup Wizard Complete!"
echo "=============================================================================="
echo "Next Steps & Documentation Links:"
echo "1. Quickstart Guide     : file://${SCRIPT_DIR}/INSTALL.md"
echo "2. Architecture Blueprint: file://${SCRIPT_DIR}/ARCHITECTURE.md"
echo "3. Gemini Enterprise UI : https://console.cloud.google.com/gemini-enterprise/data-stores/create?project=${TARGET_PROJECT}"
echo "=============================================================================="
