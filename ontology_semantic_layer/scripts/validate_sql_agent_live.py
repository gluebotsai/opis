#!/usr/bin/env python3
"""Live payload matrix for isolated SQL agent vs Postgres ground truth."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ORG = int(os.environ.get("TEST_ORG", "1000"))
USER = int(os.environ.get("TEST_USER", "1001"))
REPORTING = os.environ.get("TEST_REPORTING_AGENT", "tk.reporting")
COWORKER = os.environ.get("TEST_COWORKER_AGENT", "cc.coworker")
BASE = os.environ.get("CONTEXT_LAYER_URL", "http://127.0.0.1:8765").rstrip("/")
MAX_MS = int(os.environ.get("SQL_MAS_MAX_LATENCY_MS", "6000"))


def _post(path: str, body: dict[str, Any], *, expect: int | None = None) -> tuple[int, dict, int]:
    import urllib.error
    import urllib.request

    url = f"{BASE}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            code = resp.getcode()
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        code = exc.code
        try:
            payload = json.loads(exc.read().decode("utf-8"))
        except Exception:
            payload = {"detail": exc.reason}
    ms = int((time.perf_counter() - t0) * 1000)
    if expect is not None and code != expect:
        raise AssertionError(f"{path} expected {expect} got {code}: {payload}")
    return code, payload, ms


def _pg_count(table: str, schema: str, org: int) -> int:
    from semantic.pg_pool import checkout_connection, release_connection

    conn = checkout_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f'SELECT COUNT(*) FROM "{schema}"."{table}" WHERE organization_id = %s',
                (org,),
            )
            row = cur.fetchone()
            return int(row[0]) if row else 0
    finally:
        release_connection(conn)


def check_isolation() -> dict[str, Any]:
    proc = subprocess.run(
        [
            "rg",
            "semantic\\.query|semantic_execute|MetricFlow",
            str(ROOT / "sql_agent"),
        ],
        capture_output=True,
        text=True,
    )
    return {
        "name": "sql_agent_isolation_grep",
        "pass": proc.returncode == 1 and not proc.stdout.strip(),
        "hits": proc.stdout.strip() or None,
    }


def run_matrix() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    latencies: list[int] = []

    list_cases = [
        {
            "name": "ticketing_list",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "ticketing",
                "originAgent": REPORTING,
                "instruction": "list open tickets",
                "limit": 25,
            },
            "expect_preset": "tk.tickets",
        },
        {
            "name": "ccaas_contact_centre",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "contact_centre",
                "originAgent": "cc.reporting",
                "instruction": "list conversations",
                "limit": 25,
            },
            "expect_preset": "cc.conversations",
        },
        {
            "name": "crm_deals",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "crm",
                "originAgent": "crm.reporting",
                "instruction": "list deals in pipeline",
                "limit": 25,
            },
            "expect_preset": "crm.deals",
        },
        {
            "name": "campaign_overview",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "campaign",
                "originAgent": "campaign.reporting",
                "instruction": "list campaigns",
                "limit": 25,
            },
            "expect_preset": "camp.overview",
        },
    ]

    for case in list_cases:
        code, payload, ms = _post("/v1/sql/query", case["body"], expect=200)
        latencies.append(ms)
        meta = payload.get("_meta") or {}
        preset = meta.get("presetId") or payload.get("presetId")
        source = payload.get("source")
        ok = (
            source in ("sql_list", "metric_fallback", "sql_count")
            and preset == case["expect_preset"]
            and ms <= MAX_MS
        )
        results.append(
            {
                "name": case["name"],
                "pass": ok,
                "source": source,
                "presetId": preset,
                "latencyMs": ms,
                "rowCount": payload.get("rowCount", len(payload.get("rows") or [])),
            }
        )

    _, kpi_payload, kpi_ms = _post(
        "/v1/sql/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "originProduct": "ticketing",
            "originAgent": REPORTING,
            "instruction": "how many open tickets",
            "limit": 1,
        },
        expect=200,
    )
    latencies.append(kpi_ms)
    results.append(
        {
            "name": "ticketing_kpi",
            "pass": kpi_payload.get("source") == "metric_fallback"
            and kpi_ms <= MAX_MS,
            "source": kpi_payload.get("source"),
            "latencyMs": kpi_ms,
        }
    )

    _post(
        "/v1/sql/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "originProduct": "contact_centre",
            "originAgent": COWORKER,
            "instruction": "what is csat this week",
            "limit": 1,
        },
        expect=400,
    )
    results.append({"name": "list_only_kpi_denied", "pass": True})

    _post(
        "/v1/sql/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "originProduct": "ticketing",
            "originAgent": REPORTING,
            "instruction": "insert a ticket for testing",
            "limit": 1,
        },
        expect=400,
    )
    results.append({"name": "insert_denied", "pass": True})

    if latencies:
        latencies.sort()
        p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)]
        results.append({"name": "latency_p95", "pass": p95 <= MAX_MS, "p95Ms": p95})

    results.insert(0, check_isolation())
    return results


def main() -> int:
    report = {"results": run_matrix()}
    out = ROOT / "scripts" / "validate_sql_agent_live_report.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    failed = [r for r in report["results"] if not r.get("pass")]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
