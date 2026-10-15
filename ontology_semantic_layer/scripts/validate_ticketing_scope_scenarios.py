#!/usr/bin/env python3
"""Validate ticketing agents.id scope scenarios vs Postgres ground truth + live API.

Scenarios (org 1000 by default):
  - Admin org-wide KPI (open_tickets_metric)
  - Admin mine KPI (dataScope=mine)
  - Agent personal KPI (ticket_volume)
  - Resolver personal KPI (open_tickets_metric, assignee OR resolver)
  - Admin SQL list org vs mine
  - CRM scope unchanged (accounts identity)

Usage:
  PYTHONPATH=. python scripts/validate_ticketing_scope_scenarios.py
  ORG=1000 API_BASE=http://127.0.0.1:8765 PYTHONPATH=. python scripts/validate_ticketing_scope_scenarios.py
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8765").rstrip("/")
ORG = int(os.environ.get("ORG", "1000"))
AGENT = os.environ.get("AGENT", "tk.reporting")
SQL_AGENT = os.environ.get("SQL_AGENT", "ticket_lifecycle_executor")
DRIFT = float(os.environ.get("DRIFT_TOLERANCE", "0.0001"))
MART = "ticketing_marts.mart_tickets"
OUTPUT = ROOT / "scripts" / "ticketing_scope_validation_report.json"


@dataclass
class Scenario:
    name: str
    passed: bool
    note: str
    api_value: Any = None
    pg_value: Any = None
    extra: dict[str, Any] | None = None


def _close(a: float | None, b: float | None) -> bool:
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    if math.isnan(a) and math.isnan(b):
        return True
    return abs(a - b) <= max(DRIFT, abs(b) * 1e-6)


def _post(path: str, body: dict) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read())
        except json.JSONDecodeError:
            data = {"detail": exc.read().decode(errors="replace")}
        return exc.code, data


def _semantic(
    user_id: int,
    metric: str,
    *,
    data_scope: str | None = None,
) -> tuple[int, float | None, str]:
    body: dict[str, Any] = {
        "organizationId": ORG,
        "userId": user_id,
        "product": "ticketing",
        "agent": AGENT,
        "metrics": [metric],
    }
    if data_scope:
        body["dataScope"] = data_scope
    status, data = _post("/v1/semantic/query", body)
    if status != 200:
        return status, None, str(data.get("detail", data))[:200]
    rows = data.get("rows") or []
    val = rows[0].get(metric) if rows else None
    if val is not None:
        val = float(val)
    return status, val, ""


def _sql_list(user_id: int, instruction: str) -> tuple[int, list[dict], dict, str]:
    body = {
        "organizationId": ORG,
        "userId": user_id,
        "originProduct": "ticketing",
        "originAgent": SQL_AGENT,
        "instruction": instruction,
        "entityHint": "wt:Ticket",
        "limit": 500,
    }
    status, data = _post("/v1/sql/query", body)
    if status != 200:
        return status, [], {}, str(data.get("detail", data))[:200]
    meta = data.get("_meta") or {}
    return status, data.get("rows") or [], meta, ""


def _pg_scalar(cur, sql: str, params: list[Any]) -> float | None:
    cur.execute(sql, params)
    row = cur.fetchone()
    if row is None or row[0] is None:
        return None
    return float(row[0])


def main() -> int:
    from scripts.ticketing_agent_fixtures import _pg_conn, list_agents_by_role, load_dotenv
    from semantic.scope import lookup_user_scope

    load_dotenv()
    roles = list_agents_by_role(ORG)
    admin_id = roles.get("admin")
    agent_id = roles.get("agent")
    resolver_id = roles.get("resolver")
    missing = [r for r in ("admin", "agent", "resolver") if r not in roles]
    if missing:
        print(f"Missing agents for roles {missing} in org {ORG}")
        return 1

    print(
        f"Ticketing scope scenarios — org={ORG} admin={admin_id} agent={agent_id} "
        f"resolver={resolver_id} API={API_BASE}\n"
    )

    conn = _pg_conn()
    scenarios: list[Scenario] = []

    try:
        with conn.cursor() as cur:
            org_s = str(ORG)
            pg_org_open = _pg_scalar(
                cur,
                f"SELECT COUNT(*) FILTER (WHERE is_open) FROM {MART} WHERE organization_id = %s",
                [org_s],
            )

            def pg_mine_open(aid: int, *, dual: bool = False) -> float | None:
                if dual:
                    sql = (
                        f"SELECT COUNT(*) FILTER (WHERE is_open) FROM {MART} "
                        "WHERE organization_id = %s AND "
                        "(assignee_id::text = %s OR resolver_id::text = %s)"
                    )
                    params = [org_s, str(aid), str(aid)]
                else:
                    sql = (
                        f"SELECT COUNT(*) FILTER (WHERE is_open) FROM {MART} "
                        "WHERE organization_id = %s AND assignee_id::text = %s"
                    )
                    params = [org_s, str(aid)]
                return _pg_scalar(cur, sql, params)

            def pg_agent_volume(aid: int) -> float | None:
                return _pg_scalar(
                    cur,
                    f"SELECT COUNT(DISTINCT ticket_id) FROM {MART} "
                    "WHERE organization_id = %s AND assignee_id::text = %s",
                    [org_s, str(aid)],
                )

            # Admin org KPI
            st, api_val, err = _semantic(admin_id, "open_tickets_metric")
            ok = st == 200 and _close(api_val, pg_org_open)
            scenarios.append(
                Scenario(
                    "admin_org_open_tickets",
                    ok,
                    err or f"api={api_val} pg={pg_org_open}",
                    api_val,
                    pg_org_open,
                )
            )

            # Admin mine KPI
            pg_mine = pg_mine_open(admin_id, dual=True)
            st, api_val, err = _semantic(
                admin_id, "open_tickets_metric", data_scope="mine"
            )
            ok = st == 200 and _close(api_val, pg_mine)
            scenarios.append(
                Scenario(
                    "admin_mine_open_tickets",
                    ok,
                    err or f"api={api_val} pg={pg_mine}",
                    api_val,
                    pg_mine,
                )
            )

            # Agent personal KPI
            pg_vol = pg_agent_volume(agent_id)
            st, api_val, err = _semantic(agent_id, "ticket_volume")
            ok = st == 200 and _close(api_val, pg_vol)
            scenarios.append(
                Scenario(
                    "agent_ticket_volume",
                    ok,
                    err or f"api={api_val} pg={pg_vol}",
                    api_val,
                    pg_vol,
                )
            )

            # Resolver personal KPI (dual assignee/resolver)
            pg_res = pg_mine_open(resolver_id, dual=True)
            st, api_val, err = _semantic(resolver_id, "open_tickets_metric")
            ok = st == 200 and _close(api_val, pg_res)
            scenarios.append(
                Scenario(
                    "resolver_open_tickets",
                    ok,
                    err or f"api={api_val} pg={pg_res}",
                    api_val,
                    pg_res,
                )
            )

            pg_org_total = _pg_scalar(
                cur,
                f"SELECT COUNT(*) FROM {MART} WHERE organization_id = %s",
                [org_s],
            )
            pg_mine_total = _pg_scalar(
                cur,
                f"SELECT COUNT(*) FROM {MART} WHERE organization_id = %s "
                "AND (assignee_id::text = %s OR resolver_id::text = %s)",
                [org_s, str(admin_id), str(admin_id)],
            )

            # Admin SQL list org (all tickets — open list may be empty when no open tickets)
            st, rows, meta, err = _sql_list(admin_id, "list tickets")
            row_count = len(rows)
            scope_meta = (meta.get("scope") or {})
            ok = (
                st == 200
                and row_count > 0
                and scope_meta.get("identity") == "ticketing_agents"
                and row_count == pg_org_total
            )
            scenarios.append(
                Scenario(
                    "admin_sql_list_org",
                    ok,
                    err or f"rows={row_count} pg={pg_org_total} identity={scope_meta.get('identity')}",
                    row_count,
                    pg_org_total,
                    {"http": st},
                )
            )

            # Admin SQL list mine — row count vs Postgres assignee/resolver filter
            st, rows, meta, err = _sql_list(admin_id, "show my tickets")
            mine_count = len(rows)
            ok = st == 200 and mine_count == pg_mine_total
            scenarios.append(
                Scenario(
                    "admin_sql_list_mine",
                    ok,
                    err or f"rows={mine_count} pg={pg_mine_total}",
                    mine_count,
                    pg_mine_total,
                    {"http": st},
                )
            )

            # CRM regression — accounts identity unchanged
            crm_user = int(os.environ.get("CRM_USER_ID", "1001"))
            crm_scope = lookup_user_scope(ORG, crm_user, product="crm")
            crm_ok = crm_scope.identity != "ticketing_agents"
            scenarios.append(
                Scenario(
                    "crm_accounts_identity",
                    crm_ok,
                    f"identity={crm_scope.identity} role={crm_scope.role}",
                    None,
                    None,
                    {"user_id": crm_user},
                )
            )

    finally:
        conn.close()

    passed = sum(1 for s in scenarios if s.passed)
    failed = len(scenarios) - passed
    for s in scenarios:
        mark = "PASS" if s.passed else "FAIL"
        print(f"  {mark}  {s.name:28s}  {s.note}")

    report = {
        "org": ORG,
        "api": API_BASE,
        "agents": roles,
        "passed": passed,
        "failed": failed,
        "scenarios": [asdict(s) for s in scenarios],
    }
    OUTPUT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n{passed}/{len(scenarios)} passed. Report: {OUTPUT}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
