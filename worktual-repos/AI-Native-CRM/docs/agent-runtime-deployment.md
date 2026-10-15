# Agent runtime deployment

Run the agent stack as separate process types in production. Vite/browser
traffic terminates at Fastify only; the browser must never call ai-service or
MCP directly.

## Processes

- **Fastify API:** `cd backend && npm run start:api`
- **Scheduler singleton:** `cd backend && npm run start:scheduler`
- **Enrichment worker/listener:** `cd backend && npm run start:worker`
- **Python orchestrator:** `cd ai-service && uvicorn app.main:app --host 0.0.0.0 --port 8000`
- **Python MCP:** `cd ai-service && uvicorn app.mcp_main:app --host 0.0.0.0 --port 8010`
- **Python A2A spoke:** `cd ai-service && uvicorn app.a2a_main:app --host 0.0.0.0 --port 8020`
- **Redis:** use the existing managed Redis or a compatible Redis 6+ service.

The scheduler obtains a dedicated PostgreSQL advisory-lock connection before
arming timers. Additional scheduler replicas remain standby, so only one
instance runs sweeps. Job claims remain atomic as a second correctness layer.

## Required wiring

Fastify receives `AI_SERVICE_BASE_URL`, `REDIS_URL`,
`MCP_EXECUTION_JWT_SECRET`, and database settings. The orchestrator receives
`MCP_BASE_URL`, the same MCP JWT secret, and (when STM is enabled)
`ORCHESTRATOR_REDIS_URL`. Keep all secrets server-side; no `VITE_*` secret or
direct Python URL is supported.

Redis is optional for synchronous compatibility, but required for
multi-instance SSE fan-out and Redis-backed short-term memory. Set
`READINESS_REQUIRE_REDIS=true` when Redis is mandatory for the deployment.

## Probes and shutdown

- Fastify liveness: `GET /health`; readiness: `GET /ready`
- Orchestrator liveness: `GET /health`; readiness: `GET /ready`
- MCP liveness/readiness: authenticated `GET /mcp/v1/health`
- A2A spoke liveness: `GET /health`; Agent Card: `GET /.well-known/agent-card.json`; Hub tokens: `POST /token` (client credentials / refresh). Day-wise Hub traces: `ai-service/logs/a2a-YYYY-MM-DD.log`.

SIGTERM stops new scheduler ticks/listeners, releases the scheduler leader
lock, closes agent event subscriptions, and then closes Fastify. Agent SSE
clients reconnect with `Last-Event-ID` (or `?cursor=`) and receive heartbeats.

Operational metrics are available from the authenticated orchestrator endpoint
`GET /operations/metrics`. Labels are bounded and redact secrets, prompts,
transcripts, email, phone, and token-like values.

## Phase 11 acceptance status

Completed on 2026-08-18:

- Production `ai-service/app` has zero LangGraph/LangChain imports and
  `ai-service/requirements.txt` has neither dependency. A pytest guard enforces
  both conditions.
- Linear agent wrappers use the imperative state-merge executor; enrichment
  keeps its normalize/rank branches and step tracing explicitly.
- Named HTTP endpoints and result contracts are unchanged. `legacy` selects
  pre-orchestrator behavior, not a framework dependency; native rollout remains
  off by default with native and emergency rollback allowlists.
- Tenant/RBAC/business-type enforcement, bounded tool loops, malformed model
  output, memory isolation/concurrency, MCP/Redis degradation, action receipts,
  analytics SQL safety, and rollback selection have executable tests.
- Validation run: all 613 ai-service tests passed, Python compileall passed,
  backend event-stream and frontend stream contract tests passed, and the
  forbidden-import scan was clean.
- Full backend and frontend typechecks were attempted. Both remain blocked by
  pre-existing repository-wide TypeScript errors; the changed agent runtime and
  stream files produced no errors in those runs.
