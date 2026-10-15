# Co-worker chat prompts — what to edit

All co-worker **meaning** lives in plain text under `prompts/layers/`. Python only loads these files and validates JSON against the ontology slice.

**Speed:** Up to **four** LLM calls when needed: standalone rephrase, Super+Domain (route), **reports domain plan**, semantic executor (when not a direct certified KPI). KPI answers use templates. Dashboard KPI cards use the same ClickHouse SQL as the dashboard when a period pill is selected.

**Ticketing-style reports agent:** `AI_CHAT/reports/` (domain + semantic executor prompts, `product/kpis.json`). Runtime: `app/reports/orchestrator.py` — plan → `run_kpi` (ClickHouse) / `run_semantic` (Context Layer) → fact blocks → optional Domain synthesis.

| File | Layer | When it runs | Your edits |
|------|--------|--------------|------------|
| `layers/standalone.md` | Memory | When chat history exists | Follow-up → one clear question; online = now, not month |
| `layers/super.md` | Super | Every user message (call 1) | Routing rules: continue vs new task, greet, refuse off-topic |
| `layers/domain.md` | Domain | Same call as Super (appended) | Which domain owns KPI vs breakdown vs ranking vs drilldown; write `objective` in English |
| `layers/executor.md` | Executor | Analytics path only (call 2) | How to pick metric/dimension ids from the slice; semantic JSON shape |
| `layers/reply.md` | (optional) | Only if `AI_CHAT_LLM_REPLY=1` | Tone and follow-up suggestions after numbers are known |
| `insights_synthesis.txt` | Insights panel | `/insights/generate` only | Dashboard narrative — not co-worker chat |

## Call flow

```text
User message
  → [standalone.md] if history  → standalone question (stored in session memory)
  → [super.md + domain.md]  → JSON: action, domain, objective
  → if analytics:
       fetch ontology slice (HTTP, cached)
       → [reports/domain/agent.md]  → JSON plan: tasks[] (kpi, goal, time, answer_type)
       → per task: run_kpi (ClickHouse) OR [reports/semantic_executor/agent.md] → run_semantic
       → validate allowlists (code) → POST /v1/semantic/query when semantic
       → fact block + template answer (+ optional synthesis if depth standard/deep)
       → AI_CHAT/logs/coworker-turn-YYYY-MM-DD.log (one JSON line per turn)

**Turn log fields (debugging):** `ontology` (prompt + metric catalog), `executor_plan_raw`, `semantic_plan`, `context_layer_semantic_request`, `context_layer_semantic_response`, `data_source`, `sql_or_context`, `bot_response`.
```

## JSON outputs (do not rename keys without updating `app/mas/models.py`)

**Call 1 — route:**

```json
{
  "action": "analytics",
  "domain": "site_kpi",
  "objective": "Count unique visitors for the current website using the dashboard week period."
}
```

`action`: `analytics` | `greet` | `refuse` | `clarify`  
`domain`: `site_kpi` | `breakdown` | `ranking` | `drilldown` (ignored unless action is analytics)

**Call 2 — semantic plan:**

```json
{
  "metrics": ["unique_visitors"],
  "time": { "period": "last_7_days" },
  "group_by": [],
  "filters": [],
  "order_by": [],
  "limit": null
}
```

Never put the raw user sentence in semantic fields. Omit `time` if the user did not ask for a range and no dashboard pill applies.
