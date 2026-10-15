#!/usr/bin/env python3
"""Live verification matrix for Gemma SQL Super + Ticketing CL regressions (org 1000)."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import urllib.error
import urllib.request

ORG = int(os.environ.get("TEST_ORG", "1000"))
USER = int(os.environ.get("TEST_USER", "1001"))
REPORTING_AGENT = os.environ.get("TEST_REPORTING_AGENT", "tk.reporting")
LIFECYCLE_AGENT = os.environ.get("TEST_LIFECYCLE_AGENT", "ticket_lifecycle_executor")
BASE = os.environ.get("CONTEXT_LAYER_URL", "http://127.0.0.1:8765").rstrip("/")
MAX_LATENCY_MS = int(os.environ.get("SQL_MAS_MAX_LATENCY_MS", "6000"))


def _post(path: str, body: dict[str, Any], *, expect: int | None = None) -> tuple[int, dict]:
    url = f"{BASE}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            code = resp.getcode()
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        code = exc.code
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {"detail": exc.reason}
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    payload["_elapsedMs"] = elapsed_ms
    if expect is not None and code != expect:
        raise AssertionError(f"{path} expected {expect} got {code}: {payload}")
    return code, payload


def _scalar(rows: list, metric: str) -> Any:
    if not rows:
        return None
    row = rows[0]
    return row.get(metric, row.get("value"))


def _pg_scalar(sql: str, params: tuple) -> Any:
    from semantic.pg_pool import checkout_connection, release_connection

    conn = checkout_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        release_connection(conn)


def check_semantic_extra_query() -> dict:
    body = {
        "organizationId": ORG,
        "userId": USER,
        "product": "ticketing",
        "agent": REPORTING_AGENT,
        "metrics": ["open_tickets_metric"],
        "query": "how many open tickets",
    }
    code, _ = _post("/v1/semantic/query", body, expect=422)
    return {"name": "semantic_extra_query_rejected", "pass": code == 422}


def check_headline_kpis() -> list[dict]:
    from scripts.validate_ticketing_core_metrics import _pg_conn, _scope_clause, ground_truth

    _, assignee_ids, _ = _scope_clause()
    checks = []
    metrics = [
        "open_tickets_metric",
        "unassigned_tickets_metric",
        "ticket_volume",
        "current_overdue_tickets_metric",
        "average_csat_score",
        "high_priority_open_tickets_metric",
    ]
    conn = _pg_conn()
    for mid in metrics:
        body = {
            "organizationId": ORG,
            "userId": USER,
            "product": "ticketing",
            "agent": REPORTING_AGENT,
            "metrics": [mid],
        }
        code, resp = _post("/v1/semantic/query", body)
        api_val = _scalar(resp.get("rows") or resp.get("data") or [], mid)
        with conn.cursor() as cur:
            pg_val, _ = ground_truth(cur, mid, assignee_ids=assignee_ids)
        ok = code == 200 and api_val == pg_val
        checks.append(
            {
                "name": f"semantic_{mid}",
                "pass": ok,
                "http": code,
                "api": api_val,
                "pg": pg_val,
            }
        )
    if conn is not None:
        conn.close()
    return checks


def check_sql_lists() -> list[dict]:
    checks = []
    body = {
        "organizationId": ORG,
        "userId": USER,
        "originProduct": "ticketing",
        "originAgent": LIFECYCLE_AGENT,
        "instruction": "list open tickets",
        "limit": 50,
    }
    code, resp = _post("/v1/sql/query", body)
    rows = resp.get("rows") or []
    meta = resp.get("_meta") or {}
    open_pg = _pg_scalar(
        "SELECT COUNT(*) FROM ticketing_marts.mart_tickets WHERE organization_id = %s AND lower(status) = 'open'",
        (str(ORG),),
    )
    checks.append(
        {
            "name": "sql_list_open_tickets",
            "pass": code == 200 and len(rows) == int(open_pg or 0),
            "http": code,
            "rows": len(rows),
            "pg_open": open_pg,
            "preset": meta.get("presetId"),
            "source": meta.get("source"),
            "latencyMs": meta.get("latencyMs") or resp.get("_elapsedMs"),
        }
    )

    audit_body = {**body, "instruction": "show audit history escalations"}
    code2, resp2 = _post("/v1/sql/query", audit_body)
    meta2 = resp2.get("_meta") or {}
    checks.append(
        {
            "name": "sql_audit_events",
            "pass": code2 == 200 and meta2.get("presetId") == "tk.audit",
            "http": code2,
            "rows": len(resp2.get("rows") or []),
            "preset": meta2.get("presetId"),
        }
    )

    queue_body = {**body, "instruction": "show queue depth and membership"}
    _, resp3 = _post("/v1/sql/query", queue_body)
    meta3 = resp3.get("_meta") or {}
    checks.append(
        {
            "name": "sql_queue_preset",
            "pass": meta3.get("presetId") == "tk.queue",
            "preset": meta3.get("presetId"),
        }
    )

    kpi_body = {**body, "instruction": "how many open tickets"}
    code3, _ = _post("/v1/sql/query", kpi_body, expect=400)
    checks.append(
        {
            "name": "lifecycle_kpi_denied",
            "pass": code3 == 400,
            "http": code3,
        }
    )
    return checks


def check_sql_kpi_fallback() -> dict:
    body = {
        "organizationId": ORG,
        "userId": USER,
        "originProduct": "ticketing",
        "originAgent": REPORTING_AGENT,
        "instruction": "how many open tickets",
        "limit": 1,
    }
    code, resp = _post("/v1/sql/query", body)
    meta = resp.get("_meta") or {}
    rows = resp.get("rows") or []
    api_val = _scalar(rows, "open_tickets_metric")
    pg_val = _pg_scalar(
        "SELECT COUNT(*) FROM ticketing_marts.mart_tickets WHERE organization_id = %s AND lower(status) = 'open'",
        (str(ORG),),
    )
    return {
        "name": "sql_kpi_template_fallback",
        "pass": code == 200
        and meta.get("source") == "metric_fallback"
        and api_val == pg_val,
        "http": code,
        "api": api_val,
        "pg": pg_val,
        "source": meta.get("source"),
        "preset": meta.get("presetId"),
    }


def check_contact_centre() -> dict:
    body = {
        "organizationId": ORG,
        "userId": USER,
        "originProduct": "contact_centre",
        "originAgent": "cc.reporting",
        "instruction": "list open conversations",
        "limit": 25,
    }
    code, resp = _post("/v1/sql/query", body)
    meta = resp.get("_meta") or {}
    return {
        "name": "contact_centre_conversations",
        "pass": code == 200 and meta.get("presetId") == "cc.conversations",
        "http": code,
        "preset": meta.get("presetId"),
        "rows": len(resp.get("rows") or []),
    }


def check_insert_rejected() -> dict:
    body = {
        "organizationId": ORG,
        "userId": USER,
        "originProduct": "ticketing",
        "originAgent": REPORTING_AGENT,
        "instruction": "INSERT INTO mart_tickets VALUES (1)",
        "limit": 1,
    }
    code, _ = _post("/v1/sql/query", body, expect=400)
    return {"name": "insert_instruction_rejected", "pass": code == 400, "http": code}


def check_latency() -> dict:
    latencies: list[int] = []
    body = {
        "organizationId": ORG,
        "userId": USER,
        "originProduct": "ticketing",
        "originAgent": LIFECYCLE_AGENT,
        "instruction": "list ticket names and status",
        "limit": 10,
    }
    for _ in range(3):
        _, resp = _post("/v1/sql/query", body)
        meta = resp.get("_meta") or {}
        latencies.append(int(meta.get("latencyMs") or resp.get("_elapsedMs") or 0))
    p95 = sorted(latencies)[-1] if latencies else 0
    return {
        "name": "sql_latency_p95",
        "pass": p95 <= MAX_LATENCY_MS,
        "p95Ms": p95,
        "samples": latencies,
        "budgetMs": MAX_LATENCY_MS,
    }


def check_super_slice() -> dict:
    import yaml

    path = ROOT / "ontology" / "slices" / "tk.super.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    actions = [str(a) for a in (data.get("actions") or [])]
    bad = [a for a in actions if "create_ticket" in a or "update_" in a or "delete_" in a]
    return {"name": "super_slice_no_writes", "pass": not bad, "bad_actions": bad}


def main() -> int:
    results: list[dict] = []
    results.append(check_semantic_extra_query())
    results.extend(check_headline_kpis())
    results.extend(check_sql_lists())
    results.append(check_sql_kpi_fallback())
    results.append(check_contact_centre())
    results.append(check_insert_rejected())
    results.append(check_latency())
    results.append(check_super_slice())

    failed = [r for r in results if not r.get("pass")]
    print(json.dumps({"checks": results, "failed": len(failed)}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
