# Contact Center Reporting Domain Migration: Removals & Handover Guide

This document provides a comprehensive, transparent audit of:
1. **Everything that was removed** from the repository to integrate the new `reports_analytics_agent`.
2. **Why sending only the isolated `reports_analytics_agent` folder is NOT enough** for the product team, and exactly what constitutes the complete deliverable.
3. **The safety guarantees** ensuring that existing dashboards, live UI cards, and admin APIs remain completely unaffected.

---

## 1. Handover Answer: Is Sending `@reports_analytics_agent` Enough?

> [!CAUTION]
> **No, sending only the `reports_analytics_agent` directory is NOT enough.**
> If the product team only receives that folder, the Contact Center will **not** be able to use the reporting engine.

### Why It Is Not Enough (The 5 Missing Bridges)
`reports_analytics_agent` is the domain execution engine (the *brain* for reporting). However, in a Multi-Agent System (MAS), it cannot operate in isolation within the contact center. It requires five core integration bridges located across `ai_contact_centre`:

```
User Query (e.g., "What was our CSAT last week?")
         │
         ▼
[Contact Center Super Agent] ──────── (Bridge 1: Super Agent Routing in agent.md)
         │
         ▼
[Spoke Dispatcher / Router] ───────── (Bridge 2: Declarative agent.md & Router Logic)
         │
         ▼
[Coworker Adapter] ────────────────── (Bridge 3: coworker/reports_analytics.py)
         │
         ▼
[reports_analytics_agent Pack] ────── (The Domain Engine itself)
         │
         ▼
[Dependencies & Config] ───────────── (Bridge 4 & 5: pyproject.toml & trusted identity)
```

1. **Bridge 1: Super Agent Routing Contract (`apps/nlp/agents/contact_center_super/agent.md`)**
   - The Contact Center Super Agent is the single front door for end-user chat.
   - Without the routing instructions in `contact_center_super/agent.md`, the Super Agent does not know that questions about KPIs, SLA breaches, queues, or causal "why/how" analysis belong to `reports_analytics_agent`. It would attempt to answer using generic LLM knowledge or fail to route.
2. **Bridge 2: Declarative Spoke Contract (`apps/nlp/agents/reports_analytics_agent/agent.md`)**
   - The NLP framework requires an `agent.md` declaration specifying the agent's ID, description, capabilities, handoff targets, and sample triggers. Without this, the agent registry fails to recognize `reports_analytics_agent` as an eligible domain spoke.
3. **Bridge 3: Async Coworker Adapter (`apps/nlp/src/app/agents/coworker/reports_analytics.py`)**
   - The NLP framework's runtime executes agents asynchronously via `Agent.run()`.
   - `reports_analytics_agent` exposes a synchronous engine entrypoint (`run_turn()`).
   - The adapter `ReportsAnalyticsCoworkerAgent` bridges this via `asyncio.to_thread()`, unpacks the session context (tenant, user ID, roles), passes it into `run_turn()`, and formats the final output for the chat response. Without this adapter, the runtime crashes when trying to instantiate the agent.
4. **Bridge 4: Runtime Factory & Router Integration**
   - [`apps/nlp/src/app/agents/coworker/__init__.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/agents/coworker/__init__.py): Maps `"reports_analytics_agent"` in the agent factory.
   - [`apps/nlp/src/app/agents/definitions.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/agents/definitions.py): Declares `REPORTS_ANALYTICS_AGENT_DEFINITION` with permissions, layer (`"domain"`), and surface keywords.
   - [`apps/nlp/src/app/runtime/orchestration.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/runtime/orchestration.py): Dispatches commands (`"reports"`, `"analytics"`, `"performance"`) directly to `reports_analytics_agent`.
   - [`apps/nlp/src/app/runtime/router.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/runtime/router.py): Permits self-contained domain agents to return direct answers without forcing redundant downstream worker handoffs.
5. **Bridge 5: Python Project Dependencies (`apps/nlp/pyproject.toml`)**
   - The reporting engine requires `sqlglot`, `neo4j`, `meilisearch`, and `psycopg2-binary`. These are defined in `apps/nlp/pyproject.toml`. Without them, imports fail.

**Conclusion for Delivery**:
The product team needs the entire **`ai_contact_centre` repository** (or a Git PR/branch containing the `apps/nlp` modifications), **not** just the raw `reports_analytics_agent` directory.

---

## 2. Complete Manifest of Everything Removed

To make room for the new reporting domain agent and keep the repository clean, secure, and production-ready, removals were performed in two distinct areas:
- **Part A:** Obsolete legacy NLP reporting components in `ai_contact_centre`.
- **Part B:** Lab test benches, developer scripts, and secrets inside the `reports_analytics_agent` pack.

---

### Part A: Legacy NLP Reporting Components Removed from `ai_contact_centre`

Prior to this migration, Contact Center NLP used a rudimentary 9-metric prompt setup with an L3 coworker agent. All of these components have been decommissioned:

| # | Removed File / Component | What It Was | Why It Was Removed | Replacement |
|---|---|---|---|---|
| **1** | `apps/nlp/agents/analytics/agent.md` | Legacy L3 Analytics Agent declarative card | Contained outdated prompts that attempted to answer metrics via limited MCP tools. | Replaced by `apps/nlp/agents/reports_analytics_agent/agent.md` (46 certified KPIs). |
| **2** | `apps/nlp/agents/analytics/samples.json` | Sample queries for legacy analytics | Outdated sample queries mapped to the old agent. | Replaced by comprehensive samples in `reports_analytics_agent/agent.md`. |
| **3** | `apps/nlp/agents/performance_intelligence_domain/agent.md` | Legacy L2 Performance Domain Router | An empty pass-through router whose sole job was handing off to `analytics`. | Eliminated. `contact_center_super` now routes directly to `reports_analytics_agent`. |
| **4** | `apps/nlp/agents/performance_intelligence_domain/samples.json` | Sample queries for performance intelligence domain | Outdated routing samples. | Redundant; removed. |
| **5** | `apps/nlp/src/app/agents/coworker/analytics.py` | Legacy `AnalyticsCoworkerAgent` Python class | Wrapped the old prompt and called `MetricMCPServer`. | Replaced by `apps/nlp/src/app/agents/coworker/reports_analytics.py`. |
| **6** | `apps/nlp/src/app/prompts/analytics.py` | Hardcoded prompt strings for analytics | Contained legacy static prompt templates. | Replaced by the YAML-driven prompt system in `reports_analytics_agent/product/`. |
| **7** | `apps/nlp/src/app/mcp/servers/metric.py` (`MetricMCPServer`) | Legacy Metric MCP Server | Handled only 9 hardcoded metrics against mock/conversations tables. | Superseded by the certified SQL templates & Cypher KG engine in the domain pack. |
| **8** | `apps/nlp/src/app/skills/packs/performance-analytics/references/metrics.yaml` | Legacy 9-metric definition YAML | Restricted to 9 basic metrics with no dimensions, no grounding, and no aliases. | Replaced by `reports_analytics_agent/product/kpis.yml` (46 KPIs) and `dimensions.yml` (33 dimensions). |
| **9** | `apps/nlp/src/app/skills/packs/performance-analytics/references/schema-conversations.yaml` | Legacy conversations schema reference | Outdated schema documentation. | Replaced by `reports_analytics_agent/product/schema.yml`. |
| **10** | `apps/nlp/src/app/skills/packs/performance-analytics/skill.yaml` | Legacy skill definition pack | Manifest binding the obsolete 9 metrics. | Superseded by domain agent skills. |
| **11** | Legacy entries in `apps/nlp/src/app/mcp/registry.py` | Registrations for `metric` server and `analytics` agent | Prevented runtime from attempting to boot the deleted `MetricMCPServer`. | Cleaned up; removed deleted tool references. |
| **12** | Legacy exports in `apps/nlp/src/app/agents/definitions.py` | `ANALYTICS_AGENT_DEFINITION` & `PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION` | Outdated agent metadata definitions. | Replaced by `REPORTS_ANALYTICS_AGENT_DEFINITION`. |

---

### Part B: Non-Production Lab Artifacts & Secrets Removed from `reports_analytics_agent`

The source `reports_analytics_agent` folder originally contained standalone developer lab services, manual re-indexing scripts, developer checklists, and local credentials. These were cleaned up to create a secure, production-grade deliverable:

| # | Removed Item | Purpose in Original Lab | Why It Was Removed from Product Pack |
|---|---|---|---|
| **1** | `CCAAS_kg_context_agent/.env` | Hardcoded Neo4j and Meilisearch credentials | **Security risk.** Production services must never commit plain-text `.env` files. Runtime credentials are now securely provided via environment variables (`NEO4J_URI`, `MEILISEARCH_URL`), with fallback defaults configured. |
| **2** | `CCAAS_kg_context_agent/fastapi_service/` | Standalone FastAPI microservice server | This was an isolated HTTP server used to test the KG in a lab. In production, the domain agent imports the KG tools directly via Python modules (`from ...CCAAS_kg_context_agent.src.tools import ...`). Running a separate HTTP server is completely redundant. |
| **3** | `CCAAS_kg_context_agent/scripts/` | Local admin scripts (`reindex_meili.py`, `seed_neo4j.py`, etc.) | One-off ops and database maintenance scripts. They are not invoked during query execution. Leaving them in production creates clutter. |
| **4** | `product/COVERAGE_GATE.md` | Builder progress notes & internal checklist | Internal development documentation for developers building KPI coverage. Not used by the agent runtime. |
| **5** | `product/coverage.yml` | Raw inventory dump file | A 2500-line static inventory file created during development. The YAML loader reads `kpis.yml`, `dimensions.yml`, and `schema.yml`, and never loads `coverage.yml`. |
| **6** | `tests/` (internal pack tests) | Standalone unit tests from the lab repo | Contained obsolete unit tests hardcoded to external local URLs and mock databases. Replaced by the comprehensive integration test suite in `apps/nlp/tests/unit/test_reports_analytics_integration.py`. |
| **7** | Duplicate root folder `reports_analytics_agent/` | Redundant copy at repository root | Redundant duplicate left over from copying. The official, active pack lives at `apps/nlp/src/app/agents/reports_analytics_agent/`. |

---

## 3. What Was Protected & Strictly Preserved

To prevent any regressions in user-facing dashboards, UI analytics cards, and scheduled email reports, the following components were **strictly preserved and verified**:

```
                       ┌──────────────────────────────────────────────┐
                       │       Contact Center UI & Admin Panels       │
                       └──────┬────────────────────────────────┬──────┘
                              │                                │
              Calls REST API  │                                │  Calls Snapshot Tools
                              ▼                                ▼
       ┌──────────────────────────────┐       ┌─────────────────────────────────┐
       │   Dashboard & Reports APIs   │       │        AnalyticsMCPServer       │
       │   (api/dashboard_analytics)  │       │     (mcp/servers/analytics)     │
       │   (api/reports.py)           │       │                                 │
       │  • /internal/v1/dashboard-...│       │  • get_dashboard_analytics_...  │
       │  • /internal/v1/reports      │       │  • get_analytics_hourly_volume  │
       └──────────────────────────────┘       └─────────────────────────────────┘
                      │                                        │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Live Database & Historical Data    │
                      └───────────────────────────────────────┘
```

1. **`AnalyticsMCPServer` ([`apps/nlp/src/app/mcp/servers/analytics.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/mcp/servers/analytics.py))**:
   - **Preserved.** This is NOT the removed `MetricMCPServer`.
   - Provides `get_dashboard_analytics_snapshot` and `get_analytics_hourly_volume` used by dashboard diagnostic views and hourly peak-volume cards.
2. **Dashboard REST Endpoints ([`apps/nlp/src/app/api/dashboard_analytics.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/api/dashboard_analytics.py))**:
   - **Preserved.** Exposes `/internal/v1/dashboard-analytics` endpoints for incident snapshots, forecast adjustments, and workforce planning.
3. **Scheduled Report Endpoints ([`apps/nlp/src/app/api/reports.py`](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/api/reports.py))**:
   - **Preserved.** Generates executive summaries and agent performance breakdowns for automated email schedules.
4. **All Other Domain Agents**:
   - `agent_assist_domain`, `interaction_operations_domain`, and `workforce_management_domain` remain untouched and fully operational.

---

## 4. Verification & Health Audit

Every change has been validated using the Contact Center test suite:

| Test Suite | Purpose | Result |
|---|---|---|
| `test_reports_analytics_integration.py` | Validates agent initialization, turn execution, mock routing, error handling, and fact grounding. | **6/6 Passed (100%)** |
| `test_dashboard_analytics.py` | Verifies live dashboard snapshot REST endpoints and diagnostic reviews. | **5/5 Passed (100%)** |
| `test_report_executive_summary.py` | Verifies scheduled executive summary generation and contract safety. | **6/6 Passed (100%)** |
| KPI Loader Check | Verifies all 46 KPIs and 33 dimensions load cleanly into runtime memory. | **46/46 KPIs Verified** |

---

## 5. Recommended Product Handover Procedure

When providing the solution to the product team, share the **`ai_contact_centre` repository** using one of the following methods:

- **Method A: Direct Git Branch / Commit (Recommended)**
  Commit the current workspace state to a feature branch (e.g., `feature/reporting-analytics-agent`) and push it or create a Pull Request against the main repository.
- **Method B: Git Patch File**
  Generate a unified patch (`git diff origin/main > reporting_domain_migration.patch`) and bundle it with untracked directories (`apps/nlp/agents/reports_analytics_agent/`, `apps/nlp/src/app/agents/reports_analytics_agent/`, and documentation).
- **Method C: Complete Archive of `apps/nlp/`**
  Provide the entire `apps/nlp/` directory, which contains both the new reporting domain pack and all the contact center wiring.
