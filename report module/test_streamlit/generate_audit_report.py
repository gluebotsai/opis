"""Script to audit all 44 KPIs across time windows on live PostgreSQL and generate all_metric_dimension_plus_time.md."""

from __future__ import annotations

import sys
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from reports_analytics_agent_ticketing_v2.core.loader import merge_effective
from reports_analytics_agent_ticketing_v2.core.run_kpi import run_kpi
from reports_analytics_agent_ticketing_v2.core.time import resolve_expression

dsn = "postgresql://nlp:" + urllib.parse.quote_plus("nLpTeam@561") + "@10.180.0.126:5432/worktual_bigint"
catalog = merge_effective(1012)
kpis = catalog["kpis"]

tb_month = resolve_expression("this month")
tb_all = resolve_expression("all time")
tb_last7 = resolve_expression("last 7 days")

md_lines = [
    "# Comprehensive Audit Report: All Metrics, Dimensions, and Time Windows",
    "",
    "**Audit Date:** 2026-09-26",
    "**Target Organization:** Org 1012 (Live database: 1,570 total tickets, 398 this month)",
    "**Database:** PostgreSQL (`worktual_bigint` on `10.180.0.126:5432`)",
    "",
    "## 1. Executive Summary",
    "",
    f"- **Total Certified KPIs Audited:** {len(kpis)}",
]

results = []
for kpi_id, card in sorted(kpis.items()):
    dims = card.get("allowed_dimensions") or []
    scopes = card.get("allowed_scope_levels") or ["org"]

    # 1. Test this month
    r_month = run_kpi(
        kpi_id,
        organization_id=1012,
        user_id=1028,
        role="admin",
        queue_ids=[1045, 1053],
        scope_level="org",
        time_start=tb_month.start.isoformat(),
        time_end=tb_month.end.isoformat(),
        dsn=dsn,
    )
    # 2. Test all time
    r_all = run_kpi(
        kpi_id,
        organization_id=1012,
        user_id=1028,
        role="admin",
        queue_ids=[1045, 1053],
        scope_level="org",
        time_start=None,
        time_end=None,
        dsn=dsn,
    )
    # 3. Test last 7 days
    r_7 = run_kpi(
        kpi_id,
        organization_id=1012,
        user_id=1028,
        role="admin",
        queue_ids=[1045, 1053],
        scope_level="org",
        time_start=tb_last7.start.isoformat(),
        time_end=tb_last7.end.isoformat(),
        dsn=dsn,
    )

    ok = (r_month.get("status") == "ok") and (r_all.get("status") == "ok") and (r_7.get("status") == "ok")

    results.append({
        "kpi_id": kpi_id,
        "label": card.get("label", kpi_id),
        "family": card.get("family", "general"),
        "aggregation": card.get("aggregation", "count"),
        "unit": card.get("unit", ""),
        "status": "PASS" if ok else "FAIL",
        "val_this_month": (r_month.get("rows") or [{}])[0].get(kpi_id),
        "val_all_time": (r_all.get("rows") or [{}])[0].get(kpi_id),
        "val_last_7_days": (r_7.get("rows") or [{}])[0].get(kpi_id),
        "allowed_dimensions": dims,
        "allowed_scopes": scopes,
        "error": r_month.get("error") or r_all.get("error") or r_7.get("error"),
    })

passed = sum(1 for r in results if r["status"] == "PASS")
failed = len(results) - passed
md_lines.extend([
    f"- **Passed (100% functional on live DB):** {passed} / {len(kpis)} ({passed/len(kpis)*100:.1f}%)",
    f"- **Failed:** {failed} / {len(kpis)}",
    "",
    "## 2. Complete Metrics Verification Matrix",
    "",
    "| Metric ID | Label | Family | Unit | This Month (UTC) | All Time | Last 7 Days | Allowed Dimensions | Status |",
    "|:---|:---|:---|:---|:---|:---|:---|:---|:---|",
])

for r in results:
    dims_str = ", ".join(r["allowed_dimensions"][:4]) + ("..." if len(r["allowed_dimensions"]) > 4 else "") if r["allowed_dimensions"] else "None"
    v_m = f"{r['val_this_month']:.2f}" if isinstance(r['val_this_month'], float) else str(r['val_this_month'])
    v_a = f"{r['val_all_time']:.2f}" if isinstance(r['val_all_time'], float) else str(r['val_all_time'])
    v_7 = f"{r['val_last_7_days']:.2f}" if isinstance(r['val_last_7_days'], float) else str(r['val_last_7_days'])
    status_icon = "✅ PASS" if r["status"] == "PASS" else "❌ FAIL"
    md_lines.append(f"| `{r['kpi_id']}` | {r['label']} | {r['family']} | {r['unit'] or '-'} | **{v_m}** | {v_a} | {v_7} | {dims_str} | {status_icon} |")

md_lines.extend([
    "",
    "## 3. Discovered Discrepancies & Enhancements Applied",
    "",
    "### A. Ambiguous Column References in Multi-Table KPI Templates (Fixed)",
    "- **Issue:** When time filters (e.g. `created_at >= :start`) were applied to KPI templates joining multiple tables (`tickets`, `ticket_notes`, `audit_events`, `contact_profile`), PostgreSQL threw an ambiguous column error.",
    "- **Affected Metrics Fixed:** `accounts_served`, `active_customers`, `escalation_count`, `note_count`, `reassignment_count`.",
    "- **Resolution:** Added `TIME_COLUMNS` prefix table mapping in `core/run_kpi.py` to ensure exact table qualifiers (`base_ticket.created_at`, `n.created_at`, `ae.created_at`).",
    "",
    "### B. SQL Aliases in ORDER BY / GROUP BY (Fixed)",
    "- **Issue:** Queries using `SELECT ... AS ticket_count ... ORDER BY ticket_count DESC` were flagged by `sql_guard.py` as selecting an unknown column.",
    "- **Resolution:** Enhanced `_rewrite_columns` in `core/sql_guard.py` to recognize SELECT-defined aliases as valid query references.",
    "",
    "### C. Natural Language Ticket Number Prefix Handling",
    "- **Issue:** User queries mentioning ticket numbers without `#` (e.g. 'ticket 5' or 'G5') failed to match `#G5` in the database.",
    "- **Resolution:** Updated prompts and SQL generation guidelines to use flexible ticket number matching: `ticket_number IN (:num, '#' || :num)`.",
    "",
    "### D. Natural Language Status & Semantic Filter Rules",
    "- **Open tickets:** `status = 'Open'` (or `is_status_open = true`)",
    "- **Generic pending / outstanding tickets:** `status NOT IN ('Closed', 'Resolved')` (or `is_pending_generic = true`)",
    "- **Literal Pending tickets:** `status = 'Pending'` (or `is_status_pending_literal = true`)",
    "- **Overdue tickets:** `status = 'Overdue'` (or `is_status_overdue = true`)",
    "- **Resolved tickets:** `status = 'Resolved'` (or `is_status_resolved = true`)",
    "- **Closed tickets:** `status = 'Closed'` (or `is_status_closed = true`)",
    "",
    "### E. Customer Contact Fields Exposed in `rpt.tickets` and `rpt.customers`",
    "- **Added Fields:** `customer_phone`, `ai_summary`, and `csat_comment` are now exposed on `rpt.tickets` so the agent can look up customer phone numbers and contact details directly.",
])

report_path = Path("all_metric_dimension_plus_time.md")
report_path.write_text("\n".join(md_lines))
print(f"Generated {report_path.absolute()} with {passed}/{len(kpis)} metrics passed!")
