---
name: analytics-status-snapshot
description: Live conversation counts by the stored status column. One status value. No date filter for now.
license: Proprietary
compatibility: Contact Center Three-Layer Harness MAS
metadata:
  version: "2.1.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.status.snapshot"
  schema-ref: "analytics.status.snapshot"
  approval-policy: "none"
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_sql return_to_domain
---

# Purpose

Answer “how many are queued / active / bot_active / assigned / resolved / closed right now” from `status` as stored.

# When to use

`answer_type` is `snapshot` (or Domain set `skill` to this pack).

# Procedure

1. `run_sql` on `rpt.conversation_facts`.
2. Filter exactly one value: `status = 'queued'` or `'bot_active'` or `'assigned'` or `'active'` or `'resolved'` or `'closed'`.
3. Do not use `is_active` as a four-status bucket. `is_active` is `status = 'active'` only.
4. Do not add `created_at >= :start`. Snapshot has no date window.
5. Unresolved/outstanding: `is_resolved_or_closed = false` (resolved + closed together is allowed here only).

# Validation requirements

- Never `status IN ('bot_active', 'queued', 'assigned', 'active')`.
- Never `status IN ('assigned', 'active')`.
