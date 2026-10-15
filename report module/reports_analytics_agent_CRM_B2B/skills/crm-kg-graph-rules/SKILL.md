---
name: crm-kg-graph-rules
description: Labels, stages, tenant isolation, dynamic traversal rules for CRM Cypher.
metadata:
  version: "1.0.0"
  executors: "kg_analytics_executor"
  status: "active"
---

# When to use

Writing Cypher queries or choosing certified templates for graph analysis.

# Rules

- Read-only `MATCH ... RETURN`. No writes (no CREATE, MERGE, SET, DELETE).
- ALL registered CRM/Sales entities are fully queryable: `Deal`, `Quote`, `Proposal`, `Invoice`, `Contract`, `Account`, `Contact`, `SalesProfile`, `Product`, `LineItem`, `QuoteLine`, `InvoiceLine`, `Task`, `Meeting`, `ContactActivity`, `EmailActivity`, `MeetingActivity`, `TaskActivity`, `Session`, `ActivityHistory`, `User`, `SalesRep`.
- Ground responses in verified properties (`lost_reason`, `forecast_reason`, `amount`, `stage`, `status`, `approval_status`, `due_at`, `created_at`).
- Deal stages: `qualification`, `discover`, `propose`, `negotiate`, `closed_won`, `closed_lost`.
- Active pipeline deals: `toLower(d.stage) IN ['qualification', 'discover', 'propose', 'negotiate']`.
- Neo4j is org-isolated (`org1003`). NEVER write `organization_id` in Cypher queries.
- `Product` is a shared master entity and does not have a `:Sales` label. Join products via `WHERE p.id = li.product_id`.
- Dynamic Cypher traversal across multi-node relationships (e.g. `(c:Contract)` -> `(d:Deal)` -> `(i:Invoice)`) is encouraged to diagnose why things happen or what state exists.
- If data is sparse or unpopulated in Neo4j, query the existing nodes and relationships anyway; empirical results (including nulls or 0 counts) allow the system to explain the factual state and any data gaps.
- Domain graph jobs on leads, activities, quotes, invoices, owners, and deals **must run**. Empty or $0 rows are valid answers.
- Return `unsupported_request` ONLY when the schema has no input (quota targets, stage transition history, won_reason, email open/click events, campaign spend) or the ask is outside CRM (passwords, CCaaS recordings).
- Period/day questions on `created_at` / `closed_at` / `due_at` are supported (`date(d.created_at)`). Do not refuse date queries.
- Activity touchpoint queries (e.g. comparing email vs meeting vs task activities) are supported by querying `(ca:ContactActivity:Sales)` and grouping by activity sub-label.

