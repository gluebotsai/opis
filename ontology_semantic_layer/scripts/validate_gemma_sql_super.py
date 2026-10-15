#!/usr/bin/env python3
"""Trace + validate Gemma SQL Super: metrics, listings, presets, isolation."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ORG = int(os.environ.get("TEST_ORG", "1000"))
USER = int(os.environ.get("TEST_USER", "1001"))
REPORTING = os.environ.get("TEST_REPORTING_AGENT", "tk.reporting")
LIFECYCLE = os.environ.get("TEST_LIFECYCLE_AGENT", "ticket_lifecycle_executor")
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


def _scalar(rows: list, key: str) -> Any:
    if not rows:
        return None
    return rows[0].get(key, rows[0].get("value"))


def check_plan_compliance() -> list[dict]:
    """Static trace: plan artifacts exist and MetricFlow isolated from SQL MAS."""
    checks: list[dict] = []
    required = [
        ROOT / "semantic/sql/mas/gemma_client.py",
        ROOT / "semantic/sql/mas/harness.py",
        ROOT / "semantic/sql/mas/super_planner.py",
        ROOT / "semantic/sql/mas/product_executor.py",
        ROOT / "semantic/sql/mas/orchestrator.py",
        ROOT / "semantic/sql/presets/catalog.yml",
        ROOT / "scripts/test_sql_mas_live.py",
    ]
    for path in required:
        checks.append({"name": f"file_{path.name}", "pass": path.is_file(), "path": str(path)})

    orch = (ROOT / "semantic/sql/mas/orchestrator.py").read_text(encoding="utf-8")
    checks.append(
        {
            "name": "no_semantic_execute_in_orchestrator",
            "pass": "semantic_execute" not in orch,
        }
    )

    from semantic.sql.presets.loader import list_preset_summaries, load_preset

    presets = list_preset_summaries()
    checks.append({"name": "presets_loaded", "pass": len(presets) >= 10, "count": len(presets)})
    for pid in (
        "tk.tickets",
        "tk.queue",
        "tk.audit",
        "cc.conversations",
        "metric.certified",
    ):
        try:
            load_preset(pid)
            ok = True
        except KeyError:
            ok = False
        checks.append({"name": f"preset_{pid}", "pass": ok})

    from semantic.sql.mas.gemma_client import completions_url, llm_timeout_s

    checks.append(
        {
            "name": "gemma_url_format",
            "pass": completions_url().endswith("/chat/completions"),
            "url": completions_url(),
            "timeout_s": llm_timeout_s(),
        }
    )
    return checks


def check_semantic_metrics() -> list[dict]:
    """MetricFlow path — POST /v1/semantic/query only."""
    metrics = [
        "open_tickets_metric",
        "ticket_volume",
        "unassigned_tickets_metric",
        "average_csat_score",
    ]
    out: list[dict] = []
    for mid in metrics:
        body = {
            "organizationId": ORG,
            "userId": USER,
            "product": "ticketing",
            "agent": REPORTING,
            "metrics": [mid],
        }
        code, resp, ms = _post("/v1/semantic/query", body)
        rows = resp.get("rows") or []
        val = _scalar(rows, mid)
        out.append(
            {
                "name": f"semantic_{mid}",
                "pass": code == 200 and val is not None,
                "http": code,
                "value": val,
                "latencyMs": ms,
            }
        )
    return out


def check_sql_listings() -> list[dict]:
    """Natural-language listing queries via POST /v1/sql/query."""
    cases = [
        {
            "name": "list_open_tickets",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "ticketing",
                "originAgent": LIFECYCLE,
                "instruction": "list open tickets with assignee names",
                "limit": 50,
            },
            "expect_preset": "tk.tickets",
            "pg_sql": (
                "SELECT COUNT(*) FROM ticketing_marts.mart_tickets "
                "WHERE organization_id = %s AND lower(status) = 'open'"
            ),
        },
        {
            "name": "list_audit_history",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "ticketing",
                "originAgent": LIFECYCLE,
                "instruction": "show audit history and escalations",
                "limit": 50,
            },
            "expect_preset": "tk.audit",
        },
        {
            "name": "list_queue_depth",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "ticketing",
                "originAgent": LIFECYCLE,
                "instruction": "show queue depth and team membership",
                "limit": 30,
            },
            "expect_preset": "tk.queue",
        },
        {
            "name": "list_ticket_notes",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "ticketing",
                "originAgent": LIFECYCLE,
                "instruction": "list ticket comments and replies",
                "limit": 25,
            },
            "expect_preset": "tk.notes",
        },
        {
            "name": "contact_centre_conversations",
            "body": {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "contact_centre",
                "originAgent": "cc.reporting",
                "instruction": "list open conversations with agent names",
                "limit": 25,
            },
            "expect_preset": "cc.conversations",
        },
    ]
    out: list[dict] = []
    for case in cases:
        code, resp, ms = _post("/v1/sql/query", case["body"])
        meta = resp.get("_meta") or {}
        rows = resp.get("rows") or []
        pg_count = None
        if case.get("pg_sql"):
            try:
                pg_count = _pg_scalar(case["pg_sql"], (str(ORG),))
            except Exception as exc:
                pg_count = f"pg_error:{exc}"
        count_ok = True
        if pg_count is not None and isinstance(pg_count, int):
            count_ok = len(rows) == pg_count
        out.append(
            {
                "name": case["name"],
                "pass": code == 200
                and meta.get("source") == "sql_list"
                and meta.get("presetId") == case["expect_preset"]
                and count_ok,
                "http": code,
                "preset": meta.get("presetId"),
                "source": meta.get("source"),
                "rows": len(rows),
                "pg_count": pg_count,
                "latencyMs": meta.get("latencyMs") or ms,
                "planner": meta.get("planner"),
            }
        )
    return out


def check_sql_kpi_fallback() -> list[dict]:
    """SQL path KPI — must use metric_fallback, never metricflow."""
    cases = [
        {
            "name": "kpi_open_tickets",
            "instruction": "how many open tickets",
            "metric": "open_tickets_metric",
            "pg_sql": (
                "SELECT COUNT(*) FROM ticketing_marts.mart_tickets "
                "WHERE organization_id = %s AND lower(status) = 'open'"
            ),
        },
        {
            "name": "kpi_ticket_volume",
            "instruction": "what is ticket volume",
            "metric": "ticket_volume",
            "pg_sql": (
                "SELECT COUNT(*) FROM ticketing_marts.mart_tickets WHERE organization_id = %s"
            ),
        },
    ]
    out: list[dict] = []
    for case in cases:
        body = {
            "organizationId": ORG,
            "userId": USER,
            "originProduct": "ticketing",
            "originAgent": REPORTING,
            "instruction": case["instruction"],
            "limit": 1,
        }
        code, resp, ms = _post("/v1/sql/query", body)
        meta = resp.get("_meta") or {}
        rows = resp.get("rows") or []
        api_val = _scalar(rows, case["metric"])
        try:
            pg_val = _pg_scalar(case["pg_sql"], (str(ORG),))
        except Exception:
            pg_val = None
        out.append(
            {
                "name": case["name"],
                "pass": code == 200
                and meta.get("source") == "metric_fallback"
                and meta.get("source") != "semantic"
                and meta.get("source") != "metricflow"
                and (pg_val is None or api_val == pg_val),
                "http": code,
                "source": meta.get("source"),
                "preset": meta.get("presetId"),
                "api": api_val,
                "pg": pg_val,
                "latencyMs": meta.get("latencyMs") or ms,
            }
        )
    return out


def check_guardrails() -> list[dict]:
    out: list[dict] = []
    # list-only agent cannot run KPI
    code, _, _ = _post(
        "/v1/sql/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "originProduct": "ticketing",
            "originAgent": LIFECYCLE,
            "instruction": "how many open tickets",
            "limit": 1,
        },
        expect=400,
    )
    out.append({"name": "list_only_kpi_denied", "pass": code == 400, "http": code})

    # INSERT rejected
    code2, resp2, _ = _post(
        "/v1/sql/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "originProduct": "ticketing",
            "originAgent": REPORTING,
            "instruction": "INSERT INTO mart_tickets VALUES (1)",
            "limit": 1,
        },
    )
    out.append({"name": "insert_rejected", "pass": code2 == 400, "http": code2, "note": "requires API restart with new code"})

    # semantic extra query field rejected
    code3, _, _ = _post(
        "/v1/semantic/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "product": "ticketing",
            "agent": REPORTING,
            "metrics": ["open_tickets_metric"],
            "query": "how many open tickets",
        },
        expect=422,
    )
    out.append({"name": "semantic_extra_query_rejected", "pass": code3 == 422, "http": code3})
    return out


def check_direct_executor() -> list[dict]:
    """Direct in-process calls (bypasses API reload requirement)."""
    from semantic.sql.job import SqlQueryRequest
    from semantic.sql.super import SqlAgentError, execute_sql_query

    cases = [
        (
            "direct_list_tickets",
            SqlQueryRequest(
                organization_id=ORG,
                user_id=USER,
                origin_product="ticketing",
                origin_agent=LIFECYCLE,
                instruction="list open tickets",
                limit=20,
            ),
            "sql_list",
            "tk.tickets",
        ),
        (
            "direct_kpi_open",
            SqlQueryRequest(
                organization_id=ORG,
                user_id=USER,
                origin_product="ticketing",
                origin_agent=REPORTING,
                instruction="how many open tickets",
                limit=1,
            ),
            "metric_fallback",
            "metric.certified",
        ),
    ]
    out: list[dict] = []
    for name, req, exp_source, exp_preset in cases:
        t0 = time.perf_counter()
        try:
            result = execute_sql_query(req)
            ms = int((time.perf_counter() - t0) * 1000)
            out.append(
                {
                    "name": name,
                    "pass": result.get("source") == exp_source
                    and result.get("presetId") == exp_preset
                    and ms <= MAX_MS,
                    "source": result.get("source"),
                    "preset": result.get("presetId"),
                    "rows": result.get("rowCount"),
                    "latencyMs": ms,
                    "planner": result.get("planner"),
                }
            )
        except SqlAgentError as exc:
            out.append({"name": name, "pass": False, "error": str(exc)})
        except Exception as exc:
            out.append({"name": name, "pass": False, "error": f"{type(exc).__name__}: {exc}"})
    return out


def main() -> int:
    sections: dict[str, list[dict]] = {
        "plan_compliance": check_plan_compliance(),
        "semantic_metrics": [],
        "sql_listings": [],
        "sql_kpi_fallback": [],
        "guardrails": [],
        "direct_executor": [],
    }

    api_ok = False
    try:
        import urllib.request

        with urllib.request.urlopen(f"{BASE}/health", timeout=5) as resp:
            api_ok = resp.getcode() == 200
    except Exception:
        api_ok = False

    if api_ok:
        sections["semantic_metrics"] = check_semantic_metrics()
        sections["sql_listings"] = check_sql_listings()
        sections["sql_kpi_fallback"] = check_sql_kpi_fallback()
        sections["guardrails"] = check_guardrails()
    else:
        sections["api"] = [{"name": "api_health", "pass": False, "message": f"{BASE} not reachable"}]

    sections["direct_executor"] = check_direct_executor()

    all_checks: list[dict] = []
    for sec, checks in sections.items():
        for c in checks:
            c["section"] = sec
            all_checks.append(c)

    failed = [c for c in all_checks if not c.get("pass")]
    report = {
        "api_reachable": api_ok,
        "org": ORG,
        "user": USER,
        "sections": {k: v for k, v in sections.items()},
        "summary": {
            "total": len(all_checks),
            "passed": len(all_checks) - len(failed),
            "failed": len(failed),
        },
    }
    print(json.dumps(report, indent=2, default=str))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
