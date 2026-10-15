---
name: ticket-assign-best
description: Perform the ticket assign best capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "triage_routing_domain"
  executors: "intelligent_assignment_executor"
  task-ids: "ticket.assign.best"
  schema-ref: "ticket.assign.best"
  approval-policy: "proactive_asga"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_ticket update_ticket auto_assign_ticket list_agents list_queues list_tickets
---

# Purpose

Perform `ticket-assign-best` as a reusable declarative capability owned by `intelligent_assignment_executor` (ITRA).

On lean `ticket.created` (after classify), choose **L1 agent** and **L2 resolver** from the live roster by **skill fit to the issue**. **LLM only** decides the fit; names must be exact roster matches. A scheduled WLOA load brief may rank among skill matches; it never assigns, never overrides a missing skill fit, and must never leave a role empty because someone is busy. If at least one skill-matched person exists for that role, name one of them (use live roster size — including a single available person). If the LLM fails, invents names, or finds no skill match, leave assignee/resolver empty — do not fill with a deterministic, random, or workload scorer. Do not run WLOA on this create path.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically. Domain plan runs this after `ticket-classify-prioritize` on create.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ticket number / org context come from the proactive event or task state.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Load ticket (`get_ticket`) and roster context (`list_agents` / queues / open tickets) as needed.
3. LLM-select L1 (agent) and L2 (resolver) from roster facts by skill overlap with the issue. Use a WLOA load brief only as a hint among skill matches. Never leave a role empty because of load. Never invent names. If no skill-matched LLM roster pick, leave that role unassigned (no scorer fill, no Express auto-assign).
4. Call `update_ticket` only when LLM chose a valid assignee and/or resolver and ASGA allows. Do not call `auto_assign_ticket` as a fallback pick.
5. Return a grounded result.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Assignee/resolver must exist on the org roster.
- Unsupported operations must return a typed capability refusal.

# Dependencies

None (classify/enrich should already have set queue/priority when run in the create sequencer).

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
