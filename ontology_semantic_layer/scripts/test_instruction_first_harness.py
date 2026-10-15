"""PR1 harness unit tests — instruction-first guards (mocked Gemma / no DB)."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from semantic.scope import UserScope
from sql_agent.job import ExecutorJob, SqlFilter, SqlQueryRequest
from sql_agent.mas.harness import constrained_to_executor_job
from sql_agent.mas.intent_kinds import normalize_intent
from sql_agent.mas.metric_validator import validate_metric_against_instruction
from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan
from sql_agent.mas.telemetry import reset_counters, counters_snapshot
from sql_agent.ticketing_sql.builder import build_ticketing_list_sql, build_ticketing_count_sql


def _agent_scope() -> UserScope:
    return UserScope(
        user_id="1001",
        organization_id="1000",
        role="agent",
        visible_user_ids=["1001"],
        my_queue_ids=[],
        identity="ticketing_agents",
    )


def _admin_scope() -> UserScope:
    return UserScope(
        user_id="1",
        organization_id="1000",
        role="admin",
        visible_user_ids=["1"],
        my_queue_ids=[],
        identity="ticketing_agents",
    )


def _req(instruction: str, *, agent: str = "tk.tickets") -> SqlQueryRequest:
    return SqlQueryRequest(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent=agent,
        instruction=instruction,
        limit=20,
    )


def _entitlements():
    return SimpleNamespace(
        skus={"ticketing"},
        channels_for_product=lambda _p: ["email", "chat", "voice"],
    )


def _run_harness(plan: SqlPlan, job: ConstrainedJob, req: SqlQueryRequest, scope: UserScope):
    policy = {"list_only": False, "allowed_metrics": None}
    with (
        patch("sql_agent.mas.harness.lookup_user_scope", return_value=scope),
        patch("sql_agent.mas.harness.load_tenant_entitlements", return_value=_entitlements()),
    ):
        return constrained_to_executor_job(req, plan, job, policy)


def test_normalize_intent_legacy_count():
    assert normalize_intent("count", has_group_by=True) == "count_grouped"
    assert normalize_intent("count", has_group_by=False) == "count_grouped"
    assert normalize_intent("list") == "list"
    assert normalize_intent("count_scalar") == "count_scalar"


def test_list_intent_strips_metric_id():
    reset_counters()
    req = _req("list tickets")
    plan = SqlPlan(
        plan_id="p1",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        metric_id="open_tickets_metric",
        template_id="open_tickets_metric",
        table="tickets",
        select=["ticket_number", "status"],
        limit=20,
    )
    job = ConstrainedJob(
        product="ticketing",
        table="tickets",
        schema="ticketing",
        select=["ticket_number", "status"],
        metric_id="open_tickets_metric",
        template_id="open_tickets_metric",
        limit=20,
    )
    executor, warnings = _run_harness(plan, job, req, _agent_scope())
    assert executor.mode == "list"
    assert executor.metric_id is None
    assert plan.metric_id is None
    assert any("metric_stripped" in w for w in warnings)
    assert plan.guard_action == "metric_stripped"
    snap = counters_snapshot()
    assert snap["metric_stripped"] >= 1


def test_kpi_ticket_volume_rejected_for_open_tickets_instruction():
    reset_counters()
    req = _req("how many open tickets")
    plan = SqlPlan(
        plan_id="p2",
        preset_id="metric.certified",
        intent="kpi",
        product="ticketing",
        metric_id="ticket_volume",
        template_id="ticket_volume",
        table="tickets",
        limit=1,
    )
    job = ConstrainedJob(
        product="ticketing",
        table="tickets",
        schema="ticketing",
        select=[],
        metric_id="ticket_volume",
        template_id="ticket_volume",
        limit=1,
    )
    executor, warnings = _run_harness(plan, job, req, _admin_scope())
    assert executor.mode == "count_scalar"
    assert executor.metric_id is None
    assert any(f.column == "status" for f in executor.filters)
    status_vals = next(f.values for f in executor.filters if f.column == "status")
    assert any(str(v).lower() == "open" for v in status_vals)
    assert plan.guard_action == "metric_rejected_filter_mismatch"
    snap = counters_snapshot()
    assert snap["metric_rejected_filter_mismatch"] >= 1


def test_kpi_open_tickets_metric_passes_validator():
    v = validate_metric_against_instruction(
        "open_tickets_metric", "how many open tickets"
    )
    assert v.ok is True

    req = _req("how many open tickets")
    plan = SqlPlan(
        plan_id="p3",
        preset_id="metric.certified",
        intent="kpi",
        product="ticketing",
        metric_id="open_tickets_metric",
        template_id="open_tickets_metric",
        table="tickets",
        limit=1,
    )
    job = ConstrainedJob(
        product="ticketing",
        table="tickets",
        schema="ticketing",
        select=[],
        metric_id="open_tickets_metric",
        template_id="open_tickets_metric",
        limit=1,
    )
    with patch(
        "sql_agent.mas.harness.get_template",
        return_value={
            "table": "tickets",
            "sql": "SELECT 1",
            "row_scope_column": "assignee_id",
        },
    ), patch(
        "sql_agent.mas.harness.assert_metrics_allowed",
        return_value=None,
    ), patch(
        "sql_agent.mas.harness.is_certified",
        return_value=True,
    ), patch(
        "sql_agent.mas.harness.resolve_metric_alias",
        return_value="open_tickets_metric",
    ):
        executor, _warnings = _run_harness(plan, job, req, _admin_scope())
    assert executor.mode == "metric_fallback"
    assert executor.metric_id == "open_tickets_metric"


def test_agent_org_scope_clamped_on_list():
    reset_counters()
    req = _req("list tickets")
    plan = SqlPlan(
        plan_id="p4",
        preset_id="tk.tickets",
        intent="list",
        product="ticketing",
        table="tickets",
        select=["*"],
        scope_mode="org",
        limit=20,
    )
    job = ConstrainedJob(
        product="ticketing",
        table="tickets",
        schema="ticketing",
        select=["*"],
        scope_mode="org",
        limit=20,
    )
    executor, warnings = _run_harness(plan, job, req, _agent_scope())
    assert executor.mode == "list"
    assert executor.scope == "assignee"
    assert "1001" in executor.visible_user_ids
    assert any("scope_clamped" in w for w in warnings) or plan.guard_action == "scope_clamped"


def test_list_sql_has_order_by_with_limit():
    job = ExecutorJob(
        job_id="j1",
        mode="list",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1001,
        table="tickets",
        schema="ticketing",
        select=["ticket_number", "status", "created_at"],
        filters=[],
        order_by=[],
        limit=20,
        scope="org",
        visible_user_ids=[],
        row_scope_column="assignee_id",
        caller_role="admin",
    )
    sql, _params = build_ticketing_list_sql(job)
    assert "LIMIT" in sql.upper()
    assert "ORDER BY" in sql.upper()
    assert "created_at" in sql.lower()


def test_count_scalar_sql():
    job = ExecutorJob(
        job_id="j2",
        mode="count_scalar",
        product="ticketing",
        engine="postgres",
        organization_id=1000,
        user_id=1001,
        table="tickets",
        schema="ticketing",
        select=[],
        filters=[SqlFilter(column="status", op="eq", values=["Open"])],
        limit=1,
        scope="assignee",
        visible_user_ids=["1001"],
        row_scope_column="assignee_id",
        caller_role="agent",
    )
    sql, params = build_ticketing_count_sql(job)
    assert "COUNT(*)" in sql.upper()
    assert "row_count" in sql.lower()
    assert "LIMIT" not in sql.upper()
    assert "Open" in params or any(p == "Open" for p in params)


def test_validator_ticket_volume_vs_open():
    bad = validate_metric_against_instruction("ticket_volume", "how many open tickets")
    assert bad.ok is False
    assert bad.guard_action == "metric_rejected_filter_mismatch"
    good = validate_metric_against_instruction(
        "open_tickets_metric", "how many open tickets"
    )
    assert good.ok is True


if __name__ == "__main__":
    tests = [
        test_normalize_intent_legacy_count,
        test_list_intent_strips_metric_id,
        test_kpi_ticket_volume_rejected_for_open_tickets_instruction,
        test_kpi_open_tickets_metric_passes_validator,
        test_agent_org_scope_clamped_on_list,
        test_list_sql_has_order_by_with_limit,
        test_count_scalar_sql,
        test_validator_ticket_volume_vs_open,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
            raise
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
