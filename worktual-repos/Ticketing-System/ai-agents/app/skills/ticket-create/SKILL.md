---
name: ticket-create
description: Guided staff create-ticket — collect name, contact, issue; confirm; lean insert. Post-insert Domain enriches subject/description and assigns.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "intake_deflection_domain"
  executors: "ticket_creation_executor"
  task-ids: "ticket.create"
  schema-ref: "create_ticket"
  approval-policy: "channel_dependent"
  dependencies: "customer-verify@1.0.0"
  local-controls: "patch_ticket_draft,navigate,patch_customer_draft"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: verify_ticket_customer enrich_ticket create_ticket portal_create_ticket list_customers list_kb create_customer
---

# Purpose

Perform `ticket-create` for staff chat: collect schema fields, verify the customer, confirm, and file a lean ticket. Triage (subject/description/priority) and L1/L2 assignment happen **after** insert via triage Domain executors — do not call `enrich_ticket` on the happy path.

# When to use

Activate for task `ticket.create` / skill `ticket-create` under `ticket_creation_executor`.

# Required information (schema)

1. `customerName`
2. `contact` (email **or** phone)
3. Directory verification (`customerDirectoryStatus=verified` via `verify_ticket_customer`)
4. `issue` (customer problem in their words)
5. User consent (LLM semantic intent — any natural wording that means file/save; never a magic word list) → `create_ticket` with `confirmed=true`

Do **not** ask for subject, priority, queue, or assignees in chat. Do **not** call `enrich_ticket` before filing.

# Procedure (strict order)

1. Ask **one** missing field at a time. Call `patch_ticket_draft` after each collected value. `navigate` to create-ticket when starting.
2. If the user asks a self-service how-to (password reset, account access, “how do I…”) that is **not** the current missing field value and **not** a clear request to file that problem as a ticket: call `return_to_super` with `action=park` and `query` = their utterance. Do not invent how-to steps; do not bind how-to text into `issue` unless they want it filed.
3. Continue collecting name → contact → verify → issue → consent → `create_ticket` only for create-ticket work.
2. After name + email/phone are in the draft, call `verify_ticket_customer`. On `exists=true`, ask for the issue. On miss: explain clearly, offer to add the customer with the name + contact already collected. Do not ask for issue until verified.
3. When the user consents to add the missing customer: call `create_customer` with `confirmed=true` and `name` + email or phone from `ticket_draft` / prior turns (runtime parks `ticket.create` and runs catalog `customer.create`). Do **not** re-ask name or contact. Phone is optional when email is present. On TOOL RESULT failure: follow that message only — never greet or restart from name.
4. After add-customer succeeds and ticket draft is restored: confirm the save and ask whether to continue filing. On consent, ask **only** the next missing ticket field (usually issue).
5. After issue is collected, briefly recap **only** name, contact, and issue. Ask whether to file. Do **not** call `create_ticket` on the same turn the issue was first saved.
6. On a later turn, **you** (the LLM) decide whether the user consented to file — by meaning, not by matching words like yes/yehh/ok. If they consented, call `create_ticket` with `confirmed=true` and draft fields (issue as description). If TOOL RESULT is `CONFIRMATION_REQUIRED`, summarize and ask once. If they asked to change a field or declined, do not file. Never claim success without a successful tool result.
7. After file success, tell the user the ticket number. Subject/description/priority/assignment will be completed by post-insert triage — do not invent those values in chat.

# Working memory rules

- `customerDirectoryStatus=verified` + `customerId` mean contact is done.
- Contact change clears verification; verify again before create.
- Prefer `create_ticket` with issue text; leave subject/assignee empty for post-insert enrich.

# Validation requirements

- Never invent tenant, customer, or tool-result data.
- Mutations at most once; never auto-retry failed writes.
- Do not expand allowlists or bypass MCP / Express RBAC.

# Expected output

`executor-result-v1`: ask for one field, call an authorized tool, await confirmation, respond, or refuse.
