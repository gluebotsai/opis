---
name: ticket-reassign
description: Perform the ticket reassign capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "resolution_lifecycle_domain"
  executors: "ticket_lifecycle_executor"
  task-ids: "ticket.reassign"
  schema-ref: "reassign_ticket"
  approval-policy: "none"
  dependencies: ""
  local-controls: "patch_reassign_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_ticket list_agents list_queues resolve_ticket_person update_ticket request_ticket_reassignment list_reassignment_requests decide_ticket_reassignment
---

# Purpose

Perform `ticket-reassign` as a reusable declarative capability owned by `ticket_lifecycle_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Resolve the ticket first: Open UI item / `last_entity` / this conversation’s create TOOL RESULT is the target — do not ask which ticket unless they named a different one. Then call `resolve_ticket_person` for that number; use `person_data` name + **role** from TOOL RESULT. A later utterance that still means this same move keeps those values; do not re-ask who.
2. **Role slots (hard):** L1 assignee column → roster role **agent** (or admin). L2 resolver column → roster role **resolver** only. Never ask "agent or resolver?" when `roster_roles` / person_data already shows their role. Assignee vs resolver is utterance meaning against the live draft — not a word list. ROLE_SLOT_MISMATCH: explain once and wait; do not restart collect.
3. When the user picks a person, set `target_role` from their roster role via `patch_reassign_draft` — do not let them override (e.g. an agent cannot be assigned as resolver). A correction of a collected field is meaning of the whole utterance against this live draft — not keyword lists. Without a replacement, patch `awaiting` only. The next utterance is the replacement; if this utterance already includes it, patch that field and keep sibling values. Never store `null` or the instruction sentence.
4. **Actor role (session, not the sentence):** Admin — `update_ticket` to an org agent (L1 `assignee`) or resolver (L2 `resolver`). Agent — only a resolver from this turn’s `resolve_ticket_person` / roster TOOL RESULT; write L2 `resolver` via `update_ticket`. Resolver — do **not** call `update_ticket` or `escalate_ticket` to move people. Collect a mandatory `reason`, then `request_ticket_reassignment` with `ticket_number`, `person` from TOOL RESULT, and `reason`. Tell them the ticket’s agent must approve. Agent later: `list_reassignment_requests` then `decide_ticket_reassignment` with `request_id` from that TOOL RESULT and accept true/false. Write with `update_ticket` only for admin/agent as above: `confirmed=true` when this turn’s `resolve_ticket_person` already named them, or when the draft is complete and this utterance means they confirm that move (meaning, not a confirm-word list). Do not claim you will change it unless that write runs this turn. Do not reply that a technical issue blocked the move unless the write TOOL RESULT `success` is false. Pass `person_name` from the last `resolve_ticket_person` TOOL RESULT. Omit the unused column entirely — never send `assignee: "null"` or `resolver: "null"`. After any write TOOL RESULT, reply from that payload only.
5. If TOOL RESULT is `ROLE_SLOT_MISMATCH`, explain their roster role and list valid teammates for that slot from `resolve_ticket_person`.

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
