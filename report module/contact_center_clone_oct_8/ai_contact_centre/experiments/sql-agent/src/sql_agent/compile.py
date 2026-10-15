"""Compile certified metric or gold-example SQL with period and surface time column."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sql_agent.catalog import Catalog, GoldExample, Metric

DEFAULT_PERIOD_DAYS = 7
_TS = "%Y-%m-%d %H:%M:%S"


def default_period() -> tuple[str, str]:
    end = datetime.now(tz=UTC).replace(microsecond=0)
    start = end - timedelta(days=DEFAULT_PERIOD_DAYS)
    return start.strftime(_TS), end.strftime(_TS)


def last_calendar_month(now: datetime | None = None) -> tuple[str, str]:
    current = now or datetime.now(tz=UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    month_start = current.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start.month == 1:
        prev = month_start.replace(year=month_start.year - 1, month=12)
    else:
        prev = month_start.replace(month=month_start.month - 1)
    return prev.strftime(_TS), month_start.strftime(_TS)


def _utc_now(now: datetime | None) -> datetime:
    current = now or datetime.now(tz=UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.astimezone(UTC)


def start_of_utc_day(now: datetime | None = None) -> datetime:
    current = _utc_now(now)
    return current.replace(hour=0, minute=0, second=0, microsecond=0)


def yesterday_period(now: datetime | None = None) -> tuple[str, str]:
    start = start_of_utc_day(now) - timedelta(days=1)
    end = start + timedelta(days=1)
    return start.strftime(_TS), end.strftime(_TS)


def today_period(now: datetime | None = None) -> tuple[str, str]:
    current = _utc_now(now).replace(microsecond=0)
    start = start_of_utc_day(current)
    return start.strftime(_TS), current.strftime(_TS)


def this_week_period(now: datetime | None = None) -> tuple[str, str]:
    current = _utc_now(now).replace(microsecond=0)
    start = start_of_utc_day(current) - timedelta(days=start_of_utc_day(current).weekday())
    return start.strftime(_TS), current.strftime(_TS)


def named_window(window: str, now: datetime | None = None) -> tuple[str, str]:
    key = (window or "").strip().lower().replace("-", "_")
    if key == "yesterday":
        return yesterday_period(now)
    if key == "today":
        return today_period(now)
    if key in {"last_7_days", "last_seven_days"}:
        current = _utc_now(now).replace(microsecond=0)
        start = current - timedelta(days=DEFAULT_PERIOD_DAYS)
        return start.strftime(_TS), current.strftime(_TS)
    if key == "last_month":
        return last_calendar_month(now)
    if key == "this_week":
        return this_week_period(now)
    raise ValueError(f"Unknown time window {window!r}")


def fill_sql(
    sql: str,
    *,
    period_start: str,
    period_end: str,
    time_expr: str,
    catalog: Catalog | None = None,
    table_for_time: str | None = None,
) -> str:
    qualified_time = time_expr
    if catalog and table_for_time and time_expr == "COALESCE(assigned_at, resolved_at, ended_at, created_at)":
        alias = catalog.tables[table_for_time].alias
        if f"{alias}." not in time_expr and "c." not in sql:
            pass
        if "JOIN" in sql.upper() and " ccass.conversations c" in sql:
            qualified_time = (
                "COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at)"
            )
        elif "JOIN" in sql.upper() and "{{time_expr}}" in sql:
            # metric SQL that already aliases conversations as c
            if "FROM ccass.conversations c" in sql or "ccass.conversations c" in sql:
                qualified_time = (
                    "COALESCE(c.assigned_at, c.resolved_at, c.ended_at, c.created_at)"
                )
    filled = (
        sql.replace("{{period_start}}", period_start)
        .replace("{{period_end}}", period_end)
        .replace("{{time_expr}}", qualified_time)
    )
    return filled.strip()


def time_expr_for(metric: Metric, *, surface: str) -> str:
    if surface == "dashboard" and metric.dashboard_time_expr:
        return metric.dashboard_time_expr
    if metric.time_column:
        return metric.time_column
    return "created_at"


def compile_metric(
    metric: Metric,
    catalog: Catalog,
    *,
    period_start: str | None = None,
    period_end: str | None = None,
    surface: str = "dashboard",
) -> str:
    start, end = period_start, period_end
    if not start or not end:
        start, end = default_period()
    expr = time_expr_for(metric, surface=surface)
    table = metric.tables[0] if metric.tables else None
    return fill_sql(
        metric.sql,
        period_start=start,
        period_end=end,
        time_expr=expr,
        catalog=catalog,
        table_for_time=table,
    )


def compile_example(
    example: GoldExample,
    catalog: Catalog,
    *,
    period_start: str | None = None,
    period_end: str | None = None,
    surface: str = "dashboard",
) -> str:
    start, end = period_start, period_end
    if not start or not end:
        start, end = default_period()
    expr = "COALESCE(assigned_at, resolved_at, ended_at, created_at)"
    if surface != "dashboard":
        expr = "assigned_at"
    return fill_sql(
        example.sql,
        period_start=start,
        period_end=end,
        time_expr=expr,
        catalog=catalog,
        table_for_time="ccass.conversations",
    )
