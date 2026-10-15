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

- **List / find / show / fetch rows** → columns a person would read, `LIMIT` (default 50). Not `COUNT(*)`.
- A lead or contact list selects `full_name`, `company_name`, `lead_status`, `lead_source`, `owner_name`, `created_at`. Do not select `region` or `country` unless the goal asks for a place.
- `term` `latest` → `ORDER BY created_at DESC` and `LIMIT` the task `limit` (10 when they did not name a number). Do not use that cap on a count.
- `term` `recent` with time `last 1 hour` → filter `created_at` to that hour. Do not widen an empty hour.
- **Names** (deal title, company, owner, contact, quote number, invoice number, subject): always `ILIKE '%token%' ESCAPE '\'`. Never `title = 'expansion'` or other exact string match. Copy the user’s words inside the `%…%`. Stage, status, and type stay exact (`is_open`, `stage = 'closed_won'`).
- A named rep’s count or list filters `owner_name ILIKE '%Name%' ESCAPE '\'` and `owner_name IS NOT NULL AND btrim(owner_name) <> ''`. Do not return rows with a blank owner, and do not label them Unassigned.
- **How many** on that object with no catalog KPI → `COUNT(*)` on that view.
- Object map: deals → `rpt.deals`; leads/contacts → `rpt.contacts`; quotes → `rpt.quotes`; invoices → `rpt.invoices`; companies → `rpt.companies`; tasks → `rpt.activities` with `type = 'task'`.
- Never query deals for “leads.” A lead list or count uses `lower(coalesce(contact_type, '')) = 'lead'`. A contact, prospect, or customer list uses that type and is not the lead filter. `unassigned_leads` only when the goal says unassigned.
- A named region or country uses `lower(btrim(region)) = lower(value)` or the same for `country`, with the value already on the task. Do not use a contains match. Grouping by region or country uses `lower(btrim(...))` so `chennai` and `Chennai` are one row. Empty region is `Unassigned`.
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
SELECT id, full_name, company_name, lead_status, lead_source, owner_name, created_at
FROM rpt.contacts
WHERE full_name ILIKE '%Sri%' ESCAPE '\'
ORDER BY created_at DESC
LIMIT 50;
```

Latest leads:

```sql
SELECT full_name, company_name, lead_status, lead_source, owner_name, created_at
FROM rpt.contacts
WHERE lower(coalesce(contact_type, '')) = 'lead'
ORDER BY created_at DESC
LIMIT 10;
```
