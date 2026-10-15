---
name: crm-kg-jobs
description: Map Domain graph jobs to certified Cypher templates or dynamic multi-node Cypher traversal.
metadata:
  version: "1.0.0"
  executors: "kg_analytics_executor"
  status: "active"
---

# When to use

Domain `executor: kg` or graph analytical queries. Honor the user goal by leveraging certified templates or dynamic Cypher across all registered schema entities.

# Certified Template Mappings
- Lost / why deals dropped / deal loss analysis → `deal_root_cause_loss`
- Stall / forecast risk / deals slipping → `deal_forecast_risk_and_stall`
- Commercial chain walk for a deal → `deal_commercial_path_walk`
- Account / company 360 profile → `customer_account_commercial_summary`
- Contact qualification / BANT timeline → `contact_timeline_and_bant`
- Rep deals / pipeline allocation / rep workload comparison → `sales_rep_deal_breakdown` or `pipeline_by_owner`. A named rep matches that owner only. Leave out deals whose owner is null. Do not call those rows Unassigned.

# Dynamic Cypher Traversals (Registered Schema Nodes)
If Domain sent `executor: kg`, execute. Prefer a template when the goal matches; otherwise write dynamic Cypher. Do not return `unsupported_request` because the ask looks like a warehouse count.
- Unassigned / no-owner leads → `(c:Contact)` where owner is null; return source, status, company, BANT
- Activity mix / why more email → `(ca:ContactActivity)` grouped by sub-label
- Quotes not accepted → `(q:Quote)` with deal links and status
- Invoices outstanding / all draft → `(i:Invoice)` status, due, deal
- Contract to invoice → `(c:Contract)`, `(d:Deal)`, `(i:Invoice)`, `(a:Account)`
- Pipeline $0 / missing price → Deal to Quote to LineItem
- If rows are empty or amounts are 0, still query and return what exists

