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
allowed-tools: list_kb get_kb list_tickets
---

# Purpose

Perform `intake-self-service-deflection` as a reusable declarative capability owned by `ai_resolution_executor`.

# When to use

Activate for how-to / self-service / account help / password-reset style asks where the user wants guidance or KB deflection **before** (or instead of) filing a ticket. Domain must choose this Skill (or `knowledge-search`) on `ai_resolution_executor`, not `ticket-create`.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Search published knowledge with `list_kb` / `get_kb` using the user's problem wording; ground the reply in returned articles.
3. If articles help, give concise steps from the KB. If none apply, say so and offer to file a ticket — on clear consent to file, `return_to_super` with `action=park` and query asking to create a ticket for this issue (Domain will select `ticket-create`).
4. Never invent product UI steps that are not supported by tool results.
5. Return a grounded natural response or typed refusal without exposing internal tool names.

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
