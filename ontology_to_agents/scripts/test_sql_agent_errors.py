#!/usr/bin/env python3
"""Unit checks for SQL agent error hygiene (no live API / DB required)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_ccaas_mart_tickets_coerced() -> None:
    from sql_agent.job import SqlQueryRequest
    from sql_agent.mas.harness import validate_constrained_job
    from sql_agent.mas.super_planner import _parse_super_json

    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1013,
        origin_product="contact_centre",
        origin_agent="cc.reporting",
        instruction="list data",
        limit=10,
    )
    raw = {
        "preset_id": "tk.tickets",
        "intent": "list",
        "product": "ccaas",
        "table": "mart_tickets",
    }
    plan = _parse_super_json(raw, req, "ccaas")
    assert plan is not None
    assert plan.preset_id == "cc.conversations"
    assert plan.constrained_job is not None
    assert plan.constrained_job.table == "mart_conversations"
    assert plan.constrained_job.product == "ccaas"

    job = plan.constrained_job
    warnings = validate_constrained_job(job, preset_id=plan.preset_id)
    assert job.table == "mart_conversations"
    assert job.product == "ccaas"
    print("OK test_ccaas_mart_tickets_coerced", warnings)


def test_get_table_unknown_raises_sql_agent_error() -> None:
    from sql_agent.catalog_loader import get_table
    from sql_agent.errors import SqlAgentError

    try:
        get_table("ccaas", "mart_tickets")
        raise AssertionError("expected SqlAgentError")
    except SqlAgentError as exc:
        assert exc.code == "unknown_table"
        assert "mart_tickets" in exc.message
        assert "ccaas" in exc.message
    print("OK test_get_table_unknown_raises_sql_agent_error")


def test_undefined_table_wrapped() -> None:
    from sql_agent.db import _reraise_postgres
    from sql_agent.errors import SqlAgentError

    try:
        import psycopg2.errors as pg_errors
    except ImportError:
        print("SKIP test_undefined_table_wrapped (no psycopg2)")
        return

    exc = pg_errors.UndefinedTable('relation "ticketing_marts.mart_tickets" does not exist')
    try:
        _reraise_postgres(
            exc,
            schema="ticketing_marts",
            table="mart_tickets",
            sql='SELECT 1 FROM "ticketing_marts"."mart_tickets"',
        )
        raise AssertionError("expected SqlAgentError")
    except SqlAgentError as err:
        assert err.code == "missing_warehouse_table"
        assert "ticketing_marts.mart_tickets" in err.message

    print("OK test_undefined_table_wrapped")


def test_sql_agent_error_detail_shape() -> None:
    from sql_agent.errors import SqlAgentError, WarehouseUnavailableError

    err = SqlAgentError("bad table", code="unknown_table")
    assert err.to_detail() == {"code": "unknown_table", "message": "bad table"}
    wh = WarehouseUnavailableError("down")
    assert wh.to_detail()["retry"] is True
    print("OK test_sql_agent_error_detail_shape")


def main() -> int:
    test_ccaas_mart_tickets_coerced()
    test_get_table_unknown_raises_sql_agent_error()
    test_undefined_table_wrapped()
    test_sql_agent_error_detail_shape()
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
