---
name: crm-rpt-columns
description: rpt.* columns for free SQL. Not needed for run_kpi.
metadata:
  version: "1.0.0"
  executors: "sql_analytics_executor"
  status: "active"
---

# When to use

Writing `run_sql`. Do not invent columns. Match the view to the object’s meaning first.

`rpt.deals` (sales opportunities / pipeline deals): id, title, stage, amount, currency_code, weighted_amount, stage_weight, company_id, company_name, company_industry, owner_user_id, owner_name, closed_at, close_ts, created_at, expected_close_date, lost_reason, is_open, is_won, is_lost, aging_days, forecast_category, forecast_reason, forecast_flagged

`rpt.deal_facts` (deal plus activity/quote counts): deal_id, title, stage, amount, currency_code, company_name, owner_name, aging_days, total_activities, days_since_last_touch, quote_count

`rpt.companies` (accounts): id, name, industry, owner_name, domain, channel_role

`rpt.contacts` (leads and people — never deals): id, full_name, company_name, owner_user_id, owner_name, lead_source, lead_status, created_at

`rpt.quotes` (quote documents on deals): quote_number, deal_title, status, currency_code, total, discount_pct, owner_name, created_at

`rpt.invoices` (bills / AR): invoice_number, company_name, status, total, currency_code, due_at, is_overdue

`rpt.contracts` (agreements / ARR): title, company_id, arr, status, starts_at, ends_at

`rpt.activities` (touches: email, meeting, task, note, call): type, subject, task_status, due_at, assignee_user_id, owner_name, created_at

`rpt.users`: name, work_email, role_name

`rpt.agent_jobs`: job_type, status, created_at

Open: `is_open`. Won: `is_won`. Lost: `is_lost`. High probability: `is_open` and `stage_weight >= 0.75`. Aging: `aging_days`. Quote statuses: draft, sent, accepted, rejected, void.
