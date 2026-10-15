"""Analytics period filters — aligned with api-node/src/utils/period.ts."""

from __future__ import annotations

import re

# Dashboard period pill ids (web ReportsPanel / Dashboard.jsx)
DASHBOARD_PERIODS = frozenset({"today", "week", "month", "overall"})

# Internal period keys used by SQL builders
PERIOD_TODAY = "today"
PERIOD_YESTERDAY = "yesterday"
PERIOD_THIS_WEEK = "this_week"
PERIOD_THIS_MONTH = "this_month"
PERIOD_PREVIOUS_MONTH = "previous_month"
PERIOD_ALL_TIME = "all_time"

# Max history for expensive event scans on overall pill (api-node period.ts)
OVERALL_HEAVY_MAX_DAYS = 364


def dashboard_period_to_internal(dashboard_period: str | None) -> str | None:
    """Map UI period pill to internal period key."""
    if not dashboard_period:
        return None
    key = dashboard_period.strip().lower()
    return {
        "today": PERIOD_TODAY,
        "week": PERIOD_THIS_WEEK,
        "month": PERIOD_THIS_MONTH,
        "overall": PERIOD_ALL_TIME,
    }.get(key)


def period_from_question(question: str) -> str:
    """Parse explicit time range from user text."""
    q = question.lower()
    if re.search(r"\b(previous|last|prior)\s+month\b", q):
        return PERIOD_PREVIOUS_MONTH
    if re.search(r"\b(this|current)\s+month\b", q):
        return PERIOD_THIS_MONTH
    if re.search(r"\btoday\b", q):
        return PERIOD_TODAY
    if re.search(r"\byesterday\b", q):
        return PERIOD_YESTERDAY
    if re.search(r"\bthis week\b|\blast 7 days\b|\bpast 7 days\b", q):
        return PERIOD_THIS_WEEK
    if re.search(r"\ball time\b|\bin total\b|\boverall\b", q):
        return PERIOD_ALL_TIME
    if re.search(r"\blast 30 days\b|\bpast 30 days\b|\bthis month\b|\bmonth\b", q):
        return PERIOD_THIS_MONTH
    return PERIOD_THIS_MONTH


def resolve_period(question: str, dashboard_period: str | None = None) -> str:
    """
    Final period for SQL: explicit question text wins; else dashboard pill; else 30-day default.
    Matches Dashboard default (month = rolling 30 days).
    """
    explicit = period_from_question(question)
    mapped = dashboard_period_to_internal(dashboard_period)
    if mapped and explicit == PERIOD_THIS_MONTH and not re.search(
        r"\b(today|yesterday|week|month|overall|all time|7 days|30 days)\b",
        question.lower(),
    ):
        return mapped
    return explicit


def period_label(period: str) -> str:
    labels = {
        PERIOD_TODAY: "today",
        PERIOD_YESTERDAY: "yesterday",
        PERIOD_THIS_WEEK: "in the last 7 days",
        PERIOD_THIS_MONTH: "in the last 30 days",
        PERIOD_PREVIOUS_MONTH: "in the previous calendar month",
        PERIOD_ALL_TIME: "overall",
    }
    return labels.get(period, "in the selected period")


def session_started_filter(period: str) -> str:
    """dim_sessions.started_at — matches api-node periodFilter on sessions."""
    filters = {
        PERIOD_TODAY: " AND started_at >= today() AND started_at < today() + 1",
        PERIOD_YESTERDAY: " AND started_at >= today() - 1 AND started_at < today()",
        PERIOD_THIS_WEEK: " AND started_at >= today() - 6 AND started_at < today() + 1",
        PERIOD_THIS_MONTH: " AND started_at >= today() - 29 AND started_at < today() + 1",
        PERIOD_PREVIOUS_MONTH: (
            " AND started_at >= toStartOfMonth(today()) - 1"
            " AND started_at < toStartOfMonth(today())"
        ),
        PERIOD_ALL_TIME: "",
    }
    return filters.get(period, filters[PERIOD_THIS_MONTH])


def heavy_event_created_filter(period: str, column: str = "created_at") -> str:
    """Bounded event window — mirrors api-node resolveHeavyQueryBounds()."""
    bounded = event_created_filter(period, column)
    if bounded:
        return bounded
    prefix = f" AND {column}"
    return f"{prefix} >= today() - {OVERALL_HEAVY_MAX_DAYS} AND {column} < today() + 1"


def event_created_filter(period: str, column: str = "created_at") -> str:
    """fact_* event tables — same rolling windows as api-node periodFilter."""
    prefix = f" AND {column}"
    filters = {
        PERIOD_TODAY: f"{prefix} >= today() AND {column} < today() + 1",
        PERIOD_YESTERDAY: f"{prefix} >= today() - 1 AND {column} < today()",
        PERIOD_THIS_WEEK: f"{prefix} >= today() - 6 AND {column} < today() + 1",
        PERIOD_THIS_MONTH: f"{prefix} >= today() - 29 AND {column} < today() + 1",
        PERIOD_PREVIOUS_MONTH: (
            f"{prefix} >= toStartOfMonth(today()) - 1"
            f" AND {column} < toStartOfMonth(today())"
        ),
        PERIOD_ALL_TIME: "",
    }
    return filters.get(period, filters[PERIOD_THIS_MONTH])


def bounce_session_started_filter(period: str) -> str:
    """v_session_bounce.session_started_at — aligned with sessionBounceViewFilter."""
    col = "session_started_at"
    prefix = f" AND {col}"
    filters = {
        PERIOD_TODAY: f"{prefix} >= today() AND {col} < today() + 1",
        PERIOD_YESTERDAY: f"{prefix} >= today() - 1 AND {col} < today()",
        PERIOD_THIS_WEEK: f"{prefix} >= today() - 6 AND {col} < today() + 1",
        PERIOD_THIS_MONTH: f"{prefix} >= today() - 29 AND {col} < today() + 1",
        PERIOD_PREVIOUS_MONTH: (
            f"{prefix} >= toStartOfMonth(today()) - 1"
            f" AND {col} < toStartOfMonth(today())"
        ),
        PERIOD_ALL_TIME: "",
    }
    return filters.get(period, filters[PERIOD_THIS_MONTH])
