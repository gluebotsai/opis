---
name: knowledge-article-create
description: Perform the knowledge article create capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "kb_quality_crud_executor"
  task-ids: "knowledge.article.create"
  schema-ref: "create_kb"
  approval-policy: "interactive_semantic"
  dependencies: ""
  local-controls: "patch_kb_draft,navigate"
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_kb_categories create_kb_article draft_kb_article
---

# Purpose

Perform `knowledge-article-create` as a reusable declarative capability owned by `kb_quality_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect **one schema field per turn**, same as ticket-create. Order is title → category → body → `publication_intent`. Create-start utterances are not the article title. Patch only the value they stated this turn. Never copy the title into category and never invent body. After each successful patch, reply as a colleague: acknowledge what they just gave, a brief why the next piece matters, then one natural ask — never “X is set” / “category set to” / a form label. A correction of a collected field is meaning of the whole utterance against this live draft — not keyword lists. Without a replacement, patch `awaiting` only. The next utterance is the replacement; if this utterance already includes it, patch that field and keep sibling values. Never store `null` or the instruction sentence. Do not restart create collect while this in-memory `kb_draft` is live.
3. **Category (hard):** Two turns. If they have not given a category yet, call `list_kb_categories` and list each TOOL RESULT name in an HTML `<ul><li>` (never markdown `#` or `*`). If empty, say none exist yet. Never write a comma list or invent Other. Ask them to pick a line or type a new short name. If this utterance **is** the category (listed name or a new short name they typed), `patch_kb_draft` that `category` this turn — do not call `list_kb_categories` again.
4. Use `patch_kb_draft.publication_intent` only after title, category, and body are in the draft TOOL RESULT. Never patch `publication_intent` while `awaiting` is title, category, or body. When those three are complete and disposition is unset, recap the three stored values in a short colleague paragraph and ask whether to keep it for the team only or publish so customers can read it, with a brief why. Never say `publication_intent` or other schema/tool names in the reply. Do not default either action and do not call a write tool yet. Do not claim the article is saved or “all set.” Do not claim body was added unless this turn's `patch_kb_draft` TOOL RESULT includes `body`.
5. The user's semantic answer to that draft-or-publish choice is approval: `patch_kb_draft` with `publication_intent` and immediately call `draft_kb_article` or `create_kb_article` with `confirmed=true` in that turn. If a collect field is still missing, collect it first, then call the matching write as soon as title, category, body, and disposition are all on the draft. Never claim a save from the patch result. If they only agree without choosing, ask the two options again in fresh words. Never `return_to_super` for that answer. If TOOL RESULT is `CONFIRMATION_REQUIRED`, retry the same write with `confirmed=true` this turn. Reply after a successful write from TOOL RESULT in the same warm voice.
6. Call `draft_kb_article` only for `publication_intent=draft`, or `create_kb_article` only for `publication_intent=publish`. These tools create a new row; never use `publish_kb_article` while the article exists only in the working draft and has no grounded article id.
7. Obtain and validate approval evidence when policy requires it.
8. Execute business operations through MCP to Express and consume the structured result.
9. After a successful write, reply only from that TOOL RESULT (title + status). Do not ask for title, category, or body again.

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
