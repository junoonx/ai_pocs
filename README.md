# 🚀 Enterprise AI Proof of Concepts (ai_pocs)
### Production-Grade, Zero-Copy Enterprise AI Integrations for Google Cloud

A centralized monorepo housing modular, field-tested Proof of Concepts (PoCs) that connect Google Cloud AI platforms (**Gemini Enterprise**, **Vertex AI Agent Platform**, **Search & Conversation**) to enterprise SaaS estates with **Zero Copy** architecture.

---

## 🎯 The "Setup X POC" Universal Lifecycle

Every PoC in this repository follows a unified contract:
1. **Interactive Pre-Flight Questionnaire**: Prompts for all required SaaS/GCP credentials upfront.
2. **Dual-Mode Execution**: Supports both **Live Enterprise SaaS** and **Standalone Mock Sandboxes** for instant Day 1 customer demonstrations.
3. **Automated Cloud Run Deployment**: Deploys private, enterprise-hardened microservices with zero-trust IAM.
4. **Statistical Hillclimbing Evaluation**: Evaluates anti-hallucination and groundedness using multi-pass ($k=3$) scoring and Krippendorff's Alpha ($\alpha$).

To launch and configure any PoC, run the master orchestrator from the repository root:

```bash
# 1. Interactive Selection Menu
./setup.sh

# 2. Or launch a specific PoC directly
./setup.sh gemini-enterprise-mcp-sharepoint
```

---

## 📦 Available Proof of Concepts

| PoC Identifier | Name & Focus Area | Target Platforms | Key Capabilities |
| :--- | :--- | :--- | :--- |
| **[`gemini-enterprise-mcp-sharepoint`](./pocs/gemini-enterprise-mcp-sharepoint/)** | OmniShare-MCP | Gemini Enterprise & Microsoft 365 | Zero-copy discovery, Word/PPTX/Excel/PDF parsing, Microsoft Purview RMS encryption defense, Cloud DLP de-identification, and 12 custom MCP actions. |

---

## 🏗️ PoC Directory Structure

Every underlying PoC adheres strictly to the following directory layout:

```
ai_pocs/
├── AGENTS.md                           # Top-level AI agent and contributor guidelines
├── README.md                           # PoC catalog and launcher documentation (this file)
├── setup.sh                            # Master launcher ("setup X POC")
└── pocs/
    └── <poc-name>/
        ├── AGENTS.md                   # PoC-specific implementation rules
        ├── install.sh                  # Interactive pre-requisite wizard & deployer
        ├── INSTALL.md                  # Quickstart manual with direct console links
        ├── README.md                   # Architecture blueprint & executive summary
        ├── ARCHITECTURE.md             # Technical diagrams & protocol specs
        ├── PREREQUISITES.md            # Entra ID app registration & Graph API guide
        ├── PLAN.md                     # Clean 4-milestone implementation checklist
        ├── USE_CASES_AND_EVALS.md      # Customer demonstration workflows & autorater methodology
        ├── .env.example                # Clean configuration template
        ├── deploy_gcp_environment.sh   # Parameterized Cloud Run deployment script
        ├── mcp-server/ (or core/)      # Source code & Dockerfile
        └── evals/                      # Autorater evaluation suite
```

---

## 📜 Repository Standards & Guidelines

Refer to **[`AGENTS.md`](./AGENTS.md)** for contributor standards, zero-copy invariants, error handling policies, and instructions on authoring new PoCs.
