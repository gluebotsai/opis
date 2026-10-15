---
name: analytics-graph-path
description: Graph paths, neighbors, and why-breakdowns on the ticketing knowledge graph. Not for certified SQL KPIs.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "1.0.0"
  domain: "reports_analytics_domain"
  executors: "kg_analytics_executor"
  task-ids: "analytics.graph.path"
  schema-ref: "analytics.graph.path"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v1"
  status: "active"
allowed-tools: execute_graph return_to_domain
---

# Purpose

Run Domain frames whose executor is kg for product **ticketing**. Python compiles Cypher from product/kg templates. The model does not write Cypher.

# When to use

The Domain step executor is kg. Measures come from the graph index (ticket_neighborhood, why_breakdown, assignment_path, staffing_path, note_path, customer_path).

# Procedure

1. Keep the Domain JSON frame. Do not rebuild the question from scratch.
2. Call `execute_graph` with that frame.
3. If the job is invalid, repair the frame once (measure, group_by, path, limit from the graph index), then call `execute_graph` again.
4. Return the rows plus the echo (scope, UTC window, status reading).

# Validation requirements

- Do not emit Cypher in the model output.
- Tenant and role come only from trusted runtime identity.
- Product is ticketing. Do not add hops off Contact or into other products.
- Do not use this skill for certified KPI numbers that have SQL templates.
