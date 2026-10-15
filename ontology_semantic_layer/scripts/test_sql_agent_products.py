#!/usr/bin/env python3
"""SQL agent routing and SQL builder tests for all products."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from semantic.sql.executors.base import build_list_sql
from semantic.sql.job import ExecutorJob
from semantic.sql.router import default_table, route_product
from semantic.sql.validator import validate_readonly_sql


class Results:
    def __init__(self) -> None:
        self.ok = 0
        self.fail = 0

    def check(self, name: str, cond: bool) -> None:
        if cond:
            self.ok += 1
            print(f"  OK  {name}")
        else:
            self.fail += 1
            print(f"  FAIL {name}")


def _list_job(product: str, table: str, schema: str, engine: str = "postgres") -> ExecutorJob:
    return ExecutorJob(
        job_id="t",
        mode="list",
        product=product,
        engine=engine,
        organization_id=1000,
        user_id=1001,
        table=table,
        schema=schema,
        select=[],
        limit=10,
        scope="org",
    )


def test_routing(r: Results) -> None:
    r.check("ticket -> ticketing", route_product("wt:Ticket", "hub") == "ticketing")
    r.check("deal -> crm", route_product("wt:Deal", "hub") == "crm")
    r.check("campaign -> campaign", route_product("wt:Campaign", "hub") == "campaign")
    r.check("session -> webtracking", route_product("wt:Session", "hub") == "webtracking")


def test_defaults(r: Results) -> None:
    r.check("ticketing table", default_table("wt:Ticket", "ticketing") == "mart_tickets")
    r.check("crm table", default_table("wt:Deal", "crm") == "mart_deals")
    r.check("campaign table", default_table("wt:Campaign", "campaign") == "mart_campaign_overview")
    r.check("webtracking table", default_table("wt:Session", "webtracking") == "mart_web_sessions")


def test_sql_build(r: Results) -> None:
    cases = [
        ("ticketing", "mart_tickets", "ticketing_marts"),
        ("crm", "mart_deals", "crm_marts"),
        ("campaign", "mart_campaign_overview", "campaign_marts"),
    ]
    for product, table, schema in cases:
        job = _list_job(product, table, schema)
        sql, params = build_list_sql(job)
        validate_readonly_sql(sql)
        r.check(f"{product} SELECT", sql.strip().upper().startswith("SELECT"))
        r.check(f"{product} org filter", params[0] == "1000")


def main() -> int:
    print("=== SQL agent product tests ===")
    r = Results()
    test_routing(r)
    test_defaults(r)
    test_sql_build(r)
    print(f"\n{r.ok} passed, {r.fail} failed")
    return 1 if r.fail else 0


if __name__ == "__main__":
    sys.exit(main())
