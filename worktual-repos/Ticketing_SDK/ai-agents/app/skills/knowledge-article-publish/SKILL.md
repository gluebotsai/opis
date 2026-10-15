---
name: knowledge-article-publish
description: Perform the knowledge article publish capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "kb_quality_crud_executor"
  task-ids: "knowledge.article.publish"
  schema-ref: "knowledge.article.publish"
  approval-policy: "interactive_high_risk"
  dependencies: ""
  local-controls: "navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_kb get_kb publish_kb_article
---

# Purpose

Perform `knowledge-article-publish` as a reusable declarative capability owned by `kb_quality_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Resolve the existing article from trusted focus/`last_entity` when it contains an article id (Express `KB-…` external id or numeric). Otherwise call `list_kb` with the user's semantic title query and `status=Draft`; zero or multiple matches require a natural clarification using only returned rows.
3. Call `get_kb` for the resolved id before the write. If its TOOL RESULT is already Published, report that grounded state and do not write. Only a Draft row may proceed.
4. Summarize the resolved title and ask once for confirmation that it should become customer-visible. If the user's current utterance already clearly requests that mutation, carry its semantic approval evidence into the write rather than asking twice.
5. Call `publish_kb_article` only with the grounded id from focus/list/get/prior draft write TOOL RESULT and validated approval evidence. Never invent an id and never treat the article title as the id.
6. Consume the structured result, then return a grounded natural response or typed refusal without exposing internal tool names.
7. This Skill publishes an existing persisted draft. A new article still held in `kb_draft` with no grounded id belongs to `knowledge-article-create`, which chooses `draft_kb_article` or `create_kb_article`.

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
