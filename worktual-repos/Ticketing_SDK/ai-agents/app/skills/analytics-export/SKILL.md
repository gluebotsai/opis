---
name: analytics-export
description: Perform the analytics export capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "analytics_audit_query_executor"
  task-ids: "analytics.export"
  schema-ref: "analytics.export"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: export_analytics
---

# Purpose

Perform `analytics-export` as a reusable declarative capability owned by `analytics_audit_query_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data.
3. When the user names a preset window, pass it to `export_analytics` using the catalog `range` argument:
   - **Today / last 24 hours** → `range=24hours`
   - **Last 7 days / this week** → `range=7days`
   - **Last 30 days / this month** → `range=30days`
4. Call `export_analytics` once with the resolved preset. Never invent download URLs or CSV content.
5. Phrase the reply from the structured tool result only (`range`, readiness). Do not paste markdown links, hrefs, or `/api/` paths — the UI auto-downloads via a structured download action.
6. Return a grounded natural response or typed refusal without exposing internal tool names.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
