"""Resolve relative and calendar time windows for semantic / SQL queries."""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

logger = logging.getLogger("semantic.time_resolver")

# Dashboard month pill aliases (webtracking rolling rewrite when flag on).
WEBTRACKING_MONTH_ALIASES = frozenset({"month", "this_month", "current_month"})

# Calendar basis for period pills. Default UTC — never inherit host TZ.
# Override with SEMANTIC_CALENDAR_TZ (e.g. Asia/Kolkata) when deploy matches dashboard.
_CALENDAR_TZ_ENV = "SEMANTIC_CALENDAR_TZ"


def calendar_tz() -> ZoneInfo | timezone:
    name = (os.environ.get(_CALENDAR_TZ_ENV) or "UTC").strip() or "UTC"
    if name.upper() == "UTC":
        return timezone.utc
    return ZoneInfo(name)


def _today() -> date:
    """Calendar date in SEMANTIC_CALENDAR_TZ (default UTC), not host-local."""
    return datetime.now(calendar_tz()).date()

def _quarter_bounds(d: date) -> tuple[date, date]:
    q = (d.month - 1) // 3
    start_month = q * 3 + 1
    start = date(d.year, start_month, 1)
    if start_month == 10:
        end = date(d.year, 12, 31)
    else:
        end = date(d.year, start_month + 3, 1) - timedelta(days=1)
    return start, end


def _parse_iso_date(val: str | None) -> date | None:
    if not val:
        return None
    s = str(val).strip()[:10]
    return datetime.strptime(s, "%Y-%m-%d").date()


def webtracking_month_rolling_enabled() -> bool:
    raw = (os.environ.get("WEBTRACKING_MONTH_ROLLING") or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def apply_webtracking_month_rolling(
    time_spec: dict[str, Any] | None,
) -> dict[str, Any]:
    """When WEBTRACKING_MONTH_ROLLING is on, map month aliases → last_30_days bounds.

    Call only for execution_product webtracking. Other products must not use this.
    """
    if not time_spec:
        return {}
    out = dict(time_spec)
    period = str(out.get("period") or "").strip().lower()
    if not webtracking_month_rolling_enabled() or period not in WEBTRACKING_MONTH_ALIASES:
        return out
    old = resolve_time_window({"period": period})
    new = resolve_time_window({"period": "last_30_days"})
    logger.info(
        "WEBTRACKING_MONTH_ROLLING rewrite period=%s old_start=%s old_end=%s "
        "new_start=%s new_end=%s",
        period,
        old.get("start"),
        old.get("end"),
        new.get("start"),
        new.get("end"),
    )
    out["period"] = "last_30_days"
    out["start"] = new.get("start")
    out["end"] = new.get("end")
    out.pop("grain", None)
    return out


def resolve_time_window(time_spec: dict[str, Any] | None) -> dict[str, Any]:
    """Return time spec with explicit start/end (ISO date strings)."""
    if not time_spec:
        return {}
    out = dict(time_spec)
    period = str(out.get("period") or "").strip().lower()
    today = _today()

    if period == "this_quarter":
        start, end = _quarter_bounds(today)
        out["start"] = start.isoformat()
        out["end"] = end.isoformat()
    elif period == "previous_quarter":
        cq_start, _ = _quarter_bounds(today)
        prev_end = cq_start - timedelta(days=1)
        start, end = _quarter_bounds(prev_end)
        out["start"] = start.isoformat()
        out["end"] = end.isoformat()
    elif period == "this_year":
        out["start"] = date(today.year, 1, 1).isoformat()
        out["end"] = date(today.year, 12, 31).isoformat()
    elif period == "previous_year":
        y = today.year - 1
        out["start"] = date(y, 1, 1).isoformat()
        out["end"] = date(y, 12, 31).isoformat()
    elif period in ("last_30_days", "last_30d", "last30d", "past_30_days"):
        out["end"] = today.isoformat()
        out["start"] = (today - timedelta(days=29)).isoformat()
    elif period in ("last_7_days", "last_7d", "last7d", "past_7_days"):
        out["end"] = today.isoformat()
        out["start"] = (today - timedelta(days=6)).isoformat()
    elif period in ("today", "day"):
        out["start"] = today.isoformat()
        out["end"] = today.isoformat()
    elif period in ("week", "this_week"):
        # Rolling last 7 days inclusive (dashboard week pill).
        out["end"] = today.isoformat()
        out["start"] = (today - timedelta(days=6)).isoformat()
    elif period in ("month", "this_month", "current_month"):
        # Calendar month (webtracking may rewrite to rolling 30d via flag).
        out["start"] = date(today.year, today.month, 1).isoformat()
        out["end"] = today.isoformat()
    elif period in ("overall", "all_time", "all"):
        out.pop("start", None)
        out.pop("end", None)
        out["period"] = "overall"

    if out.get("start") and not out.get("end"):
        out["end"] = today.isoformat()
    return out


ALLOWED_TIME_GRAINS = frozenset({"day", "week", "month", "quarter", "year"})
