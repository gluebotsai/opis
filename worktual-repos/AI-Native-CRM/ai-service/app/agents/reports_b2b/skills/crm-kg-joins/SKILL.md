---
name: crm-kg-joins
description: Verified CRM graph join patterns, multi-node traversal, currency, product lines, reps.
metadata:
  version: "1.0.0"
  executors: "kg_analytics_executor"
  status: "active"
---

# When to use

Dynamic Cypher that walks deals, quotes, contracts, invoices, accounts, activities, or reps.

# Joins

- Deal → Quote: `(d:Deal)-[:HAS]->(q:Quote)`
- Quote → LineItem: `(q:Quote)-[:HAS]->(li:LineItem)`
- LineItem → Product: `OPTIONAL MATCH (p:Product) WHERE p.id = li.product_id` (no `(li)-[:HAS]->(p)`)
- Deal → Account: `OPTIONAL MATCH (a:Account {id: d.company_id})` (no `[:HAS_ACCOUNT]`)
- Invoice → Account: `OPTIONAL MATCH (a:Account {id: i.company_id})`
- Invoice → Deal: `WHERE i.deal_id = d.id` or `(i:Invoice)-[:FROM_DEAL]->(d:Deal)`
- Contract → Deal: `OPTIONAL MATCH (d:Deal {id: c.deal_id})` or `(c:Contract)-[:FROM_DEAL]->(d:Deal)`
- Contract → Account: `OPTIONAL MATCH (a:Account {id: c.company_id})`
- Contract → Deal → Invoice:
  `MATCH (c:Contract) OPTIONAL MATCH (d:Deal {id: c.deal_id}) OPTIONAL MATCH (i:Invoice {deal_id: c.deal_id}) OPTIONAL MATCH (a:Account {id: c.company_id})`
- Contact → Activity: `OPTIONAL MATCH (c:Contact {cdp_id: ca.contact_id})` or `OPTIONAL MATCH (sp:SalesProfile {id: ca.contact_id})`
- Activity touchpoints by sub-label: `MATCH (ca:ContactActivity) RETURN coalesce([l IN labels(ca) WHERE l <> 'ContactActivity' AND l <> 'Sales'][0], 'GeneralActivity') AS activity_type, count(ca) AS count`
- Deal owner: `OPTIONAL MATCH (d:Deal) WHERE d.owner_user_id = u.id` with `(u:User)` (`id`, `first_name`, `last_name`, `work_email`)
- Match names with `toLower(u.first_name) CONTAINS ... OR toLower(u.last_name) CONTAINS ...`. Never hardcode user ids.

# Currency

- Deal commercial currency comes from the approved quote.
- If currency is omitted, fallback from `Tenant.country` (India → INR, US → USD, UK → GBP). Honor explicit quote currency.
- Never mix currencies in one sum. `GROUP BY` currency. Report the code/symbol from the data.

# Templates vs Dynamic Cypher

- Standard named jobs: `deal_root_cause_loss`, `deal_forecast_risk_and_stall`, `sales_rep_deal_breakdown`, `pipeline_by_owner`, `customer_account_commercial_summary`, `deal_commercial_path_walk`, `contact_timeline_and_bant`.
- Custom multi-node diagnostic queries (contracts, invoices, activities, custom traversals): write dynamic Cypher matching the registered schema.

