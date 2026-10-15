#!/usr/bin/env python3
"""Audit all ticketing metrics: latency + Postgres ground truth (re-run MF SQL).

For each certified ticketing metric:
  1. POST /v1/semantic/query (org/user/agent configurable)
  2. Record wall-clock latency and API _timing breakdown
  3. Re-execute returned SQL on Postgres and compare scalar value

Usage:
  PYTHONPATH=. python3 scripts/audit_ticketing_all_metrics.py
  ORG=1000 USER_ID=1005 TICKETING_AGENT_ID=1005 API_BASE=http://127.0.0.1:8765 PYTHONPATH=. python3 scripts/audit_ticketing_all_metrics.py

userId must be ticketing.agents.id (not accounts.setup_users.id). Defaults to first active admin agent for the org.
"""

from __future__ import annotations

import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
AGENT = os.environ.get("AGENT", "tk.reporting")
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
OUTPUT_JSON = ROOT / "scripts" / "ticketing_all_metrics_audit.json"
OUTPUT_MD = ROOT / "scripts" / "ticketing_all_metrics_audit.md"


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


def load_metric_ids() -> list[str]:
    path = ROOT / "ontology" / "modules" / "metrics_ticketing.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return list(data.get("metric_ids") or [])


@dataclass
class MetricResult:
    metric: str
    http: int
    source: str
    path: str
    elapsed_s: float
    compile_ms: int
    warehouse_ms: int
    api_value: float | None
    pg_value: float | None
    delta: float | None
    pg_verified: bool
    pg_match: bool
    verify_note: str | None = None
    error: str | None = None


def _close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if (a is None and b == 0) or (b is None and a == 0):
        return True
    if a is None or b is None:
        return False
    if math.isnan(a) and math.isnan(b):
        return True
    return abs(a - b) <= max(DRIFT, abs(b) * 1e-6)


def api_query(metric_id: str, user_id: int) -> tuple[int, dict, float]:
    body = {
        "organizationId": ORG,
        "userId": user_id,
        "product": "ticketing",
        "agent": AGENT,
        "metrics": [metric_id],
    }
    req = urllib.request.Request(
        f"{API_BASE}/v1/semantic/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read())
            return resp.status, data, time.monotonic() - t0
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read())
        except json.JSONDecodeError:
            data = {"detail": exc.read().decode(errors="replace")}
        return exc.code, data, time.monotonic() - t0
    except Exception as exc:
        return 0, {"detail": str(exc)}, time.monotonic() - t0


def _internal_sql(metric_id: str, user_id: int) -> tuple[str | None, str, str]:
    """Fetch compiled SQL via semantic.execute (API strips sql from client payload)."""
    from semantic.query import SemanticQuery, execute

    result = execute(
        SemanticQuery(
            organization_id=ORG,
            user_id=user_id,
            product="ticketing",
            agent=AGENT,
            metrics=[metric_id],
        )
    )
    timing = result.get("_timing") or {}
    source = str(result.get("source") or "")
    path = str(timing.get("path") or "")
    sql = result.get("sql")
    if isinstance(sql, list):
        sql = "\n".join(str(s) for s in sql if s)
    return (str(sql) if sql else None), source, path


def pg_from_sql(sql: str, metric_id: str, *, source: str) -> float | None:
    from semantic.sql.db import run_postgres_query

    params: list[object] = []
    if source == "sql_template" or "%s" in sql:
        params = [str(ORG)]
    rows = run_postgres_query(sql.strip(), params)
    if not rows:
        return None
    row = rows[0]
    if metric_id in row:
        val = row[metric_id]
    elif len(row) == 1:
        val = next(iter(row.values()))
    else:
        for k, v in row.items():
            if k != "metric_time" and not str(k).startswith("metric_time__"):
                val = v
                break
        else:
            val = None
    if val is None:
        return None
    return float(val)


def audit_one(metric_id: str, user_id: int) -> MetricResult:
    http, data, elapsed = api_query(metric_id, user_id)
    timing = data.get("_timing") or {}
    source = str(data.get("source") or "")
    path = str(timing.get("path") or "")
    compile_ms = int(timing.get("compile_ms") or 0)
    warehouse_ms = int(timing.get("warehouse_ms") or 0)

    if http != 200:
        err = str(data.get("detail", data))[:200]
        return MetricResult(
            metric=metric_id,
            http=http,
            source=source,
            path=path,
            elapsed_s=round(elapsed, 3),
            compile_ms=compile_ms,
            warehouse_ms=warehouse_ms,
            api_value=None,
            pg_value=None,
            delta=None,
            pg_verified=False,
            pg_match=False,
            verify_note="http_error",
            error=err,
        )

    rows = data.get("rows") or []
    api_val = rows[0].get(metric_id) if rows else None
    if api_val is not None:
        api_val = float(api_val)

    sql = data.get("sql")
    if not sql:
        try:
            sql, source, path = _internal_sql(metric_id, user_id)
        except Exception:
            pass
    pg_val: float | None = None
    pg_verified = False
    pg_match = False
    verify_note: str | None = None
    err: str | None = None

    if isinstance(sql, list):
        sql = "\n".join(str(s) for s in sql if s)

    if sql:
        try:
            pg_val = pg_from_sql(str(sql), metric_id, source=source)
            pg_verified = True
            pg_match = _close(api_val, pg_val)
            verify_note = "pg_sql"
            if not pg_match:
                err = f"api={api_val} pg={pg_val}"
        except Exception as exc:
            verify_note = "pg_error"
            err = f"pg_exec: {exc}"
    else:
        verify_note = "no_sql"
        err = "no sql in response — latency/value only"

    delta = None
    if api_val is not None and pg_val is not None:
        delta = api_val - pg_val

    return MetricResult(
        metric=metric_id,
        http=http,
        source=source,
        path=path,
        elapsed_s=round(elapsed, 3),
        compile_ms=compile_ms,
        warehouse_ms=warehouse_ms,
        api_value=api_val,
        pg_value=pg_val,
        delta=delta,
        pg_verified=pg_verified,
        pg_match=pg_match,
        verify_note=verify_note,
        error=err if not pg_match else None,
    )


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = int(round((p / 100) * (len(s) - 1)))
    return s[idx]


def write_markdown(report: dict[str, Any]) -> None:
    lines = [
        "# Ticketing metrics audit",
        "",
        f"- API: `{report['api']}`",
        f"- Org: {report['org']} | User: {report['user_id']} | Agent: `{report['agent']}`",
        f"- Metrics: {report['total']}",
        f"- HTTP 200: {report['http_ok']}",
        f"- Postgres verified: {report['pg_verified']}",
        f"- Postgres SQL match: {report['pg_match']}",
        f"- HTTP failures: {report['http_fail']}",
        f"- PG mismatches: {report['pg_mismatch']}",
        f"- Unverified (no SQL): {report['unverified']}",
        "",
        "## Latency (wall-clock seconds per metric)",
        "",
        f"| stat | seconds |",
        f"|------|---------|",
        f"| min | {report['latency']['min_s']:.2f} |",
        f"| avg | {report['latency']['avg_s']:.2f} |",
        f"| p50 | {report['latency']['p50_s']:.2f} |",
        f"| p95 | {report['latency']['p95_s']:.2f} |",
        f"| max | {report['latency']['max_s']:.2f} |",
        f"| total | {report['latency']['total_s']:.1f} |",
        "",
        "## Per-metric results",
        "",
        "| metric | http | source | elapsed_s | compile_ms | wh_ms | api | pg | verified | match |",
        "|--------|------|--------|-----------|------------|-------|-----|-----|----------|-------|",
    ]
    for r in report["results"]:
        lines.append(
            f"| {r['metric']} | {r['http']} | {r['source']} | {r['elapsed_s']:.1f} | "
            f"{r['compile_ms']} | {r['warehouse_ms']} | {r['api_value']} | {r['pg_value']} | "
            f"{'Y' if r['pg_verified'] else 'N'} | {'Y' if r['pg_match'] else 'N'} |"
        )
    failures = [
        r
        for r in report["results"]
        if r["http"] != 200 or (r["pg_verified"] and not r["pg_match"])
    ]
    if failures:
        lines.extend(["", "## Failures / mismatches", ""])
        for r in failures:
            lines.append(f"- **{r['metric']}**: http={r['http']} {r.get('error') or ''}")
    OUTPUT_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    _load_dotenv()
    from scripts.ticketing_agent_fixtures import resolve_ticketing_agent_id
    from semantic.scope import apply_ticketing_visible_ids, lookup_user_scope

    user_id = resolve_ticketing_agent_id(ORG, role="admin")
    scope = lookup_user_scope(ORG, user_id, product="ticketing")
    apply_ticketing_visible_ids(scope)
    metrics = load_metric_ids()
    print(
        f"Ticketing full audit — {len(metrics)} metrics\n"
        f"API {API_BASE} org={ORG} user={user_id} (agents.id) role={scope.role} agent={AGENT}\n"
    )

    results: list[MetricResult] = []
    for i, mid in enumerate(metrics, 1):
        r = audit_one(mid, user_id)
        results.append(r)
        if r.http != 200:
            mark = "HTTP_FAIL"
        elif r.pg_verified and r.pg_match:
            mark = "PASS"
        elif r.pg_verified:
            mark = "PG_MISMATCH"
        else:
            mark = "OK_UNVERIFIED"
        print(
            f"  [{i:02d}/{len(metrics)}] {mark:13s} {mid:42s} "
            f"http={r.http} {r.elapsed_s:6.1f}s src={r.source or '-':12s} "
            f"api={r.api_value!s:>10} pg={r.pg_value!s:>10}"
            + (f"  {r.error}" if r.error else "")
        )
        # incremental save
        partial = {
            "api": API_BASE,
            "org": ORG,
            "user_id": user_id,
            "scope_role": scope.role,
            "scope_identity": scope.identity,
            "agent": AGENT,
            "progress": f"{i}/{len(metrics)}",
            "results": [asdict(x) for x in results],
        }
        OUTPUT_JSON.write_text(json.dumps(partial, indent=2), encoding="utf-8")

    elapsed_vals = [r.elapsed_s for r in results if r.http == 200]
    http_ok = sum(1 for r in results if r.http == 200)
    pg_verified = sum(1 for r in results if r.pg_verified)
    pg_match = sum(1 for r in results if r.pg_match)
    http_fail = len(results) - http_ok
    pg_mismatch = sum(1 for r in results if r.pg_verified and not r.pg_match)
    unverified = sum(1 for r in results if r.http == 200 and not r.pg_verified)

    report = {
        "api": API_BASE,
        "org": ORG,
        "user_id": user_id,
        "scope_role": scope.role,
        "scope_identity": scope.identity,
        "agent": AGENT,
        "total": len(metrics),
        "http_ok": http_ok,
        "http_fail": http_fail,
        "pg_verified": pg_verified,
        "pg_match": pg_match,
        "pg_mismatch": pg_mismatch,
        "unverified": unverified,
        "latency": {
            "min_s": min(elapsed_vals) if elapsed_vals else 0,
            "avg_s": statistics.mean(elapsed_vals) if elapsed_vals else 0,
            "p50_s": _pct(elapsed_vals, 50),
            "p95_s": _pct(elapsed_vals, 95),
            "max_s": max(elapsed_vals) if elapsed_vals else 0,
            "total_s": sum(elapsed_vals),
        },
        "results": [asdict(r) for r in results],
    }
    OUTPUT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    write_markdown(report)

    print(
        f"\nSummary: {http_ok}/{len(metrics)} HTTP 200, "
        f"{pg_match}/{pg_verified} PG verified match "
        f"({unverified} unverified — no SQL in response)"
    )
    print(
        f"Latency: min={report['latency']['min_s']:.1f}s "
        f"avg={report['latency']['avg_s']:.1f}s "
        f"p50={report['latency']['p50_s']:.1f}s "
        f"p95={report['latency']['p95_s']:.1f}s "
        f"max={report['latency']['max_s']:.1f}s "
        f"total={report['latency']['total_s']:.0f}s"
    )
    print(f"JSON: {OUTPUT_JSON}")
    print(f"Markdown: {OUTPUT_MD}")
    return 0 if http_fail == 0 and pg_mismatch == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
