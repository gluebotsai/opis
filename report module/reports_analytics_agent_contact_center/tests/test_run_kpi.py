import pytest
from reports_analytics_agent_contact_center.sql_executor.core.run_kpi import run_kpi


def test_admin_org_scope_compiles():
    res = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="admin",
        scope_level="org",
    )
    assert res["status"] in ("compiled", "ok")
    assert "conversation_count" in res["sql"]
    assert "organization_id = 1000" in res["sql"]


def test_agent_own_scope_enforced():
    res = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401],
        scope_level="own",
    )
    assert res["status"] in ("compiled", "ok")
    assert "assigned_agent_id = 1005" in res["sql"]


def test_agent_queue_scope_enforced():
    res = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401, 402],
        scope_level="queue",
    )
    assert res["status"] in ("compiled", "ok")
    assert "queue_id IN (401, 402)" in res["sql"]


def test_agent_org_scope_denied():
    res = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401],
        scope_level="org",
    )
    assert res["status"] == "error"
    assert res["error_type"] == "DENY"


def test_call_count_is_conversations_not_cdr():
    res = run_kpi("call_count", organization_id=1000, user_id=1005, role="admin", scope_level="org")
    assert res["status"] in ("compiled", "ok")
    assert "call_cdr" not in res["sql"]
    assert "channel IN ('call', 'voice')" in res["sql"]


def test_resolution_rate_excludes_inactivity_both_sides():
    res = run_kpi("resolution_rate", organization_id=1000, user_id=1005, role="admin", scope_level="org")
    assert res["status"] in ("compiled", "ok")
    assert res["sql"].count("NOT is_bot_resolved_inactivity") >= 2


def test_avg_wait_time_compiles():
    res = run_kpi("avg_wait_time", organization_id=1000, user_id=1005, role="admin", scope_level="org")
    assert res["status"] in ("compiled", "ok")
    assert "wait_time_minutes" in res["sql"]


def test_login_hours_by_agent_groups():
    res = run_kpi(
        "login_hours",
        organization_id=1000,
        user_id=1005,
        role="admin",
        scope_level="org",
        dimension="agent",
    )
    assert res["status"] in ("compiled", "ok")
    assert "AS agent" in res["sql"]
    assert "GROUP BY" in res["sql"]


def test_transfer_count_distinct_conversations():
    res = run_kpi("transfer_count", organization_id=1000, user_id=1005, role="admin", scope_level="org")
    assert res["status"] in ("compiled", "ok")
    assert "COUNT(DISTINCT ct.conversation_id)" in res["sql"]


def test_occupancy_clips_segments_to_window():
    res = run_kpi("agent_occupancy", organization_id=1000, user_id=1005, role="admin", scope_level="org")
    assert res["status"] in ("compiled", "ok")
    assert "LEAST" in res["sql"] and "GREATEST" in res["sql"]


def test_unknown_dimension_replans():
    res = run_kpi(
        "conversation_count",
        organization_id=1000,
        user_id=1005,
        role="admin",
        scope_level="org",
        dimension="not_a_dim",
    )
    assert res["status"] == "error"
    assert res["error_type"] == "REPLAN"


def test_agent_occupancy_own_uses_agent_id():
    res = run_kpi(
        "agent_occupancy",
        organization_id=1000,
        user_id=1005,
        role="agent",
        queue_ids=[401],
        scope_level="own",
    )
    assert res["status"] in ("compiled", "ok")
    assert "p.agent_id = 1005" in res["sql"]
