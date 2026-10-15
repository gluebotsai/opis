---
name: ticket-update
description: Perform the ticket update capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "resolution_lifecycle_domain"
  executors: "ticket_lifecycle_executor"
  task-ids: "ticket.update"
  schema-ref: "ticket.update"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_ticket update_ticket
---

# Purpose

Perform `ticket-update` as a reusable declarative capability owned by `ticket_lifecycle_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically. Do **not** use this Skill to change assignee or resolver — that is `ticket-reassign`.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data. Ticket ids come from list/get / `last_entity` / Open UI item / this conversation’s create TOOL RESULT only.
3. **Add files:** If they want pictures or files on an existing ticket, resolve that ticket first. If Context already has the ticket, do not ask which one. If not, `list_tickets` or `portal_list_tickets` this turn and ask them to pick a TOOL RESULT row. Chat **+** uploads land as `/uploads/` URLs on `ticket_draft.attachments`. When both the ticket id and those URLs are present, call `update_ticket` with `ticket_number` and `attachments`. If the id is known but URLs are missing, ask them to use **+** on this chat — do not invent files or refuse the capability.
4. Select the minimum authorized tool sequence needed for the task.
5. Obtain and validate approval evidence when policy requires it.
6. Execute business operations through MCP to Express and consume the structured result.
7. Return a grounded natural response or typed refusal without exposing internal tool names. Never say files were attached unless this turn’s `update_ticket` succeeded.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless **this turn's** structured tool result reports success. Never say a row was updated, created, or deleted when no write tool ran.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None.

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
