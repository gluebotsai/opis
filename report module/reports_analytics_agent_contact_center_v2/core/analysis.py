"""Deterministic arithmetic. The LLM must not compute rates or deltas."""

from __future__ import annotations

from typing import Any


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
