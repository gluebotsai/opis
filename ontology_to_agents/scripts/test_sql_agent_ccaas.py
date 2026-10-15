#!/usr/bin/env python3
"""Unit tests for SQL agent (no DB required for builder/validator)."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from semantic.sql.executors.base import build_list_sql
from semantic.sql.job import ExecutorJob, SqlFilter
from semantic.sql.router import route_product
from semantic.sql.validator import validate_readonly_sql
from semantic.time_resolver import ALLOWED_TIME_GRAINS, resolve_time_window


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


def test_router(r: Results) -> None:
    r.check("interaction -> ccaas", route_product("wt:Interaction", "hub") == "ccaas")
    r.check("origin ccaas", route_product(None, "contact_centre") == "ccaas")


def test_time_resolver(r: Results) -> None:
    tw = resolve_time_window({"period": "this_quarter"})
    r.check("this_quarter start", bool(tw.get("start")))
    r.check("year grain allowed", "year" in ALLOWED_TIME_GRAINS)
    r.check("quarter grain allowed", "quarter" in ALLOWED_TIME_GRAINS)


def test_list_sql_builder(r: Results) -> None:
    job = ExecutorJob(
        job_id="t1",
        mode="list",
        product="ccaas",
        engine="postgres",
        organization_id=1000,
        user_id=1001,
        table="mart_conversations",
        schema="ccass_marts_aiccaas",
        select=["conversation_id", "channel", "status", "queue_name"],
        filters=[SqlFilter(column="is_open", op="eq", values=[True])],
        limit=10,
        scope="org",
    )
    sql, params = build_list_sql(job)
    validate_readonly_sql(sql)
    r.check("sql is SELECT", sql.strip().upper().startswith("SELECT"))
    r.check("org param", str(params[0]) == "1000")
    r.check("is_open filter", "is_open" in sql)


def main() -> int:
    print("=== SQL agent unit tests ===")
    r = Results()
    test_router(r)
    test_time_resolver(r)
    test_list_sql_builder(r)
    print(f"\n{r.ok} passed, {r.fail} failed")
    return 1 if r.fail else 0


if __name__ == "__main__":
    sys.exit(main())
