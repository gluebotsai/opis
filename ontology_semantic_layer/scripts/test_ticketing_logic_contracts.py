"""Contract tests for ticketing SQL-agent status, time, scope, ART (no instruction maps)."""

from __future__ import annotations

from sql_agent.job import ExecutorJob, SqlFilter
from sql_agent.mas.intent_gate import run_intent_gate
from sql_agent.metric_fallback import _build_extra_where
from sql_agent.ticketing_sql.builder import (
    build_ticketing_count_sql,
    build_ticketing_group_sql,
    build_ticketing_list_sql,
)
from sql_agent.ticketing_scope import ticketing_row_scope_clause
from sql_agent.time_window import (
    bind_calendar_date,
    bounds_from_instruction,
    bounds_for_metric_alias,
    fold_time_filters,
    to_calendar_date,
)


def _job(**kwargs) -> ExecutorJob:
    base = dict(
        job_id="t",
        mode="count_scalar",
        product="ticketing",
        engine="postgres",
        organization_id=1012,
        user_id=1028,
        table="tickets",
        schema="ticketing",
        select=[],
        filters=[],
        scope="org",
        visible_user_ids=["1028"],
        my_queue_ids=[],
        row_scope_column="assignee_id",
        caller_role="admin",
    )
    base.update(kwargs)
    return ExecutorJob(**base)  # type: ignore[arg-type]


def test_closed_filter_is_case_insensitive_closed_only() -> None:
    job = _job(filters=[SqlFilter(column="status", op="eq", values=["Closed"])])
    sql, params = build_ticketing_count_sql(job)
    assert "lower(" in sql.lower()
    assert "resolved" not in sql.lower() or "not in" in sql.lower()
    assert "closed" in [str(p).lower() for p in params]


def test_pending_gate_is_not_in_closed_resolved() -> None:
    gate = run_intent_gate(
        "how many tickets other than closed and resolved", product="ticketing"
    )
    assert gate.filters
    flt = gate.filters[0]
    assert flt["column"] == "status"
    assert flt["op"] == "not_in"
    assert set(flt["values"]) == {"closed", "resolved"}


def test_explicit_pending_is_eq_pending() -> None:
    gate = run_intent_gate("how many pending tickets", product="ticketing")
    assert gate.filters
    flt = next(f for f in gate.filters if f.get("column") == "status")
    assert flt["op"] == "eq"
    assert [str(v).lower() for v in flt["values"]] == ["pending"]


def test_org_status_enum_uses_ticket_statuses() -> None:
    from sql_agent.mas.intent_gate import resolve_status_against_org

    pending = resolve_status_against_org("in progress", organization_id=1012)
    assert pending.lower() == "pending"
    opened = resolve_status_against_org("open", organization_id=1012)
    assert opened == "Open"
    gate = run_intent_gate(
        "how many in progress tickets",
        product="ticketing",
        organization_id=1012,
    )
    flt = next(f for f in gate.filters if f.get("column") == "status")
    assert flt["op"] == "eq"
    assert flt["values"] == ["Pending"]


def test_today_count_and_list_intents() -> None:
    count = run_intent_gate("count of today created tickets", product="ticketing")
    assert count.hint == "count_scalar"
    assert count.time_start and count.time_end
    how_many = run_intent_gate("how many tickets today", product="ticketing")
    assert how_many.hint == "count_scalar"
    assert how_many.time_start == count.time_start
    listed = run_intent_gate("list tickets today", product="ticketing")
    assert listed.hint == "list"
    assert listed.time_start == count.time_start
    mixed = run_intent_gate("list me how many tickets today", product="ticketing")
    assert mixed.hint == "count_scalar"
    assert mixed.time_start == count.time_start
    job = _job(
        time_start=count.time_start,
        time_end=count.time_end,
        mode="count_scalar",
    )
    sql, params = build_ticketing_count_sql(job)
    assert "created_at" in sql
    assert "interval '1 day'" in sql
    assert count.time_start[:10] in [str(p)[:10] for p in params]


def test_like_contains_pattern_escapes_and_rewrites() -> None:
    from sql_agent.job import SqlFilter
    from sql_agent.sql_filters import (
        filter_clause,
        like_contains_pattern,
        rewrite_eq_filters_to_ilike,
    )

    assert like_contains_pattern("bill_ing") == "%billing%"
    flt = SqlFilter(column="queue_name", op="eq", values=["billing"])
    rewritten = rewrite_eq_filters_to_ilike([flt])
    assert rewritten[0].op == "ilike"
    sql, params = filter_clause(rewritten[0])
    assert "ILIKE" in sql
    assert params == ["%billing%"]


def test_created_by_me_sets_scope_and_binds_user() -> None:
    gate = run_intent_gate("how many tickets created by me", product="ticketing")
    assert gate.scope_mode == "created_by"
    gate2 = run_intent_gate(
        "List all tickets created by the current user, sorted by latest",
        product="ticketing",
    )
    assert gate2.scope_mode == "created_by"
    assert gate2.hint == "list"
    frag, params = ticketing_row_scope_clause(
        scope_mode="created_by",
        visible_user_ids=["1028"],
        row_scope_column="assignee_id",
        role="admin",
    )
    assert "created_by_id" in frag
    assert params == ["1028"]
    list_job = _job(
        mode="list",
        scope="created_by",
        select=["ticket_number", "created_at"],
        limit=20,
    )
    list_sql, list_params = build_ticketing_list_sql(list_job)
    assert "created_by_id" in list_sql
    assert "1028" in [str(p) for p in list_params]


def test_empty_team_clause_is_false() -> None:
    frag, params = ticketing_row_scope_clause(
        scope_mode="team",
        visible_user_ids=["1028"],
        row_scope_column="assignee_id",
        role="admin",
        my_queue_ids=[],
    )
    assert frag == "FALSE"
    assert params == []


def test_last_7_days_extracted_and_applied_on_created_at() -> None:
    start, end = bounds_from_instruction("ticket volume last 7 days")
    assert start and end
    job = _job(time_start=start, time_end=end, mode="count_scalar")
    sql, params = build_ticketing_count_sql(job)
    assert "created_at" in sql
    assert "now()" not in sql.lower()
    assert "interval '7 days'" not in sql.lower()
    assert start[:10] in [str(p)[:10] for p in params]


def test_alias_metric_window() -> None:
    start, end = bounds_for_metric_alias("tickets_last_7_days")
    assert start and end


def test_art_extra_where_uses_resolved_at() -> None:
    job = _job(
        mode="metric_fallback",
        metric_id="average_resolution_time_hours",
        time_start="2026-09-01",
        time_end="2026-09-07",
        time_column="resolved_at",
    )
    where, params = _build_extra_where(job, "resolved_at")
    assert "resolved_at" in where
    assert "created_at" not in where
    assert params[0] == "2026-09-01"


def test_group_by_status_compiles() -> None:
    job = _job(mode="group_count", group_by=["status"])
    sql, _params = build_ticketing_group_sql(job)
    assert "GROUP BY" in sql
    assert "status" in sql


def test_my_team_gate_and_empty_queues_are_false() -> None:
    gate = run_intent_gate("how many tickets for my team", product="ticketing")
    assert gate.team_scope is True
    frag, params = ticketing_row_scope_clause(
        scope_mode="team",
        visible_user_ids=["1028"],
        row_scope_column="assignee_id",
        role="admin",
        my_queue_ids=[],
    )
    assert frag == "FALSE"
    assert params == []


def test_live_today_count_matches_warehouse() -> None:
    from sql_agent.db import run_postgres_query
    from sql_agent.executors.ticketing import execute_job
    from sql_agent.time_window import bounds_from_instruction

    start, end = bounds_from_instruction("count of today created tickets")
    assert start and end
    warehouse = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s "
        "AND created_at >= %s::date AND created_at < (%s::date + interval '1 day')",
        ["1012", start, end],
        schema="ticketing",
        table="tickets",
    )
    expected = int(warehouse[0]["n"])
    result = execute_job(
        _job(
            mode="count_scalar",
            time_start=start,
            time_end=end,
            time_column="created_at",
            caller_role="admin",
            scope="org",
        )
    )
    got = int(result["value"])
    assert got == expected, f"today count agent={got} warehouse={expected}"


def test_live_like_retry_on_partial_queue() -> None:
    from sql_agent.db import run_postgres_query
    from sql_agent.executors.ticketing import execute_job

    rows = run_postgres_query(
        "SELECT queue_name FROM ticketing.tickets "
        "WHERE organization_id = %s AND queue_name IS NOT NULL AND length(queue_name) > 4 "
        "GROUP BY queue_name ORDER BY COUNT(*) DESC LIMIT 1",
        ["1012"],
        schema="ticketing",
        table="tickets",
    )
    assert rows, "expected at least one queue_name in org 1012"
    full = str(rows[0]["queue_name"])
    fragment = full[: max(3, len(full) // 2)]
    if fragment.lower() == full.lower():
        fragment = full[:-1]
    exact = execute_job(
        _job(
            mode="count_scalar",
            filters=[SqlFilter(column="queue_name", op="eq", values=[fragment])],
            caller_role="admin",
            scope="org",
        )
    )
    # Partial token is not the full queue name, so exact is 0 then ILIKE retry finds rows.
    assert int(exact["value"]) >= 1, f"ILIKE retry should find queue like {fragment!r} in {full!r}"
    assert exact.get("like_retry") is True or int(exact["value"]) >= 1


def test_live_sql_query_today_count() -> None:
    from sql_agent.job import SqlQueryRequest
    from sql_agent.super import execute_sql_query

    result = execute_sql_query(
        SqlQueryRequest(
            organization_id=1012,
            user_id=1028,
            origin_product="ticketing",
            origin_agent="insights_analytics_executor",
            instruction="count of today created ticket",
        )
    )
    rows = result.get("rows") or []
    assert rows, f"expected rows, got {result!r}"
    row = rows[0]
    val = row.get("row_count")
    if val is None:
        val = row.get("tickets_created_today_metric")
    if val is None:
        val = next(iter(row.values()))
    val = int(val)
    from sql_agent.db import run_postgres_query
    from sql_agent.time_window import bounds_from_instruction

    start, end = bounds_from_instruction("count of today created ticket")
    warehouse = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s "
        "AND created_at >= %s::date AND created_at < (%s::date + interval '1 day')",
        ["1012", start, end],
        schema="ticketing",
        table="tickets",
    )
    expected = int(warehouse[0]["n"])
    assert val == expected, (
        f"sql.query today count={val} warehouse={expected} sql={result.get('sql')!r}"
    )


def test_created_at_gte_filter_folds_off_filters() -> None:
    from sql_agent.time_window import fold_time_filters

    start, end = bounds_from_instruction(
        "List me the tickets which are all created in last 7 days along with the dates"
    )
    assert start and end
    kept, tstart, tend, tcol = fold_time_filters(
        [SqlFilter(column="created_at", op=">=", values=["2020-01-01"])],
        time_start=start,
        time_end=end,
    )
    assert kept == []
    assert tstart == start
    assert tend == end
    assert tcol == "created_at"
    job = _job(
        mode="list",
        select=["ticket_number", "created_at"],
        filters=kept,
        time_start=tstart,
        time_end=tend,
        time_column=tcol,
        limit=20,
    )
    sql, params = build_ticketing_list_sql(job)
    assert "created_at" in sql
    assert start[:10] in [str(p)[:10] for p in params]


def test_period_token_as_filter_op_folds() -> None:
    from sql_agent.time_window import fold_time_filters

    kept, start, end, tcol = fold_time_filters(
        [SqlFilter(column="created_at", op="yesterday", values=[])]
    )
    assert kept == []
    assert start and end
    assert tcol == "created_at"


def test_created_range_last_7d_value_folds() -> None:
    from sql_agent.time_window import fold_time_filters

    kept, start, end, _tcol = fold_time_filters(
        [SqlFilter(column="created_range", op="eq", values=["last_7d"])]
    )
    assert kept == []
    assert start and end


def test_explicit_calendar_day_from_instruction() -> None:
    start, end = bounds_from_instruction(
        "List me the tickets which are all created on September 23, 2026 along with the dates"
    )
    assert start == "2026-09-23"
    assert end == "2026-09-23"
    iso_start, iso_end = bounds_from_instruction("tickets created on 2026-09-23")
    assert iso_start == iso_end == "2026-09-23"
    gate = run_intent_gate(
        "List me the tickets which are all created on September 23, 2026 along with the dates",
        product="ticketing",
        organization_id=1012,
    )
    assert gate.time_start == "2026-09-23"
    assert gate.time_end == "2026-09-23"


def test_iso_timestamptz_eq_folds_to_half_open_day() -> None:
    kept, start, end, tcol = fold_time_filters(
        [
            SqlFilter(
                column="created_at",
                op="eq",
                values=["2026-09-23T00:00:00Z"],
            )
        ]
    )
    assert kept == []
    assert start == end == "2026-09-23"
    assert tcol == "created_at"
    job = _job(
        mode="list",
        select=["ticket_number", "created_at"],
        filters=kept,
        time_start=start,
        time_end=end,
        time_column=tcol,
        limit=20,
    )
    sql, params = build_ticketing_list_sql(job)
    assert ">= %s::date" in sql
    assert "interval '1 day'" in sql
    assert params.count("2026-09-23") == 2
    assert bind_calendar_date("2026-09-23T00:00:00Z 23:59:59") == "2026-09-23"
    assert to_calendar_date("2026-09-23T00:00:00Z") == "2026-09-23"


def test_signed_in_user_is_created_by_me() -> None:
    gate = run_intent_gate(
        "List all tickets created by the current signed-in user (admin), most recent first",
        product="ticketing",
    )
    assert gate.scope_mode == "created_by"


def test_assignee_name_eq_is_ilike() -> None:
    from sql_agent.sql_filters import filter_clause

    sql, params = filter_clause(SqlFilter(column="assignee_name", op="eq", values=["fazil"]))
    assert "ILIKE" in sql
    assert params == ["%fazil%"]


def test_drop_self_name_filters() -> None:
    from sql_agent.ticketing_resolve import drop_self_name_filters

    kept = drop_self_name_filters(
        [
            SqlFilter(column="created_by_name", op="eq", values=["me"]),
            SqlFilter(column="priority", op="eq", values=["high"]),
        ]
    )
    assert len(kept) == 1
    assert kept[0].column == "priority"


def test_no_entitlement_channel_on_ticketing_list() -> None:
    job = _job(
        mode="list",
        select=["ticket_number", "channel"],
        entitled_channels=[],
        channel_column="channel",
        limit=12,
    )
    sql, params = build_ticketing_list_sql(job)
    assert "channel IN" not in sql
    assert "email" not in [str(p).lower() for p in params]


def test_calendar_last_n_is_today_plus_previous_n_minus_1() -> None:
    from datetime import timedelta

    from semantic.time_resolver import resolve_time_window
    from sql_agent.time_window import _today

    today = _today()
    last_30 = resolve_time_window({"period": "last_30_days"})
    last_7 = resolve_time_window({"period": "last_7_days"})
    today_w = resolve_time_window({"period": "today"})
    assert last_30["start"] == (today - timedelta(days=29)).isoformat()
    assert last_30["end"] == today.isoformat()
    assert last_7["start"] == (today - timedelta(days=6)).isoformat()
    assert last_7["end"] == today.isoformat()
    assert today_w["start"] == today.isoformat()
    assert today_w["end"] == today.isoformat()
    alias_30 = bounds_for_metric_alias("tickets_last_30_days")
    alias_7 = bounds_for_metric_alias("tickets_last_7_days")
    alias_today = bounds_for_metric_alias("tickets_created_today_metric")
    assert alias_30 == (last_30["start"], last_30["end"])
    assert alias_7 == (last_7["start"], last_7["end"])
    assert alias_today == (today_w["start"], today_w["end"])


def test_window_kpi_templates_have_no_baked_now() -> None:
    from semantic.metrics.catalog import clear_metrics_catalog_cache
    from semantic.sql.metric_template_registry import clear_template_cache, get_template
    from semantic.sql.template_execute import _prepared_with_alias_window

    clear_metrics_catalog_cache()
    clear_template_cache()
    for mid in (
        "tickets_last_30_days",
        "tickets_last_7_days",
        "tickets_created_today_metric",
    ):
        spec = get_template("ticketing", mid) or {}
        sql = str(spec.get("sql") or "").lower()
        assert "now()" not in sql, mid
        assert "current_date" not in sql, mid
        assert "interval" not in sql, mid
        filled = _prepared_with_alias_window(
            {
                "product": "ticketing",
                "organizationId": 1003,
                "userId": 1,
                "metrics": [mid],
            },
            mid,
        )
        assert filled["time"].get("start")
        assert filled["time"].get("end")
        kept = _prepared_with_alias_window(
            {
                "product": "ticketing",
                "organizationId": 1003,
                "userId": 1,
                "metrics": [mid],
                "time": {"start": "2026-01-01", "end": "2026-01-02"},
            },
            mid,
        )
        assert kept["time"]["start"] == "2026-01-01"
        assert kept["time"]["end"] == "2026-01-02"


def test_tickets_created_by_me_threshold_is_null() -> None:
    from semantic.thresholds import clear_thresholds_cache, merge_threshold

    clear_thresholds_cache()
    row = merge_threshold("tickets_created_by_me", 1012)
    assert row.get("threshold") is None
    unknown = merge_threshold("metric_with_no_platform_row_xyz")
    assert unknown.get("threshold") is None


def test_live_org_1003_last_30_calendar_is_29() -> None:
    from semantic.time_resolver import resolve_time_window
    from sql_agent.db import run_postgres_query

    window = resolve_time_window({"period": "last_30_days"})
    calendar = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s "
        "AND created_at >= %s::date AND created_at < (%s::date + interval '1 day')",
        ["1003", window["start"], window["end"]],
        schema="ticketing",
        table="tickets",
    )
    assert int(calendar[0]["n"]) == 29, (
        f"calendar last_30 org 1003={calendar[0]['n']} "
        f"start={window['start']} end={window['end']}"
    )


def test_live_fazil_ilike_and_overdue_status_30d() -> None:
    from sql_agent.db import run_postgres_query

    exact = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s AND assignee_name = %s",
        ["1012", "fazil"],
        schema="ticketing",
        table="tickets",
    )
    ilike = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s AND assignee_name ILIKE %s",
        ["1012", "%fazil%"],
        schema="ticketing",
        table="tickets",
    )
    assert int(exact[0]["n"]) == 0
    assert int(ilike[0]["n"]) >= 1
    created = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s AND created_by_id = %s",
        ["1012", "1033"],
        schema="ticketing",
        table="tickets",
    )
    assert int(created[0]["n"]) >= 1
    overdue_status = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s AND lower(status) = 'overdue' "
        "AND created_at >= (CURRENT_DATE - 30)",
        ["1012"],
        schema="ticketing",
        table="tickets",
    )
    overdue_due = run_postgres_query(
        "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets "
        "WHERE organization_id = %s AND lower(status) NOT IN ('closed', 'resolved') "
        "AND due_at < NOW() AND created_at >= (CURRENT_DATE - 30)",
        ["1012"],
        schema="ticketing",
        table="tickets",
    )
    assert int(overdue_status[0]["n"]) != int(overdue_due[0]["n"])
    from sql_agent.kpi_template_registry import get_template

    spec = get_template("ticketing", "current_overdue_tickets_metric") or {}
    assert "lower(status) = 'overdue'" in str(spec.get("sql") or "")
    closed = get_template("ticketing", "closed_tickets_metric") or {}
    assert str(closed.get("time_column") or "") == "resolved_at"


def main() -> int:
    tests = [
        test_closed_filter_is_case_insensitive_closed_only,
        test_pending_gate_is_not_in_closed_resolved,
        test_explicit_pending_is_eq_pending,
        test_org_status_enum_uses_ticket_statuses,
        test_today_count_and_list_intents,
        test_like_contains_pattern_escapes_and_rewrites,
        test_created_by_me_sets_scope_and_binds_user,
        test_empty_team_clause_is_false,
        test_last_7_days_extracted_and_applied_on_created_at,
        test_created_at_gte_filter_folds_off_filters,
        test_period_token_as_filter_op_folds,
        test_created_range_last_7d_value_folds,
        test_explicit_calendar_day_from_instruction,
        test_iso_timestamptz_eq_folds_to_half_open_day,
        test_alias_metric_window,
        test_art_extra_where_uses_resolved_at,
        test_group_by_status_compiles,
        test_my_team_gate_and_empty_queues_are_false,
        test_live_today_count_matches_warehouse,
        test_live_like_retry_on_partial_queue,
        test_live_sql_query_today_count,
        test_signed_in_user_is_created_by_me,
        test_assignee_name_eq_is_ilike,
        test_drop_self_name_filters,
        test_no_entitlement_channel_on_ticketing_list,
        test_calendar_last_n_is_today_plus_previous_n_minus_1,
        test_window_kpi_templates_have_no_baked_now,
        test_tickets_created_by_me_threshold_is_null,
        test_live_org_1003_last_30_calendar_is_29,
        test_live_fazil_ilike_and_overdue_status_30d,
    ]
    for fn in tests:
        fn()
        print(f"OK {fn.__name__}")
    print(f"PASS {len(tests)} tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
