---
name: customer-create
description: Perform the customer create capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "customer_directory_crud_executor"
  task-ids: "customer.create"
  schema-ref: "create_customer"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: "patch_customer_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: create_customer
---

# Purpose

Perform `customer-create` as a reusable declarative capability owned by `customer_directory_crud_executor` under `catalog_administration_domain`.

# When to use

Activate for task `customer.create` / skill `customer-create`, including when intake parks `ticket.create` on directory miss and hands off here.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Reuse `customer_draft` / supplied fields / parked ticket contact — ask only for truly missing name or email|phone. Never re-ask fields already present. A correction of a collected field is meaning of the whole utterance against this live draft — not keyword lists. Without a replacement, patch `awaiting` only. The next utterance is the replacement; if this utterance already includes it, patch that field and keep sibling values. Never store `null` or the instruction sentence. Do not restart create.
3. On user consent to save, call `create_customer` with `confirmed=true`.
4. On success: grounded confirmation. If a parked create-ticket was restored / `offer_continue_ticket_after_customer`, ask whether to continue filing the ticket (do not restart from customer name).
5. On failure: explain the structured tool error; ask only missing fields.

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
