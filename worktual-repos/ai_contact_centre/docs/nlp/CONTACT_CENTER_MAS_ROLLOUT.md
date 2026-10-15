# Contact Center MAS rollout and rollback

The coworker default is three-layer MAS (`contact_center_super` → domain → executor). Enabling one capability does not implicitly enable another.

## Configuration

- `COWORKER_MAS_MODE=three_layer`: `flat`, `shadow`, or `three_layer` coworker routing.
- `COWORKER_MAS_ORG_IDS=*`: comma-separated tenant allowlist; `*` means all tenants.
- `COWORKER_MAS_INTERNAL_HANDOFF_LIMIT=10`: internal L1/L2 hop budget.
- `COWORKER_MAS_ROUTING_TIMEOUT_SECONDS=6`: per L1/L2 routing-agent timeout.
- `AGENT_MARKDOWN_PROMPTS_ENABLED=false`: use migrated `agent.md` prompts for legacy L3s.
- `DYNAMIC_PROCEDURAL_SKILLS_ENABLED=false`: allow governed L3 skill activation/deactivation.
- `AGENT_MEMORY_V2_ENABLED=false`: enable four-layer memory and hard-preference checks.
- `AGENT_AUDIT_PERSISTENCE_ENABLED=false`: persist non-blocking tool audit metadata.
- `PASSIVE_ASSIST_STRUCTURED_ENABLED=false`: direct structured Conversation Assist response.
- `VITE_PASSIVE_ASSIST_STRUCTURED_ENABLED=false`: render structured passive-assist UI.

An empty `COWORKER_MAS_ORG_IDS` always resolves to flat mode even when the requested mode is shadow or three-layer.

## Rollout

1. Deploy schema migration `contact_center_mas_v1.sql`; leave all flags off.
2. Enable audit persistence and memory for an internal test tenant.
3. Enable `shadow` for that tenant. Compare shadow L1/L2 terminal L3 decisions with flat routes; shadow never executes the selected L3.
4. Enable Markdown prompts and dynamic skills for the internal tenant; run contact create/update/deactivate golden workflows.
5. Enable structured passive assist in NLP and web for the internal tenant/build.
6. Change the internal tenant to `three_layer`; verify route, fallback, latency, tool-denial, draft, and confirmation telemetry.
7. Add tenants individually. Do not use `*` until canary error/latency and route-stability gates remain healthy.

## Required canary gates

- No increase in API/SSE errors or missing terminal `done`.
- No L1/L2 business MCP calls.
- No disallowed layer edge or cross-tenant memory result.
- Flat and three-layer choose the same terminal legacy L3 for established golden requests.
- Contact/queue/task mutations still require preview, confirmation, idempotency, and hard-preference verification.
- Passive assist never sends or mutates; stale revisions/source-message IDs are ignored.
- P95 added hierarchy latency remains within the team release threshold.

## Config-only rollback

Set `COWORKER_MAS_MODE=flat` or remove the affected tenant from `COWORKER_MAS_ORG_IDS`. Independently disable Markdown prompts, dynamic skills, memory/audit, or structured assist if that subsystem is implicated. No database rollback or destructive migration is required; additive columns and memory records may remain.

