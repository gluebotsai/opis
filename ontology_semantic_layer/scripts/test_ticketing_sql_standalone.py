#!/usr/bin/env python3
"""Unit tests for standalone Ticketing SQL Super (no DB)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_ticketing_agents_not_list_only() -> None:
    from sql_agent.agent_policy import _LIST_ONLY_AGENTS

    for agent in (
        "ticket_lifecycle_executor",
        "ticket_creation_executor",
        "tk.reporting",
        "tk.super",
    ):
        assert agent not in _LIST_ONLY_AGENTS, agent
    assert "cc.ai_support" in _LIST_ONLY_AGENTS
    print("OK test_ticketing_agents_not_list_only")


def test_resolve_list_scope_agent_not_org_on_open() -> None:
    from sql_agent.scope_resolver import resolve_list_scope

    scope = resolve_list_scope(
        product="ticketing",
        table="tickets",
        instruction="show open tickets",
        has_row_scope=True,
        caller_role="agent",
    )
    assert scope == "assignee"
    print("OK test_resolve_list_scope_agent_not_org_on_open")


def test_named_person_scope_denied_for_agent() -> None:
    from semantic.scope import UserScope
    from sql_agent.errors import SqlAgentError
    from sql_agent.scope_resolver import assert_ticketing_scope_allowed

    scope = UserScope(
        user_id="1004",
        organization_id="1000",
        role="agent",
        visible_user_ids=["1004"],
        identity="ticketing_agents",
    )
    try:
        assert_ticketing_scope_allowed(
            scope,
            filters=[{"column": "assignee_name", "op": "eq", "values": ["Alice"]}],
            scope_mode="assignee",
        )
        raise AssertionError("expected scope_denied")
    except SqlAgentError as exc:
        assert exc.code == "scope_denied"
    print("OK test_named_person_scope_denied_for_agent")


def test_group_by_routes_to_group_count_job() -> None:
    from sql_agent.job import SqlQueryRequest
    from sql_agent.mas.harness import constrained_to_executor_job
    from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan

    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1005,
        origin_product="ticketing",
        origin_agent="tk.reporting",
        instruction="ticket count by queue",
        limit=20,
    )
    plan = SqlPlan(
        plan_id="p1",
        preset_id="tk.tickets",
        intent="count",
        product="ticketing",
        group_by=["queue_name"],
        limit=20,
    )
    job = ConstrainedJob(
        product="ticketing",
        table="tickets",
        schema="ticketing",
        select=[],
        filters=[],
        limit=20,
        group_by=["queue_name"],
    )
    policy = {"list_only": False, "allowed_metrics": ["ticket_volume"]}
    executor, _warnings = constrained_to_executor_job(req, plan, job, policy)
    assert executor.mode == "group_count"
    assert executor.group_by == ["queue_name"]
    assert executor.table == "tickets"
    print("OK test_group_by_routes_to_group_count_job")


def test_group_sql_builder() -> None:
    from sql_agent.job import ExecutorJob
    from sql_agent.ticketing_sql.builder import build_ticketing_group_sql

    job = ExecutorJob(
        job_id="j1",
        mode="group_count",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1005,
        table="tickets",
        schema="ticketing",
        select=[],
        filters=[],
        limit=10,
        scope="org",
        visible_user_ids=[],
        group_by=["queue_name"],
    )
    sql, params = build_ticketing_group_sql(job)
    assert "GROUP BY" in sql
    assert "queue_name" in sql
    assert "ticket_count" in sql
    assert "ticketing.tickets" in sql
    assert params[0] == "1000"
    print("OK test_group_sql_builder")


def test_kpi_template_uses_operational_tickets() -> None:
    from sql_agent.kpi_template_registry import get_template, list_templates

    spec = get_template("ticketing", "open_tickets_metric")
    assert spec is not None
    assert spec.get("table") == "tickets"
    sql = str(spec.get("sql") or "")
    assert "ticketing.tickets" in sql
    assert "mart_tickets" not in sql
    assert "ticketing_marts" not in sql
    assert "lower(status) = 'open'" in sql or "is_open" in sql

    metrics = list_templates("ticketing")
    assert len(metrics) == 97
    for metric_id, mspec in metrics.items():
        msql = str(mspec.get("sql") or "")
        assert "ticketing_marts" not in msql, metric_id
        assert not str(mspec.get("table") or "").startswith("mart_"), metric_id
    print("OK test_kpi_template_uses_operational_tickets")


def test_time_partition_group_sql() -> None:
    from sql_agent.job import ExecutorJob
    from sql_agent.ticketing_sql.builder import build_ticketing_group_sql

    job = ExecutorJob(
        job_id="j4",
        mode="group_count",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1005,
        table="tickets",
        schema="ticketing",
        select=[],
        filters=[],
        limit=10,
        scope="org",
        visible_user_ids=[],
        group_by=["created_at"],
        time_grain="day",
        time_start="2026-01-01",
        time_end="2026-01-31",
    )
    sql, params = build_ticketing_group_sql(job)
    assert "date_trunc('day'" in sql
    assert "created_at >= %s" in sql
    assert params[1] == "2026-01-01"
    print("OK test_time_partition_group_sql")


def test_wrap_metric_sql_no_marts() -> None:
    from sql_agent.ticketing_sql.enriched import wrap_metric_sql

    sql = wrap_metric_sql(
        "SELECT COUNT(ticket_id)::bigint AS ticket_volume\n"
        "FROM ticketing_marts.mart_tickets\n"
        "WHERE organization_id = %s{{extra_where}}",
        enriched_base="tickets",
    )
    assert "ticketing_marts" not in sql
    assert "WITH enriched AS" in sql
    assert "FROM enriched" in sql
    print("OK test_wrap_metric_sql_no_marts")


def test_ticketing_no_instruction_regex_filters() -> None:
    from sql_agent.instruction_filters import parse_ticketing_filters

    filters = parse_ticketing_filters(
        "show my open tickets in billing queue",
        None,
        product="ticketing",
    )
    assert filters == []
    print("OK test_ticketing_no_instruction_regex_filters")


def test_cdp_live_email_join_sql() -> None:
    from sql_agent.job import ExecutorJob
    from sql_agent.ticketing_sql.builder import build_ticketing_list_sql

    job = ExecutorJob(
        job_id="j2",
        mode="list",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1005,
        table="tickets",
        schema="ticketing",
        select=["ticket_number", "customer_name"],
        filters=[],
        limit=10,
        scope="org",
        visible_user_ids=[],
        cdp_live=True,
        cdp_email="customer@example.com",
    )
    sql, params = build_ticketing_list_sql(job)
    assert "cdp.identity_keys" in sql
    assert "contact_profile" in sql
    assert "lower(ik.key_value) = lower(%s)" in sql
    assert params[-1] == "customer@example.com"
    print("OK test_cdp_live_email_join_sql")


def test_snapshot_customer_email_filter() -> None:
    from sql_agent.job import ExecutorJob, SqlFilter
    from sql_agent.ticketing_sql.builder import build_ticketing_list_sql

    job = ExecutorJob(
        job_id="j3",
        mode="list",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1005,
        table="tickets",
        schema="ticketing",
        select=["ticket_number", "customer_email"],
        filters=[SqlFilter(column="customer_email", op="eq", values=["mohamed@example.com"])],
        limit=10,
        scope="org",
        visible_user_ids=[],
    )
    sql, params = build_ticketing_list_sql(job)
    assert "cdp.identity_keys" not in sql
    assert "t.customer_email = %s" in sql
    assert "mohamed@example.com" in params
    print("OK test_snapshot_customer_email_filter")


def test_lifecycle_agent_not_list_only() -> None:
    from sql_agent.agent_policy import resolve_agent_policy

    for agent in ("ticket_lifecycle_executor", "ticket_creation_executor"):
        policy = resolve_agent_policy(
            organization_id=1000,
            user_id=1005,
            origin_product="ticketing",
            origin_agent=agent,
        )
        assert policy.get("list_only") is False, agent
    print("OK test_lifecycle_agent_not_list_only")


def test_ticketing_plan_failed_no_regex_fallback(monkeypatch=None) -> None:
    from sql_agent.errors import SqlAgentError
    from sql_agent.job import SqlQueryRequest
    from sql_agent.mas import super_planner

    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1005,
        origin_product="ticketing",
        origin_agent="tk.reporting",
        instruction="list tickets",
        limit=10,
    )
    policy = {"list_only": False}

    def _boom(*args, **kwargs):
        from sql_agent.mas.gemma_client import GemmaParseError

        raise GemmaParseError("bad json")

    original = super_planner.chat_json
    super_planner.chat_json = _boom
    try:
        try:
            super_planner.plan_sql_query(req)
            raise AssertionError("expected plan_failed")
        except SqlAgentError as exc:
            assert exc.code == "plan_failed"
    finally:
        super_planner.chat_json = original
    print("OK test_ticketing_plan_failed_no_regex_fallback")


def main() -> int:
    tests = [
        test_ticketing_agents_not_list_only,
        test_resolve_list_scope_agent_not_org_on_open,
        test_named_person_scope_denied_for_agent,
        test_group_by_routes_to_group_count_job,
        test_group_sql_builder,
        test_kpi_template_uses_operational_tickets,
        test_time_partition_group_sql,
        test_wrap_metric_sql_no_marts,
        test_ticketing_no_instruction_regex_filters,
        test_cdp_live_email_join_sql,
        test_snapshot_customer_email_filter,
        test_lifecycle_agent_not_list_only,
        test_ticketing_plan_failed_no_regex_fallback,
    ]
    for fn in tests:
        fn()
    print(f"PASS {len(tests)} tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
