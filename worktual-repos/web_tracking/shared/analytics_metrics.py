"""
Dashboard-aligned analytics SQL — single source of truth for AI Chat known queries.

Must stay in sync with api-node/src/repositories/clickhouse/analyticsRepository.ts
and api-node/src/utils/period.ts.
"""

from __future__ import annotations

from shared.analytics_period import (
    PERIOD_ALL_TIME,
    bounce_session_started_filter,
    event_created_filter,
    heavy_event_created_filter,
    period_label,
    resolve_period,
    session_started_filter,
)


def sql_total_visitors(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = session_started_filter(period)
    return f"""
SELECT uniqExact(visitor_id) AS total_visitors
FROM dim_sessions FINAL
WHERE website_id = {website_id}{date_filter}
""".strip()


def sql_visitors_today(website_id: int) -> str:
    return f"""
SELECT uniqExact(visitor_id) AS visitors_today
FROM dim_sessions FINAL
WHERE website_id = {website_id}
  AND started_at >= today()
  AND started_at < today() + 1
""".strip()


def sql_total_sessions(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    """Match dashboard total_sessions — uniqExact(session_id), not count()."""
    period = resolve_period(question, dashboard_period)
    if period == PERIOD_ALL_TIME:
        return f"""
SELECT uniqExactMerge(sessions_state) AS total_sessions
FROM agg_web_daily
WHERE website_id = {website_id}
""".strip()
    date_filter = session_started_filter(period)
    return f"""
SELECT uniqExact(session_id) AS total_sessions
FROM dim_sessions FINAL
WHERE website_id = {website_id}{date_filter}
""".strip()


def sql_total_pageviews(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = event_created_filter(period)
    return f"""
SELECT count() AS total_pageviews
FROM fact_page_views
WHERE website_id = {website_id}{date_filter}
""".strip()


def sql_total_clicks(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = event_created_filter(period)
    return f"""
SELECT count() AS total_clicks
FROM fact_interaction_events
WHERE website_id = {website_id}
  AND event_type = 'click'{date_filter}
""".strip()


def sql_total_conversions(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = event_created_filter(period)
    return f"""
SELECT count() AS total_conversions
FROM fact_conversion_events
WHERE website_id = {website_id}{date_filter}
""".strip()


def sql_avg_session_duration(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    """Match dashboard avg_session_duration_seconds — activity span from page views + interactions."""
    period = resolve_period(question, dashboard_period)
    date_filter = heavy_event_created_filter(period)
    return f"""
WITH session_activity AS (
    SELECT
        session_id,
        min(event_ts) AS activity_started_at,
        max(event_ts) AS activity_ended_at
    FROM (
        SELECT session_id, created_at AS event_ts
        FROM fact_page_views
        WHERE website_id = {website_id}{date_filter}
        UNION ALL
        SELECT session_id, created_at AS event_ts
        FROM fact_interaction_events
        WHERE website_id = {website_id}{date_filter}
    )
    GROUP BY session_id
),
pageview_sessions AS (
    SELECT session_id, count() AS pageview_count
    FROM fact_page_views
    WHERE website_id = {website_id}{date_filter}
    GROUP BY session_id
)
SELECT coalesce(
    round(avg(greatest(0, dateDiff(
        'second',
        sa.activity_started_at,
        sa.activity_ended_at
    ))), 0),
    0
) AS avg_session_duration_seconds
FROM session_activity sa
INNER JOIN pageview_sessions ps ON ps.session_id = sa.session_id
WHERE ps.pageview_count > 0
""".strip()


def sql_bounce_rate(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = bounce_session_started_filter(period)
    return f"""
SELECT
  count() AS sessions,
  countIf(is_bounce = 1) AS bounce_sessions,
  if(count() = 0, 0, round(countIf(is_bounce = 1) / count() * 100, 2)) AS bounce_rate
FROM v_session_bounce
WHERE website_id = {website_id}{date_filter}
""".strip()


def sql_new_visitors(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = session_started_filter(period)
    return f"""
SELECT countIf(session_count <= 1) AS new_visitors
FROM (
  SELECT visitor_id, uniqExact(session_id) AS session_count
  FROM dim_sessions FINAL
  WHERE website_id = {website_id}{date_filter}
  GROUP BY visitor_id
)
""".strip()


def sql_returning_visitors(website_id: int, question: str, *, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = session_started_filter(period)
    return f"""
SELECT countIf(session_count > 1) AS returning_visitors
FROM (
  SELECT visitor_id, uniqExact(session_id) AS session_count
  FROM dim_sessions FINAL
  WHERE website_id = {website_id}{date_filter}
  GROUP BY visitor_id
)
""".strip()


def sql_online_visitors(website_id: int) -> str:
    return f"""
SELECT uniqExact(visitor_id) AS online_visitors
FROM (
    SELECT visitor_id
    FROM fact_page_views
    WHERE website_id = {website_id}
      AND created_at >= now() - INTERVAL 5 MINUTE
    UNION ALL
    SELECT visitor_id
    FROM fact_interaction_events
    WHERE website_id = {website_id}
      AND created_at >= now() - INTERVAL 5 MINUTE
    UNION ALL
    SELECT visitor_id
    FROM fact_custom_events
    WHERE website_id = {website_id}
      AND created_at >= now() - INTERVAL 5 MINUTE
    UNION ALL
    SELECT visitor_id
    FROM fact_product_interactions
    WHERE website_id = {website_id}
      AND created_at >= now() - INTERVAL 5 MINUTE
)
""".strip()


def sql_top_pages(website_id: int, question: str, *, limit: int = 10, dashboard_period: str | None = None) -> str:
    period = resolve_period(question, dashboard_period)
    date_filter = event_created_filter(period)
    return f"""
SELECT page_path, count() AS views, uniqExact(visitor_id) AS unique_visitors
FROM fact_page_views
WHERE website_id = {website_id}{date_filter}
GROUP BY page_path
ORDER BY views DESC
LIMIT {limit}
""".strip()


def answer_period_label(question: str, *, dashboard_period: str | None = None) -> str:
    return period_label(resolve_period(question, dashboard_period))
