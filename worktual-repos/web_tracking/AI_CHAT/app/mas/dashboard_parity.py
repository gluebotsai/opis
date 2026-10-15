"""Dashboard KPI numbers via ClickHouse — same SQL as api-node / shared/analytics_metrics."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from shared.analytics_metrics import (
    sql_bounce_rate,
    sql_new_visitors,
    sql_online_visitors,
    sql_returning_visitors,
    sql_total_clicks,
    sql_total_conversions,
    sql_total_pageviews,
    sql_total_sessions,
    sql_total_visitors,
    sql_avg_session_duration,
)
from shared.clickhouse import get_client
from shared.semantic_time import REALTIME_METRICS

logger = logging.getLogger(__name__)

# Certified ids that must match dashboard KPI cards when user has a period pill selected.
DASHBOARD_KPI_METRICS: dict[str, str] = {
    "unique_visitors": "total_visitors",
    "new_visitor_count": "new_visitors",
    "returning_visitor_count": "returning_visitors",
    "web_session_volume": "total_sessions",
    "page_views": "total_pageviews",
    "total_clicks": "total_clicks",
    "total_conversions": "total_conversions",
    "average_session_duration": "avg_session_duration_seconds",
    "bounce_rate": "bounce_rate",
    "online_visitors": "online_visitors",
}


def uses_dashboard_parity(metric_id: str, *, dashboard_period: str | None) -> bool:
    if metric_id not in DASHBOARD_KPI_METRICS:
        return False
    if metric_id in REALTIME_METRICS:
        return True
    return bool(dashboard_period)


def _sql_for_metric(metric_id: str, website_id: int, question: str, dashboard_period: str | None) -> str | None:
    if metric_id == "unique_visitors":
        return sql_total_visitors(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "new_visitor_count":
        return sql_new_visitors(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "returning_visitor_count":
        return sql_returning_visitors(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "web_session_volume":
        return sql_total_sessions(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "page_views":
        return sql_total_pageviews(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "total_clicks":
        return sql_total_clicks(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "total_conversions":
        return sql_total_conversions(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "average_session_duration":
        return sql_avg_session_duration(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "bounce_rate":
        return sql_bounce_rate(website_id, question, dashboard_period=dashboard_period)
    if metric_id == "online_visitors":
        return sql_online_visitors(website_id)
    return None


def _run_sql(sql: str) -> tuple[list[str], list[list[Any]]]:
    client = get_client()
    result = client.query(sql)
    columns = list(result.column_names)
    rows = [list(row) for row in result.result_rows]
    return columns, rows


async def fetch_dashboard_kpi(
    metric_id: str,
    *,
    website_id: int,
    question: str,
    dashboard_period: str | None,
) -> tuple[list[str], list[list[Any]], str] | None:
    sql = _sql_for_metric(metric_id, website_id, question, dashboard_period)
    if not sql:
        return None
    try:
        columns, rows = await asyncio.to_thread(_run_sql, sql)
        if metric_id == "bounce_rate" and rows and "bounce_rate" in columns:
            idx = columns.index("bounce_rate")
            return ["bounce_rate"], [[rows[0][idx]]], sql
        if metric_id == "unique_visitors" and rows and "total_visitors" in columns:
            idx = columns.index("total_visitors")
            return ["unique_visitors"], [[rows[0][idx]]], sql
        if metric_id == "new_visitor_count" and rows and "new_visitors" in columns:
            idx = columns.index("new_visitors")
            return ["new_visitor_count"], [[rows[0][idx]]], sql
        if metric_id == "returning_visitor_count" and rows and "returning_visitors" in columns:
            idx = columns.index("returning_visitors")
            return ["returning_visitor_count"], [[rows[0][idx]]], sql
        if metric_id == "web_session_volume" and rows and "total_sessions" in columns:
            idx = columns.index("total_sessions")
            return ["web_session_volume"], [[rows[0][idx]]], sql
        if metric_id == "page_views" and rows and "total_pageviews" in columns:
            idx = columns.index("total_pageviews")
            return ["page_views"], [[rows[0][idx]]], sql
        if metric_id == "online_visitors" and rows and "online_visitors" in columns:
            idx = columns.index("online_visitors")
            return ["online_visitors"], [[rows[0][idx]]], sql
        return columns, rows, sql
    except Exception:
        logger.exception("Dashboard parity ClickHouse failed metric=%s", metric_id)
        return None
