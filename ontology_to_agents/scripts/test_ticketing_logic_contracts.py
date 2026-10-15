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
    ]
    for fn in tests:
        fn()
        print(f"OK {fn.__name__}")
    print(f"PASS {len(tests)} tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
