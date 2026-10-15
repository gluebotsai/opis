---
name: customer-read-360
description: Perform the customer read 360 capability within the Ticketing product. Use when the registered task requires this operation.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "customer_directory_crud_executor"
  task-ids: "customer.read.360"
  schema-ref: "customer.read.360"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: ask_sql_layer list_customers get_customer_360 list_tickets
---

# Purpose

Perform `customer-read-360` as a reusable declarative capability owned by `customer_directory_crud_executor`. Rows and tickets they raised come only from tools. Never patch or write customer fields. User-facing text is a short human intro — never say 360, CDP, or directory.

# When to use

Activate only for a validated registered task whose Domain and Executor match the metadata above. Natural-language selection is semantic and LLM-driven; structured task and event IDs may pin this Skill deterministically.

# Supported operations

Use only the tools declared in `allowed-tools`, further narrowed by the Executor manifest, MCP discovery, token claims, role, channel, module, surface, approval policy, and Express RBAC.

# Required information

Use the registered TaskDefinition and MCP JSON Schemas. Ask naturally for only schema-missing information and preserve collected values and provenance in TaskState.

# Procedure

1. Validate the active task, Skill version, actor context, and dependency state.
2. Collect or resolve only missing inputs without inventing business data.
3. Select the minimum authorized tool sequence needed for the task.
4. Obtain and validate approval evidence when policy requires it.
5. Execute business operations through MCP to Express and consume the structured result.
6. **Search / list (staff):** call `ask_sql_layer` first (`instruction` = one English sentence, `entityHint` `wt:Customer`, optional `limit`). Successful TOOL RESULT is the page — including empty rows. Call `list_customers` this turn only when SQL fails (`success` false, transport, timeout, 5xx). Never invent directory rows. More of the same listing: repeat the tool that succeeded. One person / 360 → `list_customers` then `get_customer_360` as below.
7. **List reply:** one short intro only — runtime renders the directory HTML table from this turn’s list TOOL RESULT (`ask_sql_layer`, or `list_customers` only after SQL failed). Do not write markdown/HTML tables yourself. Empty list → say no data exists for that name. Never narrate searching or fetching.
8. **Single match → 360 offer:** when the list tool result has exactly **one row**, use the email from that row only. You may ask whether to open the 360 ticket-history view. Do not describe ticket history until step 9 succeeds. Runtime stores that email in `customer_360_candidate` for the consent turn.
9. **360 consent (hard):** when the user agrees to a 360 / history / ticket-details view, **`get_customer_360` must run before your reply** with the email from **`list_customers` TOOL RESULT** (never a guessed address). Runtime may prefetch this call when consent is pending — still quote only the tool JSON in your intro.
10. **360 reply:** one short intro only — runtime renders the ticket HTML table from `get_customer_360` JSON. Quote only fields present in the tool payload (`totalTickets`, `avgCsat`, `tickets`). Never claim you loaded history without `success: true`. Empty tickets → say no data exists for this customer. Never say you looked, searched, or found no matches in the system.
11. **Multiple matches:** do not call `get_customer_360` until the user identifies which customer; resolve email via another `list_customers` or explicit disambiguation, then call `get_customer_360`.
12. On tool failure, explain the structured error from the tool result — never claim you loaded history without `success: true`.
13. Return a grounded natural response or typed refusal without exposing internal tool names.

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
