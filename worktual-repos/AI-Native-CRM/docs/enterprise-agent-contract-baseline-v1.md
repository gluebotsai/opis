# Enterprise agent contract baseline v1

Status: frozen compatibility baseline; runtime implementation superseded by
phase 11 while the HTTP and output contracts remain active.

This document records the production contract before native-runtime migration. It
does not switch any existing agent, remove LangGraph, or grant new tool access.
The canonical prompt order remains:

`Role → Goal → Instructions → Context → Output → Guardrails`

The prompt builders remain `crm_tools.build_system_prompt` for coworker turns and
`llm_result.sectioned_system_prompt` for job agents. Agent decisions, scores,
summaries, drafts, replies, and routing on configured success paths come from the
LLM. Rules and heuristics are offline fallbacks only.

## HTTP contract v1

- Fastify calls `POST /ai/v1/agents/:name/run` with JSON and an optional
  `x-internal-secret`. The Python service returns the agent's JSON object.
- The route remains synchronous. Fastify timeouts are bounded from 5,000 ms to
  240,000 ms. A non-2xx response or transport failure becomes `null` at the
  TypeScript client boundary.
- Coworker clients call `POST /api/coworker/agent-turn`. Authentication is a
  Fastify user session. Fastify supplies authoritative organization, actor,
  role, and business type to `crm-agent`.
- Coworker success is `{ok:true, assistantText}` plus optional `patch`,
  `contactDraftPatch`, `toolProposals`, `workspaceHint`, `sessionMemoryPatch`,
  `sessionMemory`, and `uiRefresh`. Failure is `{ok:false,error}`.
- A tool proposal has `id`, `name`, `label`, `args`, and `risk` (`low|high`).
  UI refresh has optional `modules`, `entityIds`, and `reason`.
- B2C Finance is rejected before the Python call. Durable memory writes are
  allowlisted structured slots and are persisted by Fastify.
- Fixture `ai-service/tests/fixtures/agent_contract_v1.json` is the executable
  offline baseline. Tests parse request/result models and do not start Fastify,
  ai-service, an LLM, MCP, Redis, or PostgreSQL.

## Public named-agent inventory

The Python registry exposes these names:

- Lead/contact pipelines: `enrich-lead`, `score-lead`, `summarize-lead`,
  `nurture-lead`, `lifecycle-lead`, and `hygiene`. They receive contact or job
  context, use CRM reads plus LLM-generated enrichment/score/summary/decision
  output, and persist through existing CRM client endpoints. Tenant scope is the
  supplied organization.
- Sales and finance jobs: `assign-sales`, `audit-forecast`,
  `invoice-escalation`, and `expansion-matcher`. They receive organization plus
  contact/company/deal/invoice identifiers as applicable. Existing CRM services
  own persistence and authorization.
- Meeting and inbox jobs: `analyze-transcript`, `auto-reply-email`,
  `assist-meeting`, `meeting-brief-email`, `meeting-mom`,
  `meeting-miss-escalation`, and `post-meeting-process`. Their generated
  analyses, drafts, coaching, and follow-up decisions are LLM output.
- Content and governance: `sales-coach`, `compose-email`,
  `compliance-privacy`, `document-template`, and `proposal-content`. They return
  structured generated content; callers own approved persistence.
- General entrypoints: `hello`, `chat`, and `crm-agent`. `chat` is the shared
  direct LLM adapter. `crm-agent` is the compatibility coworker supervisor.

Every public name above is mounted at `/ai/v1/agents/<name>/run`. Request shapes
remain the Pydantic models in `ai-service/app/api/routes.py`; the endpoint
fixture freezes route names and representative request keys without pretending
that all agents share one input schema.

## Coworker specialists hidden behind `crm-agent`

These are not independently exposed HTTP agents:

- Stateful/domain specialists: contact, company, deal, proposal, product, and
  link-module specialists (quotes, finance, activities).
- Draft specialists: contact, company/location, deal, product, invoice,
  activity, and quote draft handlers.
- Generic page assistance and the shared native-tool turn.
- The current supervisor owns module selection and active session-memory hints.
  MCP tools are listed for the effective module/surface. Form-owned mutations
  remain proposals; other calls use the Python MCP client.

Coworker prompts use `crm_tools.build_system_prompt`, tool schemas come from the
Python MCP catalog, tool calls map back to the compatibility envelope, and
Fastify persists only approved durable-memory writes. Existing specialist code
and LangGraph graphs remain untouched during phases 1–2.

## Native runtime v1

`ai-service/app/orchestrator` introduces an opt-in runtime contract:

- `ExecutionEnvelope` freezes run/trace/tenant/actor/role/business type/mode,
  deadline, idempotency, conversation, and tool-budget data.
- `RunResult` preserves `assistantText`, `patch`, `toolProposals`,
  `sessionMemory`, and `uiRefresh`.
- Registries are explicit immutable instances. Active agent is request state,
  never mutable process-global state.
- Tool execution is bounded to six LLM rounds and ten calls. Exact repeated
  calls are cycle-detected. Mutations execute serially; independent read-only
  batches may execute concurrently. MCP is represented by an injected protocol.
- Pipelines support linear/conditional steps, retry classification,
  checkpoints/resume, leases, compensation metadata, and step traces.
- Tenancy, RBAC/tool authorization, confirmation/idempotency, prompt redaction,
  auditing hooks, and output sanitation are deterministic policy hooks.
- Rollout controls are `legacy|native|dry_run` with per-agent allowlists.
  Mutation-capable agents cannot use comparison dry-run, preventing dual writes.

Phase 11 removed the LangGraph/LangChain runtime dependencies. Rollback
`legacy` now means the framework-independent pre-orchestrator agent behavior;
`native` means the PipelineRunner/supervisor/tool-loop adapter. The named native
rollout remains disabled by default, allowlisted, and single-execution for
mutation-capable agents. Both paths preserve the contracts above and use the
same LLM-backed prompt builders.
