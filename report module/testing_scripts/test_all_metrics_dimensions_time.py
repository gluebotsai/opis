"""Comprehensive Automated Verification Suite for All Metrics, Dimensions, and Time Windows.

Validates 100% of certified KPIs across:
  1. Ticketing (reports_analytics_agent_ticketing_v2) - 44 certified KPIs
  2. Contact Center (reports_analytics_agent_contact_center) - 60 certified KPIs

Strict Constraint:
  - ONLY SELECT / read-only commands are permitted. Every query is verified before execution.
  - Safe in-memory thread-local connections for high-performance non-blocking parallel execution.

Time Windows Tested:
  - today
  - this week
  - last 7 days
  - last 30 days
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import os
import re
import sys
import threading
import time
from decimal import Decimal
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor
import yaml
from dotenv import load_dotenv

# Path setup
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

# Load environment
for env_path in [
    ROOT / ".env",
    ROOT / "reports_analytics_agent_ticketing_v2" / ".env",
    ROOT / "reports_analytics_agent_contact_center" / ".env",
    Path("/home/vectone/shiva/reportagent/.env"),
]:
    if env_path.exists():
        load_dotenv(env_path)

DSN = os.getenv(
    "PG_DSN",
    "postgresql://nlp:nLpTeam%40561@10.180.0.126:5432/worktual_bigint",
)

# -----------------------------------------------------------------------------
# STRICT SELECT-ONLY GUARD & THREAD-LOCAL CONNECTION POOLING
# -----------------------------------------------------------------------------
_THREAD_LOCAL = threading.local()

FORBIDDEN_SQL_PATTERNS = [
    r"\bINSERT\s+INTO\b",
    r"\bUPDATE\s+\w+\s+SET\b",
    r"\bDELETE\s+FROM\b",
    r"\bDROP\s+(?:TABLE|VIEW|SCHEMA|DATABASE|INDEX)\b",
    r"\bALTER\s+(?:TABLE|VIEW|SCHEMA|DATABASE)\b",
    r"\bCREATE\s+(?:TABLE|VIEW|SCHEMA|DATABASE|INDEX)\b",
    r"\bTRUNCATE\b",
    r"\bGRANT\b",
    r"\bREVOKE\b",
]


def assert_select_only(sql: str) -> None:
    """Strictly assert that the query is a read-only SELECT or WITH statement."""
    clean = sql.strip().lstrip("(").strip().upper()
    if not (clean.startswith("SELECT") or clean.startswith("WITH")):
        raise ValueError(f"Prohibited non-SELECT query detected: {sql[:60]}")
    for pattern in FORBIDDEN_SQL_PATTERNS:
        if re.search(pattern, clean, re.IGNORECASE):
            raise ValueError(f"Prohibited command in SQL query ({pattern}): {sql[:80]}")


def open_kpi_snapshot(dsn: str) -> psycopg2.extensions.connection:
    """One read-only REPEATABLE READ transaction per KPI so grouped sums match the baseline."""
    conn = psycopg2.connect(dsn)
    conn.set_session(
        readonly=True,
        autocommit=False,
        isolation_level=psycopg2.extensions.ISOLATION_LEVEL_REPEATABLE_READ,
    )
    with conn.cursor() as cur:
        cur.execute("BEGIN")
        cur.execute("SET TRANSACTION READ ONLY")
    return conn


def close_kpi_snapshot(conn: psycopg2.extensions.connection | None) -> None:
    if conn is None:
        return
    try:
        conn.rollback()
    except Exception:
        pass
    try:
        conn.close()
    except Exception:
        pass


def safe_thread_local_fetchall(
    dsn: str, sql: str, params: tuple[Any, ...] = (), *, timeout_ms: int = 15000
) -> list[dict[str, Any]]:
    """Strictly SELECT-only runner against the current KPI snapshot connection."""
    assert_select_only(sql)
    conn = getattr(_THREAD_LOCAL, "snapshot_conn", None)
    if conn is None or conn.closed != 0:
        raise RuntimeError("No read-only snapshot connection is active for this KPI.")
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SAVEPOINT audit_q")
        try:
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
            if params:
                cur.execute(sql, params)
            else:
                cur.execute(sql)
            rows = cur.fetchall()
            cur.execute("RELEASE SAVEPOINT audit_q")
        except Exception:
            cur.execute("ROLLBACK TO SAVEPOINT audit_q")
            raise
    return [dict(r) for r in rows]


def install_audit_hooks() -> None:
    """In-memory hooks to enforce safe SELECT-only thread-local fetchall across both domains."""
    import reports_analytics_agent_ticketing_v2.core.db as t_db
    t_db.fetchall = safe_thread_local_fetchall
    import reports_analytics_agent_contact_center.sql_executor.core.db as cc_db
    cc_db.fetchall = safe_thread_local_fetchall


from reports_analytics_agent_contact_center.sql_executor.core.run_kpi import run_kpi as cc_run_kpi
from reports_analytics_agent_contact_center.core.time import resolve_expression as cc_resolve_expression
from reports_analytics_agent_ticketing_v2.core.run_kpi import run_kpi as t_run_kpi
from reports_analytics_agent_ticketing_v2.core.time import resolve_expression as t_resolve_expression

TIME_WINDOWS = ["today", "this week", "last 7 days", "last 30 days"]
DEFAULT_ORG_ID = 1012

VALUE_COLUMN_ALIASES: dict[str, str] = {
    "new_vs_returning_rate": "new_contact_rate",
    "disposition_distribution": "disposition_count",
    "bot_intent_distribution": "turn_count",
    "presence_reason_breakdown": "total_duration_seconds",
    "resolution_code_distribution": "conversation_count",
}

# Additive count metrics where SUM(dimension_breakdown) == baseline_total
ADDITIVE_COUNT_METRICS = {
    "ticket_count",
    "conversation_count",
    "call_count",
    "message_count",
    "bot_turn_count",
    "copilot_usage_count",
    "reopen_count",
    "escalation_count",
    "transfer_count",
    "missed_contact_count",
    "first_response_at_risk_count",
    "resolution_at_risk_count",
    "no_sla_count",
}


def get_dimension_sql(domain: str, kpi_id: str, dim: str, template_text: str) -> tuple[str, str] | None:
    """Map dimension name to dimension_select and group_by_sql expressions."""
    # Only templates with an outer GROUP BY need ', <col>' instead of 'GROUP BY <col>'
    has_existing_group_by = kpi_id in {
        "bot_intent_distribution",
        "disposition_distribution",
        "presence_reason_breakdown",
        "resolution_code_distribution",
    }

    if domain == "contact_center":
        if kpi_id in {"call_count", "avg_handle_time_voice", "avg_hold_time"}:
            col_map = {
                "queue": "COALESCE(q.name, 'Unassigned Queue')",
                "agent": "c.agent_ext",
                "agent_ext": "c.agent_ext",
                "is_inbound": "c.is_inbound",
                "day": "DATE_TRUNC('day', c.created_at)::date",
                "week": "DATE_TRUNC('week', c.created_at)::date",
                "month": "DATE_TRUNC('month', c.created_at)::date",
            }
        elif kpi_id in {"bot_turn_count", "bot_intent_distribution", "bot_grounded_rate", "bot_intent_confidence_avg", "bot_response_latency_avg"}:
            col_map = {
                "intent": "t.intent",
                "skill_key": "t.skill_key",
                "handoff_reason": "t.handoff_reason",
                "day": "DATE_TRUNC('day', t.created_at)::date",
                "channel": "t.selected_queue_key",
                "queue": "t.selected_queue_key",
            }
        elif kpi_id in {"copilot_usage_count", "copilot_acceptance_rate", "copilot_latency_avg"}:
            col_map = {
                "turn_type": "ct.turn_type",
                "skill_key": "ct.skill_key",
                "day": "DATE_TRUNC('day', ct.created_at)::date",
                "agent": "ct.session_id",
            }
        elif kpi_id == "copilot_tool_success_rate":
            col_map = {
                "turn_type": "e.skill_key",
                "skill_key": "e.skill_key",
                "day": "DATE_TRUNC('day', e.created_at)::date",
                "agent": "COALESCE(e.agent_name, 'Unassigned')",
            }
        elif kpi_id in {"presence_reason_breakdown", "agent_occupancy", "login_hours"}:
            col_map = {
                "state": "reason_code",
                "reason": "reason_code",
                "reason_code": "reason_code",
                "agent": "agent_id",
            }
        elif kpi_id == "transfer_count":
            col_map = {
                "from_queue": "ct.from_queue_id",
                "to_queue": "ct.to_queue_id",
                "state": "ct.state",
                "outcome_reason": "ct.outcome_reason",
            }
        elif kpi_id in {"missed_contact_count", "missed_contact_rate"}:
            col_map = {
                "queue": "m.queue_id",
                "agent": "m.agent_id",
                "reason": "m.reason",
                "channel": "m.channel",
            }
        elif kpi_id == "message_count":
            col_map = {
                "channel": "c.channel",
                "direction": "m.direction",
                "sender_type": "m.sender_type",
            }
        elif kpi_id == "avg_messages_per_conversation":
            col_map = {
                "channel": "c.channel",
                "queue": "COALESCE(q.name, 'Unassigned Queue')",
                "agent": "COALESCE(a.display_name, 'Unassigned')",
            }
        elif kpi_id == "callback_completion_rate":
            col_map = {
                "agent": "COALESCE(u.first_name || ' ' || u.last_name, 'Unassigned')",
                "channel": "t.channel",
            }
        elif kpi_id == "escalation_count":
            col_map = {
                "queue": "COALESCE(q.name, 'Unassigned Queue')",
                "agent": "COALESCE(u.first_name || ' ' || u.last_name, 'Unassigned')",
                "status": "t.status",
            }
        elif kpi_id in {"avg_offer_ring_time", "offer_accept_rate", "offer_timeout_rate"}:
            col_map = {
                "queue": "COALESCE(q.name, 'Unassigned Queue')",
                "agent": "COALESCE(a.display_name, 'Unassigned')",
            }
        elif kpi_id in {"routing_attempt_success_rate", "overflow_rate"}:
            col_map = {
                "queue": "COALESCE(q.name, 'Unassigned Queue')",
            }
        elif kpi_id == "concurrency_utilization":
            col_map = {
                "agent": "COALESCE(a.display_name, 'Unassigned')",
                "channel": "ac.channel",
            }
        elif kpi_id in {"negative_sentiment_rate", "sentiment_trend"}:
            col_map = {
                "queue": "COALESCE(q.name, 'Unassigned Queue')",
                "agent": "COALESCE(a.display_name, 'Unassigned')",
                "channel": "c.channel",
                "customer_label": "st.customer_label",
                "day": "DATE_TRUNC('day', st.created_at)::date",
                "week": "DATE_TRUNC('week', st.created_at)::date",
                "month": "DATE_TRUNC('month', st.created_at)::date",
            }
        else:
            col_map = {
                "channel": "channel",
                "queue": "queue_name",
                "agent": "agent_name",
                "status": "status",
                "priority": "priority",
                "team": "team_name",
                "disposition_code": "disposition_code",
                "disposition_category": "disposition_category",
                "handoff_reason": "handoff_reason",
                "outcome_reason": "outcome_reason",
                "day": "DATE_TRUNC('day', created_at)::date",
                "week": "DATE_TRUNC('week', created_at)::date",
                "month": "DATE_TRUNC('month', created_at)::date",
                "hour_of_day": "EXTRACT(HOUR FROM created_at)::int",
                "day_of_week": "EXTRACT(DOW FROM created_at)::int",
            }
    else:
        col_map = {
            "status": "status",
            "priority": "priority",
            "channel": "channel",
            "category": "category",
            "queue": "queue_name",
            "agent": "assignee_name",
            "resolver": "resolver_name",
            "customer": "customer_name",
            "created_by": "created_by_name",
            "day": "DATE_TRUNC('day', created_at)::date",
            "week": "DATE_TRUNC('week', created_at)::date",
            "month": "DATE_TRUNC('month', created_at)::date",
        }

    if dim not in col_map:
        return None
    expr = col_map[dim]
    dim_select = f"{expr} AS {dim},"
    if has_existing_group_by:
        group_by = f", {expr}"
    else:
        group_by = f"GROUP BY {expr}"
    return dim_select, group_by


def extract_metric_val(row: dict[str, Any], kpi_id: str) -> float | int | None:
    """Extract the certified metric column; do not pick an id or dimension column."""
    if not row:
        return None
    preferred = VALUE_COLUMN_ALIASES.get(kpi_id, kpi_id)
    if preferred in row:
        v = row[preferred]
        if v is None:
            return None
        if isinstance(v, (int, float, Decimal)):
            return float(v)
    skip = {"id", "ticket_id", "conversation_id", "queue_id", "agent_id", "contact_id"}
    for k, v in row.items():
        if k in skip or k.endswith("_id"):
            continue
        if k == preferred or k.endswith("_count") or k.endswith("_rate") or k.startswith("avg_"):
            if isinstance(v, (int, float, Decimal)):
                return float(v)
    return None


def audit_single_kpi(
    dom: str,
    kpi_id: str,
    kpi_card: dict[str, Any],
    sql_dir: Path,
    run_kpi_fn: Any,
    resolve_expr_fn: Any,
    org_id: int,
    quick_dim_limit: int | None = None,
    user_id: int = 1,
    role: str = "admin",
    scope_level: str = "org",
    queue_ids: list[int] | None = None,
) -> dict[str, Any]:
    """Audit one KPI across the four time windows and all allowed dimensions."""
    kpi_entry = {
        "kpi_id": kpi_id,
        "domain": dom,
        "label": kpi_card.get("label", kpi_id),
        "family": kpi_card.get("family", "general"),
        "aggregation": kpi_card.get("aggregation", "count"),
        "allowed_dimensions": list(kpi_card.get("allowed_dimensions") or []),
        "baseline_by_window": {},
        "dimension_tests": [],
        "skipped_dimensions": [],
        "errors": [],
        "expected_denies": [],
        "role": role,
        "user_id": user_id,
        "scope_level": scope_level,
    }

    template_file = sql_dir / f"{kpi_id}.sql"
    template_text = template_file.read_text() if template_file.exists() else ""
    supports_dimensions = ("{{dimension_select}}" in template_text) or ("{{group_by_sql}}" in template_text)

    snapshot = open_kpi_snapshot(DSN)
    _THREAD_LOCAL.snapshot_conn = snapshot
    try:
        for win in TIME_WINDOWS:
            tb = resolve_expr_fn(win)
            s_iso = tb.start.isoformat() if tb.start else None
            e_iso = tb.end.isoformat() if tb.end else None

            try:
                res = run_kpi_fn(
                    kpi_id,
                    organization_id=org_id,
                    user_id=user_id,
                    role=role,
                    queue_ids=list(queue_ids or []),
                    scope_level=scope_level,
                    time_start=s_iso,
                    time_end=e_iso,
                    dsn=DSN,
                )
                if res.get("status") != "ok":
                    err_msg = res.get("error", "Unknown error")
                    err_type = res.get("error_type")
                    kpi_entry["baseline_by_window"][win] = {
                        "status": "error",
                        "error": err_msg,
                        "error_type": err_type,
                    }
                    if err_type == "DENY":
                        kpi_entry["expected_denies"].append(f"Baseline {win}: {err_msg}")
                    else:
                        kpi_entry["errors"].append(f"Baseline {win}: {err_msg}")
                else:
                    rows = res.get("rows") or []
                    val = extract_metric_val(rows[0] if rows else {}, kpi_id) if rows else 0.0
                    kpi_entry["baseline_by_window"][win] = {
                        "status": "ok",
                        "value": val,
                        "rows": len(rows),
                    }
            except Exception as exc:
                err_msg = str(exc)
                kpi_entry["baseline_by_window"][win] = {"status": "error", "error": err_msg}
                kpi_entry["errors"].append(f"Baseline {win}: {err_msg}")

        allowed_dims = list(kpi_card.get("allowed_dimensions") or [])
        dims_to_test = allowed_dims[:quick_dim_limit] if quick_dim_limit else allowed_dims
        if any(
            (kpi_entry["baseline_by_window"].get(w) or {}).get("error_type") == "DENY"
            for w in TIME_WINDOWS
        ):
            dims_to_test = []

        for dim in dims_to_test:
            if not supports_dimensions:
                kpi_entry["skipped_dimensions"].append({
                    "dimension": dim,
                    "reason": "template has no {{dimension_select}} / {{group_by_sql}} slots",
                })
                continue
            dim_sql = get_dimension_sql(dom, kpi_id, dim, template_text)
            if dim_sql is None:
                kpi_entry["skipped_dimensions"].append({
                    "dimension": dim,
                    "reason": "no SQL expression mapped for this dimension on this KPI",
                })
                continue

            dim_select, group_by = dim_sql
            slot_vals = {
                "dimension_select": dim_select,
                "group_by_sql": group_by,
            }

            for win in TIME_WINDOWS:
                tb = resolve_expr_fn(win)
                s_iso = tb.start.isoformat() if tb.start else None
                e_iso = tb.end.isoformat() if tb.end else None
                base_info = kpi_entry["baseline_by_window"].get(win, {})
                base_val = base_info.get("value")

                try:
                    res_dim = run_kpi_fn(
                        kpi_id,
                        organization_id=org_id,
                        user_id=user_id,
                        role=role,
                        queue_ids=list(queue_ids or []),
                        scope_level=scope_level,
                        time_start=s_iso,
                        time_end=e_iso,
                        slot_values=slot_vals,
                        dsn=DSN,
                    )
                    if res_dim.get("status") != "ok":
                        err_msg = res_dim.get("error", "Unknown error")
                        err_type = res_dim.get("error_type")
                        kpi_entry["dimension_tests"].append({
                            "dimension": dim,
                            "window": win,
                            "status": "error",
                            "error": err_msg,
                            "error_type": err_type,
                        })
                        if err_type == "DENY":
                            kpi_entry["expected_denies"].append(f"Dim '{dim}' {win}: {err_msg}")
                        else:
                            kpi_entry["errors"].append(f"Dim '{dim}' {win}: {err_msg}")
                    else:
                        dim_rows = res_dim.get("rows") or []
                        is_match = True
                        diff = 0.0

                        if kpi_id in ADDITIVE_COUNT_METRICS and base_val is not None:
                            dim_sum = sum(
                                extract_metric_val(r, kpi_id) or 0.0
                                for r in dim_rows
                            )
                            diff = abs(dim_sum - float(base_val))
                            if diff > 0.01:
                                is_match = False
                                kpi_entry["errors"].append(
                                    f"Dimension '{dim}' on {win} sum mismatch: grouped={dim_sum} vs baseline={base_val}"
                                )

                        kpi_entry["dimension_tests"].append({
                            "dimension": dim,
                            "window": win,
                            "status": "ok",
                            "row_count": len(dim_rows),
                            "matched_baseline": is_match,
                            "diff": diff,
                        })
                except Exception as exc:
                    err_msg = str(exc)
                    kpi_entry["dimension_tests"].append({
                        "dimension": dim,
                        "window": win,
                        "status": "error",
                        "error": err_msg,
                    })
                    kpi_entry["errors"].append(f"Dim '{dim}' {win}: {err_msg}")
    finally:
        _THREAD_LOCAL.snapshot_conn = None
        close_kpi_snapshot(snapshot)

    return kpi_entry


def run_full_audit(
    domain_filter: str | None = None,
    org_id: int = DEFAULT_ORG_ID,
    quick_dim_limit: int | None = None,
    workers: int = 6,
) -> dict[str, Any]:
    install_audit_hooks()
    print("=" * 80)
    print("AUDIT SUITE: ALL METRICS, ALL DIMENSIONS, 4 TIME WINDOWS")
    print(f"Target DB: {DSN.split('@')[-1]}")
    print(f"Organization ID (both products): {org_id}")
    print("SQL Constraint: SELECT / WITH only (enforced before execute)")
    print(f"Time Windows: {', '.join(TIME_WINDOWS)}")
    print(f"Parallel Worker Threads: {workers}")
    print("=" * 80)

    start_time = time.time()
    results = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "org_id": org_id,
        "summary": {
            "total_metrics": 0,
            "total_baseline_tests": 0,
            "total_dimension_tests": 0,
            "passed_tests": 0,
            "failed_tests": 0,
            "mismatched_tests": 0,
            "skipped_dimensions": 0,
        },
        "domains": {},
    }

    domains_to_run = []
    if domain_filter in (None, "ticketing"):
        domains_to_run.append("ticketing")
    if domain_filter in (None, "contact_center"):
        domains_to_run.append("contact_center")

    for dom in domains_to_run:
        dom_start = time.time()
        print(f"\n📂 AUDITING DOMAIN: {dom.upper()}")
        print("-" * 80)

        if dom == "ticketing":
            pack_root = ROOT / "reports_analytics_agent_ticketing_v2"
            run_kpi_fn = t_run_kpi
            resolve_expr_fn = t_resolve_expression
        else:
            pack_root = ROOT / "reports_analytics_agent_contact_center"
            run_kpi_fn = cc_run_kpi
            resolve_expr_fn = cc_resolve_expression

        kpis_doc = yaml.safe_load((pack_root / "product" / "kpis.yml").read_text()) or {}
        kpi_defs = kpis_doc.get("kpis", {})
        sql_dir = pack_root / "product" / "sql"

        results["domains"][dom] = {
            "total_kpis": len(kpi_defs),
            "kpi_results": {},
        }
        results["summary"]["total_metrics"] += len(kpi_defs)

        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_kpi = {
                executor.submit(
                    audit_single_kpi,
                    dom,
                    kpi_id,
                    kpi_card,
                    sql_dir,
                    run_kpi_fn,
                    resolve_expr_fn,
                    org_id,
                    quick_dim_limit,
                ): kpi_id
                for kpi_id, kpi_card in kpi_defs.items()
            }

            for future in concurrent.futures.as_completed(future_to_kpi):
                kpi_id = future_to_kpi[future]
                try:
                    kpi_entry = future.result()
                    results["domains"][dom]["kpi_results"][kpi_id] = kpi_entry

                    # Aggregate stats
                    b_count = len(kpi_entry["baseline_by_window"])
                    d_count = len(kpi_entry["dimension_tests"])
                    results["summary"]["total_baseline_tests"] += b_count
                    results["summary"]["total_dimension_tests"] += d_count

                    skip_count = len(kpi_entry.get("skipped_dimensions") or [])
                    results["summary"]["skipped_dimensions"] = (
                        results["summary"].get("skipped_dimensions", 0) + skip_count
                    )
                    err_count = len(kpi_entry["errors"])
                    mismatch_count = sum(
                        1 for dt in kpi_entry["dimension_tests"] if not dt.get("matched_baseline", True)
                    )
                    results["summary"]["failed_tests"] += err_count
                    results["summary"]["mismatched_tests"] += mismatch_count
                    results["summary"]["passed_tests"] += (b_count + d_count) - err_count

                    status_symbol = "✅" if err_count == 0 else "❌"
                    sample_today = kpi_entry["baseline_by_window"].get("today", {}).get("value", "-")
                    sample_30d = kpi_entry["baseline_by_window"].get("last 30 days", {}).get("value", "-")
                    dims_tested = len(set(dt["dimension"] for dt in kpi_entry["dimension_tests"]))
                    print(f"{status_symbol} [{dom[:2].upper()}] {kpi_id:32} | today: {str(sample_today):>6} | 30d: {str(sample_30d):>6} ({dims_tested} dims tested)")
                    if err_count > 0:
                        for err in kpi_entry["errors"][:2]:
                            print(f"   ⚠️  {err}")
                except Exception as exc:
                    print(f"❌ [{dom[:2].upper()}] {kpi_id:32} | Thread Execution Error: {exc}")
                    results["summary"]["failed_tests"] += 1

        print(f"Domain {dom} completed in {round(time.time() - dom_start, 2)}s")

    total_duration = round(time.time() - start_time, 2)
    results["duration_seconds"] = total_duration

    # Output Summary
    print("\n" + "=" * 80)
    print("📊 FULL AUDIT SUITE EXECUTION SUMMARY")
    print("=" * 80)
    print(f"Total Execution Time:       {total_duration}s")
    print(f"Total Certified Metrics:    {results['summary']['total_metrics']}")
    print(f"Baseline Window Tests:      {results['summary']['total_baseline_tests']}")
    print(f"Dimensional Grouping Tests: {results['summary']['total_dimension_tests']}")
    total_execs = results['summary']['total_baseline_tests'] + results['summary']['total_dimension_tests']
    print(f"Total Queries Executed:     {total_execs}")
    print(f"Passed & Verified:          {results['summary']['passed_tests']}")
    print(f"Failed / Errored:           {results['summary']['failed_tests']}")
    print(f"Mismatched Sums:            {results['summary']['mismatched_tests']}")
    print(f"Skipped YAML dimensions:    {results['summary'].get('skipped_dimensions', 0)}")
    pass_pct = (
        round(100.0 * results["summary"]["passed_tests"] / total_execs, 1)
        if total_execs > 0
        else 100.0
    )
    print(f"Overall Accuracy Rate:      {pass_pct}%")
    print("=" * 80)

    # Write Markdown Report
    report_path = ROOT / "ALL_METRICS_DIMENSIONS_TIME_AUDIT.md"
    write_markdown_report(report_path, results)
    findings_path = ROOT / "KPI_WAREHOUSE_TEST_REPORT.generated.md"
    write_findings_report(findings_path, results)
    print(f"\nMatrix report: {report_path.name}")
    print(f"Findings report: {findings_path.name}\n")

    return results


def write_markdown_report(path: Path, results: dict[str, Any]) -> None:
    lines = [
        "# Comprehensive Audit: All Metrics, Dimensions & Time Windows",
        "",
        "> [!IMPORTANT]",
        "> **Strict SELECT-Only Enforcement:** Every query executed in this audit suite was verified as a read-only `SELECT` / `WITH` statement. No mutations or DDL statements were executed.",
        "",
        f"- **Execution Timestamp:** `{results['timestamp']}`",
        f"- **Target Tenant:** Org `{results['org_id']}` on PostgreSQL `worktual_bigint`",
        f"- **Total Execution Time:** `{results['duration_seconds']}s`",
        f"- **Total Certified KPIs Audited:** `{results['summary']['total_metrics']}`",
        f"- **Baseline Window Tests:** `{results['summary']['total_baseline_tests']}`",
        f"- **Dimensional Grouping Tests:** `{results['summary']['total_dimension_tests']}`",
        f"- **Passed & Verified:** `{results['summary']['passed_tests']}`",
        f"- **Failures / Errors:** `{results['summary']['failed_tests']}`",
        f"- **Mismatched Sums:** `{results['summary']['mismatched_tests']}`",
        f"- **YAML dimensions not executed:** `{results['summary'].get('skipped_dimensions', 0)}`",
        "",
        "---",
        "",
        "## 1. Executive Summary Table",
        "",
        "| Domain | Total KPIs | Baseline Tests | Dimension Tests | Passed | Errors | Accuracy |",
        "|---|---|---|---|---|---|---|",
    ]

    for dom, data in results["domains"].items():
        kpis = data["kpi_results"]
        base_tests = sum(len(k["baseline_by_window"]) for k in kpis.values())
        dim_tests = sum(len(k["dimension_tests"]) for k in kpis.values())
        errs = sum(len(k["errors"]) for k in kpis.values())
        passed = (base_tests + dim_tests) - errs
        acc = round(100.0 * passed / (base_tests + dim_tests), 1) if (base_tests + dim_tests) > 0 else 100.0
        lines.append(f"| **{dom.replace('_', ' ').title()}** | {len(kpis)} | {base_tests} | {dim_tests} | {passed} | {errs} | **{acc}%** |")

    lines.extend([
        "",
        "---",
        "",
        "## 2. Contact Center Certified KPIs (org 1012)",
        "",
        "| KPI ID | Label | Today | This Week | Last 7d | Last 30d | Allowed Dimensions | Verification |",
        "|---|---|---|---|---|---|---|---|",
    ])

    cc_kpis = results["domains"].get("contact_center", {}).get("kpi_results", {})
    for kpi_id in sorted(cc_kpis.keys()):
        k = cc_kpis[kpi_id]
        t = k["baseline_by_window"].get("today", {}).get("value", "-")
        tw = k["baseline_by_window"].get("this week", {}).get("value", "-")
        l7 = k["baseline_by_window"].get("last 7 days", {}).get("value", "-")
        l30 = k["baseline_by_window"].get("last 30 days", {}).get("value", "-")
        dims = ", ".join(k["allowed_dimensions"]) or "None"
        status = "PASS" if len(k["errors"]) == 0 else f"{len(k['errors'])} errors"
        lines.append(f"| `{kpi_id}` | {k['label']} | {t} | {tw} | {l7} | {l30} | `{dims}` | {status} |")

    lines.extend([
        "",
        "---",
        "",
        "## 3. Ticketing Certified KPIs (org 1012)",
        "",
        "| KPI ID | Label | Today | This Week | Last 7d | Last 30d | Allowed Dimensions | Verification |",
        "|---|---|---|---|---|---|---|---|",
    ])

    t_kpis = results["domains"].get("ticketing", {}).get("kpi_results", {})
    for kpi_id in sorted(t_kpis.keys()):
        k = t_kpis[kpi_id]
        t = k["baseline_by_window"].get("today", {}).get("value", "-")
        tw = k["baseline_by_window"].get("this week", {}).get("value", "-")
        l7 = k["baseline_by_window"].get("last 7 days", {}).get("value", "-")
        l30 = k["baseline_by_window"].get("last 30 days", {}).get("value", "-")
        dims = ", ".join(k["allowed_dimensions"]) or "None"
        status = "PASS" if len(k["errors"]) == 0 else f"{len(k['errors'])} errors"
        lines.append(f"| `{kpi_id}` | {k['label']} | {t} | {tw} | {l7} | {l30} | `{dims}` | {status} |")

    lines.extend([
        "",
        "---",
        "",
        "## 4. Discrepancies & Findings",
        "",
    ])

    all_errs = []
    for dom, data in results["domains"].items():
        for kpi_id, k in data["kpi_results"].items():
            for e in k["errors"]:
                all_errs.append(f"- **[{dom}] `{kpi_id}`**: {e}")

    skipped = []
    for dom, data in results["domains"].items():
        for kpi_id, k in data["kpi_results"].items():
            for s in k.get("skipped_dimensions") or []:
                skipped.append(
                    f"- **[{dom}] `{kpi_id}`** dimension `{s['dimension']}`: {s['reason']}"
                )

    if all_errs:
        lines.extend(all_errs)
    else:
        lines.append("No SQL execution errors or additive sum mismatches on this run.")

    lines.extend(["", "### Dimensions listed in YAML but not executed", ""])
    if skipped:
        lines.extend(skipped)
    else:
        lines.append("Every YAML `allowed_dimensions` entry was executable on this run.")

    path.write_text("\n".join(lines))


def _classify_error(message: str) -> str:
    text = message.lower()
    if "sum mismatch" in text:
        return "additive_sum_mismatch"
    if "does not exist" in text or "undefinedcolumn" in text or "undefined column" in text:
        return "missing_or_ambiguous_column"
    if "ambiguous" in text:
        return "ambiguous_column"
    if "syntax error" in text:
        return "sql_syntax"
    if "timeout" in text or "canceling statement" in text:
        return "statement_timeout"
    if "permission" in text or "denied" in text:
        return "access_or_permission"
    if "relation" in text and "does not exist" in text:
        return "missing_relation"
    if "division by zero" in text:
        return "division_by_zero"
    return "other_sql_or_runtime"


def write_findings_report(path: Path, results: dict[str, Any]) -> None:
    """Qualitative report: what worked, what failed, why, and how to fix."""
    classified: dict[str, list[str]] = {}
    skipped_rows: list[str] = []
    empty_windows: list[str] = []
    kpis_with_errors: set[str] = set()
    kpis_clean: list[str] = []

    for dom, data in results["domains"].items():
        for kpi_id, k in data["kpi_results"].items():
            key = f"{dom}/{kpi_id}"
            if k["errors"]:
                kpis_with_errors.add(key)
                for e in k["errors"]:
                    classified.setdefault(_classify_error(e), []).append(f"**[{dom}] `{kpi_id}`**: {e}")
            else:
                kpis_clean.append(key)
            for s in k.get("skipped_dimensions") or []:
                skipped_rows.append(f"**[{dom}] `{kpi_id}`** `{s['dimension']}` — {s['reason']}")
            for win, info in (k.get("baseline_by_window") or {}).items():
                if info.get("status") == "ok" and info.get("value") in (0, 0.0, None):
                    empty_windows.append(f"{key} / {win} = {info.get('value')}")

    total_kpis = results["summary"]["total_metrics"]
    total_execs = results["summary"]["total_baseline_tests"] + results["summary"]["total_dimension_tests"]
    failed = results["summary"]["failed_tests"]
    mismatched = results["summary"]["mismatched_tests"]
    skipped_n = results["summary"].get("skipped_dimensions", 0)

    lines = [
        "# KPI warehouse test report",
        "",
        "This run executed certified KPI templates only. Every statement was checked to be `SELECT` or `WITH` before it hit Postgres. Neither product folder was modified.",
        "",
        "## Run setup",
        "",
        f"- **When:** `{results['timestamp']}`",
        f"- **Org (both products):** `{results['org_id']}`",
        f"- **Time windows:** {', '.join(TIME_WINDOWS)} (UTC, via each pack's `time.resolve_expression`)",
        "- **Scope:** `admin` + `org`",
        "- **Isolation:** one read-only `REPEATABLE READ` snapshot per KPI (baseline and all groupings share the same snapshot, then rollback)",
        f"- **Duration:** `{results['duration_seconds']}s`",
        "",
        "## Scoreboard",
        "",
        f"- Certified KPIs: **{total_kpis}**",
        f"- Queries executed: **{total_execs}**",
        f"- Passed: **{results['summary']['passed_tests']}**",
        f"- SQL / runtime errors: **{failed}**",
        f"- Additive sum mismatches: **{mismatched}**",
        f"- YAML dimensions not executed: **{skipped_n}**",
        f"- KPIs with zero errors: **{len(kpis_clean)}**",
        f"- KPIs with at least one error: **{len(kpis_with_errors)}**",
        "",
        "## What is good",
        "",
        "- Both catalogs (`product/kpis.yml` + `product/sql/*.sql`) were loaded and compiled through the existing `run_kpi` path, not ad-hoc SQL.",
        "- Read-only guard rejected anything that is not `SELECT` / `WITH`, and the snapshot connection is `READ ONLY`.",
        "- Time words are resolved in Python (UTC), not by the LLM.",
        "- Grouped additive counts are compared to the baseline on the **same snapshot**, so live inserts should not create false +1 / +2 mismatches.",
        f"- {len(kpis_clean)} KPIs returned a result for all four windows without SQL errors.",
        "",
    ]

    if kpis_clean:
        lines.append("KPIs with a clean SQL run:")
        lines.append("")
        for item in sorted(kpis_clean):
            lines.append(f"- `{item}`")
        lines.append("")

    lines.extend([
        "## What is not good",
        "",
    ])

    if failed == 0 and mismatched == 0 and skipped_n == 0:
        lines.append("No SQL failures, sum mismatches, or skipped YAML dimensions on this run.")
        lines.append("")
    else:
        if failed:
            lines.append(f"- **{failed}** query-level failures (compile, Postgres error, or timeout). Those KPIs cannot be trusted for the failing window/dimension until the template or mapping is fixed.")
        if mismatched:
            lines.append(f"- **{mismatched}** additive breakdowns did not sum to the ungrouped total. That means the GROUP BY column is splitting/duplicating rows, or the metric column extracted from grouped rows is the wrong field.")
        if skipped_n:
            lines.append(f"- **{skipped_n}** dimensions are advertised in YAML but were not executed. Either the SQL template has no grouping slots, or this suite has no column mapping for that KPI/dimension.")
        lines.append("")
        lines.append("A zero in a window is not automatically a defect. For org 1012 it often means no rows in that UTC window (especially Contact Center if that tenant has little or no `ccass.*` data).")
        lines.append("")

    lines.extend([
        "## Issues, why they happened, and how to fix",
        "",
    ])

    if not classified and not skipped_rows:
        lines.append("No issues were recorded.")
        lines.append("")
    else:
        titles = {
            "additive_sum_mismatch": "Grouped count does not match baseline",
            "missing_or_ambiguous_column": "Column missing or not visible in the template FROM clause",
            "ambiguous_column": "Ambiguous column in JOIN templates",
            "sql_syntax": "SQL syntax after slot fill",
            "statement_timeout": "Statement timeout",
            "access_or_permission": "Access / permission",
            "missing_relation": "Table or view missing",
            "division_by_zero": "Division by zero",
            "other_sql_or_runtime": "Other SQL / runtime errors",
        }
        fixes = {
            "additive_sum_mismatch": (
                "**Why:** The dimension expression is nullable, not 1:1 with the grain, or the extractor summed the wrong column. "
                "**Fix:** Qualify the GROUP BY to a non-null key at the KPI grain (for example `queue_id` rather than a joined name), "
                "and keep the metric alias identical in baseline and grouped SELECT lists."
            ),
            "missing_or_ambiguous_column": (
                "**Why:** `get_dimension_sql` (this suite) or the template SELECT list referenced a column that is not in that KPI's FROM/JOIN. "
                "Voice/bot/copilot templates use different aliases (`c`, `t`, `m`, `ct`) than conversation KPIs. "
                "**Fix:** Add a per-KPI column map in the template (or this suite) that matches the actual FROM aliases; do not reuse `queue_name` on every KPI."
            ),
            "ambiguous_column": (
                "**Why:** Time or scope filters use an unqualified `created_at` on a JOIN. "
                "**Fix:** Keep using `TIME_COLUMNS` in `run_kpi.py` (product code) so the date column is table-qualified. This suite does not change product files."
            ),
            "sql_syntax": (
                "**Why:** Slot fill produced invalid SQL (duplicate GROUP BY, trailing comma, or `GROUP BY` appended onto an existing GROUP BY incorrectly). "
                "**Fix:** Templates that already `GROUP BY` a distribution column must use the `, expr` group-by form; others must use `GROUP BY expr`."
            ),
            "statement_timeout": (
                "**Why:** Heavy templates (presence, occupancy, FCR) exceeded 15s. "
                "**Fix:** Add indexes on the time columns used in `TIME_COLUMNS`, or raise timeout only for those KPIs in the test runner."
            ),
            "access_or_permission": (
                "**Why:** Role/scope denied or DB role cannot read the relation. "
                "**Fix:** Confirm the audit user can `SELECT` the `ticketing.*` / `ccass.*` tables for org 1012."
            ),
            "missing_relation": (
                "**Why:** Template references a table not present on this warehouse. "
                "**Fix:** Align the template schema with the live database (or skip that KPI until the table exists)."
            ),
            "division_by_zero": (
                "**Why:** A rate divided without `NULLIF`. "
                "**Fix:** Wrap denominators in `NULLIF(..., 0)` in the certified SQL template."
            ),
            "other_sql_or_runtime": (
                "**Why:** Postgres or template-slot error not in the buckets above. Read the message. "
                "**Fix:** Reproduce the compiled SQL from `run_kpi` with `dsn` and adjust the template; do not bypass `run_kpi` with handwritten SQL."
            ),
        }

        for kind, items in classified.items():
            lines.append(f"### {titles.get(kind, kind)}")
            lines.append("")
            lines.append(fixes.get(kind, ""))
            lines.append("")
            for item in items[:40]:
                lines.append(f"- {item}")
            if len(items) > 40:
                lines.append(f"- … {len(items) - 40} more")
            lines.append("")

        if skipped_rows:
            lines.append("### YAML dimensions that were not executed")
            lines.append("")
            lines.append(
                "**Why:** Ticketing `note_count`, `escalation_count`, `reassignment_count`, and `kb_article_count` list dimensions in YAML but their `.sql` files have no `{{dimension_select}}` slots. "
                "Contact Center KPIs can list dimensions this suite does not map for that specific FROM clause. "
                "**Fix (in product SQL, not this suite):** add grouping slots to those templates, or remove the dimension from `allowed_dimensions` if grouping is not supported. "
                "For unmapped CC dimensions, add an explicit column expression in the test mapper that matches the template aliases."
            )
            lines.append("")
            for item in skipped_rows:
                lines.append(f"- {item}")
            lines.append("")

    lines.extend([
        "## How to re-run",
        "",
        "```bash",
        "python test_all_metrics_dimensions_time.py --org_id 1012",
        "```",
        "",
        "Optional: `--domain ticketing` or `--domain contact_center`. Output files: `ALL_METRICS_DIMENSIONS_TIME_AUDIT.md` (matrix) and this findings file.",
        "",
    ])
    path.write_text("\n".join(lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test all metrics, dimensions, and time windows.")
    parser.add_argument("--domain", choices=["ticketing", "contact_center"], default=None, help="Filter domain")
    parser.add_argument("--org_id", type=int, default=DEFAULT_ORG_ID, help="Target Organization ID for both products")
    parser.add_argument("--quick", type=int, default=None, help="Limit number of dimensions per KPI for quick smoke test")
    parser.add_argument("--workers", type=int, default=6, help="Number of concurrent worker threads")
    args = parser.parse_args()

    run_full_audit(
        domain_filter=args.domain,
        org_id=args.org_id,
        quick_dim_limit=args.quick,
        workers=args.workers,
    )
