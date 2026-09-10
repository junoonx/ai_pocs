# 🛠️ Installation & Setup Manual: OmniShare-MCP
### Deploying to Google Cloud & Connecting to Gemini Enterprise

This manual guides you through deploying the **OmniShare-MCP** middleware to Google Cloud Run and registering the Custom MCP Server inside Gemini Enterprise.

---

## Prerequisites Checklist

Before starting, ensure you have:
1. Google Cloud SDK (`gcloud`) installed and authenticated (`gcloud auth login`).
2. `roles/run.admin`, `roles/iam.serviceAccountUser`, and `roles/secretmanager.admin` on your target GCP project.
3. Access to Gemini Enterprise Console in your project.
4. *(Optional for Live Mode)*: Microsoft Entra ID Application Registration credentials per [PREREQUISITES.md](./PREREQUISITES.md). *(If you don't have these, use Standalone Mock Mode).*

---

## Step 1: Configure Local Environment

Clone the repository and copy the environment template:

```bash
cd pocs/gemini-enterprise-mcp-sharepoint
cp .env.example .env
```

Edit `.env` to configure your target project:

```bash
# Target GCP Project
GCP_PROJECT_ID="your-project-id"
GCP_REGION="us-central1"

# Set to true if you are testing without live M365 credentials
MOCK_MODE=false

# If MOCK_MODE=false, provide your Microsoft Entra ID credentials
MS_GRAPH_TENANT_ID="your-tenant-guid"
MS_GRAPH_CLIENT_ID="your-client-app-guid"
MS_GRAPH_CLIENT_SECRET="your-client-secret"
SHAREPOINT_INSTANCE_URL="https://yourcompany.sharepoint.com"
```

---

## Step 2: Deploy Private Cloud Run Service

Execute the automated deployment script:

```bash
# Deploy with live Microsoft 365 credentials
./deploy_gcp_environment.sh --project YOUR_PROJECT_ID --region us-central1

# OR deploy in standalone Mock Sandbox mode (zero M365 dependency)
./deploy_gcp_environment.sh --project YOUR_PROJECT_ID --region us-central1 --mock
```

The script automatically:
1. Enables necessary Google Cloud APIs (`run`, `discoveryengine`, `cloudbuild`, `secretmanager`).
2. Stores your client secret securely in Google Cloud Secret Manager.
3. Builds and deploys the container with `--no-allow-unauthenticated`.
4. Grants `roles/run.invoker` strictly to the Gemini Enterprise Discovery Engine Service Agent (`service-${PROJECT_NUM}@gcp-sa-discoveryengine.iam.gserviceaccount.com`).
5. Outputs your live MCP Server Endpoint URL:
   ```
   https://sharepoint-mcp-server-XXXXXXXXXXXX.us-central1.run.app/mcp
   ```

---

## Step 3: Validate MCP Handshake & Tools List

Run a test against your Cloud Run service to verify that all 13 tools are registered and responsive:

```bash
LIVE_URL="https://sharepoint-mcp-server-XXXXXXXXXXXX.us-central1.run.app/mcp"

# Test tools/list discovery (authenticate using gcloud identity token)
curl -s -X POST "$LIVE_URL" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}' | jq .
```

*Expected output: JSON-RPC response listing all 13 tools (`sharepoint_search_files`, `sharepoint_read_file`, `sharepoint_get_suggested_prompts`, etc.).*

---

## Step 4: Register Custom MCP Connector in Gemini Enterprise

1. Open the Google Cloud Console directly to Data Store creation:
   ```
   https://console.cloud.google.com/gemini-enterprise/data-stores/create?project=YOUR_PROJECT_ID
   ```
2. Search for **MCP** and select **Custom MCP Server**.
3. Fill out the Data Connector configuration:
   - **Data store name**: `Cymbal Universal Data Connector`
   - **Location**: `global`
   - **MCP Server URL**: `https://sharepoint-mcp-server-XXXXXXXXXXXX.us-central1.run.app/mcp` *(Path `/mcp` is mandatory)*

4. Configure Authentication (**OAuth 2.0**):

   **Option A: Live Microsoft Entra ID**
   - **Authorization URL**: `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/authorize`
   - **Auth URL Parameters**: `&access_type=offline&prompt=consent`
   - **Token URL**: `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token`
   - **Client ID**: Your Entra ID Application (Client) ID
   - **Client Secret**: Your Entra ID Client Secret
   - **Scopes**: `https://graph.microsoft.com/.default`

   **Option B: Standalone Mock Sandbox Mode**
   - **Authorization URL**: `https://sharepoint-mcp-server-XXXXXXXXXXXX.us-central1.run.app/auth`
   - **Auth URL Parameters**: `&access_type=offline`
   - **Token URL**: `https://sharepoint-mcp-server-XXXXXXXXXXXX.us-central1.run.app/token`
   - **Client ID**: `mock_client_id`
   - **Client Secret**: `mock_client_secret`
   - **Scopes**: `mock_scope`

5. Click **Verify Auth / Login**:
   - In the popup window, sign in and accept permissions.
6. Click **Create** to complete connector setup.

---

## Step 5: Enable All 13 Discovered Actions

1. In Gemini Enterprise Console, click on **Cymbal Universal Data Connector**.
2. Wait 30–60 seconds for connector status to display **Active**.
3. Click the **Actions** tab.
4. Click **Reload custom actions** to query `tools/list`.
5. Select **Select all rows** (13 resources selected) and click **Enable actions**.
6. Verify status displays: *"Data connector actions updated successfully."*

---

## Step 6: Link Connector to Gemini Enterprise App

1. In Gemini Enterprise Console, navigate to **Apps** $\rightarrow$ select your app (e.g. `gemini-enterprise-app` or create a new one).
2. Click **Connected data stores**.
3. Click **Connect an existing data store**.
4. Select `Cymbal Universal Data Connector` and click **Connect**.
5. Open your Gemini Enterprise webapp URL (`https://vertexaisearch.cloud.google.com/home/cid/...`).
6. Click the **Sources** icon in the chat bar, authorize the server, and test:
   > *"Search SharePoint sites related to Cymbal Operations."*

*Verify that Gemini invokes `Query Sharepoint Sites Lookup` and returns live grounded results with zero copy!*
