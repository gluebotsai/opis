---
name: customer-verify
description: Verify a create-ticket contact against the org customer directory before collecting the issue.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "intake_deflection_domain"
  executors: "ticket_creation_executor"
  task-ids: "customer.verify"
  schema-ref: "customer.verify"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: verify_ticket_customer
---

# Purpose

Confirm the customer exists in the org directory (email or phone) and write `customerId` + `customerDirectoryStatus=verified` into working draft state.

# When to use

- As a dependency of `ticket-create` as soon as name + email/phone are collected.
- Standalone task `customer.verify` when only directory check is requested.

# Procedure

1. Require email or phone (from args or `ticket_draft`). Name alone is not enough.
2. Call `verify_ticket_customer` once with those fields.
3. On success (`exists=true`): verification is complete — do **not** re-ask contact, do **not** ask the user to confirm the match. Hand control back so create-ticket can ask for the issue.
4. On miss / ambiguous / temporary failure: follow the tool message; never invent a customerId; never proceed to issue/enrich/create as if verified.
5. Do not retry identical verify args in the same turn after a failure or CONFLICT cycle-break.

# Working memory

Successful verify merges into `ticket_draft`: `customerId`, `customerDirectoryStatus=verified`, `awaiting=issue`. That status is the hard gate for `enrich_ticket` / `create_ticket`.

# Expected output

`executor-result-v1` grounded in the verify tool payload only.
