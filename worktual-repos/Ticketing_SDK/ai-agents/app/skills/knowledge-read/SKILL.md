---
name: knowledge-read
description: Perform the knowledge read capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "kb_quality_crud_executor"
  task-ids: "knowledge.read"
  schema-ref: "knowledge.read"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: list_kb get_kb list_kb_categories
---

# Purpose

Perform `knowledge-read` as a reusable declarative capability owned by `kb_quality_crud_executor`.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data.
3. Select the minimum authorized tool sequence needed for the task. Article lists are pages of 10 from `list_kb` (`limit=10`). A new list uses `offset=0`. More of that same list uses the live cursor offset (`nextOffset`). Quote `totalRows` for how many exist, and only the titles in this turn's page. Do not repeat the previous page.
4. Obtain and validate approval evidence when policy requires it.
5. Execute business operations through MCP to Express and consume the structured result.
6. Return a grounded natural response or typed refusal without exposing internal tool names.

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
