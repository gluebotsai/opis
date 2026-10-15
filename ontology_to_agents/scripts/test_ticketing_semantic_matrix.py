#!/usr/bin/env python3
"""Exhaustive Ticketing Semantic Query & SQL Fallback Test Matrix Runner (HTTP Mode).

Strictly non-destructive: Does NOT edit any existing codebase files or configurations.
Sends live JSON payloads over HTTP to POST /v1/semantic/query, checks every ticketing
metric across dimensions, time grains, filters, and bundles, and triggers automated
POST /v1/sql/query fallback for any encountered failures.
Outputs complete telemetry to scripts/ticketing_semantic_test_results.json.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG_ID = int(os.environ.get("ORG_ID", "1000"))
USER_ID = int(os.environ.get("USER_ID", "1001"))
PRODUCT = "ticketing"
AGENT = "tk.reporting"

OUTPUT_JSON = os.path.join(ROOT, "scripts", "ticketing_semantic_test_results.json")


def http_post(path: str, payload: dict, timeout: int = 60) -> Tuple[int, dict]:
    """Execute HTTP POST request against Context Layer API."""
    url = f"{API_BASE}{path}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start_t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            elapsed = time.time() - start_t
            body = json.loads(resp.read().decode("utf-8"))
            body["_elapsed_s"] = round(elapsed, 3)
            return resp.status, body
    except urllib.error.HTTPError as exc:
        elapsed = time.time() - start_t
        raw = exc.read().decode("utf-8")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"detail": raw}
        body["_elapsed_s"] = round(elapsed, 3)
        return exc.code, body
    except Exception as exc:
        elapsed = time.time() - start_t
        return 599, {"detail": str(exc), "_elapsed_s": round(elapsed, 3)}


def test_sql_fallback(
    metric_id: str,
    group_by: Optional[List[str]] = None,
    filters: Optional[List[dict]] = None,
    time_spec: Optional[dict] = None,
) -> Tuple[int, dict]:
    """Trigger SQL Super Agent fallback via POST /v1/sql/query."""
    payload = {
        "organizationId": ORG_ID,
        "userId": USER_ID,
        "originProduct": PRODUCT,
        "originAgent": AGENT,
        "instruction": f"Fetch metric value for {metric_id}",
        "entityHint": "wt:Ticket",
        "metricRequest": {
            "organizationId": ORG_ID,
            "userId": USER_ID,
            "product": PRODUCT,
            "agent": AGENT,
            "metrics": [metric_id],
            "groupBy": group_by,
            "filters": filters,
            "time": time_spec,
        },
    }
    return http_post("/v1/sql/query", payload, timeout=30)


def load_ticketing_inventory() -> Tuple[List[str], Dict[str, List[str]], Dict[str, Any]]:
    """Load ticketing metrics, policies, and semantic models."""
    import yaml

    # 1. Metric IDs
    metrics_file = os.path.join(ROOT, "ontology", "modules", "metrics_ticketing.yml")
    with open(metrics_file, "r", encoding="utf-8") as f:
        mod = yaml.safe_load(f)
    metric_ids = mod.get("metric_ids", [])

    # 2. Metric Policies (dims, scope)
    policies_file = os.path.join(ROOT, "ontology", "metric_policies.yml")
    policies = {}
    if os.path.exists(policies_file):
        with open(policies_file, "r", encoding="utf-8") as f:
            policies = yaml.safe_load(f).get("metrics", {})

    # 3. Semantic Layer YAML (dimensions per model)
    sem_file = os.path.join(
        ROOT,
        "semantic",
        "dbt",
        "ticketing",
        "default",
        "dbt",
        "models",
        "semantic_layer",
        "semantic_layer.yml",
    )
    sem_models = {}
    if os.path.exists(sem_file):
        with open(sem_file, "r", encoding="utf-8") as f:
            sem_data = yaml.safe_load(f)
            for sm in sem_data.get("semantic_models", []):
                sem_models[sm["name"]] = [d["name"] for d in sm.get("dimensions", [])]

    return metric_ids, policies, sem_models


def classify_error(status: int, response: dict) -> str:
    """Categorize error into root-cause buckets."""
    msg = str(response.get("detail") or response.get("message") or "")
    if "does not match any MetricFlow group-by item" in msg:
        return "E1_DIM_MAPPING_ERROR"
    if "not allowed for metric" in msg:
        return "E2_POLICY_DISALLOWED_DIM"
    if "not entitled for agent" in msg:
        return "E6_AGENT_AUTHORIZATION_GATED"
    if "require product" in msg:
        return "E6_PRODUCT_MISMATCH"
    if "join" in msg.lower() or "ratio" in msg.lower() or "measure" in msg.lower():
        return "E3_MF_MODEL_JOIN_ERROR"
    if "time" in msg.lower() or "granularity" in msg.lower() or "spine" in msg.lower():
        return "E4_TIME_SPINE_ERROR"
    if "mart" in msg.lower() or "column" in msg.lower() or "relation" in msg.lower() or status == 502:
        return "E5_MART_SQL_ERROR"
    return f"E_OTHER_HTTP_{status}"


def run_test_case(
    test_id: str,
    suite: str,
    metrics: List[str],
    group_by: Optional[List[str]] = None,
    filters: Optional[List[dict]] = None,
    time_spec: Optional[dict] = None,
    agent: str = AGENT,
    user_id: int = USER_ID,
    expected_status: int = 200,
) -> dict:
    """Execute a single test case with automated SQL fallback testing on failure."""
    req_payload = {
        "organizationId": ORG_ID,
        "userId": user_id,
        "product": PRODUCT,
        "agent": agent,
        "metrics": metrics,
    }
    if group_by:
        req_payload["group_by"] = group_by
    if filters:
        req_payload["filters"] = filters
    if time_spec:
        req_payload["time"] = time_spec

    status, resp = http_post("/v1/semantic/query", req_payload)
    elapsed = resp.get("_elapsed_s", 0)

    record = {
        "test_id": test_id,
        "suite": suite,
        "metrics": metrics,
        "group_by": group_by or [],
        "filters": filters or [],
        "time": time_spec,
        "agent": agent,
        "user_id": user_id,
        "expected_status": expected_status,
        "status": status,
        "elapsed_s": elapsed,
        "passed": status == expected_status,
        "error_category": None,
        "error_message": None,
        "fallback_tested": False,
        "fallback_status": None,
        "fallback_recovered": False,
        "fallback_elapsed_s": None,
        "fallback_message": None,
    }

    if status != expected_status:
        err_cat = classify_error(status, resp)
        record["error_category"] = err_cat
        record["error_message"] = str(resp.get("detail") or resp)

        # Trigger SQL Fallback for single metric queries
        if len(metrics) == 1 and expected_status == 200:
            fb_status, fb_resp = test_sql_fallback(
                metrics[0], group_by=group_by, filters=filters, time_spec=time_spec
            )
            record["fallback_tested"] = True
            record["fallback_status"] = fb_status
            record["fallback_elapsed_s"] = fb_resp.get("_elapsed_s")
            if fb_status == 200:
                record["fallback_recovered"] = True
                record["fallback_message"] = f"Recovered rows={len(fb_resp.get('rows') or [])}"
            else:
                record["fallback_message"] = str(fb_resp.get("detail") or fb_resp)[:120]

    return record


def main() -> int:
    print("=" * 80, flush=True)
    print("🚀 WORKTUAL TICKETING SEMANTIC QUERY & SQL FALLBACK TEST MATRIX (HTTP MODE)", flush=True)
    print(f"Target Endpoint: {API_BASE}/v1/semantic/query | Org: {ORG_ID} | Agent: {AGENT}", flush=True)
    print("=" * 80, flush=True)

    # Health check
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=5) as resp:
            health = json.loads(resp.read().decode())
            print(f"✅ Health OK: {health.get('status')}, Warm: {health.get('metricflow', {}).get('warm')}\n", flush=True)
    except Exception as exc:
        print(f"❌ API unreachable at {API_BASE}/health ({exc}). Aborting.", flush=True)
        return 1

    metric_ids, policies, sem_models = load_ticketing_inventory()
    print(f"📦 Ingested {len(metric_ids)} Ticketing metrics and {len(policies)} policies.\n", flush=True)

    results = []
    suite_stats = defaultdict(lambda: {"total": 0, "passed": 0, "failed": 0, "fallback_recovered": 0})
    error_counts = defaultdict(int)

    # -------------------------------------------------------------------------
    # SUITE 1: Baseline Scalar Aggregations (All 95 Metrics, group_by: [])
    # -------------------------------------------------------------------------
    print("🔹 [Suite 1/7] Testing 95 Baseline Scalar Metrics (group_by: [])...", flush=True)
    for idx, mid in enumerate(metric_ids, 1):
        test_id = f"S1_SCALAR_{idx:03d}_{mid}"
        rec = run_test_case(test_id, "Suite 1: Scalar Baseline", [mid])
        results.append(rec)
        suite_stats["Suite 1"]["total"] += 1
        if rec["passed"]:
            suite_stats["Suite 1"]["passed"] += 1
            print(f"  [PASS] {idx:02d}/{len(metric_ids)} {mid} ({rec['elapsed_s']}s)", flush=True)
        else:
            suite_stats["Suite 1"]["failed"] += 1
            error_counts[rec["error_category"]] += 1
            fb_str = "➔ FB OK" if rec["fallback_recovered"] else f"➔ FB FAIL ({rec['fallback_status']})"
            print(f"  [FAIL] {idx:02d}/{len(metric_ids)} {mid} HTTP {rec['status']} [{rec['error_category']}] {fb_str}", flush=True)

    # -------------------------------------------------------------------------
    # SUITE 2: Single-Dimension Breakdown
    # -------------------------------------------------------------------------
    print("\n🔹 [Suite 2/7] Testing Single-Dimension Permutations...", flush=True)
    s2_tests = []
    for mid in metric_ids:
        pol = policies.get(mid, {})
        dims = pol.get("dims") or []
        for dim in dims[:4]:  # test up to 4 declared dimensions
            s2_tests.append((mid, dim))

    print(f"  Generated {len(s2_tests)} metric-dimension pairs.", flush=True)
    for idx, (mid, dim) in enumerate(s2_tests, 1):
        test_id = f"S2_DIM_{idx:03d}_{mid}_{dim}"
        rec = run_test_case(test_id, "Suite 2: Single Dimension", [mid], group_by=[dim])
        results.append(rec)
        suite_stats["Suite 2"]["total"] += 1
        if rec["passed"]:
            suite_stats["Suite 2"]["passed"] += 1
            print(f"  [PASS] ({idx:03d}/{len(s2_tests)}) {mid} by '{dim}' ({rec['elapsed_s']}s)", flush=True)
        else:
            suite_stats["Suite 2"]["failed"] += 1
            error_counts[rec["error_category"]] += 1
            fb_str = "➔ FB OK" if rec["fallback_recovered"] else f"➔ FB FAIL ({rec['fallback_status']})"
            print(f"  [FAIL] ({idx:03d}/{len(s2_tests)}) {mid} by '{dim}' HTTP {rec['status']} [{rec['error_category']}] {fb_str}", flush=True)

    # -------------------------------------------------------------------------
    # SUITE 3: Time Granularity & Relative Range Permutations
    # -------------------------------------------------------------------------
    print("\n🔹 [Suite 3/7] Testing Time Granularities & Relative Windows...", flush=True)
    time_metrics = [
        "ticket_volume",
        "open_tickets_metric",
        "resolved_tickets_metric",
        "sla_breach_rate",
        "average_resolution_time_hours",
        "csat_response_rate",
        "note_volume",
        "reopen_rate",
    ]
    grains = ["day", "week", "month", "quarter", "year"]
    periods = ["last_7_days", "last_30_days", "this_quarter"]

    s3_count = 0
    for mid in time_metrics:
        # Explicit start/end with grain
        for g in grains:
            s3_count += 1
            test_id = f"S3_TIME_GRAIN_{s3_count:03d}_{mid}_{g}"
            time_spec = {"start": "2026-08-01", "end": "2026-09-01", "grain": g}
            rec = run_test_case(test_id, "Suite 3: Time Windows", [mid], time_spec=time_spec)
            results.append(rec)
            suite_stats["Suite 3"]["total"] += 1
            if rec["passed"]:
                suite_stats["Suite 3"]["passed"] += 1
                print(f"  [PASS] {mid} grain={g} ({rec['elapsed_s']}s)", flush=True)
            else:
                suite_stats["Suite 3"]["failed"] += 1
                error_counts[rec["error_category"]] += 1
                fb_str = "➔ FB OK" if rec["fallback_recovered"] else f"➔ FB FAIL ({rec['fallback_status']})"
                print(f"  [FAIL] {mid} grain={g} HTTP {rec['status']} [{rec['error_category']}] {fb_str}", flush=True)

        # Relative period
        for p in periods:
            s3_count += 1
            test_id = f"S3_TIME_PERIOD_{s3_count:03d}_{mid}_{p}"
            time_spec = {"period": p}
            rec = run_test_case(test_id, "Suite 3: Time Windows", [mid], time_spec=time_spec)
            results.append(rec)
            suite_stats["Suite 3"]["total"] += 1
            if rec["passed"]:
                suite_stats["Suite 3"]["passed"] += 1
                print(f"  [PASS] {mid} period={p} ({rec['elapsed_s']}s)", flush=True)
            else:
                suite_stats["Suite 3"]["failed"] += 1
                error_counts[rec["error_category"]] += 1
                fb_str = "➔ FB OK" if rec["fallback_recovered"] else f"➔ FB FAIL ({rec['fallback_status']})"
                print(f"  [FAIL] {mid} period={p} HTTP {rec['status']} [{rec['error_category']}] {fb_str}", flush=True)

    # -------------------------------------------------------------------------
    # SUITE 4: Multi-Dimensional Permutations
    # -------------------------------------------------------------------------
    print("\n🔹 [Suite 4/7] Testing Multi-Dimensional Permutations (Composite group_by)...", flush=True)
    multi_dim_cases = [
        ("ticket_volume", ["priority", "channel"]),
        ("ticket_volume", ["queue_name", "status"]),
        ("open_tickets_metric", ["priority", "queue_name"]),
        ("open_tickets_metric", ["status", "priority"]),
        ("resolved_tickets_metric", ["channel", "priority"]),
        ("sla_breach_rate", ["priority", "queue_name"]),
        ("sla_breach_rate", ["channel", "priority"]),
        ("average_resolution_time_hours", ["priority", "queue_name"]),
        ("note_volume", ["is_internal_note", "ticket_priority"]),
        ("csat_response_rate", ["priority", "queue_name"]),
        ("reopen_rate", ["priority", "queue_name"]),
        ("active_tickets_metric", ["status", "priority"]),
    ]
    for idx, (mid, dims) in enumerate(multi_dim_cases, 1):
        test_id = f"S4_MULTIDIM_{idx:03d}_{mid}_{'_'.join(dims)}"
        rec = run_test_case(test_id, "Suite 4: Multi-Dimensional", [mid], group_by=dims)
        results.append(rec)
        suite_stats["Suite 4"]["total"] += 1
        if rec["passed"]:
            suite_stats["Suite 4"]["passed"] += 1
            print(f"  [PASS] {mid} by {dims} ({rec['elapsed_s']}s)", flush=True)
        else:
            suite_stats["Suite 4"]["failed"] += 1
            error_counts[rec["error_category"]] += 1
            fb_str = "➔ FB OK" if rec["fallback_recovered"] else f"➔ FB FAIL ({rec['fallback_status']})"
            print(f"  [FAIL] {mid} by {dims} HTTP {rec['status']} [{rec['error_category']}] {fb_str}", flush=True)

    # -------------------------------------------------------------------------
    # SUITE 5: Structured Dimension Filters
    # -------------------------------------------------------------------------
    print("\n🔹 [Suite 5/7] Testing Dimension Filter Combinations...", flush=True)
    filter_cases = [
        ("ticket_volume", [{"dimension": "priority", "op": "eq", "value": "p1"}]),
        ("ticket_volume", [{"dimension": "channel", "op": "in", "values": ["email", "web"]}]),
        ("open_tickets_metric", [{"dimension": "priority", "op": "eq", "value": "urgent"}]),
        ("open_tickets_metric", [{"dimension": "status", "op": "neq", "value": "closed"}]),
        ("sla_breach_rate", [{"dimension": "priority", "op": "eq", "value": "p1"}]),
        ("resolved_tickets_metric", [{"dimension": "channel", "op": "eq", "value": "email"}]),
        ("average_resolution_time_hours", [{"dimension": "queue_name", "op": "eq", "value": "support"}]),
        ("due_today_tickets_metric", [{"dimension": "priority", "op": "eq", "value": "p1"}]),
    ]
    for idx, (mid, flts) in enumerate(filter_cases, 1):
        test_id = f"S5_FILTER_{idx:03d}_{mid}"
        rec = run_test_case(test_id, "Suite 5: Filter Combinations", [mid], filters=flts)
        results.append(rec)
        suite_stats["Suite 5"]["total"] += 1
        if rec["passed"]:
            suite_stats["Suite 5"]["passed"] += 1
            print(f"  [PASS] {mid} with filter {flts} ({rec['elapsed_s']}s)", flush=True)
        else:
            suite_stats["Suite 5"]["failed"] += 1
            error_counts[rec["error_category"]] += 1
            fb_str = "➔ FB OK" if rec["fallback_recovered"] else f"➔ FB FAIL ({rec['fallback_status']})"
            print(f"  [FAIL] {mid} with filter {flts} HTTP {rec['status']} [{rec['error_category']}] {fb_str}", flush=True)

    # -------------------------------------------------------------------------
    # SUITE 6: Multi-Metric Bundles & Fan-Out Merging
    # -------------------------------------------------------------------------
    print("\n🔹 [Suite 6/7] Testing Multi-Metric Bundles & Fan-Out Merging...", flush=True)
    multi_metric_bundles = [
        (["ticket_volume", "open_tickets_metric"], None),
        (["ticket_volume", "open_tickets_metric", "resolved_tickets_metric"], None),
        (["open_tickets_metric", "sla_breach_rate"], ["priority"]),
        (["ticket_volume", "average_resolution_time_hours"], ["queue_name"]),
        (["ticket_volume", "note_volume"], None),  # Cross-model bundle
        (["open_tickets_metric", "kb_article_volume"], None),  # Cross-model bundle
    ]
    for idx, (bundle, grp) in enumerate(multi_metric_bundles, 1):
        test_id = f"S6_BUNDLE_{idx:03d}_{len(bundle)}metrics"
        rec = run_test_case(test_id, "Suite 6: Multi-Metric Bundles", bundle, group_by=grp)
        results.append(rec)
        suite_stats["Suite 6"]["total"] += 1
        if rec["passed"]:
            suite_stats["Suite 6"]["passed"] += 1
            print(f"  [PASS] Bundle {bundle} group_by={grp} ({rec['elapsed_s']}s)", flush=True)
        else:
            suite_stats["Suite 6"]["failed"] += 1
            error_counts[rec["error_category"]] += 1
            print(f"  [FAIL] Bundle {bundle} HTTP {rec['status']} [{rec['error_category']}]", flush=True)

    # -------------------------------------------------------------------------
    # SUITE 7: Role Scope & Authorization Gating
    # -------------------------------------------------------------------------
    print("\n🔹 [Suite 7/7] Testing Role Scope & Agent Authorization Gating...", flush=True)
    # Expected 200 on authorized analytical agent
    rec1 = run_test_case("S7_ROLE_001_AUTH_AGENT", "Suite 7: Scope & Gating", ["open_tickets_metric"], agent="tk.reporting", expected_status=200)
    # Expected 400 on operational ticket agent
    rec2 = run_test_case("S7_ROLE_002_DENIED_AGENT_TICKETS", "Suite 7: Scope & Gating", ["open_tickets_metric"], agent="tk.tickets", expected_status=400)
    # Expected 400 on supervisor non-analytical agent
    rec3 = run_test_case("S7_ROLE_003_DENIED_AGENT_SUPER", "Suite 7: Scope & Gating", ["open_tickets_metric"], agent="tk.super", expected_status=400)

    for rec in [rec1, rec2, rec3]:
        results.append(rec)
        suite_stats["Suite 7"]["total"] += 1
        if rec["passed"]:
            suite_stats["Suite 7"]["passed"] += 1
            print(f"  [PASS] Gating Test {rec['test_id']} (Status {rec['status']} as expected)", flush=True)
        else:
            suite_stats["Suite 7"]["failed"] += 1
            print(f"  [FAIL] Gating Test {rec['test_id']} (Status {rec['status']}, expected {rec['expected_status']})", flush=True)

    # -------------------------------------------------------------------------
    # SUMMARY & TELEMETRY DUMP
    # -------------------------------------------------------------------------
    total_tests = len(results)
    total_passed = sum(1 for r in results if r["passed"])
    total_failed = sum(1 for r in results if not r["passed"])
    fallback_tested = sum(1 for r in results if r["fallback_tested"])
    fallback_recovered = sum(1 for r in results if r["fallback_recovered"])

    summary = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "target_endpoint": f"{API_BASE}/v1/semantic/query",
        "sql_fallback_endpoint": f"{API_BASE}/v1/sql/query",
        "total_tests": total_tests,
        "total_passed": total_passed,
        "total_failed": total_failed,
        "pass_rate_pct": round((total_passed / total_tests) * 100, 2) if total_tests else 0,
        "fallback_tested": fallback_tested,
        "fallback_recovered": fallback_recovered,
        "fallback_recovery_rate_pct": round((fallback_recovered / fallback_tested) * 100, 2) if fallback_tested else 0,
        "suite_breakdown": dict(suite_stats),
        "error_categories": dict(error_counts),
        "test_results": results,
    }

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 80, flush=True)
    print("📊 BENCHMARK EXECUTION SUMMARY", flush=True)
    print(f"Total Tests Executed:       {total_tests}", flush=True)
    print(f"Total Queries Passed:       {total_passed} ({summary['pass_rate_pct']}%)", flush=True)
    print(f"Total Queries Failed:       {total_failed}", flush=True)
    print(f"SQL Fallbacks Tested:       {fallback_tested}", flush=True)
    print(f"SQL Fallbacks Recovered:    {fallback_recovered} ({summary['fallback_recovery_rate_pct']}%)", flush=True)
    print(f"Results Written To:         {OUTPUT_JSON}", flush=True)
    print("=" * 80, flush=True)

    for suite_name, st in suite_stats.items():
        pct = round((st['passed'] / st['total']) * 100, 1) if st['total'] else 0
        print(f"  • {suite_name:30s}: {st['passed']}/{st['total']} passed ({pct}%)", flush=True)

    if error_counts:
        print("\n⚠️ ERROR BREAKDOWN:", flush=True)
        for err_cat, count in sorted(error_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"  • {err_cat:30s}: {count} occurrences", flush=True)

    return 0 if total_failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
