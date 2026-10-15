#!/usr/bin/env python3
"""Validate all ticketing KPI templates via sql_agent (no marts) vs MF on Postgres.

Usage:
  ORG=1000 PYTHONPATH=. python3 scripts/validate_ticketing_sql_all_metrics.py
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ORG = int(os.environ.get("ORG", "1000"))
AGENT = os.environ.get("AGENT", "tk.reporting")
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
OUTPUT_JSON = ROOT / "scripts" / "ticketing_sql_all_metrics_report.json"
OUTPUT_MD = ROOT / "scripts" / "ticketing_sql_all_metrics_report.md"


@dataclass
class Row:
    metric: str
    status: str
    sql_value: float | None
    mf_value: float | None
    delta: float | None
    mart_leak: bool
    note: str = ""


def _close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if (a is None and b == 0) or (b is None and a == 0):
        return True
    if a is None or b is None:
        return False
    if math.isnan(a) and math.isnan(b):
        return True
    tol = max(DRIFT, abs(b) * 1e-6)
    if any(isinstance(x, float) and not math.isfinite(x) for x in (a, b)):
        return False
    return abs(a - b) <= tol


def _rate_close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return _close(a, b)
    return abs(float(a) - float(b)) <= max(0.01, DRIFT)


def _mf_value(metric_id: str, user_id: int) -> tuple[float | None, str]:
    from semantic.query import SemanticQuery, execute

    try:
        result = execute(
            SemanticQuery(
                organization_id=ORG,
                user_id=user_id,
                product="ticketing",
                agent=AGENT,
                metrics=[metric_id],
            )
        )
    except Exception as exc:
        return None, f"mf_error:{exc}"
    rows = result.get("rows") or []
    if not rows:
        return None, "mf_empty"
    val = rows[0].get(metric_id)
    if val is None:
        return None, "mf_null"
    return float(val), ""


def _sql_agent_value(metric_id: str, user_id: int, scope: Any) -> tuple[float | None, str, str]:
    from semantic.ticketing_scope import job_scope_fields
    from sql_agent.catalog_loader import get_table, resolve_channel_filter
    from sql_agent.compiled_catalog import load_compiled_catalog
    from sql_agent.job import ExecutorJob
    from sql_agent.kpi_template_registry import get_template
    from sql_agent.metric_fallback import execute_metric_fallback

    meta = get_template("ticketing", metric_id) or {}
    table = str(meta.get("table") or "tickets")
    tbl_meta = get_table("ticketing", table)
    scope_fields = job_scope_fields(scope, metric_id, product="ticketing")
    channels: list[str] = []
    entitled_channels, channel_column = resolve_channel_filter(
        "ticketing", table, channel_scoped=False, channels=channels
    )
    job = ExecutorJob(
        job_id="validate",
        mode="metric_fallback",
        product="ticketing",
        engine=str(load_compiled_catalog("ticketing").get("engine") or "postgres"),
        organization_id=ORG,
        user_id=user_id,
        table=table,
        schema=str(tbl_meta.get("schema") or "ticketing"),
        select=[],
        metric_id=metric_id,
        template_id=metric_id,
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        my_queue_ids=list(getattr(scope, "my_queue_ids", None) or []),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(
            meta.get("row_scope_column") or tbl_meta.get("row_scope_column") or ""
        )
        or None,
        entitled_channels=entitled_channels,
        channel_column=channel_column,
        time_column=meta.get("time_column"),
    )
    try:
        out = execute_metric_fallback(job)
    except Exception as exc:
        return None, "", f"sql_error:{exc}"
    sql = str(out.get("sql") or "")
    mart_leak = "ticketing_marts" in sql.lower() or " mart_" in f" {sql.lower()}"
    rows = out.get("rows") or []
    val = rows[0].get(metric_id) if rows else None
    if val is None and rows:
        val = next(iter(rows[0].values()), None)
    if val is None:
        return None, sql, "sql_null"
    return float(val), sql, ("mart_leak" if mart_leak else "")


def main() -> int:
    from scripts.ticketing_agent_fixtures import load_dotenv, resolve_ticketing_agent_id
    from semantic.scope import apply_ticketing_visible_ids, lookup_user_scope
    from sql_agent.kpi_template_registry import list_templates

    load_dotenv()
    user_id = resolve_ticketing_agent_id(ORG, role="admin")
    scope = lookup_user_scope(ORG, user_id, product="ticketing")
    apply_ticketing_visible_ids(scope)

    metrics = sorted(list_templates("ticketing").keys())
    rows: list[Row] = []
    t0 = time.monotonic()

    print(f"sql_agent 96-metric validation org={ORG} user={user_id} agent={AGENT}\n")

    for metric_id in metrics:
        sql_val, sql_text, sql_note = _sql_agent_value(metric_id, user_id, scope)
        mf_val, mf_note = _mf_value(metric_id, user_id)
        mart_leak = "mart_leak" in sql_note or (
            sql_text and ("ticketing_marts" in sql_text.lower())
        )

        if sql_note.startswith("sql_error"):
            status = "sql_error"
            note = sql_note
        elif mart_leak:
            status = "mart_leak"
            note = "SQL references marts"
        elif mf_note.startswith("mf_error"):
            status = "mf_skip" if sql_val is not None else "sql_only"
            note = mf_note
        elif sql_val is None and mf_val is None:
            status = "pass_null"
            note = "both null"
        elif sql_val is None or mf_val is None:
            is_rate = metric_id.endswith("_rate") or "hours" in metric_id or "csat" in metric_id
            ok = _rate_close(sql_val, mf_val) if is_rate else _close(sql_val, mf_val)
            status = "pass" if ok else "mf_drift"
            note = f"sql={sql_val} mf={mf_val}"
        else:
            is_rate = metric_id.endswith("_rate") or "hours" in metric_id or "csat" in metric_id
            ok = _rate_close(sql_val, mf_val) if is_rate else _close(sql_val, mf_val)
            status = "pass" if ok else "mf_drift"
            note = mf_note or sql_note

        delta = None
        if sql_val is not None and mf_val is not None:
            delta = float(sql_val) - float(mf_val)

        mark = {"pass": "PASS", "pass_null": "PASS", "mf_skip": "SKIP", "sql_only": "SQL"}.get(
            status, "FAIL"
        )
        print(
            f"  {mark:4}  {metric_id}: sql={sql_val} mf={mf_val}"
            + (f" ({note})" if status not in ("pass", "pass_null") else "")
        )
        rows.append(
            Row(
                metric=metric_id,
                status=status,
                sql_value=sql_val,
                mf_value=mf_val,
                delta=delta,
                mart_leak=mart_leak,
                note=note,
            )
        )

    elapsed = round(time.monotonic() - t0, 1)
    summary = {
        "org": ORG,
        "user_id": user_id,
        "agent": AGENT,
        "metrics": len(metrics),
        "elapsed_s": elapsed,
        "pass": sum(1 for r in rows if r.status in ("pass", "pass_null")),
        "mf_drift": sum(1 for r in rows if r.status == "mf_drift"),
        "sql_error": sum(1 for r in rows if r.status == "sql_error"),
        "mart_leak": sum(1 for r in rows if r.status == "mart_leak"),
        "mf_skip": sum(1 for r in rows if r.status == "mf_skip"),
        "rows": [asdict(r) for r in rows],
    }
    OUTPUT_JSON.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    md_lines = [
        "# Ticketing sql_agent all-metrics validation",
        "",
        f"- Org: {ORG} | User: {user_id} | Agent: `{AGENT}`",
        f"- Metrics: {len(metrics)} | Elapsed: {elapsed}s",
        "",
        "## Summary",
        "",
        f"| bucket | count |",
        f"|--------|------:|",
        f"| pass | {summary['pass']} |",
        f"| mf_drift | {summary['mf_drift']} |",
        f"| sql_error | {summary['sql_error']} |",
        f"| mart_leak | {summary['mart_leak']} |",
        f"| mf_skip | {summary['mf_skip']} |",
        "",
        "## Failures",
        "",
    ]
    failures = [r for r in rows if r.status not in ("pass", "pass_null", "mf_skip")]
    if not failures:
        md_lines.append("_None — all executable metrics matched MF or MF unavailable._")
    else:
        md_lines.append("| metric | status | sql | mf | note |")
        md_lines.append("|--------|--------|-----|-----|------|")
        for r in failures:
            md_lines.append(
                f"| {r.metric} | {r.status} | {r.sql_value} | {r.mf_value} | {r.note[:60]} |"
            )
    OUTPUT_MD.write_text("\n".join(md_lines) + "\n", encoding="utf-8")

    print(
        f"\nSummary: pass={summary['pass']} drift={summary['mf_drift']} "
        f"sql_error={summary['sql_error']} mart_leak={summary['mart_leak']} "
        f"mf_skip={summary['mf_skip']}"
    )
    print(f"JSON: {OUTPUT_JSON}")
    print(f"MD:   {OUTPUT_MD}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
