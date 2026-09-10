# 🔐 Prerequisites & Microsoft Entra ID Configuration Guide

This guide details how to register your application in **Microsoft Entra ID (formerly Azure AD)**, configure Microsoft Graph API permissions, and establish zero-copy data governance.

---

## 1. Microsoft Entra ID App Registration

If deploying in **Live Mode**, register an application in the Microsoft Entra Admin Center:

1. Sign in to the [Microsoft Entra Admin Center](https://entra.microsoft.com) with Application Administrator or Global Administrator privileges.
2. Navigate to **Identity** $\rightarrow$ **Applications** $\rightarrow$ **App registrations** $\rightarrow$ click **New registration**.
3. Fill out the application profile:
   - **Name**: `Gemini-Enterprise-SharePoint-MCP`
   - **Supported account types**: Accounts in this organizational directory only (Single tenant).
   - **Redirect URI (Web)**:
     ```
     https://vertexaisearch.cloud.google.com/oauth-redirect
     ```
4. Click **Register**.
5. Note down the following values from the **Overview** page:
   - **Application (client) ID**
   - **Directory (tenant) ID**

---

## 2. Generate Application Client Secret

1. In your app registration, navigate to **Manage** $\rightarrow$ **Certificates & secrets** $\rightarrow$ **Client secrets**.
2. Click **New client secret**:
   - **Description**: `Gemini-Enterprise-MCP-TokenExchange`
   - **Expires**: 180 days, 365 days, or custom corporate standard.
3. Click **Add**.
4. **Immediately copy the Value** (not the Secret ID). This value is only displayed once and will be stored in Google Cloud Secret Manager.

---

## 3. Microsoft Graph API Permissions: Scoped Governance

To counter enterprise CISO objections regarding excessive tenant-wide privileges, you have two configuration options:

### Option A: Least-Privilege Scoped Governance (`Sites.Selected`) [RECOMMENDED]
Instead of granting tenant-wide read/write permissions, use `Sites.Selected` to restrict the integration strictly to designated SharePoint site collections:

1. Under **API permissions** $\rightarrow$ **Add a permission** $\rightarrow$ select **Microsoft Graph**.
2. Select **Application permissions**.
3. Check **`Sites.Selected`** and **`InformationProtectionPolicy.Read.All`** (for Purview sensitivity labels).
4. Click **Grant admin consent for [Organization]**.
5. Your SharePoint Administrator runs a one-time PowerShell or Graph call to bind access specifically to authorized departmental sites:
   ```http
   POST https://graph.microsoft.com/v1.0/sites/{target-site-id}/permissions
   Authorization: Bearer <AdminToken>
   Content-Type: application/json

   {
     "roles": ["read", "write"],
     "grantedToIdentities": [{
       "application": {
         "id": "<YOUR_CLIENT_ID>",
         "displayName": "Gemini-Enterprise-SharePoint-MCP"
       }
     }]
   }
   ```
*Result: Microsoft Graph enforces this whitelist natively. Attempts to access HR or Executive sites return `403 Forbidden`.*

### Option B: Delegated User Permissions (Interactive PKCE)
1. Select **Delegated permissions**.
2. Add:
   - `Files.ReadWrite.All`
   - `Sites.ReadWrite.All`
   - `offline_access` (Mandatory: enables refresh token issuance for long-lived sessions).
3. Click **Grant admin consent for [Organization]**.

---

## 4. Microsoft Purview & Information Protection Labels

To leverage automated sensitivity guardrails:
* **Licensing**: Requires Microsoft 365 E5, Office 365 E5, or Microsoft 365 Compliance add-on.
* **Sensitivity Labels**: Configured in [Microsoft Purview Compliance Portal](https://purview.microsoft.com) under **Information Protection**.
* **Behavior**:
  - Documents labeled with blocked tags (e.g. `Confidential`, `Restricted`) or encrypted via Azure Rights Management (RMS) are intercepted by OmniShare-MCP before buffer download.
  - A structured compliance message informs Gemini Enterprise why extraction was withheld, preventing parser errors.

---

## 5. Google Cloud IAM & Discovery Engine Permissions

To support private zero-trust Cloud Run invocations:

1. Note your Google Cloud Project Number:
   ```bash
   PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
   ```
2. The Gemini Enterprise Discovery Engine Service Agent requires invoker access to Cloud Run:
   ```
   service-${PROJECT_NUMBER}@gcp-sa-discoveryengine.iam.gserviceaccount.com
   ```
3. This binding is applied automatically by `./deploy_gcp_environment.sh`:
   ```bash
   gcloud run services add-iam-policy-binding sharepoint-mcp-server \
       --region us-central1 \
       --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-discoveryengine.iam.gserviceaccount.com" \
       --role="roles/run.invoker"
   ```
