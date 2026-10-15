---
name: user-preferences
description: Read and update the actor preference scratchpad and verify hard preferences before risky actions.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS with the ticketing MCP server
metadata:
  version: "1.0.0"
  domain: "catalog_administration_domain"
  executors: "org_settings_integrations_executor"
  task-ids: "user.preferences.manage"
  schema-ref: "user.preferences.manage"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: get_user_preferences update_user_preference verify_hard_preferences
---

# Purpose

Manage the actor's soft/hard preference scratchpad and verify hard constraints against proposed actions.

# When to use

Use when the user asks to remember preference, change tone/format preferences, set hard bans (channels/tools), or when verifying a proposed action against hard preferences.

# Procedure

1. Call `get_user_preferences` before changing unknown prefs.
2. Use `update_user_preference` with kind=soft|hard for a single key.
3. Soft prefs personalize replies; hard prefs are enforced by `verify_hard_preferences` and mutation gates.
4. Never invent preference values; only persist what the user stated.
