# 💼 Enterprise Customer Use Cases & Autorater Evaluation Framework

This document outlines high-impact customer demonstration workflows and explains the statistical evaluation methodology used to benchmark the **OmniShare-MCP** integration.

---

## 1. Top 3 Enterprise Customer Showcase Scenarios

When presenting Gemini Enterprise integrated with Microsoft 365, focus on these three real-world business scenarios:

### Scenario 1: Cross-Silo Unified Executive Synthesis (Zero Copy)
* **The Customer Problem**: Knowledge workers spend up to 2.5 hours per day switching between Microsoft SharePoint, OneDrive, and corporate dashboards, unable to correlate cross-functional dependencies.
* **The Showcase in Action**:
  * *Prompt*: *"Synthesize the expected operational impact of the Project Helix system upgrade on our Q3 financial ledger and summarize any dependencies noted across teams."*
  * *Agent Execution*:
    1. Invokes `sharepoint_search_files` with `query="Helix Upgrade"` $\rightarrow$ locates `Cymbal_Helix_Upgrade.docx` in SharePoint Operations.
    2. Invokes `sharepoint_search_files` with `query="QuantumLedger"` $\rightarrow$ locates `Cymbal_QuantumLedger.docx` in SharePoint Finance.
    3. Invokes `sharepoint_read_file` on both documents simultaneously in volatile Cloud Run memory.
    4. Correlates the 4-hour maintenance window with the 2-day delay in Q3 ledger reconciliation.
    5. Returns a unified briefing with clickable citations back to SharePoint Online.
* **Customer Takeaway**: Proves that Gemini Enterprise acts as a cognitive orchestration layer uniting siloed departments with zero data duplication.

---

### Scenario 2: Active Agentic Workflows (Bidirectional Read + Write)
* **The Customer Problem**: Most enterprise AI assistants are passive search tools ("read-only RAG"). They cannot create deliverables, organize shared drives, or take action within corporate repositories.
* **The Showcase in Action**:
  * *Prompt*: *"Review our NovaPulse campaign brief on SharePoint, draft a 1-page executive summary briefing, and save it as a new document under the Marketing 'Executive Briefs' folder."*
  * *Agent Execution*:
    1. Reads `Cymbal_NovaPulse_Brief.docx` via `sharepoint_read_file`.
    2. Synthesizes an executive overview with budget allocations ($650k) and designated agencies.
    3. Calls `sharepoint_create_folder` to create `Executive Briefs` if it doesn't already exist.
    4. Calls `sharepoint_upload_file` to commit `NovaPulse_Executive_Brief.docx` directly to the SharePoint drive.
* **Customer Takeaway**: Demonstrates active enterprise productivity, transitioning AI from answering questions to completing tasks.

---

### Scenario 3: Enterprise Zero-Trust Governance & Purview Guardrails
* **The Customer Problem**: Chief Information Security Officers (CISOs) fear that connecting AI to Microsoft 365 causes data leakage, unauthorized file downloads, or PCI/PII compliance violations.
* **The Showcase in Action**:
  * *Prompt*: *"List the vendor billing details and corporate credit card numbers recorded in the QuantumLedger documentation."*
  * *Agent Execution*:
    1. Reads `Cymbal_QuantumLedger.docx` via `sharepoint_read_file`.
    2. Volatile RAM pipeline streams text through Cloud Sensitive Data Protection (DLP).
    3. Credit card numbers (`4124...`, `8891...`) are synchronously masked to `[REDACTED_CREDIT_CARD]`.
    4. When attempting to query `Executive_Compensation_2026.docx`, the Purview pre-flight check intercepts the RMS-encrypted document and returns an enterprise governance block notice.
* **Customer Takeaway**: Proves that enterprise compliance policies are strictly enforced before any text reaches the LLM context window.

---

## 2. Why We Use an Autorater Evaluation Harness

In enterprise AI architectures, connecting an MCP server is only half the battle. A standard API ping verifies that the server responded (`HTTP 200`), but **it cannot verify cognitive correctness or safety**.

The **Autorater Evaluation Engine** (inspired by the *Hillclimbing with Autoraters* methodology) provides three critical capabilities:

1. **Tool Selection & Reasoning Verification**:
   - Verifies whether Gemini picks the optimal tool out of 12 (e.g. `sharepoint_read_file` instead of guessing from metadata).
   - Validates multi-hop execution chains across independent site collections.

2. **Grounding & Anti-Hallucination Gate**:
   - Formulates strict Likert rubrics (`rubrics.json`) measuring whether numerical claims, dates, and names are directly traceable to the source text.
   - Gracefully penalizes responses that confabulate details for non-existent documents (negative testing).

3. **Statistical Reliability & Defense Against the Homogeneity Trap**:
   - **Multi-Pass Sampling ($k=3$)**: Runs evaluations across multiple passes to measure intra-rater consistency.
   - **Krippendorff's Alpha ($\alpha$)**: Evaluates inter-rater agreement across passes to prove the evaluator is reliable ($\alpha \ge 0.80$).
   - **Homogeneity Trap Detection**: If an evaluator assigns uniform 5/5 scores across diverse prompts ($\text{Variance} = 0$), it flags a "Homogeneity Trap," warning engineers that the judge is rubber-stamping outputs.

---

## 3. How to Run and Customize the Evaluation Suite

### Running the Evals

```bash
cd evals

# 1. Run multi-pass autorater scoring (outputs eval_results.json)
python3 autorater.py

# 2. Compute Krippendorff's Alpha and quality gate metrics
python3 evaluate_reliability.py
```

### Customizing for Your Customer Domain

1. **Add Custom Queries**: Edit `evalset.json` with domain-specific questions, target SharePoint sites, and expected factual assertions.
2. **Tune Rubrics**: Edit `rubrics.json` to reflect customer compliance requirements (e.g., specific industry disclaimers or formatting standards).
3. **Live LLM Judge**: Export `GEMINI_API_KEY` to run the autorater against Vertex AI `gemini-2.5-flash` rather than simulated scoring.
