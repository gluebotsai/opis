---
name: analytics-graph-path
description: Graph paths, queue staffing, note authors, and why-breakdowns on the ticketing knowledge graph using run_cypher.
license: Proprietary
compatibility: Ticketing Three-Layer Harness MAS
metadata:
  version: "2.0.0"
  domain: "reports_analytics_domain"
  executors: "kg_analytics_executor"
  task-ids: "analytics.graph.path"
  schema-ref: "analytics.graph.path"
  approval-policy: "none"
  dependencies: ""
  local-controls: ""
  output-contract: "executor-result-v2"
  status: "active"
allowed-tools: run_cypher return_to_domain
---

# Purpose

Run Cypher queries on the ticketing knowledge graph via `kg_analytics_executor` calling `run_cypher`.

# When to use

The Domain task executor is `kg` (relationships, staffing including org-wide MEMBER_OF, neighborhoods, why breakdowns).

# Procedure

1. Write a read-only Cypher query conforming to `product/kg/schema_registry.json` and call `run_cypher`.
2. Ensure structural org isolation (do not include `organization_id` property filters).
3. One repair if rejected by `cypher_guard`.
4. Return facts assembled from graph rows.
