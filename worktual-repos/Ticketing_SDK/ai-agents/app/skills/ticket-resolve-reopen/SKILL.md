---
name: ticket-resolve-reopen
description: Perform the ticket resolve reopen capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "resolution_lifecycle_domain"
  executors: "ticket_lifecycle_executor"
  task-ids: "ticket.resolve.reopen"
  schema-ref: "ticket.resolve.reopen"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_ticket portal_list_tickets update_ticket
---

# Purpose

Perform `ticket-resolve-reopen` as a reusable declarative capability owned by `ticket_lifecycle_executor`.

Staff and signed-in customers (support portal included): write the status they meant. **Close** → **Closed**. **Resolve** / work done → **Resolved**. Customers never write Resolved; they close with **Closed** (after staff Resolved) or reopen a **Closed** ticket to **Reopened**. Customers may only change status on tickets they own — Express enforces that.

# When to use

Activate when the user clearly wants to **resolve/close** or **reopen** an existing ticket — by number, from recent context, or from conversation meaning (“my ticket”) with no id yet.

# Procedure

1. Resolve the **ticket number** from trusted `last_entity` (right-hand open ticket), Super `query` / objective when it already names a listed id from create-path same-issue, `get_ticket`, `list_tickets`, `portal_list_tickets`, or `last_customer_360_tickets` — never invent ids. If `last_entity` is a ticket, or Super already passed a listed number, do **not** ask which ticket number.
2. **No ticket id in focus:** this turn call **`portal_list_tickets`** on the support portal (or **`list_tickets`** for staff). Reply only from that TOOL RESULT. For reopen, staff: offer Resolved/closed rows; portal customer: offer **Closed** rows (or the single match). For close, name the ticket they mean from that TOOL RESULT. Never file a new ticket. Never say the customer role cannot reopen.
3. When status is unknown for a chosen id, call **`get_ticket`** first.
4. **Reopen:** staff may reopen from Resolved or Closed; customers reopen only when current status is **Closed**. Call **`update_ticket`** with `status="Reopened"` in the same turn before replying.
5. **Resolve:** when they mean work is done / mark resolved (not close), call **`update_ticket`** with `status="Resolved"`. Staff only. Never substitute Closed for that ask.
6. **Close:** when they mean close the ticket, call **`update_ticket`** with `status="Closed"` this turn. Staff may close from the current TOOL RESULT status. Customers close only if TOOL RESULT status is **Resolved**. Never write Resolved when they meant close. Never write Closed when they meant resolve.
7. If you already summarized and asked them to proceed, the next utterance that means consent must call **`update_ticket`** with flat `ticket_number`, `status`, and `confirmed=true`. Do not nest those fields under `arguments`. Do not ask them to confirm a second time.
8. Reply briefly using only fields from the successful **`update_ticket`** tool result (`status`, ticket id). Do not claim success without `success: true`.
9. On tool failure, quote the structured error only.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.

# Expected output

Return `executor-result-v1`: ask for a ticket number if missing, call authorized tools, respond from tool JSON, or refuse.
