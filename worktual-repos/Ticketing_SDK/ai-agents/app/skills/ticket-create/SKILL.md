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
allowed-tools: verify_ticket_customer enrich_ticket create_ticket portal_create_ticket get_customer_order list_tickets list_customers list_kb
---

# Purpose

Perform `ticket-create` for staff chat: collect schema fields, verify the customer, confirm, and file a lean ticket. Triage (subject/description/priority) and L1/L2 assignment happen **after** insert via triage Domain executors — do not call `enrich_ticket` on the happy path.

# When to use

Activate for task `ticket.create` / skill `ticket-create` under `ticket_creation_executor`.

# Required information (schema)

1. `customerName`
2. `contact` (email **or** phone)
3. Directory verification (`customerDirectoryStatus=verified` via `verify_ticket_customer`)
4. `issue` — you may **enhance** (rephrase) the problem in `patch_ticket_draft` when **this turn is the issue** (they described, added to, or corrected it). Use conversation + draft so the write-up is clear; do not invent. If a resolver still could not act, ask one follow-up (never word lists). When the text is enough, patch that enhanced `issue` plus `issueReady=true`. `issueReady` without `issue` is incomplete. If TOOL RESULT `missing` lists `issue`, enhance and patch `issue` this turn. Do not stamp `issueReady` on a vague first sentence. If this utterance means they agree to file, or they are not changing the problem, do not re-patch a new enhanced `issue` — keep the draft `issue`. Order id is `orderId`, not a string stuffed into `issue`.
5. Same-customer same-issue check (`list_tickets` for this customer **after** `issueReady=true`). Same vs new is LLM meaning of listed rows vs the rephrased draft issue — never word lists. Stamp `precreate_duplicate_check=not_duplicate` only when no listed row is the same issue, or they declined reopen of a Resolved/Closed same-issue ticket and still mean to file new. Same issue still open (status is not Resolved or Closed) → stamp `duplicate`; do not create. Same issue Resolved or Closed → ask whether to reopen that listed ticket; do not stamp `not_duplicate` until they decline reopen and still want a new file.
6. User consent (LLM meaning of this utterance plus the recap — they agree to file; never a word list) → `create_ticket` with `confirmed=true` (staff) or `portal_create_ticket` (support portal)

Do **not** ask for subject, priority, queue, or assignees in chat. Do **not** call `enrich_ticket` before filing.

# Portal (logged-in customer)

The customer already authenticated. Runtime stamps `ticket_draft.surface=portal` plus session `customerId` / name. Do not ask for email or name. From the **whole conversation**, decide if this filing is about a **purchase they already made**. **Not a purchase:** collect **only the issue**, then the same completeness / follow-up / rephrase / `issueReady` / `list_tickets` duplicate gate as staff. **Purchase (LLM meaning of this conversation — never keyword lists):** this turn `patch_ticket_draft` `needsOrderCheck=true` **before** `issueReady` or recap. If `orderId` is empty, ask for it — do not recap. When they give it, `patch_ticket_draft` `orderId`, call `get_customer_order` this turn with that `order_id` (this org + signed-in customer only). Never call it with empty arguments. Quote TOOL RESULT only. Found → show those order fields, then collect `productId` from TOOL RESULT `items[]` only (one line: confirm that product; several: they pick; none: skip). Then issue if missing (or keep draft `issue` from this conversation), `issueReady`, `list_tickets` same-orderId gate, recap **identity + draft issue + order and product TOOL RESULT**, then consent. Not found (`exists` false) → polite human reply; do not file. After they agreed to file a purchase problem, do **not** skip order id because the issue is already in history. File with `portal_create_ticket` — never staff `create_ticket`. User-visible replies never mention draft, ticket_draft, CDP, or that nothing was saved.

# Staff (admin / agent / resolver)

After verify, if the conversation means a purchase issue: same order-id + `get_customer_order` using verified `customerId` from TOOL RESULT / draft and `order_id` they just gave (patch `orderId` first). After that TOOL RESULT, collect `productId` from `items[]` (confirm one line, or pick among several). Never empty `get_customer_order` args. Never invent a customer, order, or product id. Never look up an order for a different customer or without org. Non-purchase filings skip the order tool. `order_id is required` is not a missing purchase — pass the id and call again.

# Procedure (strict order)

1. Ask **one** missing field at a time (from TOOL RESULT `missing` / live draft). Call `patch_ticket_draft` after each collected value. `navigate` to create-ticket when starting. Each ask is a fresh, polite paragraph (two or three sentences): acknowledge what they just gave, a short why the next piece matters, then one question. Same warmth as a first hello — not a one-line form prompt and not a reused opener. Judge the whole utterance against this live `ticket_draft` (meaning/context, never keyword lists): without a replacement, patch `awaiting` only; the next utterance is the replacement; if this utterance already includes it, patch that field and keep sibling values. Never store `null` or the instruction sentence. Do not restart create. Do not re-collect or re-patch fields already on the draft unless they mean to correct that field. If this utterance is not the open slot (not a name, email/phone, issue, or order id they are filing), do not re-patch Context leftovers. Empty `updated_fields` → stop patching; park via `return_to_super` when they stated a how-to/problem they have not agreed to file, otherwise ask one clarification.
2. If the user asks a self-service how-to, or states a problem they may solve themselves, and they have **not** asked or agreed to file it: call `return_to_super` with `action=park` and `query` = their utterance — even if `awaiting=issue`. Do not invent how-to steps; do not bind that text into `issue`. On **support portal** a leftover create pin is the same: `search_kb` first via Super/Domain. After that walk, stay here only if they already asked or agreed to file: `patch_ticket_draft` the rephrased issue + `issueReady=true` from the conversation — do not ask the issue again, do not park. An unsolved walk without that agreement is not this Skill.
3. Continue collecting name → contact → verify → (purchase meaning: `needsOrderCheck` + order id + `get_customer_order` + product from that TOOL RESULT `items[]` before `issueReady`) → issue (follow-ups until complete) → rephrase + `issueReady` → `list_tickets` → same-issue / same-orderId gate → recap (include order and product TOOL RESULT when a purchase check ran) → consent → `create_ticket` / `portal_create_ticket` only for create-ticket work.
4. After name + email/phone are in the draft, call `verify_ticket_customer`. On `exists=true`, stay in the create-ticket thread. **Staff surface:** speak to the agent; use the TOOL RESULT name as the person this ticket is for. Write two or three sentences with a brief why we now need the issue (so the write-up is in their words and the team can act), then one natural ask. Do not greet the customer as if they are in chat. Do not say on record, on file, matches, the right person, or that you looked them up. **Portal surface:** talk to the customer in fresh wording, with a short why, and ask what they need help with. Never say directory, customer found, verified, or CDP. On miss (`cannot_create`): a polite paragraph from the facts (the contact they gave, no matching person, cannot file). Do not offer to add them. Do not ask for issue. Stop.
5. **Issue quality (hard — LLM only, both staff and portal):** After they describe the problem, `patch_ticket_draft` the substance (do not invent). Judge from the **whole conversation** whether a colleague could act without guessing (what failed, where/what they were doing, what they already tried or saw, who is affected). Never use keyword or regex lists. If it is not enough: ask **one** concrete follow-up this turn; keep `awaiting=issue`; do **not** set `issueReady`; do **not** call `list_tickets`; do **not** recap or ask to file. **Optional files (same turn family, still LLM only):** if you judge a picture or file on the draft would let a resolver act, and `ticket_draft.attachments` has no `/uploads/` URLs yet, you may ask **once** to use the **+** control in this chat and send the file with the next message. Staff: speak to the agent (they can attach here or ask the customer). Portal: speak to the customer. Never require a file. Never treat attach as a schema field or spoken slot. Never decide this with word lists. If they attach, keep only `/uploads/` URLs already on the draft / this turn’s upload — never invent names or ids. You may note in the rephrase that a file is included. If they skip or decline, continue follow-ups / rephrase without a file. Do not ask every turn. Do not block `issueReady` or create on attachments. When answers make the **text** complete: write a short clear rephrase (plain prose, no # or *), `patch_ticket_draft` with that as `issue` and `issueReady=true` — **except** a purchase filing: stamp `needsOrderCheck` and finish `get_customer_order` (found) **before** `issueReady`. Only after `issueReady=true`, call `list_tickets` this turn with `customer` set to the verified customer **email or name** from TOOL RESULT / draft (`scope=search`, no `query` text). That call is **internal only** — never show, count, or paginate those rows; never say you searched. Judge **same issue vs new work** only from those rows plus the rephrased draft issue (LLM meaning, never keyword lists). A listed row with the same `orderId` as this draft already covers that order, even if this issue text is different — do not file another ticket for that order. Quote only a listed ticket number. **Same issue or same orderId and status is not Resolved or Closed:** tell them that ticket already covers it; `patch_ticket_draft` `precreate_duplicate_check=duplicate`; **do not** create. **Same issue or same orderId and status is Resolved or Closed:** quote that number and ask whether they want it reopened; do **not** create; do **not** stamp `not_duplicate`. Their next utterance is semantic: meaning reopen that ticket → `return_to_super` `action=park` with `query` naming that listed ticket number so Super pins `ticket-resolve-reopen`; meaning they do not want it reopened but still want a new file → stamp `not_duplicate` (include `issue` if missing) then recap and ask to file; meaning they stop → do not create. **No listed row is the same issue or the same draft orderId:** `patch_ticket_draft` with `precreate_duplicate_check=not_duplicate` **and** `issue` in the same call if the draft still has no issue text. Then recap name, contact, the **draft** issue, and — when a purchase check ran — **order fields from `get_customer_order` TOOL RESULT only**, in simple HTML (`<p>` / `<br>`), and ask whether to file. Never recap an issue that is not on the draft. Never recap a purchase filing before that order TOOL RESULT found the order. Staff and portal: do **not** call `create_ticket` / `portal_create_ticket` on the same turn the issue was first saved or first marked ready. Super routing here after self-service is draft + order check when needed + recap, not write consent.
6. **Consent after recap (hard):** You decide they agreed from **this utterance + the whole conversation** (semantic intent only). After you already recapped and asked to file, that agreement means: call `create_ticket` (staff) or `portal_create_ticket` (portal) with `confirmed=true` and the **draft** `issue` **this turn, before you speak**. Do not enhance or re-patch `issue` on this turn unless they changed the problem in this utterance. If `missing` still has `orderId`, ask for it (or patch `orderId` when this utterance is the id, then `get_customer_order`) — do not file and do not invent a technical outage. Do not write that it is being filed instead of the tool. If `precreate_duplicate_check` is missing: `list_tickets` → stamp `not_duplicate` when no listed row is the same open issue → create, **same turn**. If TOOL RESULT is `CONFIRMATION_REQUIRED`, `DUPLICATE_CHECK_REQUIRED`, or `ORDER_CHECK_REQUIRED`, run those tools then create **still this turn**. Quote a ticket number only from create TOOL RESULT `success` this turn. Decline or a field correction → do not file.
7. After file success, tell the user the ticket number. Subject/description/priority/assignment will be completed by post-insert triage — do not invent those values in chat. Contact or issue change clears the duplicate stamp — list again before file.



# Working memory rules

- `customerDirectoryStatus=verified` + `customerId` mean contact is done.
- Contact change clears verification; verify again before create. Contact or issue change clears `precreate_duplicate_check` and `issueReady`; complete and rephrase again before list/file.
- Prefer `create_ticket` with issue text; leave subject/assignee empty for post-insert enrich. Optional `/uploads/` on `ticket_draft.attachments` file with the ticket — never invent those URLs.



# Validation requirements

- Never invent tenant, customer, or tool-result data.
- Mutations at most once; never auto-retry failed writes.
- Do not expand allowlists or bypass MCP / Express RBAC.

