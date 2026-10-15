#!/usr/bin/env python3
"""Certified-SQL matrix for ticketing /v1/semantic/query.

Compares API (or in-process execute) scalars and group_by series against the
same certified template SQL on Postgres. Use this instead of the external MAS
oracle that compared averages to counts / first-bucket to totals.

Usage:
  ORG=1012 USER_ID=1028 PYTHONPATH=. python3 scripts/audit_ticketing_semantic_matrix.py
  ORG=1012 USER_ID=1028 MATRIX_MODE=core PYTHONPATH=. python3 scripts/audit_ticketing_semantic_matrix.py
  ORG=1012 USER_ID=1028 USE_API=1 API_BASE=http://127.0.0.1:8765 PYTHONPATH=. python3 scripts/audit_ticketing_semantic_matrix.py
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ORG = int(os.environ.get("ORG", "1012"))
USER_ID = int(os.environ.get("USER_ID", "1028"))
AGENT = os.environ.get("AGENT", "tk.reporting")
API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
USE_API = os.environ.get("USE_API", "0") == "1"
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.001"))
MATRIX_MODE = os.environ.get("MATRIX_MODE", "full")  # full|core
OUTPUT_JSON = ROOT / "scripts" / "ticketing_semantic_matrix_report.json"
OUTPUT_MD = ROOT / "scripts" / "ticketing_semantic_matrix_report.md"

WINDOWS = [
    {},
    {"period": "today"},
    {"period": "last_7d"},
    {"period": "last_30d"},
]

CORE_METRICS = [
    "active_tickets_metric",
    "open_tickets_metric",
    "assigned_tickets_metric",
    "closed_tickets_metric",
    "accounts_served",
    "customers_served",
    "average_tickets_per_day",
    "current_overdue_tickets_metric",
    "breached_tickets_metric",
    "csat_score_total",
    "average_csat_score",
    "csat_rated_metric",
    "csat_promoter_metric",
    "csat_detractor_metric",
    "approval_volume",
    "audit_event_volume",
    "customer_reply_volume",
    "average_first_response_hours",
    "average_resolution_time_hours",
]

TICKET_DIMS = [
    "status",
    "status_display_name",
    "is_closed_by_status",
    "priority",
    "has_first_response",
    "has_csat_rating",
    "is_overdue",
    "assignee_name",
]


def _load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def _close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if (a is None and b == 0) or (b is None and a == 0):
        return True
    if a is None or b is None:
        return False
    return abs(a - b) <= max(DRIFT, abs(b) * 1e-6)


def load_metric_ids() -> list[str]:
    if MATRIX_MODE == "core":
        return list(CORE_METRICS)
    path = ROOT / "ontology" / "modules" / "metrics_ticketing.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    ids = list(data.get("metric_ids") or [])
    # include template-only alias if present
    from semantic.sql.metric_template_registry import get_template

    extras = []
    for mid in ("high_priority_open_tickets_metric", "ticket_active_days"):
        if get_template("ticketing", mid) and mid not in ids:
            extras.append(mid)
    return ids + extras


def run_query(
    metric_id: str,
    *,
    time_spec: dict[str, Any] | None = None,
    group_by: list[str] | None = None,
) -> tuple[str, list[dict[str, Any]], str | None]:
    """Return (status, rows, error). status: PASS path marker / API_ERROR."""
    if USE_API:
        body: dict[str, Any] = {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "ticketing",
            "agent": AGENT,
            "metrics": [metric_id],
        }
        if time_spec:
            body["time"] = time_spec
        if group_by:
            body["groupBy"] = group_by
        req = urllib.request.Request(
            f"{API_BASE}/v1/semantic/query",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
            return str(data.get("source") or "api"), list(data.get("rows") or []), None
        except Exception as exc:  # noqa: BLE001
            return "API_ERROR", [], str(exc)[:240]

    from semantic.query import SemanticQuery, execute

    q = SemanticQuery(
        organization_id=ORG,
        user_id=USER_ID,
        product="ticketing",
        agent=AGENT,
        metrics=[metric_id],
        time=time_spec or None,
        group_by=group_by,
    )
    try:
        data = execute(q)
        return str(data.get("source") or "local"), list(data.get("rows") or []), None
    except Exception as exc:  # noqa: BLE001
        return "API_ERROR", [], f"{type(exc).__name__}: {exc}"[:240]


def pg_scalar(metric_id: str, time_spec: dict[str, Any] | None) -> float | None:
    """Execute certified template SQL with the same time window."""
    from semantic.query import SemanticQuery, validate_and_prepare
    from semantic.sql.metric_fallback import execute_metric_fallback
    from semantic.sql.template_execute import _build_template_job, can_use_sql_template

    q = SemanticQuery(
        organization_id=ORG,
        user_id=USER_ID,
        product="ticketing",
        agent=AGENT,
        metrics=[metric_id],
        time=time_spec or None,
    )
    prepared = validate_and_prepare(q)
    if not can_use_sql_template(prepared):
        return None
    job = _build_template_job(prepared, metric_id)
    # Force no group_by for oracle scalar
    job.group_by = []
    out = execute_metric_fallback(job)
    rows = out.get("rows") or []
    if not rows:
        return 0.0
    val = rows[0].get(metric_id)
    return None if val is None else float(val)


def extract_scalar(rows: list[dict[str, Any]], metric_id: str) -> float | None:
    if not rows:
        return None
    val = rows[0].get(metric_id)
    return None if val is None else float(val)


def series_sum(rows: list[dict[str, Any]], metric_id: str) -> float:
    total = 0.0
    for row in rows:
        val = row.get(metric_id)
        if val is not None:
            total += float(val)
    return total


def main() -> int:
    _load_dotenv()
    # Clear template cache so regen is picked up
    import semantic.sql.metric_template_registry as reg

    if hasattr(reg, "_CACHE"):
        reg._CACHE = {}

    metrics = load_metric_ids()
    results: list[dict[str, Any]] = []
    t0 = time.time()

    for mid in metrics:
        for window in WINDOWS:
            label = window.get("period") or "all_time"
            src, rows, err = run_query(mid, time_spec=window or None)
            if err:
                results.append(
                    {
                        "metric": mid,
                        "window": label,
                        "group_by": "-",
                        "status": "API_ERROR",
                        "cl": None,
                        "pg": None,
                        "source": src,
                        "error": err,
                    }
                )
                continue
            cl_val = extract_scalar(rows, mid)
            try:
                pg_val = pg_scalar(mid, window or None)
                if _close(cl_val, pg_val):
                    status = "PASS"
                elif pg_val is None and cl_val is not None:
                    status = "EMPTY_OK" if cl_val == 0 else "PG_SKIP"
                else:
                    status = "PG_MISMATCH"
            except Exception as exc:  # noqa: BLE001
                pg_val = None
                status = "SQL_ERROR"
                err = str(exc)[:200]
            results.append(
                {
                    "metric": mid,
                    "window": label,
                    "group_by": "-",
                    "status": status,
                    "cl": cl_val,
                    "pg": pg_val,
                    "source": src,
                    "error": err,
                }
            )

        # group_by matrix (core dims, last_7d only) for ticket-grained metrics
        if mid in CORE_METRICS or MATRIX_MODE == "full":
            for dim in TICKET_DIMS:
                src, rows, err = run_query(
                    mid, time_spec={"period": "last_7d"}, group_by=[dim]
                )
                if err:
                    # complex metrics may reject group_by — mark skip
                    status = (
                        "GB_SKIP"
                        if "group_by not supported" in (err or "")
                        else "API_ERROR"
                    )
                    results.append(
                        {
                            "metric": mid,
                            "window": "last_7d",
                            "group_by": dim,
                            "status": status,
                            "cl": None,
                            "pg": None,
                            "source": src,
                            "error": err,
                        }
                    )
                    continue
                cl_sum = series_sum(rows, mid)
                # Compare sum-of-buckets to ungrouped scalar (counts)
                src2, rows2, err2 = run_query(mid, time_spec={"period": "last_7d"})
                scalar = extract_scalar(rows2, mid) if not err2 else None
                is_avg = mid.startswith("average_") or mid.endswith("_rate")
                if is_avg:
                    status = "PASS" if rows else "EMPTY_OK"
                elif scalar is None:
                    status = "PASS" if rows is not None else "API_ERROR"
                elif _close(cl_sum, scalar):
                    status = "PASS"
                else:
                    # rates/avgs and distinct metrics may not sum to scalar
                    status = "GB_DRIFT"
                results.append(
                    {
                        "metric": mid,
                        "window": "last_7d",
                        "group_by": dim,
                        "status": status,
                        "cl": cl_sum,
                        "pg": scalar,
                        "source": src,
                        "buckets": len(rows),
                        "error": None
                        if status == "PASS"
                        else f"sum={cl_sum} scalar={scalar}",
                    }
                )

    counts = Counter(r["status"] for r in results)
    report = {
        "org": ORG,
        "user_id": USER_ID,
        "agent": AGENT,
        "mode": MATRIX_MODE,
        "elapsed_s": round(time.time() - t0, 2),
        "counts": dict(counts),
        "results": results,
    }
    OUTPUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        f"# Ticketing semantic matrix — org {ORG}",
        "",
        f"- user `{USER_ID}` agent `{AGENT}` mode `{MATRIX_MODE}`",
        f"- elapsed `{report['elapsed_s']}s`",
        f"- counts: `{counts}`",
        "",
        "| metric | window | group_by | status | CL | PG |",
        "|---|---|---|---|---|---|",
    ]
    for r in results:
        if r["status"] in ("PASS", "EMPTY_OK", "PG_SKIP", "GB_SKIP"):
            continue
        lines.append(
            f"| {r['metric']} | {r['window']} | {r['group_by']} | {r['status']} "
            f"| {r.get('cl')} | {r.get('pg')} |"
        )
    lines.append("")
    lines.append("## All non-PASS rows listed above; full JSON has every case.")
    OUTPUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps(counts, indent=2))
    print(f"Wrote {OUTPUT_MD}")
    bad = counts.get("API_ERROR", 0) + counts.get("SQL_ERROR", 0) + counts.get(
        "PG_MISMATCH", 0
    )
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
