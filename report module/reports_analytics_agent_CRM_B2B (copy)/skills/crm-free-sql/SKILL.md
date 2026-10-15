---
name: crm-free-sql
description: List, find, or COUNT when Domain left kpi null.
metadata:
  version: "1.0.0"
  executors: "sql_analytics_executor"
  allowed-tools: "run_sql"
  status: "active"
---

# When to use

`task.kpi` is null. One SELECT/WITH on the view for the goal’s object.

# Procedure

- Infer the view from the **object meaning** in the goal, then the column list.
- **List / find / show / fetch rows** → columns a person would read, `LIMIT` (default 50). Not `COUNT(*)`.
- **Names** (deal title, company, owner, contact, quote number, invoice number, subject): always `ILIKE '%token%' ESCAPE '\'`. Never `title = 'expansion'` or other exact string match. Copy the user’s words inside the `%…%`. Stage, status, and type stay exact (`is_open`, `stage = 'closed_won'`).
- **How many** on that object with no catalog KPI → `COUNT(*)` on that view.
- Object map: deals → `rpt.deals`; leads/contacts → `rpt.contacts`; quotes → `rpt.quotes`; invoices → `rpt.invoices`; companies → `rpt.companies`; tasks → `rpt.activities` with `type = 'task'`.
- Never query deals for “leads.” `unassigned_leads` only when the goal says unassigned.
- If `time_params` has start and end, filter with `:start` and `:end`. Overall → no date filter. `time_status` unresolved → do not run all-time SQL.
- Sums of money: `GROUP BY currency_code` when mixing currencies.

# Examples

Find open deals named expansion:

```sql
SELECT id, title, stage, amount, currency_code, company_name, owner_name
FROM rpt.deals
WHERE is_open = TRUE
  AND title ILIKE '%expansion%' ESCAPE '\'
ORDER BY created_at DESC
LIMIT 50;
```

Fetch the Orange account:

```sql
SELECT id, name, industry, domain, owner_name
FROM rpt.companies
WHERE name ILIKE '%Orange%' ESCAPE '\'
   OR domain ILIKE '%Orange%' ESCAPE '\'
LIMIT 50;
```

List contacts named Sri:

```sql
SELECT id, full_name, company_name, lead_status, owner_name, created_at
FROM rpt.contacts
WHERE full_name ILIKE '%Sri%' ESCAPE '\'
ORDER BY created_at DESC
LIMIT 50;
```
