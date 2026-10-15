<!-- BEGIN:nextjs-agent-rules -->
# Stack note

Primary app is **Vite (`frontend/`) + Fastify (`backend/`)**.

- DB access: `backend/src/dao/**`
- Business logic: `backend/src/service/**`
- HTTP routes: `backend/src/modules/**`
- UI: `frontend/src/**`

This repo previously used Next.js; that App Router UI has been removed. When changing APIs or UI, prefer the Vite + Fastify paths and read package docs under `frontend/node_modules` / `backend/node_modules` as needed.

# Agents / LLM (mandatory)

Every AI agent lives in **Python** under `ai-service/app/agents/**`. Replies,
collected fields, and actions must come from the LLM (`LLM_BASE_URL`) — never
regex/heuristic fill or canned routing. Reuse `crm_tools`, `coworker_shared`,
and `llm_result`. TypeScript only enqueues / calls ai-service. If the LLM is
down, fail/retry; do not collect data or act via heuristics.
See `.cursor/rules/agents-must-use-llm.mdc`.

# Coworker MCP (HTTP server on ai-service)

MCP tools live in **`ai-service/app/mcp/`** and are served at **`/mcp/v1`** on the
ai-service process (`MCP_BASE_URL`, default `http://127.0.0.1:8000/mcp/v1`).
Agents use `app.mcp_client.McpClient` over HTTP (in-process fallback for tests).
Fastify is **not** the MCP host — forms stay on Fastify; Vite refreshes via
`uiRefresh` on agent-turn. See [`docs/worktual-combine-contracts.md`](docs/worktual-combine-contracts.md).

Lead pipeline (enrich → score → summary → assign|nurture): gate **≥ 40**,
bands hot/warm/cold — see [`docs/lead-agent-pipeline.md`](docs/lead-agent-pipeline.md).

AI-native CRM / Worktual combine contracts:
[`docs/worktual-combine-contracts.md`](docs/worktual-combine-contracts.md).

Full migration guide (LangGraph/LangChain → native orchestrator, MCP, tool loop, memory, hooks):
[`docs/ai-service-architecture-migration.md`](docs/ai-service-architecture-migration.md).

# Finance (B2B)

Invoice lifecycle (Sales → Finance approve → customer send → offline paid or Phase 2 gateway webhooks):
[`docs/finance-invoice-flow.md`](docs/finance-invoice-flow.md) (Phase 1–3 subscriptions & renewals).

# Multi-tenancy (B2B / B2C / B2B2C)

One shared CRM schema for all business types; gate by
`accounts.organizations.business_type`. Keep companies and contacts separate —
no unified party table, no tables per industry or franchise. Industry packs
follow `accounts.organizations.industry_type`. Product catalog is
`inventory.products` (DML only; no CRM DDL). See
[`docs/multi-tenancy-common-model.md`](docs/multi-tenancy-common-model.md).
<!-- END:nextjs-agent-rules -->
