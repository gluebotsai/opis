"""Map dashboard UI period pills to Context Layer semantic time.period (api-node aligned)."""

from __future__ import annotations

# Same rolling windows as api-node period.ts / scripts/context_layer_validation_audit.py
DASHBOARD_PILL_TO_SEMANTIC: dict[str, str] = {
    "today": "today",
    "week": "week",
    "month": "month",
    "overall": "overall",
}

REALTIME_METRICS = frozenset({"online_visitors"})

# Executor may emit aliases; Context Layer + dashboard pills use these keys.
PERIOD_ALIASES: dict[str, str] = {
    "this_month": "month",
    "last_30_days": "month",
    "this_week": "week",
    "last_7_days": "week",
    "all_time": "overall",
    "all": "overall",
}

CONTEXT_LAYER_PERIODS = frozenset({
    "today",
    "yesterday",
    "week",
    "month",
    "overall",
})

# Ranking / breakdown questions without an explicit limit.
DEFAULT_RANKING_LIMIT = 10


def normalize_semantic_period(period: str | None) -> str | None:
    if not period:
        return None
    key = period.strip().lower()
    return PERIOD_ALIASES.get(key, key)


def semantic_period_from_dashboard_pill(dashboard_period: str | None) -> str | None:
    if not dashboard_period:
        return None
    return DASHBOARD_PILL_TO_SEMANTIC.get(dashboard_period.strip().lower())


def dashboard_period_label(dashboard_period: str | None) -> str | None:
    labels = {
        "today": "today",
        "week": "in the last 7 days",
        "month": "in the last 30 days",
        "overall": "overall",
    }
    if not dashboard_period:
        return None
    return labels.get(dashboard_period.strip().lower())
