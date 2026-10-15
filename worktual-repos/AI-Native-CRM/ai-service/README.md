# AI Service (LangGraph agents)

Python FastAPI gateway for **all** CRM agents. **One agent per file** under
`app/agents/`. The Vite + Fastify CRM backend only enqueues jobs and calls
these endpoints — it must not implement agent brains.

All LLM calls go through the **OpenAI-compatible GLM server**
(`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`, default `worktual-glm`).

## Agent contract (mandatory)

1. **Primary output = LLM** (`generate_ai_text` / `chat_with_tools` in `app/llm.py`).
2. **Heuristics = offline fallback only** (`source: heuristic`, `reason: llm_*`).
3. **Reuse shared stacks** — do not invent parallel styles:

| Concern | Module |
|---------|--------|
| OpenAI tool schemas + `run_native_agent_turn` | `app/agents/crm_tools.py` |
| Prompt sections Role → Goal → Instructions → Context → Output → Guardrails | `crm_tools.build_system_prompt` / `llm_result.sectioned_system_prompt` |
| Chat memory (`entityId`, catalog) | `app/agents/coworker_shared.py` |
| JSON extract / AI vs heuristic labels | `app/agents/llm_result.py` |

See `.cursor/rules/agents-must-use-llm.mdc`.

## Run

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=.
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Set `CRM_API_BASE_URL` to the Fastify backend and `ENRICH_INTERNAL_SECRET` to match.
Set `LLM_*` to your self-hosted model endpoint.

Run MCP as a separate production ASGI service:

```bash
uvicorn app.mcp_main:app --host 0.0.0.0 --port 8010
```

CRM A2A spoke (Hub tasks; Agent Card + `/token` + JSON-RPC):

```bash
uvicorn app.a2a_main:app --host 0.0.0.0 --port 8020
```

Set `A2A_HUB_JWT_SECRET` (signing key for CRM-issued access JWTs). Seed this spoke’s Hub client with `A2A_SERVER_NAME=worktual-crm`, `A2A_SPOKE_CLIENT_ID`, and `A2A_SPOKE_CLIENT_SECRET` (stored on `accounts.a2a_spoke_clients`). For leftover non-CRM work, set `HUB_A2A_URL` plus `HUB_A2A_CLIENT_ID` / `HUB_A2A_CLIENT_SECRET`; CRM mints Hub tokens onto the `worktual-hub` row of the same table. Never escalate Hub follow-ups. Hub traffic is logged day-wise to `ai-service/logs/a2a-YYYY-MM-DD.log` (`tail -f ai-service/logs/a2a-$(date +%F).log`).

Set the same server-only `MCP_EXECUTION_JWT_SECRET` on Fastify and MCP.
Fastify issues short-lived execution JWTs; the browser never receives them.
Production does not mount MCP on `app.main` and never falls back to in-process
tool dispatch. Legacy secret auth and in-process dispatch are explicit
development/test compatibility options documented in `.env.example`.

## Native orchestrator skills and memory

`app/skills` exposes name/description summaries first and loads a full typed
six-section package only after agent, role, and business-type eligibility
checks. Selected skill MCP capabilities are intersected with the parent
`AgentSpec.allowedTools`; selection can never add a tool.

`app/memory` provides request working memory with tenant/user/conversation
Redis isolation, TTL, optimistic CAS, distributed locks, redaction, compaction,
provenance, and forget. It is disabled by default. Set
`ORCHESTRATOR_STM_ENABLED=true` and `ORCHESTRATOR_REDIS_URL` to make Redis
authoritative; `sessionMemory` and `sessionMemoryPatch` remain in responses for
client compatibility. `ORCHESTRATOR_STM_FAILURE_MODE=closed` rejects runs on
memory failures; `graceful` preserves the compatibility path.

Durable slots remain in `crm.agent_memories` behind Fastify tenancy/RBAC. Native
agents use a signed MCP execution JWT through the internal HTTP memory contract;
only allowlisted slots and bounded expiries are accepted.

## Agents

| Agent | Module | Endpoint |
|-------|--------|----------|
| hello | `app/agents/hello_agent.py` | `POST /ai/v1/agents/hello/run` |
| enrich-lead | `app/agents/enrich_lead_agent.py` | `POST /ai/v1/agents/enrich-lead/run` |
| score-lead | `app/agents/score_lead_agent.py` | `POST /ai/v1/agents/score-lead/run` |
| summarize-lead | `app/agents/summarize_lead_agent.py` | `POST /ai/v1/agents/summarize-lead/run` |
| nurture-lead | `app/agents/nurture_lead_agent.py` | `POST /ai/v1/agents/nurture-lead/run` |
| lifecycle-lead | `app/agents/lifecycle_lead_agent.py` | `POST /ai/v1/agents/lifecycle-lead/run` |
| assign-sales | `app/agents/assign_sales_agent.py` | `POST /ai/v1/agents/assign-sales/run` |
| analyze-transcript | `app/agents/analyze_transcript_agent.py` | `POST /ai/v1/agents/analyze-transcript/run` |
| auto-reply-email | `app/agents/auto_reply_email_agent.py` | `POST /ai/v1/agents/auto-reply-email/run` |
| assist-meeting | `app/agents/assist_meeting_agent.py` | `POST /ai/v1/agents/assist-meeting/run` |
| meeting-brief-email | `app/agents/meeting_brief_agent.py` | `POST /ai/v1/agents/meeting-brief-email/run` |
| meeting-mom | `app/agents/meeting_mom_agent.py` | `POST /ai/v1/agents/meeting-mom/run` |
| meeting-miss-escalation | `app/agents/meeting_miss_escalation_agent.py` | `POST /ai/v1/agents/meeting-miss-escalation/run` |
| post-meeting-process | `app/agents/post_meeting_process_agent.py` | `POST /ai/v1/agents/post-meeting-process/run` |
| compose-email | `app/agents/compose_email_agent.py` | `POST /ai/v1/agents/compose-email/run` |
| crm-agent | `app/agents/crm_agent.py` | `POST /ai/v1/agents/crm-agent/run` |
| chat | `app/agents/chat_agent.py` | `POST /ai/v1/agents/chat/run` |

TypeScript heuristics remain **offline fallback only** when ai-service is down.
