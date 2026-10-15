"""Deterministic arithmetic. The LLM must not compute rates or deltas."""

from __future__ import annotations

from typing import Any

DURATION_MINUTE_KEYS = frozenset(
    {
        "avg_handle_time",
        "avg_first_response",
        "asa",
        "avg_hold_time",
    }
)


def format_duration_seconds(seconds: Any) -> str | None:
    """Match dashboard cards: 3158 -> 52m 38s."""
    try:
        total = int(round(float(seconds)))
    except (TypeError, ValueError):
        return None
    if total < 0:
        return None
    if total < 60:
        return f"{total}s"
    minutes = total // 60
    remaining = total % 60
    if minutes < 60:
        return f"{minutes}m {remaining}s" if remaining else f"{minutes}m"
    hours = minutes // 60
    remaining_minutes = minutes % 60
    return f"{hours}h {remaining_minutes}m" if remaining_minutes else f"{hours}h"


def format_duration_minutes(minutes: Any) -> str | None:
    try:
        return format_duration_seconds(float(minutes) * 60.0)
    except (TypeError, ValueError):
        return None


def format_journey_seconds(seconds: Any) -> str | None:
    """Hop deltas: values over 300 seconds become hours/minutes."""
    try:
        total = float(seconds)
    except (TypeError, ValueError):
        return None
    if total > 300:
        return format_duration_seconds(total)
    return format_duration_seconds(total)


def rate_one_decimal(numerator: Any, denominator: Any) -> float | None:
    """Product rounding: round(num/den * 1000) / 10. None if denom is 0 or missing."""
    try:
        num = float(numerator)
        den = float(denominator)
    except (TypeError, ValueError):
        return None
    if den == 0:
        return None
    return round(num / den * 1000) / 10


def occupancy_pct(busy_acw_seconds: Any, logged_in_seconds: Any) -> float | None:
    return rate_one_decimal(busy_acw_seconds, logged_in_seconds)


def percent_change(current: Any, previous: Any) -> float | None:
    """0 if both empty; None ('New') if prior is 0 and now > 0."""
    try:
        now = float(current or 0)
        prev = float(previous or 0)
    except (TypeError, ValueError):
        return None
    if now == 0 and prev == 0:
        return 0.0
    if prev == 0 and now > 0:
        return None
    return round((now - prev) / abs(prev) * 1000) / 10


def period_delta(
    current: float | int,
    previous: float | int,
    *,
    unit: str = "",
    precision: int = 2,
) -> dict[str, Any]:
    cur = float(current)
    prv = float(previous)
    delta = round(cur - prv, precision)
    if prv == 0:
        pct_change = None
    else:
        pct_change = round((cur - prv) / abs(prv) * 100, precision)
    if delta > 0:
        direction = "up"
    elif delta < 0:
        direction = "down"
    else:
        direction = "flat"
    return {
        "current": round(cur, precision),
        "previous": round(prv, precision),
        "delta": delta,
        "pct_change": pct_change,
        "direction": direction,
        "unit": unit,
    }
