#!/usr/bin/env python3
"""Compare 10 core ticketing metrics via POST /v1/sql/query vs Postgres ground truth.

The SQL endpoint tries MetricFlow first (source=metricflow), then SQL templates
(source=metric_fallback). Ground truth uses MetricFlow measure semantics unless
the response source is metric_fallback and a template exists — then template SQL
is used as the expected value.

Usage:
  PYTHONPATH=. python3 scripts/validate_ticketing_core_sql_metrics.py
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER_ID = int(os.environ.get("USER_ID", os.environ.get("TICKETING_AGENT_ID", "1005")))
AGENT = os.environ.get("AGENT", "tk.reporting")
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
OUTPUT = ROOT / "scripts" / "ticketing_core_sql_metrics_report.json"

# Reuse MF-aligned ground truth from semantic validator
_spec = importlib.util.spec_from_file_location(
    "mf_validate",
    ROOT / "scripts" / "validate_ticketing_core_metrics.py",
)
_mf = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
sys.modules["mf_validate"] = _mf
_spec.loader.exec_module(_mf)

CORE_METRICS = _mf.CORE_METRICS
MART = _mf.MART


@dataclass
class Row:
    metric: str
    scope: str
    api_status: int
    source: str
    api_value: float | None
    pg_value: float | None
    delta: float | None
    match: bool
    note: str = ""


def sql_query(metric_id: str) -> tuple[int, dict, float | None, str]:
    body = {
        "organizationId": ORG,
        "userId": USER_ID,
        "originProduct": "ticketing",
        "originAgent": AGENT,
        "instruction": f"Fetch metric value for {metric_id}",
        "entityHint": "wt:Ticket",
        "metricRequest": {
            "organizationId": ORG,
            "userId": USER_ID,
            "product": "ticketing",
            "agent": AGENT,
            "metrics": [metric_id],
        },
    }
    req = urllib.request.Request(
        f"{API_BASE}/v1/sql/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
            rows = data.get("rows") or []
            val = rows[0].get(metric_id) if rows else None
            if val is not None:
                val = float(val)
            return resp.status, data, val, ""
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read())
        except json.JSONDecodeError:
            detail = {"detail": exc.read().decode(errors="replace")}
        return exc.code, detail, None, str(detail.get("detail", detail))
    except Exception as exc:
        return 0, {}, None, str(exc)


def _template_truth(cur, metric_id: str, scope) -> float | None:
    """Postgres values matching semantic/sql/metric_templates/ticketing.yml."""
    (w, p), _ = _mf._where_for_metric(scope, metric_id)
    base = f"FROM {MART} WHERE"

    if metric_id == "open_tickets_metric":
        return _mf._scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_open) {base} {w}",
            p,
        )
    if metric_id == "sla_breach_rate":
        num = _mf._scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE is_breached_proxy) {base} {w}",
            p,
        )
        den = _mf._scalar(
            cur,
            f"SELECT COUNT(*) FILTER (WHERE has_resolution_sla_target) {base} {w}",
            p,
        )
        if num is None or den is None or den == 0:
            return None
        return num / den
    if metric_id == "ticket_volume":
        return _mf._scalar(
            cur,
            f"SELECT COUNT(DISTINCT ticket_id) {base} {w}",
            p,
        )
    if metric_id == "average_resolution_time_hours":
        return _mf._scalar(
            cur,
            f"""SELECT SUM(resolution_hours)::float
                / NULLIF(COUNT(*) FILTER (WHERE resolved_at IS NOT NULL), 0)
                {base} {w}""",
            p,
        )
    if metric_id == "high_priority_ticket_volume":
        return _mf._scalar(
            cur,
            f"""SELECT COUNT(ticket_id) {base} {w}
                AND lower(priority) IN ('high', 'urgent')""",
            p,
        )
    return None


def _close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    return abs(a - b) <= max(DRIFT, abs(b) * 1e-6)


def main() -> int:
    _mf._load_dotenv()
    print(f"Ticketing SQL endpoint — API {API_BASE}/v1/sql/query")
    print(f"org={ORG} user={USER_ID} agent={AGENT}\n")

    scope, scope_summary = _mf._resolve_scope()
    print(f"Scope: {scope_summary}\n")

    try:
        conn = _mf._pg_conn()
    except Exception as exc:
        print(f"Postgres connect failed: {exc}")
        return 1

    results: list[Row] = []
    passed = failed = 0

    with conn:
        cur = conn.cursor()
        for mid in CORE_METRICS:
            status, payload, api_val, err = sql_query(mid)
            source = str(payload.get("source") or "unknown") if status == 200 else ""

            try:
                mf_val, scope_kind = _mf.ground_truth(cur, mid, scope=scope)
            except Exception as exc:
                mf_val, scope_kind = None, "?"
                err = f"pg mf: {exc}"

            if source == "metric_fallback":
                tpl_val = _template_truth(cur, mid, scope)
                pg_val = tpl_val if tpl_val is not None else mf_val
                expect = "template" if tpl_val is not None else "mf"
            else:
                pg_val = mf_val
                expect = "mf"

            if status != 200:
                match = False
                note = err[:100] if err else f"HTTP {status}"
                failed += 1
            elif pg_val is None and api_val is None:
                match = True
                note = f"source={source} both null"
                passed += 1
            elif pg_val is None or api_val is None:
                match = False
                note = f"source={source} expect={expect} one null"
                failed += 1
            else:
                match = _close(api_val, pg_val)
                delta = api_val - pg_val
                note = f"source={source} expect={expect} delta={delta:.6g}"
                if match:
                    passed += 1
                else:
                    failed += 1
                    if source == "metricflow" and mf_val is not None:
                        note += f" (mf_pg={mf_val})"

            delta = None
            if api_val is not None and pg_val is not None:
                delta = api_val - pg_val

            row = Row(
                metric=mid,
                scope=scope_kind,
                api_status=status,
                source=source,
                api_value=api_val,
                pg_value=pg_val,
                delta=delta,
                match=match,
                note=note,
            )
            results.append(row)
            mark = "PASS" if row.match else "FAIL"
            print(
                f"  {mark}  {mid:40s} [{row.source:15s}] "
                f"api={row.api_value!s:>12} pg={row.pg_value!s:>12}  {row.note}"
            )

    report = {
        "endpoint": f"{API_BASE}/v1/sql/query",
        "org": ORG,
        "user_id": USER_ID,
        "agent": AGENT,
        "scope": scope_summary,
        "passed": passed,
        "failed": failed,
        "metrics": [r.__dict__ for r in results],
    }
    OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n{passed}/{len(CORE_METRICS)} matched. Report: {OUTPUT}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
