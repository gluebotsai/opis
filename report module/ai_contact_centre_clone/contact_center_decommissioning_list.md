# Decommissioning Catalog: Items Being Removed vs. Items Retained

This document explicitly lists **what is being removed**, **what is being added/activated**, and **what is preserved without changes** to guarantee that Contact Center dashboards, metrics, and APIs remain undisturbed.

---

## 1. Summary Matrix

| Category | Being Removed (Legacy NLP Only) | Being Added / Active | Retained & Protected (Dashboard & APIs) |
| :--- | :--- | :--- | :--- |
| **Agents** | `analytics` (L3 coworker), `performance_intelligence_domain` (L2 router) | `reports_analytics_agent` (Self-contained Domain L2) | All other coworker agents (`general`, `contact`, `inbox`, `task`, `queue`, `monitoring`) |
| **Agent Prompt Files** | `agents/analytics/agent.md`, `agents/performance_intelligence_domain/agent.md` | `agents/reports_analytics_agent/agent.md` | All other agent prompt documents in `apps/nlp/agents/` |
| **Python Code** | `coworker/analytics.py`, `prompts/analytics.py` | `coworker/reports_analytics.py`, `reports_analytics_agent/` module | All shared runtime agents, memory, and orchestration engines |
| **Skill Packs** | `performance-analytics/` (redundant `metrics.yaml`) | Built-in domain skills (`cc-user-brief`, `contact_center-kpi-meaning`, etc.) | Operational skill packs (`contact-*`, `queue-*`) |
| **MCP Servers** | `MetricMCPServer` (`mcp/servers/metric.py`) | Domain agent internal SQL & Cypher KG executors | `AnalyticsMCPServer` (retained for dashboard snapshot APIs), `FastMCP` |
| **REST APIs** | **None** | **None** | `/internal/v1/dashboard-analytics`, `/internal/v1/reports`, `/api/v1/dashboard/analytics` |

---

## 2. Items Being Removed (Decommissioned)

These items are obsolete co-worker chat artifacts that previously handled performance reporting via a rigid prompt and a 9-metric YAML reference:

### A. Declarative Agent Contracts & Definitions
1. **`apps/nlp/agents/analytics/agent.md`**:
   - *Reason*: Old L3 co-worker prompt that attempted to route and render reports via MCP tools.
2. **`apps/nlp/agents/performance_intelligence_domain/agent.md`**:
   - *Reason*: Old L2 domain router that solely handed off to `analytics`.
3. **`apps/nlp/src/app/agents/coworker/analytics.py`**:
   - *Reason*: Thin subclass of `Agent` that wrapped the legacy `analytics` prompt.
4. **`apps/nlp/src/app/prompts/analytics.py`**:
   - *Reason*: Hardcoded fallback prompt strings for the legacy analytics agent.
5. **Definitions in `apps/nlp/src/app/agents/definitions.py`**:
   - Remove `PERFORMANCE_INTELLIGENCE_DOMAIN_DEFINITION`
   - Remove `ANALYTICS_AGENT_DEFINITION`
   - Clean up exports from `ALL_AGENT_DEFINITIONS`

### B. Legacy Skill Packs
6. **`apps/nlp/src/app/skills/packs/performance-analytics/`**:
   - *Reason*: Contains the old 9-metric `metrics.yaml` and prompt instructions. Superseded by the 46 KPIs and certified SQL templates in `reports_analytics_agent`.

### C. Redundant MCP Server
7. **`apps/nlp/src/app/mcp/servers/metric.py` (`MetricMCPServer`)**:
   - *Reason*: Standalone MCP server whose sole role was querying the 9 legacy metrics in `metrics.yaml`.
   - Remove from `apps/nlp/src/app/mcp/registry.py`.

---

## 3. Items Being Added / Active (The New Reporting Engine)

The reporting module operates as a self-contained, domain-level engine with zero reliance on legacy NLP prompts:

1. **`apps/nlp/src/app/agents/reports_analytics_agent/`**:
   - Complete domain reporting engine.
   - `core/turn.py`: Multi-turn planner, turnaround dispatcher, and fact assembler.
   - `core/sql/`: Certified KPI template engine and free SQL fallback.
   - `core/grounding.py`: Automatic fact-checking verifier preventing hallucinated numbers.
   - `CCAAS_kg_context_agent/`: Neo4j Cypher knowledge graph for causal "why/how" analysis.
   - `product/kpis.yml` & `product/sql/*.sql`: 46 certified KPI definitions and templates.
   - `product/dimensions.yml`: 33 dimensions across 663 aliases.
2. **`apps/nlp/agents/reports_analytics_agent/agent.md`**:
   - Declarative contract establishing `reports_analytics_agent` as the L2 domain authority for reports, metrics, and causal analysis.
3. **`apps/nlp/src/app/agents/coworker/reports_analytics.py`**:
   - Runtime adapter bridging async `Agent.run()` to `run_turn()` using `asyncio.to_thread()`.
4. **Router & Factory Updates**:
   - `contact_center_super` routes all reporting, metrics, SLAs, and causal questions directly to `reports_analytics_agent`.
   - Surface mappings (`"reports"`, `"performance"`, `"analytics"`) point to `reports_analytics_agent`.

---

## 4. Protected Items (Explicitly Retained & Preserved)

> [!NOTE]
> The following components are **critical to dashboard operations, UI cards, and internal scheduled services** and are **strictly preserved**:

1. **Dashboard & Analytics REST API Endpoints**:
   - [apps/nlp/src/app/api/dashboard_analytics.py](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/api/dashboard_analytics.py): Handles diagnostic review, forecast adjustments, and workforce planning for the admin UI.
   - [apps/nlp/src/app/api/reports.py](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/api/reports.py): Handles executive summary and agent performance summary generation for scheduled report emails.
2. **Dashboard Snapshot Tools in `AnalyticsMCPServer`**:
   - [apps/nlp/src/app/mcp/servers/analytics.py](file:///home/vectone/Uday/vibecoding_files/ai_contact_centre/apps/nlp/src/app/mcp/servers/analytics.py):
     - `get_dashboard_analytics_snapshot`: Fetches live diagnostic/predictive/prescriptive data from `/api/v1/dashboard/analytics`.
     - `get_analytics_hourly_volume`: Fetches hourly inbound evidence for the peak-hour card.
3. **Admin Dashboard Skill Pack**:
   - `apps/nlp/src/app/skills/packs/dashboard-analytics/`: Retained for the Analytics page incident snapshot integration (`get_dashboard_analytics_snapshot`).
4. **All Other Domain Agents**:
   - `agent_assist_domain`, `interaction_operations_domain`, and `workforce_management_domain` remain untouched.
