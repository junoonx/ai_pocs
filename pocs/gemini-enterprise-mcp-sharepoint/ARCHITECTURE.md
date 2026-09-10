# 🏛️ Technical Architecture & Zero-Copy Specification: OmniShare-MCP

This document provides the architectural blueprint, security boundaries, and data lifecycles for integrating Microsoft 365 with Google Cloud's Gemini Enterprise Agent Platform (GEAP).

---

## 1. End-to-End System Architecture

```mermaid
flowchart TD
    subgraph ClientTier ["1. User & Consumer Tier"]
        User["Enterprise Employee / User"]
        GE_App["Gemini Enterprise App<br/>• Unified Conversational UX<br/>• Grounding & Source Citations"]
        GE_Agent["GEAP / Reasoning Engine<br/>• Function Calling Orchestrator<br/>• Tool Execution Planner"]
        User -->|Natural Language Prompt| GE_App
        GE_App -->|Query & Context| GE_Agent
    end

    subgraph GCPPlatform ["2. Google Cloud Integration Tier"]
        GE_Connector["Custom MCP Server Data Connector<br/>• Discovery Engine Action Gateway<br/>• 13 Enabled Custom Actions"]
        GE_Agent -->|tools/call RPC| GE_Connector

        subgraph CloudRunService ["Cloud Run Private MCP Middleware (us-central1)"]
            CR_Auth["Cloud Run IAM Verifier<br/>• roles/run.invoker<br/>• Discovery Engine Service Agent"]
            CR_MCP["sharepoint-mcp-server<br/>• Node.js 20 / AsyncLocalStorage<br/>• Streamable HTTP JSON-RPC 2.0<br/>• 15-min In-Memory LRU Cache"]
            CR_Auth --> CR_MCP
        end
        GE_Connector -->|POST /mcp (X-Serverless-Authorization)| CR_Auth

        subgraph InRAMProcessing ["Ephemeral In-Memory RAM Pipeline (Zero Copy)"]
            Doc_Parser["Multi-Format Parser<br/>• mammoth (DOCX)<br/>• officeparser (PPTX/XLSX)<br/>• pdf-parse (PDF)"]
            DLP_Engine["Cloud Sensitive Data Protection<br/>• Inline PII / PCI De-identification<br/>• [REDACTED_CREDIT_CARD]"]
            Purview_Check["Purview Guardrail<br/>• Intercepts RMS Encryption<br/>• Blocks Restricted Labels"]
            CR_MCP --> Purview_Check
            Purview_Check --> Doc_Parser
            Doc_Parser --> DLP_Engine
        end
    end

    subgraph AuthTier ["3. Enterprise Identity & Token Governance"]
        GoogleIdP["Google Identity Provider<br/>(End-User Authentication)"]
        EntraID["Microsoft Entra ID (Azure AD)<br/>• OAuth 2.0 PKCE Code Grant<br/>• Scoped: Sites.Selected or Delegated"]
        GE_App -->|User Auth| GoogleIdP
        GE_Connector -->|OAuth 2.0 Code + PKCE| EntraID
        CR_MCP -->|Bearer Token Exchange| EntraID
    end

    subgraph MicrosoftCloud ["4. Microsoft 365 Enterprise Compliance Boundary"]
        MS_Graph["Microsoft Graph REST API v1.0<br/>• /v1.0/search/query<br/>• 429 Retry-After Interceptor"]
        CR_MCP -->|Outbound HTTPS (TLS 1.3)| MS_Graph

        subgraph SharePointDrives ["SharePoint Online & OneDrive (Data Stays at Rest Here)"]
            SP_Mktg["Marketing Site Collections"]
            SP_Ops["Operations Engineering Site Collections"]
            SP_Fin["Finance & Ledger Site Collections"]
            SP_OneDrive["Personal OneDrive Repositories"]
            Purview["Microsoft Purview<br/>• Sensitivity Labels & RMS Encryption"]
        end
        MS_Graph --> SP_Mktg
        MS_Graph --> SP_Ops
        MS_Graph --> SP_Fin
        MS_Graph --> SP_OneDrive
        MS_Graph --> Purview
    end

    classDef gcp fill:#e8f0fe,stroke:#4285f4,stroke-width:2px,color:#174ea6;
    classDef msft fill:#e6f4ea,stroke:#137333,stroke-width:2px,color:#0d652d;
    classDef auth fill:#fef7e0,stroke:#f9ab00,stroke-width:2px,color:#b06000;
    classDef client fill:#fce8e6,stroke:#d93025,stroke-width:2px,color:#a50e0e;

    class GE_App,GE_Agent,GE_Connector,CR_Auth,CR_MCP,Doc_Parser,DLP_Engine,Purview_Check gcp;
    class MS_Graph,SP_Mktg,SP_Ops,SP_Fin,SP_OneDrive,Purview msft;
    class GoogleIdP,EntraID auth;
    class User client;
```

---

## 2. The Strict Zero-Copy Guarantees

Unlike traditional enterprise search architectures that copy documents into intermediate object storage or sync external data into shadow vector indexes, OmniShare-MCP operates under **four formal zero-copy guarantees**:

1. **Zero Google Cloud Storage (GCS) Footprint**:
   - The architecture provisions **0 Cloud Storage buckets**, **0 BigQuery datasets**, and **0 persistent disks**.
   - No customer files or temporary blobs are ever written to disk.

2. **Volatile In-Memory Lifecycle**:
   - Documents are retrieved ephemerally into volatile Node.js `Buffer` objects in Cloud Run RAM.
   - Text is parsed, PII is masked synchronously, the JSON-RPC response is transmitted to Gemini Enterprise, and the memory buffer is immediately dereferenced for V8 garbage collection.

3. **No Shadow Vector Duplication**:
   - Full-text keyword and semantic discovery is delegated directly to Microsoft Graph Search (`/v1.0/search/query`).
   - Microsoft retains the index and document data at rest within your existing M365 tenant boundary.

4. **Enterprise Privacy & Data Protection**:
   - Under Google Cloud's Enterprise Agreement for Gemini Enterprise, customer prompts, retrieved context, and completions are strictly isolated and never logged for foundation model training.

---

## 3. Concurrency Safety: AsyncLocalStorage & Stateless Transport Factory

To avoid token collisions across concurrent users while maintaining high throughput and conforming strictly to the `@modelcontextprotocol/sdk` specification:

* The server implements the **Stateless Transport Factory Pattern** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`), provisioning a dedicated transport and server instance per request to guarantee zero message ID collisions.
* When incoming HTTP requests hit `/mcp`, the handler wraps execution inside Node.js `AsyncLocalStorage`:

```javascript
export const requestContext = new AsyncLocalStorage();

// Inside HTTP request listener:
await requestContext.run({ authHeader: req.headers.authorization }, async () => {
    const sessionServer = createMcpServer();
    const sessionTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });
    await sessionServer.connect(sessionTransport);
    await sessionTransport.handleRequest(req, res);
    res.on("close", () => {
        sessionTransport.close().catch(() => {});
        sessionServer.close().catch(() => {});
    });
});
```

When a tool executes via `serverInstance.setRequestHandler(CallToolRequestSchema)`, `requestContext.getStore()` retrieves the exact delegated user token for that specific asynchronous execution chain without any shared global state.

---

## 4. Microsoft Purview & Azure RMS Encryption Defense

Microsoft Purview allows enterprises to apply sensitivity labels (e.g., "General", "Confidential", "Highly Confidential"). When labels apply Azure Rights Management (RMS) encryption:
* Binary content downloaded via `/content` is wrapped in an encrypted RMS envelope.
* Attempting to parse this binary buffer causes parsers to crash or emit raw ciphertext.

**Pre-Flight Inspection Flow**:
1. Tool executes `GET /drives/{driveId}/items/{itemId}?$select=id,name,sensitivityLabel,file`.
2. The server compares `sensitivityLabel.displayName` against `PURVIEW_BLOCKED_LABELS` and checks for `.pfile` or RMS indicators.
3. If classified as restricted, the server intercepts execution **before downloading the binary buffer** and returns a structured compliance response:
   ```json
   {
     "status": "BlockedByGovernance",
     "message": "[PURVIEW BLOCKED] Document is classified under Microsoft Purview as 'Highly Confidential'. Extraction blocked by enterprise governance policy."
   }
   ```
4. If permitted, the buffer is downloaded into memory, parsed, and scrubbed.

---

## 5. Dual-Mode Architecture: Live Graph vs. Standalone Mock

To prevent customer POCs from stalling while awaiting 3–6 week M365 Global Administrator approvals, the server provides a dual-mode engine:

| Operational Mode | Configuration | Target Scenario | Authentication Flow |
| :--- | :--- | :--- | :--- |
| **Live Microsoft Graph** | `MOCK_MODE=false`<br/>Credentials populated in `.env` | Production or pilot deployments with active M365 admin consent. | 3-legged OAuth 2.0 PKCE or `Sites.Selected` app credentials. |
| **Standalone Mock Sandbox** | `MOCK_MODE=true`<br/>or missing M365 credentials | Day 1 architectural validation, developer testing, and sales demonstrations. | Built-in `/auth` and `/token` routes with local JSON fixtures (`mock_data/`). |
