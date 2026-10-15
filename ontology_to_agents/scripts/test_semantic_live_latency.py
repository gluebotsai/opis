#!/usr/bin/env python3
"""Live latency gate for semantic template path (org 1000, user 1001)."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER = int(os.environ.get("USER_ID", "1001"))
REPORTING_AGENT = os.environ.get(
    "REPORTING_AGENT", "analytics_audit_query_executor"
)
LIFECYCLE_AGENT = os.environ.get("LIFECYCLE_AGENT", "ticket_lifecycle_executor")


def _post(path: str, body: dict) -> tuple[float, dict]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return time.monotonic() - t0, payload
    except urllib.error.HTTPError as exc:
        wall = time.monotonic() - t0
        detail = exc.read().decode("utf-8", errors="replace")
        return wall, {"_http_error": exc.code, "detail": detail}


def _semantic(metric: str, agent: str = REPORTING_AGENT) -> tuple[float, dict]:
    return _post(
        "/v1/semantic/query",
        {
            "organizationId": ORG,
            "userId": USER,
            "product": "ticketing",
            "agent": agent,
            "metrics": [metric],
        },
    )


def main() -> int:
    cases = [
        ("open_tickets_metric", REPORTING_AGENT, "sql_template"),
        ("open_tickets_metric_repeat", REPORTING_AGENT, "sql_template"),
        ("kb_article_volume", REPORTING_AGENT, "sql_template"),
        ("deny_tk_tickets", "tk.tickets", "deny"),
        ("sql_list", LIFECYCLE_AGENT, "sql_list"),
        ("sql_count", LIFECYCLE_AGENT, "sql_count"),
    ]
    failed = 0
    print(f"API={API} org={ORG} user={USER}")
    for label, agent, expect in cases:
        if label == "sql_count":
            wall, payload = _post(
                "/v1/sql/query",
                {
                    "organizationId": ORG,
                    "userId": USER,
                    "originProduct": "ticketing",
                    "originAgent": agent,
                    "instruction": "what is the count of total tickets available",
                    "entityHint": "wt:Ticket",
                },
            )
            rows = payload.get("rows") or []
            ok = (
                payload.get("_http_error") is None
                and len(rows) == 1
                and ("ticket_volume" in rows[0] or "count" in rows[0])
                and wall < 6.0
            )
            print(
                f"{label}: wall={wall:.2f}s rows={rows} status={payload.get('status')} ok={ok}"
            )
            failed += 0 if ok else 1
            continue
        if label == "sql_list":
            wall, payload = _post(
                "/v1/sql/query",
                {
                    "organizationId": ORG,
                    "userId": USER,
                    "originProduct": "ticketing",
                    "originAgent": agent,
                    "instruction": "list open tickets",
                    "entityHint": "wt:Ticket",
                },
            )
            ok = "rows" in payload and "_http_error" not in payload
            print(
                f"{label}: wall={wall:.2f}s rows={len(payload.get('rows') or [])} "
                f"ok={ok} err={payload.get('_http_error')}"
            )
            failed += 0 if ok else 1
            continue
        metric = "open_tickets_metric" if "open_tickets" in label else "kb_article_volume"
        wall, payload = _semantic(metric, agent=agent)
        if expect == "deny":
            ok = payload.get("_http_error") == 400
            print(f"{label}: wall={wall:.2f}s deny={ok}")
            failed += 0 if ok else 1
            continue
        ok = (
            payload.get("_http_error") is None
            and "rows" in payload
            and "status" in payload
            and "threshold" in payload
            and wall < 6.0
        )
        print(
            f"{label}: wall={wall:.2f}s status={payload.get('status')} "
            f"rows={len(payload.get('rows') or [])} ok={ok}"
        )
        failed += 0 if ok else 1

    gb_body = {
        "organizationId": ORG,
        "userId": USER,
        "product": "ticketing",
        "agent": REPORTING_AGENT,
        "metrics": ["open_tickets_metric"],
        "group_by": ["priority"],
    }
    wall, payload = _post("/v1/semantic/query", gb_body)
    err = payload.get("_http_error")
    ok_gb = err is None and "rows" in payload and wall < 8.0
    print(
        f"group_by_priority: wall={wall:.2f}s rows={len(payload.get('rows') or [])} ok={ok_gb}"
    )
    if wall > 30:
        print("  FAIL  group_by looks like mega-graph compile")
        ok_gb = False
    failed += 0 if ok_gb else 1

    wall2, payload2 = _post("/v1/semantic/query", gb_body)
    ok_rep = payload2.get("_http_error") is None and wall2 < 6.0 and "rows" in payload2
    print(
        f"group_by_repeat: wall={wall2:.2f}s rows={len(payload2.get('rows') or [])} ok={ok_rep}"
    )
    failed += 0 if ok_rep else 1

    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
