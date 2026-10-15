#!/usr/bin/env python3
"""Unit tests: parameterized SQL filters (Phase 0 gate)."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from semantic.sql.executors.base import build_list_sql
from semantic.sql.job import ExecutorJob, SqlFilter
from semantic.sql.validator import validate_readonly_sql


def test_bool_eq_no_extra_params() -> None:
    job = ExecutorJob(
        job_id="t",
        mode="list",
        product="ccaas",
        engine="postgres",
        organization_id=1000,
        user_id=1001,
        table="mart_conversations",
        schema="ccass_marts_aiccaas",
        select=["conversation_id", "is_open"],
        filters=[SqlFilter(column="is_open", op="eq", values=[True])],
        limit=5,
        scope="org",
    )
    sql, params = build_list_sql(job)
    validate_readonly_sql(sql)
    assert "is_open = %s" in sql
    assert True in params
    assert sql.count("%s") == len(params)


def test_contains_uses_param() -> None:
    job = ExecutorJob(
        job_id="t",
        mode="list",
        product="ccaas",
        engine="postgres",
        organization_id=1000,
        user_id=1001,
        table="mart_conversations",
        schema="ccass_marts_aiccaas",
        select=["conversation_id", "queue_name"],
        filters=[SqlFilter(column="queue_name", op="contains", values=["Support"])],
        limit=5,
        scope="org",
    )
    sql, params = build_list_sql(job)
    assert "ILIKE %s" in sql
    assert "%Support%" in params


def main() -> int:
    tests = [test_bool_eq_no_extra_params, test_contains_uses_param]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL {fn.__name__}: {exc}")
    print(f"\n{len(tests) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
