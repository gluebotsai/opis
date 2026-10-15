---
name: ticket-classify-prioritize
description: Perform the ticket classify prioritize capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "triage_routing_domain"
  executors: "classification_priority_executor"
  task-ids: "ticket.classify.prioritize"
  schema-ref: "ticket.classify.prioritize"
  approval-policy: "proactive_asga"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_ticket update_ticket list_queues list_tickets
---

# Purpose

Perform `ticket-classify-prioritize` as a reusable declarative capability owned by `classification_priority_executor`.

After lean create (`triage_complete=false`), this Skill must LLM-enrich **subject and description** (same quality as `enrich_ticket` / `categorize_ticket`) plus priority, category, and queue — then `update_ticket`. Do not assign L1/L2 here (that is `ticket-assign-best` / ITRA).

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically. Domain plan runs this before assign on `ticket.created` lean inserts.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Load the ticket (`get_ticket`) and org queues (`list_queues`) as needed.
3. LLM-enrich polished **subject** + **description** from the raw customer issue, and classify priority / category / queue (same triage quality as pre-file `enrich_ticket`).
4. Call `update_ticket` with subject, description, priority, category, and queue when confidence meets ASGA. `description` is required on that write — never omit it or send blank.
5. Return a grounded result; do not invent assignees.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Subject and description enrichment is required on lean post-insert triage — priority-only updates are insufficient.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
