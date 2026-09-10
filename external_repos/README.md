# 📚 External Reference Repositories (external_repos)

This directory houses curated upstream reference architectures, agent design patterns, and production-grade engineering blueprints integrated as Git submodules into the `ai_pocs` monorepo.

These repositories provide architectural benchmarks, eval patterns, and resilience mechanisms for designing and hardening enterprise AI Proof of Concepts.

---

## 📦 Catalog of External Repositories

| Repository | Upstream Remote | Core Focus & Architecture |
| :--- | :--- | :--- |
| **[`l400-managing-production-agents`](./l400-managing-production-agents/)** | [`https://github.com/leiterenato/l400-managing-production-agents.git`](https://github.com/leiterenato/l400-managing-production-agents.git) | **Production Agent Reliability at Scale (L400)**:<br/>• **Eval-Driven Development (EDD)**: Invariant testing before deployment and in production.<br/>• **Agent Resilience**: Semantic circuit breakers, honest degradation, and per-session cost budgets.<br/>• **Data-Boundary Zero Trust**: IAM + Row-Level Security (BigQuery / Cloud SQL) at the data layer instead of prompt-only filtering.<br/>• **A2A Protocol**: Inter-agent communication patterns (`fraud_check_a2a`). |

---

## 🔄 Managing Submodules

To clone the monorepo including all external submodules:
```bash
git clone --recurse-submodules https://github.com/junoonx/ai_pocs.git
```

If already cloned, initialize and update submodules:
```bash
git submodule update --init --recursive
```

To update an external repository to the latest upstream commit:
```bash
git submodule update --remote external_repos/<repo-name>
```
