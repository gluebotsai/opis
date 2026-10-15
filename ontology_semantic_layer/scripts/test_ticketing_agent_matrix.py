#!/usr/bin/env python3
"""Ticketing agent matrix — MF + SQL (Phase 2 gate)."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

API = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
USER = int(os.environ.get("USER_ID", "1001"))

REPORTING_AGENTS = {
    "tk.reporting": [
        "open_tickets_metric",
        "ticket_volume",
        "resolution_sla_compliance_rate",
    ],
    "analytics_audit_query_executor": ["open_tickets_metric"],
    "insights_analytics_executor": ["open_tickets_metric"],
}

DENY_AGENTS = {
    "ticketing_super_agent": ["open_tickets_metric"],
    "tk.super": ["open_tickets_metric"],
    "intake_deflection_domain": ["open_tickets_metric"],
    "ticket_lifecycle_executor": ["open_tickets_metric"],
    "ticket_creation_executor": ["open_tickets_metric"],
    "root_cause_learning_executor": ["open_tickets_metric"],
    "tiaa": ["open_tickets_metric"],
    "dssa": ["open_tickets_metric"],
    "not_registered_executor": ["open_tickets_metric"],
}

SQL_LIST_AGENTS = ["ticket_lifecycle_executor", "ticket_creation_executor"]


def _api_available() -> bool:
    try:
        urllib.request.urlopen(f"{API}/health", timeout=3)
        return True
    except Exception:
        return False


def _post(path: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read())
        except json.JSONDecodeError:
            return exc.code, {"detail": exc.read().decode()}
    except urllib.error.URLError as exc:
        raise SystemExit(
            f"API not reachable at {API} ({exc.reason}).\n"
            "Start it in another terminal:\n"
            "  cd ontology_semantic_layer && PYTHONPATH=. bash scripts/run_context_layer_api.sh\n"
            "Or with conda myenv:\n"
            "  PYTHONPATH=. python -m uvicorn api.main:app --host 0.0.0.0 --port 8765"
        ) from exc


def main() -> int:
    if not _api_available():
        raise SystemExit(
            f"API not reachable at {API}/health.\n"
            "Start it in another terminal:\n"
            "  cd ontology_semantic_layer && PYTHONPATH=. bash scripts/run_context_layer_api.sh"
        )
    failed = 0
    print(f"Ticketing agent matrix org={ORG} api={API}")

    for agent, metrics in REPORTING_AGENTS.items():
        for mid in metrics:
            code, resp = _post(
                "/v1/semantic/query",
                {
                    "organizationId": ORG,
                    "userId": USER,
                    "product": "ticketing",
                    "agent": agent,
                    "metrics": [mid],
                },
            )
            if code == 200:
                val = (resp.get("rows") or [{}])[0].get(mid)
                print(f"  PASS  MF {agent} {mid} val={val}")
            else:
                detail = resp.get("detail", resp)
                print(f"  FAIL  MF {agent} {mid} HTTP {code} {str(detail)[:80]}")
                failed += 1

    for agent, metrics in DENY_AGENTS.items():
        for mid in metrics:
            code, resp = _post(
                "/v1/semantic/query",
                {
                    "organizationId": ORG,
                    "userId": USER,
                    "product": "ticketing",
                    "agent": agent,
                    "metrics": [mid],
                },
            )
            if code == 200:
                print(f"  FAIL  MF {agent} {mid} should be denied, got 200")
                failed += 1
            else:
                print(f"  PASS  MF deny {agent} {mid} HTTP {code}")

    for agent in SQL_LIST_AGENTS:
        code, resp = _post(
            "/v1/sql/query",
            {
                "organizationId": ORG,
                "userId": USER,
                "originProduct": "ticketing",
                "originAgent": agent,
                "instruction": "list open tickets",
                "entityHint": "wt:Ticket",
                "limit": 5,
            },
        )
        if code == 200:
            print(f"  PASS  SQL list {agent} rows={resp.get('rowCount')}")
        else:
            print(f"  FAIL  SQL list {agent} HTTP {code}")
            failed += 1

    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
