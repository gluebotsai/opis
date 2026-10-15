---
name: intake-self-service-deflection
description: Perform the intake self service deflection capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "intake_deflection_domain"
  executors: "ai_resolution_executor"
  task-ids: "intake.self.service.deflection"
  schema-ref: "intake.self.service.deflection"
  approval-policy: "proactive_asga"
  dependencies: "knowledge-search@1.0.0"
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: search_kb
---

# Purpose

Perform `intake-self-service-deflection` as a reusable declarative capability owned by `ai_resolution_executor`.

# When to use

Activate for how-to / self-service / account help / password-reset style asks where the user wants guidance or KB deflection **before** (or instead of) filing a ticket. Domain must choose this Skill (or `knowledge-search`) on `ai_resolution_executor`, not `ticket-create`.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. **Portal — their tickets / status:** If they want the status or list of tickets they already created (not a new problem to solve, not file), call `return_to_super` with `action=park` and `query` set to their message. Do not `search_kb`. Do not say they have none. Do not offer to file. Super pins `ticket-read-search` for `portal_list_tickets`.
3. Call `search_kb` this turn with the user's problem wording. The TOOL RESULT is one Meilisearch article (or empty). Quote only that hit — title, symptoms, steps, text. Never load the published catalog.
4. When a hit exists, walk them through those `steps` in simple HTML (`<p>`, `<ol>`/`<ul><li>`, `<strong>`, `<br>`) — a couple first, then ask if they want the next or if it worked. Use `pending_kb` steps/text in Context the same way; do not invent UI. Do not call `get_kb` just to write the chat reply. Phrase freshly; do not paste the article wholesale.
5. If TOOL RESULT has no related article, or they say the walk did not help: acknowledge that and **ask whether they want a ticket filed**. Stay on this Skill. Call `return_to_super` with `action=park` and `query` = their utterance only after they asked or agreed to file (meaning, never a word list) so Domain can pin `ticket-create` (that Skill collects order id when the filing is a purchase — this Skill does not). Do not park to create on the unsolved-walk turn. Do not recap a ticket. Do not claim a ticket exists.
6. Never invent product UI steps that are not supported by tool results. Do not recap a ticket while related articles still have unused steps.
7. Return a grounded natural response or typed refusal without exposing internal tool names.

# Validation requirements

- This Skill may narrow but never expand tool permissions.
- Tenant, actor, role, and authorization claims come only from trusted runtime context.
- Mutations execute at most once and are never automatically retried.
- Do not claim success unless the structured tool result reports success.
- Unsupported operations must return a typed capability refusal.

# Dependencies

knowledge-search@1.0.0

# Expected output

Return `executor-result-v1`: ask for a field, call an authorized tool, await confirmation, respond, request an allowed handoff, cancel, or refuse.
