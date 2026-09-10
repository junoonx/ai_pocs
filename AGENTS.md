# Enterprise AI Proof of Concepts (ai_pocs) – Contributor & AI Agent Guide

Welcome to the **`junoonx/ai_pocs`** repository. This repository houses enterprise-grade, zero-copy Proof of Concepts (PoCs) bridging foundational AI technologies (Google Cloud Gemini Enterprise, Vertex AI, Agentic Platforms) with external enterprise SaaS ecosystems (Microsoft 365, SharePoint Online, OneDrive, Purview, Salesforce, Jira, ServiceNow).

---

## Language & Tone

All code, comments, commit messages, docstrings, and architectural specifications must be written in **English**.

---

## Codebase Style & Engineering Standards

Applies across all PoCs in `pocs/` and root orchestration scripts (`setup.sh`).

### 1. Formatting & Code Shape
- **Line Length**: Maximum 120 characters across all languages (Python, JavaScript/TypeScript, Shell, Markdown).
- **Function Focus**: Keep functions tightly focused (< 40–50 lines). Extract logical sub-steps into dedicated, descriptive helpers (e.g. `_resolve_graph_headers()`, `_inspect_purview_label()`, `_redact_pii_dlp()`).
- **Naming by Intent**: Name variables by their semantic meaning, not their container (e.g. `purview_blocked_labels`, not `label_list_var`; `active_project_id`, not `p_str`).
- **Modular File Length**: Keep component files under 500 lines. Decompose large monoliths into dedicated modules (`evals/`, `mcp-server/`, `mock_data/`).
- **Comments**: Keep comments minimal and focused on *why* (e.g. Node.js `AsyncLocalStorage` request isolation, Microsoft Graph 429 backoff math, Azure RMS encryption envelopes), not *what* the code trivially does.

### 2. Error Handling & Robustness
- **Never Silently Swallow Failures**: Bare `except:` or `catch (err) {}` without structured logging or graceful fallback semantics is strictly prohibited. Swallowed exceptions conceal token expiration and cascade into silent pipeline stalls.
- **Context-Rich Errors**: When handling HTTP, Graph API, or Cloud Run failures, always include operation context, endpoint paths, and HTTP status codes in error messages.
- **Graceful Fallbacks**: Failures in third-party SaaS services must return structured JSON error payloads with actionable troubleshooting guidance rather than unhandled process exits.

### 3. Strict Zero-Copy & Data Governance Invariants
- **Zero Persistent Storage Bloat**: PoCs must adhere to strict **Zero Copy**. Do NOT provision intermediate Cloud Storage (GCS) buckets, persistent disks, or external vector caches for retrieved SaaS data.
- **Volatile In-Memory Lifecycle**: Enterprise documents must be streamed ephemerally into volatile memory (RAM), parsed, and immediately dereferenced for garbage collection.
- **Inline Sensitive Data Protection (DLP)**: All customer text context must pass through synchronous Cloud DLP / Sensitive Data Protection de-identification before context injection.
- **Purview & Security Boundary Guardrails**: When interacting with Microsoft Purview or enterprise DLP, pre-flight checks must inspect sensitivity labels before downloading binary buffers. Encrypted or restricted files (e.g. Azure RMS `.pfile`) must be intercepted with formal policy block notices.

### 4. Secrets Management & Anti-Leak Policy
- **Zero Hardcoded Credentials**: Agents and contributors MUST NEVER embed raw API keys, passwords, client secrets, tenant GUIDs, or personal email addresses in git repositories, markdown documentation, or test fixtures.
- **No Plaintext `.env` Sprawl**: Commit only `.env.example` templates with descriptive placeholders. Runtime secrets must be loaded via Google Cloud Secret Manager or interactive pre-flight wizards.
- **Anti-Leak Masking**: Never echo full raw secret values or authorization tokens in conversational logs, console outputs, or CI/CD build outputs.

---

## The Standardized PoC Contract: "Setup X POC"

Every Proof of Concept added to this repository must reside under `pocs/<poc-name>/` and implement the **Universal PoC Contract**:

```
ai_pocs/pocs/<poc-name>/
├── AGENTS.md                  # PoC-specific technical guidelines and constraints
├── install.sh                 # Standardized interactive pre-requisites wizard ("setup X POC")
├── INSTALL.md                 # Quickstart guide with console deep-links and copy-paste CLI
├── README.md                  # Architecture blueprint, capabilities, and executive summary
├── ARCHITECTURE.md            # Detailed sequence diagrams and security boundaries
├── PREREQUISITES.md           # External SaaS setup, IAM permissions, and OAuth registration
├── PLAN.md                    # 4-milestone implementation checklist (zero Qwiklabs/harvesting steps)
├── USE_CASES_AND_EVALS.md     # Customer showcase scenarios & evaluation methodology
├── .env.example               # Clean configuration template with descriptive placeholders
├── deploy_gcp_environment.sh  # Automated, parameterized deployment script
├── mcp-server/ (or core/)     # Source code
└── evals/                     # Statistical evaluation suite (rubrics, evalset, autorater)
```

### Mandatory Requirements for Every PoC:
1. **Interactive Pre-Flight Wizard (`install.sh`)**:
   - Must prompt for all required configuration and credentials upfront.
   - Must verify Google Cloud SDK authentication and active project context.
   - Must support **Dual-Mode Execution**:
     - **Mode 1: Live SaaS** (Prompts for live tenant credentials and generates `.env`).
     - **Mode 2: Standalone Mock Sandbox** (Sets `MOCK_MODE=true` with zero credential barriers for instant Day 1 customer demonstrations).
   - Must provide a prompt offering to execute automated Cloud Run deployment immediately.
   - Must output a direct clickable link to [`INSTALL.md`](file:///...) upon completion.
2. **Master Launcher Compatibility (`setup.sh`)**:
   - The root script `./setup.sh` must dynamically discover the PoC and support execution via `./setup.sh <poc-name>`.
3. **Statistical Hillclimbing Evaluation Suite (`evals/`)**:
   - Every PoC must provide a rubric-driven evaluation harness (`rubrics.json`, `evalset.json`, `autorater.py`, `evaluate_reliability.py`).
   - Evals must validate against the **Homogeneity Trap** and compute authentic **Krippendorff's Alpha** ($\alpha \ge 0.80$) across multi-pass ($k=3$) judge runs.
