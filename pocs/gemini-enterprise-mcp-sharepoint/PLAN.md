# 🗺️ Implementation Plan & Checkpoint Tracker: OmniShare-MCP
### Reusable Blueprint for Gemini Enterprise & Microsoft 365 Integration

This implementation plan outlines the 4 core deployment milestones for launching, configuring, and verifying the **OmniShare-MCP** integration across any target Google Cloud project and Microsoft 365 environment.

---

## Milestone 1: Environment Configuration & Identity Setup
- [ ] **Checkpoint 1.1**: Register Application in Microsoft Entra ID with redirect URI `https://vertexaisearch.cloud.google.com/oauth-redirect`.
- [ ] **Checkpoint 1.2**: Configure API permissions (`Sites.Selected` or delegated `Files.ReadWrite.All`, `offline_access`) and grant admin consent.
- [ ] **Checkpoint 1.3**: Configure local `.env` from `.env.example` with project ID, region, and Entra ID credentials (or set `MOCK_MODE=true` for standalone testing).
- [ ] **Checkpoint 1.4**: Verify local dependencies and container build (`npm install` or `docker build`).

---

## Milestone 2: Google Cloud Infrastructure & Private Cloud Run Deployment
- [ ] **Checkpoint 2.1**: Enable required Google Cloud APIs (`run.googleapis.com`, `discoveryengine.googleapis.com`, `secretmanager.googleapis.com`).
- [ ] **Checkpoint 2.2**: Execute `./deploy_gcp_environment.sh` to deploy the private Cloud Run service (`--no-allow-unauthenticated`).
- [ ] **Checkpoint 2.3**: Verify that `MS_GRAPH_CLIENT_SECRET` is securely vaulted in Google Cloud Secret Manager.
- [ ] **Checkpoint 2.4**: Bind `roles/run.invoker` to the Discovery Engine Service Agent (`service-${PROJECT_NUM}@gcp-sa-discoveryengine.iam.gserviceaccount.com`).
- [ ] **Checkpoint 2.5**: Perform handshake test against `/mcp` using `tools/list` to verify all 13 tools are registered.

---

## Milestone 3: Gemini Enterprise Connector & App Integration
- [ ] **Checkpoint 3.1**: Open Gemini Enterprise Console directly: `https://console.cloud.google.com/gemini-enterprise/data-stores/create?project=YOUR_PROJECT_ID`.
- [ ] **Checkpoint 3.2**: Register **Custom MCP Server** with Cloud Run `/mcp` URL and configure OAuth 2.0 parameters.
- [ ] **Checkpoint 3.3**: Perform OAuth login and verify connector status transitions to **Active**.
- [ ] **Checkpoint 3.4**: Open the **Actions** tab, click **Reload custom actions**, and enable all 13 tools.
- [ ] **Checkpoint 3.5**: Connect data store to Gemini Enterprise App (`gemini-enterprise-app`).

---

## Milestone 4: End-to-End Verification & Statistical Autorater Evals
- [ ] **Checkpoint 4.1**: Execute live conversational query in Gemini Enterprise webapp (*"Search SharePoint sites related to Cymbal Operations"*).
- [ ] **Checkpoint 4.2**: Verify that Gemini Enterprise invokes `Query Sharepoint Sites Lookup` and returns live grounded metadata.
- [ ] **Checkpoint 4.3**: Test multi-format document text extraction (`sharepoint_read_file`) and confirm inline DLP masking.
- [ ] **Checkpoint 4.4**: Test dynamic prompt recommendations (`sharepoint_get_suggested_prompts`) across Executive, Compliance, and Engineering persona lenses.
- [ ] **Checkpoint 4.5**: Execute the statistical autorater evaluation suite (`python3 evals/autorater.py`).
- [ ] **Checkpoint 4.6**: Run `python3 evals/evaluate_reliability.py` to confirm the quality gate passes ($\text{Mean} \ge 4.0$, $\text{Variance} > 0.10$, Krippendorff's $\alpha \ge 0.80$).
