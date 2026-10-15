---
name: ticket-enrich
description: Triage/enrich a create-ticket draft after directory verify and issue collection.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "intake_deflection_domain"
  executors: "ticket_creation_executor"
  task-ids: "ticket.enrich"
  schema-ref: "ticket.enrich"
  approval-policy: "none"
  dependencies: "customer-verify@1.0.0"
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: enrich_ticket
---

# Purpose

Run `enrich_ticket` so Express/ITRA fills subject, priority, and routing into `ticket_draft` before file confirmation.

# When to use

As a dependency of `ticket-create` after name + verified contact + usable issue are present. Do not use before `customerDirectoryStatus=verified`.

# Prerequisites (hard)

1. `ticket_draft` has `customerName` and email/phone.
2. `verify_ticket_customer` already succeeded (`customerId` + `customerDirectoryStatus=verified`).
3. Usable `issue` text is in the draft (customer problem — not name/email).

If verify is missing, refuse enrich and call `verify_ticket_customer` first (or ask the user to wait/retry). Do not invent triage fields in chat.

# Procedure

1. Call `enrich_ticket` once with draft customer + issue fields (hydrate from `ticket_draft`).
2. On success: acknowledge briefly from tool payload; do not ask for subject/priority/queue in chat.
3. Recap key facts in fresh wording and ask whether to file — call `create_ticket` only after clear consent (owned by `ticket-create`).
4. On failure: report grounded tool error; do not claim enrichment succeeded; do not invent assignee/resolver names.

# Working memory

Enrich writes triage fields into `ticket_draft`. Contact change or issue change invalidates prior enrich — re-verify if contact changed, then enrich again after issue is set.

# Expected output

`executor-result-v1` grounded in the `enrich_ticket` payload only.
