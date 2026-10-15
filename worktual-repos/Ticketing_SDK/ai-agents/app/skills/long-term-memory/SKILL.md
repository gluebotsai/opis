---
name: long-term-memory
description: Store and search tenant/user-scoped long-term memory facts across sessions.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "org_settings_integrations_executor"
  task-ids: "memory.long_term.manage"
  schema-ref: "memory.long_term.manage"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: store_long_term_memory search_long_term_memory
---

# Purpose

Persist and retrieve durable cross-session facts for the actor without dumping full history into the prompt.

# When to use

Use when the user asks to remember a durable fact across sessions, or when relevant prior facts should be retrieved for the current ask.

# Procedure

1. Store only durable facts/outcomes worth keeping via `store_long_term_memory`.
2. Retrieve with `search_long_term_memory` using a focused query; keep results bounded.
3. Never invent memories; only store authenticated actor statements/outcomes.
