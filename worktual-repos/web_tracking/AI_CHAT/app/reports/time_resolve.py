"""Map Domain task time words + dashboard pill to semantic time.period."""

from __future__ import annotations

from shared.semantic_time import (
    normalize_semantic_period,
    semantic_period_from_dashboard_pill,
)

_PILL_WORDS = {
    "today": "today",
    "this day": "today",
    "week": "week",
    "this week": "week",
    "month": "month",
    "this month": "month",
    "overall": "overall",
    "all time": "overall",
    "all-time": "overall",
    "lifetime": "overall",
    "realtime": None,
    "online now": None,
    "right now": None,
}


def resolve_task_time(
    task_time: str | None,
    *,
    dashboard_period: str | None,
    realtime: bool = False,
) -> dict[str, str] | None:
    if realtime:
        return None
    expr = (task_time or "").strip().lower()
    if not expr:
        period = semantic_period_from_dashboard_pill(dashboard_period) or "overall"
        return {"period": period}
    if expr in _PILL_WORDS:
        mapped = _PILL_WORDS[expr]
        if mapped is None:
            return None
        return {"period": mapped}
    normalized = normalize_semantic_period(expr)
    if normalized:
        return {"period": normalized}
    pill = semantic_period_from_dashboard_pill(dashboard_period)
    if pill:
        return {"period": pill}
    return {"period": "overall"}
