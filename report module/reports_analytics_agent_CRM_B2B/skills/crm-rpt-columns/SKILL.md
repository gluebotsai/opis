---
name: crm-rpt-columns
description: rpt.* columns for free SQL. Not needed for run_kpi.
metadata:
  version: "1.0.0"
  executors: "sql_analytics_executor"
  status: "active"
---

# When to use

Writing `run_sql`. Do not invent columns.

`rpt.deals`: id, title, stage, amount, currency_code, weighted_amount, stage_weight, company_id, company_name, company_industry, owner_user_id, owner_name, closed_at, close_ts, created_at, expected_close_date, lost_reason, is_open, is_won, is_lost, aging_days, forecast_category, forecast_reason, forecast_flagged

`rpt.deal_facts`: deal_id, title, stage, amount, currency_code, company_name, owner_name, aging_days, total_activities, days_since_last_touch, quote_count

`rpt.companies`: id, name, industry, owner_name, domain, channel_role

`rpt.contacts`: id, full_name, company_name, owner_user_id, owner_name, lead_source, lead_status, contact_type, created_at, is_active. A CRM **lead** is `contact_type = 'lead'` (not prospect/contact/customer).

`rpt.products`: id, name, sku, billing_type, is_active, created_at

`rpt.quote_lines`: id, quote_id, product_id, product_name, quantity, unit_price, amount, created_at

`rpt.invoice_lines`: id, invoice_id, kind, product_id, addon_id, name, quantity, unit_price, tax_percent, amount, created_at

`rpt.invoices`: invoice_number, company_name, status, total, currency_code, due_at, is_overdue, deal_id, owner_name, created_at

`rpt.quotes`: quote_number, deal_id, deal_title, status, currency_code, total, discount_pct, owner_name, created_at

`rpt.contracts`: title, company_id, arr, status, starts_at, ends_at

`rpt.activities`: type, subject, task_status, due_at, assignee_user_id, owner_name, created_at

`rpt.users`: name, work_email, role_name

`rpt.agent_jobs`: job_type, status, created_at

Open: `is_open`. Won: `is_won`. Lost: `is_lost`. High probability: `is_open` and `stage_weight >= 0.75`. Aging: `aging_days`. Quote statuses: draft, sent, accepted, rejected, void.
