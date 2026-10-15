#!/usr/bin/env python3 -u
"""Observe live API latency, then run phased sequential metric tests.

Phases (sequential only — do not parallelize):
  observe  — two back-to-back curls to measure gap vs SQL runtime
  smoke    — 4 reporting metrics
  scalars  — all ticketing metric_ids (Suite 1 only)
  spine    — 2 grain=day queries (time spine)
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG_ID", "1000"))
USER = int(os.environ.get("USER_ID", "1"))
AGENT = os.environ.get("AGENT", "tk.reporting")
PRODUCT = "ticketing"
OUTPUT = ROOT / "scripts" / "endpoint_metric_observe_results.json"

SMOKE_METRICS = [
    "open_tickets_metric",
    "ticket_volume",
    "resolution_sla_compliance_rate",
    "unassigned_tickets_metric",
]

SPINE_METRICS = ["ticket_volume", "open_tickets_metric"]
SPINE_TIME = {"start": "2026-08-01", "end": "2026-09-01", "grain": "day"}


def _post(path: str, body: dict, timeout: int) -> tuple[int, dict, float]:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = time.monotonic() - t0
            data = json.loads(resp.read())
            return resp.status, data, elapsed
    except urllib.error.HTTPError as exc:
        elapsed = time.monotonic() - t0
        try:
            data = json.loads(exc.read())
        except json.JSONDecodeError:
            data = {"detail": exc.read().decode(errors="replace")}
        return exc.code, data, elapsed
    except Exception as exc:
        elapsed = time.monotonic() - t0
        return 599, {"detail": str(exc)}, elapsed


def semantic_query(
    metrics: list[str],
    *,
    agent: str = AGENT,
    user_id: int = USER,
    group_by: list[str] | None = None,
    time_spec: dict | None = None,
    timeout: int = 120,
) -> tuple[int, dict, float]:
    body: dict[str, Any] = {
        "organizationId": ORG,
        "userId": user_id,
        "product": PRODUCT,
        "agent": agent,
        "metrics": metrics,
    }
    if group_by:
        body["group_by"] = group_by
    if time_spec:
        body["time"] = time_spec
    return _post("/v1/semantic/query", body, timeout)


def load_ticketing_metric_ids() -> list[str]:
    import yaml

    path = ROOT / "ontology" / "modules" / "metrics_ticketing.yml"
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return list(data.get("metric_ids") or [])


def health_check() -> dict:
    with urllib.request.urlopen(f"{API}/health", timeout=5) as resp:
        return json.loads(resp.read())


def phase_observe(results: dict) -> bool:
    print("\n=== OBSERVE: two sequential curls (userId=%s) ===" % USER)
    payload = {
        "organizationId": ORG,
        "userId": USER,
        "product": PRODUCT,
        "agent": AGENT,
        "metrics": ["open_tickets_metric"],
    }
    runs = []
    for i in (1, 2):
        code, resp, elapsed = _post("/v1/semantic/query", payload, timeout=120)
        row = {
            "curl": i,
            "http": code,
            "elapsed_s": round(elapsed, 3),
            "rows": len(resp.get("rows") or []) if code == 200 else None,
            "detail": str(resp.get("detail", ""))[:120] if code != 200 else None,
        }
        runs.append(row)
        print(
            f"  curl #{i}: HTTP {code} elapsed={elapsed:.2f}s"
            + (f" rows={row['rows']}" if code == 200 else f" detail={row['detail']}")
        )
        if code == 599 and "timed out" in str(resp.get("detail", "")).lower():
            print("  ABORT: request timed out — API may be blocked by concurrent traffic")
            results["observe"] = {"runs": runs, "aborted": True}
            return False
    gap = runs[1]["elapsed_s"] - runs[0].get("sql_hint_s", 0)  # noqa: placeholder
    results["observe"] = {
        "runs": runs,
        "gap_note": "Compare elapsed_s between curl #1 and #2; check logs for Finished running query runtime",
        "second_minus_first_s": round(runs[1]["elapsed_s"] - runs[0]["elapsed_s"], 3),
    }
    return True


def phase_smoke(results: dict) -> bool:
    print("\n=== PHASE A: smoke (4 metrics) ===")
    rows = []
    for mid in SMOKE_METRICS:
        code, resp, elapsed = semantic_query([mid], timeout=90)
        ok = code == 200
        val = None
        if ok and resp.get("rows"):
            val = resp["rows"][0].get(mid)
        row = {
            "metric": mid,
            "http": code,
            "elapsed_s": round(elapsed, 3),
            "value": val,
            "error": str(resp.get("detail", ""))[:120] if not ok else None,
        }
        rows.append(row)
        status = "PASS" if ok else "FAIL"
        print(f"  {status} {mid} HTTP {code} {elapsed:.2f}s" + (f" val={val}" if ok else ""))
        if elapsed >= 90 and code == 599:
            print("  ABORT: smoke call exceeded 90s")
            results["phase_a"] = {"metrics": rows, "aborted": True}
            return False
    results["phase_a"] = {"metrics": rows, "passed": sum(1 for r in rows if r["http"] == 200)}
    return True


def phase_scalars(results: dict) -> bool:
    print("\n=== PHASE B: all scalar metrics (Suite 1) ===")
    metric_ids = load_ticketing_metric_ids()
    print(f"  {len(metric_ids)} metrics, timeout=120s each, agent={AGENT}")
    rows = []
    passed = failed = timed_out = 0
    for idx, mid in enumerate(metric_ids, 1):
        code, resp, elapsed = semantic_query([mid], timeout=120)
        ok = code == 200
        err = None
        if not ok:
            err = str(resp.get("detail", resp))[:200]
        if code == 599:
            timed_out += 1
        elif ok:
            passed += 1
        else:
            failed += 1
        row = {
            "metric": mid,
            "http": code,
            "elapsed_s": round(elapsed, 3),
            "error": err,
        }
        rows.append(row)
        tag = "PASS" if ok else ("TIMEOUT" if code == 599 else "FAIL")
        print(f"  [{idx:02d}/{len(metric_ids)}] {tag} {mid} HTTP {code} {elapsed:.1f}s", flush=True)
        if idx % 10 == 0:
            _flush_results(
                {
                    **results,
                    "phase_b_progress": {
                        "completed": idx,
                        "total": len(metric_ids),
                        "passed": passed,
                        "failed": failed,
                        "timed_out": timed_out,
                    },
                }
            )
        if code == 599 and elapsed >= 119:
            print("  ABORT: scalar timed out at 120s — stop suite")
            results["phase_b"] = {
                "total": len(metric_ids),
                "completed": idx,
                "passed": passed,
                "failed": failed,
                "timed_out": timed_out,
                "metrics": rows,
                "aborted": True,
            }
            return False

    # deny controls
    print("\n  --- deny controls (expect HTTP 400) ---")
    controls = []
    for deny_agent in ("tk.super", "tk.tickets"):
        code, resp, elapsed = semantic_query(
            ["open_tickets_metric"], agent=deny_agent, timeout=30
        )
        ok = code == 400
        controls.append(
            {
                "agent": deny_agent,
                "http": code,
                "elapsed_s": round(elapsed, 3),
                "passed": ok,
            }
        )
        print(f"  {'PASS' if ok else 'FAIL'} deny {deny_agent} HTTP {code}")

    results["phase_b"] = {
        "total": len(metric_ids),
        "passed": passed,
        "failed": failed,
        "timed_out": timed_out,
        "deny_controls": controls,
        "metrics": rows,
    }
    return True


def phase_spine(results: dict) -> None:
    print("\n=== PHASE C: time spine (grain=day) ===")
    rows = []
    for mid in SPINE_METRICS:
        code, resp, elapsed = semantic_query(
            [mid], time_spec=SPINE_TIME, timeout=120
        )
        sql = (resp.get("sql") or "") if code == 200 else ""
        uses_spine = "metricflow_time_spine" in sql.lower()
        err = str(resp.get("detail", ""))[:200] if code != 200 else None
        spine_in_error = err and "spine" in err.lower()
        row = {
            "metric": mid,
            "http": code,
            "elapsed_s": round(elapsed, 3),
            "uses_time_spine_in_sql": uses_spine,
            "spine_mentioned_in_error": spine_in_error,
            "error": err,
            "sql_snippet": sql[:300] if sql else None,
        }
        rows.append(row)
        tag = "PASS" if code == 200 else "FAIL"
        print(
            f"  {tag} {mid} HTTP {code} {elapsed:.1f}s"
            + (f" spine_in_sql={uses_spine}" if code == 200 else f" err={err[:60]}")
        )
    results["phase_c"] = {"metrics": rows}


def _flush_results(results: dict) -> None:
    """Write partial results so long runs are monitorable."""
    OUTPUT.write_text(json.dumps(results, indent=2), encoding="utf-8")


def main() -> int:
    # Ensure line-buffered stdout when invoked without -u
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)

    phases = [p.strip() for p in os.environ.get("PHASES", "observe,smoke,scalars,spine").split(",") if p.strip()]
    print(f"Endpoint observe → {API} org={ORG} user={USER} agent={AGENT}", flush=True)
    print(f"Phases: {', '.join(phases)}")

    try:
        health = health_check()
        print(f"Health OK — metricflow cached: {health.get('metricflow', {}).get('cached')}")
    except Exception as exc:
        print(f"API unreachable: {exc}")
        return 1

    results: dict[str, Any] = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "api": API,
        "org": ORG,
        "user_id": USER,
        "agent": AGENT,
        "health": health,
    }

    ok = True
    if "observe" in phases:
        ok = phase_observe(results) and ok
    if ok and "smoke" in phases:
        ok = phase_smoke(results) and ok
    if ok and "scalars" in phases:
        ok = phase_scalars(results) and ok
    if "spine" in phases and ok:
        phase_spine(results)

    _flush_results(results)
    print(f"\nResults written to {OUTPUT}", flush=True)

    any_fail = False
    if "phase_a" in results:
        any_fail = any(r["http"] != 200 for r in results["phase_a"].get("metrics", []))
    if "phase_b" in results:
        any_fail = any_fail or results["phase_b"].get("failed", 0) > 0
    if "phase_c" in results:
        any_fail = any_fail or any(r["http"] != 200 for r in results["phase_c"].get("metrics", []))
    if results.get("observe", {}).get("aborted") or results.get("phase_a", {}).get("aborted"):
        return 2
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
