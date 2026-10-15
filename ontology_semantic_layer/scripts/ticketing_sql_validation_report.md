# Ticketing SQL Agent — Validation Report

**Date:** 2026-03-19 (post enum/column parity fix)  
**Target org:** 1000 (admin user `1005` = `ticketing.agents.id`)

---

## Executive summary

| Layer | Result | Notes |
|-------|--------|-------|
| Static (templates + presets + enum audit) | **PASS** | 96/96 KPI templates, 0 mart refs, LOWER() gate clean |
| Offline unit tests | **PASS** | 13 standalone |
| Direct DB — sql_agent KPI vs MF | **96/96 PASS** | 0 drift, 0 sql_error, 0 mart_leak |

**Bottom line:** Mart-free sql_agent KPI path is fully parity-aligned with MetricFlow on org 1000 after Title Case enum fixes and column map corrections.

---

## Fixes applied this round

1. **Mart LOWER() enums** (dbt + live views patched)
   - `mart_customers.is_active`: `lower(status) = 'active'` (DB stores `Active`)
   - `mart_kb_articles.is_published`: `lower(kb_article_status) = 'published'` (DB stores `Published`)
   - `mart_agent_queues.is_at_risk`: `lower(sla_status) = 'at_risk'`
   - `mart_tickets` pending/closed/due flags: `lower(status) = 'resolved'`

2. **sql_agent operational enrichment** ([`sql_agent/ticketing_sql/enriched.py`](sql_agent/ticketing_sql/enriched.py))
   - KB: `COALESCE(views, 0)::bigint AS view_count` (was hardcoded 0)
   - Macros: `created_by_name` (was invalid `name`)
   - Notifications: `COALESCE(is_read, false)` (was hardcoded false)
   - Combined CTE wrap: `WITH enriched AS (...), enriched_audit AS (...)` for dual-table metrics

3. **Catalog** ([`ticketing_operational.yaml`](sql_agent/catalog/sources/ticketing_operational.yaml))
   - Added `views`, `is_read`, `title`/`created_by_name` on macros

4. **Regression gate:** [`scripts/audit_ticketing_enum_casing.py`](scripts/audit_ticketing_enum_casing.py)

---

## Phase 3 — Direct DB: 96 KPI templates

**Script:** `scripts/validate_ticketing_sql_all_metrics.py`  
**Duration:** ~389s

| Bucket | Before | After |
|--------|-------:|------:|
| pass | 89 | **96** |
| mf_drift | 4 | **0** |
| sql_error | 3 | **0** |
| mart_leak | 0 | **0** |

Previously failing metrics now PASS:

| Metric | SQL | MF |
|--------|-----|-----|
| `active_customers_metric` | 34 | 34 |
| `kb_published_article_metric` | 28 | 28 |
| `kb_views_total` | 63 | 63 |
| `unread_notifications_metric` | 905 | 905 |
| `macro_volume` | 12 | 12 |
| `average_notes_per_ticket` | 0.451 | 0.451 |
| `escalation_rate` | 0.035 | 0.035 |

---

## Remaining known gaps (out of this fix)

- API `/v1/sql/query` Gemma planner internal errors (list/KPI via Super) — separate from template parity
- Ontology lists 95 metric IDs vs 96 templates (`high_priority_open_tickets_metric` extra)

---

## Reproduce

```bash
conda activate myenv
export ORG=1000 PYTHONPATH=.

python3 scripts/audit_ticketing_enum_casing.py
python3 scripts/validate_ticketing_kpi_templates.py
python3 scripts/regenerate_ticketing_kpi_templates.py
python3 scripts/validate_ticketing_sql_all_metrics.py
python3 scripts/test_ticketing_sql_standalone.py
```
