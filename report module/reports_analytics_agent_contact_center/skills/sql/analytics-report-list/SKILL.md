---
name: analytics-report-list
description: List or find conversation, agent, or queue rows via run_sql on rpt.* views.
license: Proprietary
compatibility: Contact Center Three-Layer Harness MAS
metadata:
  version: "2.1.0"
  domain: "reports_analytics_domain"
  executors: "sql_analytics_executor"
  task-ids: "analytics.report.list"
  schema-ref: "analytics.report.list"
  approval-policy: "none"
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_sql return_to_domain
---

# Purpose

Row lists (not population counts).

# When to use

`task.kpi` is empty and `answer_type` is list.

# Procedure

1. One `SELECT` on `rpt.conversation_facts` (or the view named in the goal). `LIMIT 50`.
2. Last agent who attended: `assigned_agent_id IS NOT NULL`, order by `assigned_at` or `created_at` descending, `LIMIT 1`. Do not treat COALESCE Unassigned as an agent.
3. Ready/online agents: `rpt.presence` current state, not `rpt.agents` roster `is_active`.
4. Empty rows: zero matching records for that scope.
