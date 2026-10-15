# Web Tracking AI co-worker (MAS)

Simple **Super → route → reports domain agent** chat for dashboard analytics (same pattern as ticketing **`reports_analytics_domain`**). Meaning lives in **editable prompts** under `prompts/layers/` and `reports/`; Python plans tasks, runs **`run_kpi`** (ClickHouse) or **`run_semantic`** (Context Layer), then answers from fact blocks.

## Run

```bash
cd AI_CHAT
python -m uvicorn app.main:app --host 0.0.0.0 --port 7863
```

Requires `CONTEXT_LAYER_URL`, JWT `API_SECRET_KEY`, and LLM env vars (see `.env.example`).

## Edit behavior (prompts)

See **[prompts/README.md](./prompts/README.md)** — which file to change for routing vs metrics vs optional reply tone.

| Path | Purpose |
|------|---------|
| `prompts/layers/standalone.md` | Follow-up → standalone question |
| `prompts/layers/super.md` | Super routing |
| `prompts/layers/domain.md` | Domain ownership + objective |
| `prompts/layers/executor.md` | Reference metric rules (semantic shape) |
| `reports/domain/agent.md` | Reports domain: task plan + synthesis rules |
| `reports/semantic_executor/agent.md` | `run_kpi` / `run_semantic` tool JSON |
| `reports/product/kpis.json` | Certified KPI index (ClickHouse vs semantic store) |
| `prompts/layers/reply.md` | Optional natural reply (`AI_CHAT_LLM_REPLY=1`) |
| `prompts/insights_synthesis.txt` | Insights panel only |

## Code map (small)

| Path | Purpose |
|------|---------|
| `app/mas/turn.py` | One user turn orchestration |
| `app/reports/orchestrator.py` | Reports domain plan → execute → answer |
| `app/mas/layers.py` | LLM call 1 (Super+Domain route) |
| `app/mas/prompts.py` | Read `.md` prompt files |
| `app/mas/validate.py` | Allowlist metrics/dims (no regex routing) |
| `app/services/context_layer.py` | Ontology slice + semantic HTTP |
| `app/routes/chat.py` | HTTP API |
| `app/insights/` | Separate Insights agent |

## Speed and parity

- Standalone rephrase only when the session has prior turns.
- Super+Domain and Executor use low temperature and capped tokens.
- KPI questions with a dashboard period pill use **ClickHouse parity** (`app/mas/dashboard_parity.py`) so numbers match the dashboard.
- **Online visitors** are always realtime (no month/30-day wording).
- Turn log: `AI_CHAT/logs/coworker-turn-YYYY-MM-DD.log` and mirror `.local/logs/coworker-turn-YYYY-MM-DD.log` (created at startup + each turn). `GET /health` returns `turn_log_primary` and `turn_log_mirror`.
- Set `AI_CHAT_LLM_REPLY=1` only if you want a polished prose pass (slower).

## Architecture doc

[docs/WEB_TRACKING_COWORKER_THREE_LAYER_MAS.md](../docs/WEB_TRACKING_COWORKER_THREE_LAYER_MAS.md)
