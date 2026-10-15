from datetime import UTC, datetime

from sql_agent.compile import last_calendar_month, yesterday_period
from sql_agent.context import QueryContext
from sql_agent.grounding import ground_reply, render_grounded_html, reply_matches_preview
from sql_agent.scope import apply_scope, rewrite_timestamp_literals
from sql_agent.tools import SqlAgentTools
from sql_agent.warehouse import display_value


def test_last_calendar_month_is_previous_utc_month():
    start, end = last_calendar_month(datetime(2026, 9, 8, 20, 0, tzinfo=UTC))
    assert start == "2026-08-01 00:00:00"
    assert end == "2026-09-01 00:00:00"


def test_yesterday_period_is_prior_utc_day():
    start, end = yesterday_period(datetime(2026, 9, 8, 20, 0, tzinfo=UTC))
    assert start == "2026-09-07 00:00:00"
    assert end == "2026-09-08 00:00:00"


def test_lock_period_replaces_ui_month_with_yesterday(catalog):
    ctx = QueryContext(
        organization_id="1000",
        period_start="2026-08-01 00:00:00",
        period_end="2026-09-01 00:00:00",
    )
    tools = SqlAgentTools(catalog, live=False, ctx=ctx)
    result = tools.lock_period("yesterday")
    assert result["ok"] is True
    assert result["period_start"] != "2026-08-01 00:00:00"
    assert tools.ctx.period_start == result["period_start"]


def test_rewrite_timestamp_literals_uses_trusted_window():
    rewritten = rewrite_timestamp_literals(
        "WHERE ts >= TIMESTAMP '2025-01-01 00:00:00' AND ts < TIMESTAMP '2025-07-14 00:00:00'",
        "2026-09-01 00:00:00",
        "2026-09-08 00:00:00",
    )
    assert "2025-01-01" not in rewritten
    assert "TIMESTAMP '2026-09-01 00:00:00'" in rewritten
    assert "TIMESTAMP '2026-09-08 00:00:00'" in rewritten


def test_unbounded_sql_gets_period_cte(catalog):
    ctx = QueryContext(
        organization_id="1000",
        period_start="2026-09-01 00:00:00",
        period_end="2026-09-08 00:00:00",
    )
    scoped = apply_scope(
        "SELECT channel, COUNT(*) AS n FROM ccass.conversation_messages GROUP BY channel",
        ctx,
        catalog,
    )
    assert "__scope_conversation_messages" in scoped
    assert "2026-09-01 00:00:00" in scoped
    assert "organization_id = '1000'::bigint" in scoped


def test_dated_sql_rewrites_literals_without_double_period_on_messages(catalog):
    ctx = QueryContext(
        organization_id="1000",
        period_start="2026-09-01 00:00:00",
        period_end="2026-09-08 00:00:00",
    )
    scoped = apply_scope(
        "SELECT COUNT(*) AS n FROM ccass.conversations "
        "WHERE COALESCE(assigned_at, resolved_at, ended_at, created_at) "
        ">= TIMESTAMP '2025-01-01 00:00:00' AND COALESCE(assigned_at, resolved_at, ended_at, created_at) "
        "< TIMESTAMP '2025-07-14 00:00:00'",
        ctx,
        catalog,
    )
    assert "2025-01-01" not in scoped
    assert "2026-09-01 00:00:00" in scoped
    assert "__scope_conversations" in scoped


def test_sql_analytics_uses_locked_plan_sql(catalog):
    ctx = QueryContext(
        organization_id="1000",
        period_start="2026-09-01 00:00:00",
        period_end="2026-09-08 00:00:00",
    )
    tools = SqlAgentTools(catalog, live=False, ctx=ctx)
    tools.plan_query("average handel time")
    result = tools.sql_analytics(
        "SELECT COUNT(*) AS n FROM ccass.conversations "
        "WHERE created_at >= TIMESTAMP '2020-01-01' AND created_at < TIMESTAMP '2020-01-02'"
    )
    assert result["ok"] is True
    assert "avg_handle_seconds" in (result.get("inner_sql") or "")
    assert "2020-01-01" not in (result.get("inner_sql") or "")


def test_sla_display_is_percent_not_duration():
    assert display_value("response_sla_pct", 80.4) == "80.4%"
    assert display_value("avg_handle_seconds", 129) == "2m 9s"


def test_grounding_replaces_hallucinated_numbers():
    ctx = QueryContext(
        organization_id="1000",
        period_start="2026-09-01 00:00:00",
        period_end="2026-09-08 00:00:00",
    )
    warehouse = {
        "ok": True,
        "dry_run": False,
        "headline": "avg_handle_seconds=2m 9s",
        "preview": [{"avg_handle_seconds": "2m 9s"}],
    }
    assert reply_matches_preview("<p>Average handle time is 2m 9s.</p>", warehouse["preview"])
    rewritten = ground_reply(
        "<p>Average handle time is 1 hour 57 minutes.</p>",
        warehouse,
        ctx,
    )
    assert "2m 9s" in rewritten
    assert "1 hour 57" not in rewritten
    empty = render_grounded_html([], ctx=ctx, headline="No matching rows in the warehouse.")
    assert "No matching rows" in empty
