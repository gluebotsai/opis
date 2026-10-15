"""PR3 list quality + formula cards + time_* preservation."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from semantic.scope import UserScope
from sql_agent.job import ExecutorJob, SqlQueryRequest
from sql_agent.mas.formula_cards import format_formula_cards_text, formula_cards_for_product
from sql_agent.mas.harness import constrained_to_executor_job
from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan
from sql_agent.ticketing_sql.builder import build_ticketing_list_sql


def test_formula_cards_include_open_and_volume():
    cards = formula_cards_for_product("ticketing")
    ids = {c["metric_id"] for c in cards}
    assert "open_tickets_metric" in ids
    assert "ticket_volume" in ids
    assert "tickets_created_by_me" in ids
    text = format_formula_cards_text("ticketing")
    assert "open_tickets_metric" in text
    assert "declared_filters" in text or "filters=" in text
    assert "tickets_created_by_me" in text
    assert "created_by_id" in text
    assert "ticket_volume + dataScope=mine" in text


def test_priority_list_order_by_rank():
    job = ExecutorJob(
        job_id="j1",
        mode="list",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1,
        table="tickets",
        schema="ticketing",
        select=["ticket_number", "priority", "created_at"],
        order_by=["priority_rank ASC", "created_at DESC"],
        limit=20,
        scope="org",
        caller_role="admin",
        row_scope_column="assignee_id",
    )
    sql, _ = build_ticketing_list_sql(job)
    assert "CASE lower" in sql.lower() or "CASE" in sql
    assert "urgent" in sql.lower()
    assert "ORDER BY" in sql.upper()
    assert "LIMIT 20" in sql.upper().replace(" ", " ")


def test_list_default_limit_20_max_200():
    scope = UserScope(
        user_id="1001",
        organization_id="1000",
        role="agent",
        visible_user_ids=["1001"],
    )
    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent="tk.tickets",
        instruction="list high priority tickets",
        limit=999,
    )
    plan = SqlPlan(
        plan_id="p",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        table="tickets",
        select=["*"],
        limit=999,
    )
    job = ConstrainedJob(
        product="ticketing",
        table="tickets",
        schema="ticketing",
        select=["*"],
        limit=999,
    )
    ent = SimpleNamespace(
        skus={"ticketing"},
        channels_for_product=lambda _p: ["email"],
    )
    with (
        patch("sql_agent.mas.harness.lookup_user_scope", return_value=scope),
        patch("sql_agent.mas.harness.load_tenant_entitlements", return_value=ent),
    ):
        executor, _ = constrained_to_executor_job(req, plan, job, {"list_only": False})
    assert executor.limit == 200
    assert executor.order_by[0] == "priority_rank ASC"
    assert executor.time_start is None  # still present as field


def test_executor_preserves_time_fields_on_list():
    from sql_agent.executors.ticketing import _route_base

    job = ExecutorJob(
        job_id="j",
        mode="list",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1,
        table="tickets",
        schema="ticketing",
        select=["*"],
        limit=20,
        time_start="2026-01-01",
        time_end="2026-01-31",
        time_grain="day",
        scope="org",
        caller_role="admin",
    )
    routed = _route_base(job)
    assert routed.time_start == "2026-01-01"
    assert routed.time_end == "2026-01-31"
    assert routed.time_grain == "day"


def test_list_select_keeps_entity_columns_with_named_extras() -> None:
    from sql_agent.presets.loader import list_select_columns, load_preset

    spec = load_preset("tk.tickets")
    cols = list_select_columns("list", ["created_at"], spec)
    assert "ticket_number" in cols
    assert "subject" in cols
    assert "created_at" in cols


def test_list_with_skinny_select_does_not_skip_executor() -> None:
    plan = SqlPlan(
        plan_id="p1",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        table="tickets",
        select=["created_at"],
    )
    assert plan.is_executor_skippable() is False


if __name__ == "__main__":
    tests = [
        test_formula_cards_include_open_and_volume,
        test_priority_list_order_by_rank,
        test_list_default_limit_20_max_200,
        test_executor_preserves_time_fields_on_list,
        test_list_select_keeps_entity_columns_with_named_extras,
        test_list_with_skinny_select_does_not_skip_executor,
    ]
    for fn in tests:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
