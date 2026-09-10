# OmniShare-MCP – PoC-Specific Contributor & AI Agent Guide

This document defines implementation rules, architectural invariants, and security constraints specific to the **OmniShare-MCP** integration connecting Google Cloud Gemini Enterprise with Microsoft 365 (SharePoint Online, OneDrive, Microsoft Purview).

---

## 1. Concurrency & Lifecycle Invariants

### AsyncLocalStorage Request Isolation
- **Singleton Server Pattern**: Never re-instantiate `@modelcontextprotocol/sdk` `Server` or `StreamableHTTPServerTransport` inside HTTP request callbacks.
- **Thread/Context Safety**: The HTTP listener must execute all transport logic inside `requestContext.run({ authHeader: req.headers.authorization }, ...)` using Node.js `node:async_hooks`.
- **Zero Global State Collisions**: Tool handlers (`CallToolRequestSchema`) must extract delegated tokens strictly from `requestContext.getStore()`. Never store authorization headers in global variables.

---

## 2. Microsoft Graph Resilience & API Invariants

### 1. 429 Throttling & Exponential Backoff
- All outbound requests to `graph.microsoft.com` must route through Axios interceptors that parse the `Retry-After` header.
- Wait times must be capped at 8–10 seconds to satisfy Gemini Enterprise's 60-second tool execution deadline.

### 2. Search vs. Traversal Optimization
- Never use recursive or sequential site crawling (`/sites` $\rightarrow$ `/drives` $\rightarrow$ `/children`) for keyword queries.
- Keyword queries must route through the indexed Microsoft Graph Search API (`/v1.0/search/query`).
- Cache resolved drive IDs and site metadata in volatile Cloud Run RAM using a 15-minute Time-to-Live (TTL) LRU cache.

---

## 3. Data Governance & Zero-Copy Invariants

### 1. Microsoft Purview & Azure RMS Pre-Flight Checks
- Never attempt to parse binary buffers without checking Purview metadata first.
- Query item properties (`$select=id,name,size,sensitivityLabel,file`) before downloading content.
- If a document is classified with an encrypting sensitivity label or is a `.pfile` RMS envelope, intercept execution immediately and return a structured policy notice (`[PURVIEW POLICY RESTRICTION]`).

### 2. Cloud DLP / Sensitive Data Protection (SDP)
- Text extracted from Word, PowerPoint, Excel, or PDF must pass through synchronous Cloud DLP de-identification before being returned to Gemini Enterprise.
- When `ENABLE_DLP=true`, mask credit card numbers (`CREDIT_CARD_NUMBER`) and social security numbers (`US_SOCIAL_SECURITY_NUMBER`).
- If DLP service is unavailable or in mock mode, apply the local regex de-identification fallback.

---

## 4. Operational Modes: Mock Sandbox vs. Live Graph

- When `MOCK_MODE=true` (or when credentials are omitted), all 12 tools must respond using local JSON fixtures from `mock_data/sites.json` and `mock_data/files.json`.
- The mock provider must simulate Purview blocks and DLP masking so that evaluation and demonstration workflows function identically to production.
- When `READ_ONLY_MODE=true`, all mutating tools (`sharepoint_upload_file`, `sharepoint_create_folder`, `sharepoint_update_file`, `sharepoint_rename_item`, `sharepoint_delete_item`) must be rejected with an operational block notice.
