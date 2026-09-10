# 🌐 OmniShare-MCP: Enterprise Model Context Protocol for Gemini Enterprise & Microsoft 365
### High-Performance, Zero-Copy Integration for SharePoint Online, OneDrive, and Microsoft Purview

OmniShare-MCP bridges Google Cloud's **Gemini Enterprise Agent Platform (GEAP)** directly to your enterprise **Microsoft 365** estate using the open [Model Context Protocol (MCP)](https://modelcontextprotocol.io/).

Enterprise employees can query, synthesize, and act upon corporate documents stored across SharePoint and OneDrive directly through Gemini Enterprise—**without copying, duplicating, or indexing files in Google Cloud**.

---

## ⚡ Key Capabilities & Architectural Highlights

1. **Strict Zero Copy Architecture**:
   - Files remain at rest in Microsoft 365.
   - Cloud Run fetches documents ephemerally over HTTPS into volatile memory (RAM), converts them to text, masks PII, and immediately discards the buffers.
   - Zero Google Cloud Storage (GCS) buckets, zero vector databases, and zero data caches.

2. **Microsoft Purview & Sensitivity Label Guardrails**:
   - Pre-flight checks inspect Microsoft Purview `sensitivityLabel` before binary buffers are retrieved.
   - Azure Rights Management (RMS) encrypted files or restricted documents are intercepted with structured enterprise governance notices, preventing parser crashes.

3. **In-Memory Cloud Sensitive Data Protection (DLP)**:
   - Synchronous inline PII and PCI de-identification (`CREDIT_CARD_NUMBER`, `US_SOCIAL_SECURITY_NUMBER`, etc.) before returning text context to Gemini.

4. **Private, Enterprise-Hardened Cloud Run Deployment**:
   - Zero-trust security: Deployed with `--no-allow-unauthenticated`.
   - Authorized invoker access granted strictly to the Discovery Engine Service Agent (`service-<PROJECT_NUM>@gcp-sa-discoveryengine.iam.gserviceaccount.com`).

5. **Dual-Mode Engine (Live Graph & Standalone Mock)**:
   - **Production Mode**: Connects directly to Microsoft Graph API with delegated OAuth 2.0 PKCE or scoped `Sites.Selected` app permissions.
   - **Standalone Mock Mode (`MOCK_MODE=true`)**: Runs an offline fixture sandbox (Marketing, Operations, Finance drives) enabling instant trials on Day 1 without waiting weeks for M365 tenant administrator consent.

6. **Statistical Autorater Evaluation Suite**:
   - Implements multi-pass ($k=3$) LLM-as-a-Judge benchmarking across Grounding Faithfulness, Cross-Silo Completeness, and Security SDP Compliance.
   - Includes automated Krippendorff's Alpha ($\alpha$) and homogeneity trap validation inspired by the *Hillclimbing with Autoraters* methodology.

---

## 📂 Repository Structure

```
gemini-enterprise-mcp-sharepoint/
├── README.md                      # Executive overview and quickstart (this file)
├── ARCHITECTURE.md                # System diagrams, protocol flows, and zero-copy guarantees
├── INSTALL.md                     # Step-by-step deployment guide for any GCP project
├── PREREQUISITES.md               # Microsoft Entra ID registration guide & Graph permissions
├── PLAN.md                        # 4-milestone implementation checklist
├── USE_CASES_AND_EVALS.md         # Enterprise business scenarios & autorater methodology
├── .env.example                   # Clean configuration template
├── deploy_gcp_environment.sh      # Automated Cloud Run deployment script
├── mcp-server/                    # Node.js MCP server
│   ├── package.json               # MCP SDK, Cloud DLP, Mammoth, OfficeParser
│   ├── Dockerfile                 # Multi-stage container definition
│   ├── index.js                   # Concurrency-safe MCP server with AsyncLocalStorage
│   └── mock_data/                 # Fixtures for MOCK_MODE=true sandbox
│       ├── sites.json
│       └── files.json
└── evals/                         # Hillclimbing evaluation harness
    ├── rubrics.json               # Likert scoring rubrics
    ├── evalset.json               # Golden query benchmarks
    ├── autorater.py               # Multi-pass LLM-as-a-Judge benchmark script
    └── evaluate_reliability.py    # Krippendorff's Alpha validator
```

---

## 🚀 Quickstart: Deploy in 5 Minutes

### Step 1: Clone and Configure Environment

```bash
# 1. Copy configuration template
cp .env.example .env

# 2. Configure target Google Cloud project
# If you don't have M365 credentials yet, set MOCK_MODE=true for standalone sandbox mode
nano .env
```

### Step 2: Deploy Cloud Run Middleware

```bash
# Deploys private Cloud Run service and binds Discovery Engine invoker IAM
./deploy_gcp_environment.sh --project YOUR_PROJECT_ID --region us-central1
```

### Step 3: Register Custom MCP Connector in Gemini Enterprise

1. Open the Google Cloud Console directly to Data Store creation:
   `https://console.cloud.google.com/gemini-enterprise/data-stores/create?project=YOUR_PROJECT_ID`
2. Select **Custom MCP Server**.
3. Set **Data store name** to `Cymbal Universal Data Connector`.
4. Enter your Cloud Run endpoint (must include `/mcp`):
   `https://sharepoint-mcp-server-XXXXXXXXXXXX.us-central1.run.app/mcp`
5. Configure OAuth 2.0 per [PREREQUISITES.md](./PREREQUISITES.md).
6. Enable all 12 custom actions and connect the data store to your Gemini Enterprise App!

---

## 🛠️ The 12 Granular Tools

| Tool Name | Operation Category | Description |
| :--- | :--- | :--- |
| `sharepoint_search_files` | Discovery | Searches across SharePoint and OneDrive for documents matching query keywords. |
| `sharepoint_list_sites` | Discovery | Lists accessible corporate SharePoint sites across departments. |
| `sharepoint_list_libraries` | Navigation | Retrieves document libraries and drives within a specific SharePoint site. |
| `sharepoint_list_items` | Navigation | Lists directory folders, files, and sub-hierarchies within a library. |
| `sharepoint_get_file_metadata` | Inspection | Returns file size, last modified timestamp, and Purview sensitivity labels. |
| `sharepoint_read_file` | Read / Extract | Streams clean text from Word, PowerPoint, Excel, and PDF with DLP masking. |
| `sharepoint_download_url` | Read / Binary | Generates direct pre-authenticated download links for files. |
| `sharepoint_upload_file` | Mutation | Writes new analytical deliverables or summaries directly into SharePoint drives. |
| `sharepoint_create_folder` | Mutation | Scaffolds directory folders inside document libraries. |
| `sharepoint_update_file` | Mutation | Modifies or appends findings to existing documents. |
| `sharepoint_rename_item` | Mutation | Standardizes document naming conventions. |
| `sharepoint_delete_item` | Mutation | Deletes deprecated documents under enterprise approval workflows. |

---

## 📚 Detailed Documentation

* [ARCHITECTURE.md](./ARCHITECTURE.md): Multi-cloud architecture, concurrency isolation, and zero-copy guarantees.
* [INSTALL.md](./INSTALL.md): Complete setup walkthrough for Cloud Run and Gemini Enterprise.
* [PREREQUISITES.md](./PREREQUISITES.md): Microsoft Entra ID registration, `Sites.Selected` app governance, and GCP IAM.
* [PLAN.md](./PLAN.md): Implementation checkpoints and milestone tracker.
* [USE_CASES_AND_EVALS.md](./USE_CASES_AND_EVALS.md): Customer demonstration workflows, autorater scoring, and Krippendorff's Alpha analysis.
