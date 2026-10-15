"""UTC calendar windows. Domain emits ISO bounds; named words stay as a fallback."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple


@dataclass
class TimeSpec:
    expression: str | None = None
    date_column: str | None = None
    start: str | None = None
    end: str | None = None


class TimeBounds(NamedTuple):
    start: datetime | None
    end: datetime | None
    echo: str


def utc_now(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def parse_utc(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        try:
            day = date.fromisoformat(text[:10])
            if len(text) == 10:
                return datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        except ValueError:
            pass
    parsed = datetime.fromisoformat(text)
    return utc_now(parsed)


import calendar
import re

_MONTH_NAMES = {calendar.month_name[i].lower(): i for i in range(1, 13)}
_MONTH_NAMES.update({calendar.month_abbr[i].lower(): i for i in range(1, 13)})

_ALL_TIME_WORDS = frozenset({
    "all time", "all-time", "all_time", "all", "overall", "total",
    "lifetime", "ever", "any", "any time", "anytime", "unbounded",
    "none", "na", "n/a", "full", "whole", "entire",
    "now", "current", "live", "right now",
})


def _parse_month_year(raw: str) -> tuple[datetime, datetime, str] | None:
    tokens = raw.replace(",", " ").replace("-", " ").split()
    month = year = None
    for tok in tokens:
        low = tok.lower()
        if low in _MONTH_NAMES:
            month = _MONTH_NAMES[low]
        elif tok.isdigit() and len(tok) == 4:
            year = int(tok)
        elif tok.isdigit() and len(tok) <= 2 and not month:
            m = int(tok)
            if 1 <= m <= 12:
                month = m
    if month and year:
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        end = (
            datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            if month == 12
            else datetime(year, month + 1, 1, tzinfo=timezone.utc)
        )
        month_name = calendar.month_name[month]
        return start, end, f"{month_name} {year} (UTC)"
    return None


def resolve_expression(expression: str | None, *, now: datetime | None = None) -> TimeBounds:
    """Map Domain time words or ISO strings to half-open [start, end) UTC."""
    moment = utc_now(now)
    if not expression:
        return TimeBounds(None, None, "overall (no date filter, UTC)")

    key = expression.strip().lower()
    if key in _ALL_TIME_WORDS:
        return TimeBounds(None, None, "overall (no date filter, UTC)")

    today = moment.date()
    today_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    named = {
        "today": (today_start, today_start + timedelta(days=1), "today (UTC)"),
        "yesterday": (today_start - timedelta(days=1), today_start, "yesterday (UTC)"),
        "this week": (
            today_start - timedelta(days=today.weekday()),
            today_start - timedelta(days=today.weekday()) + timedelta(days=7),
            "this week Monday–Sunday (UTC)",
        ),
        "last week": (
            today_start - timedelta(days=today.weekday()) - timedelta(days=7),
            today_start - timedelta(days=today.weekday()),
            "last week Monday–Sunday (UTC)",
        ),
        "this year": (
            datetime(today.year, 1, 1, tzinfo=timezone.utc),
            datetime(today.year + 1, 1, 1, tzinfo=timezone.utc),
            f"this year {today.year} (UTC)",
        ),
        "last year": (
            datetime(today.year - 1, 1, 1, tzinfo=timezone.utc),
            datetime(today.year, 1, 1, tzinfo=timezone.utc),
            f"last year {today.year - 1} (UTC)",
        ),
    }
    if key in named:
        start, end, echo = named[key]
        return TimeBounds(start, end, echo)

    if key in {"this month", "current month"}:
        start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        end = (
            datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)
            if today.month == 12
            else datetime(today.year, today.month + 1, 1, tzinfo=timezone.utc)
        )
        return TimeBounds(start, end, "this month (UTC)")

    if key in {"last month", "previous month"}:
        first_this = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        start = (
            datetime(today.year - 1, 12, 1, tzinfo=timezone.utc)
            if today.month == 1
            else datetime(today.year, today.month - 1, 1, tzinfo=timezone.utc)
        )
        return TimeBounds(start, first_this, "last month (UTC)")

    # Trailing dynamic windows: "last N days", "past N hours", etc.
    trailing_match = re.match(r"^(?:last|past)\s+(\d+)\s*(days?|hours?|weeks?|months?)$", key)
    if trailing_match:
        count = int(trailing_match.group(1))
        unit = trailing_match.group(2)
        if unit.startswith("hour"):
            return TimeBounds(moment - timedelta(hours=count), moment, f"past {count} hours (UTC)")
        if unit.startswith("day"):
            return TimeBounds(today_start - timedelta(days=count), today_start + timedelta(days=1), f"past {count} days (UTC)")
        if unit.startswith("week"):
            return TimeBounds(today_start - timedelta(weeks=count), today_start + timedelta(days=1), f"past {count} weeks (UTC)")
        if unit.startswith("month"):
            return TimeBounds(today_start - timedelta(days=count * 30), today_start + timedelta(days=1), f"past {count} months (UTC)")

    # Calendar Year only (e.g. "2026")
    if key.isdigit() and len(key) == 4:
        y = int(key)
        start = datetime(y, 1, 1, tzinfo=timezone.utc)
        end = datetime(y + 1, 1, 1, tzinfo=timezone.utc)
        return TimeBounds(start, end, f"{y} (UTC)")

    # Month and Year (e.g. "August 2026", "2026-08")
    month_year = _parse_month_year(key)
    if month_year:
        start, end, echo = month_year
        return TimeBounds(start, end, echo)

    # Specific ISO timestamp or date (e.g. "2026-09-01")
    try:
        start = parse_utc(expression.strip())
        if len(expression.strip()) == 10:
            return TimeBounds(start, start + timedelta(days=1), f"{start.date().isoformat()} (UTC)")
        return TimeBounds(start, start + timedelta(seconds=1), f"{start.isoformat()} (UTC)")
    except Exception:
        # Graceful fallback: rather than crashing the pipeline with an exception,
        # treat unparseable descriptive text as unbounded (all time).
        return TimeBounds(None, None, "overall (no date filter, UTC)")


def resolve_time(spec: TimeSpec | None, *, now: datetime | None = None) -> TimeBounds:
    spec = spec or TimeSpec()
    if spec.start and spec.end:
        start = parse_utc(str(spec.start))
        end = parse_utc(str(spec.end))
        return TimeBounds(start, end, f"{start.isoformat()}–{end.isoformat()} UTC")
    if spec.start and not spec.end:
        start = parse_utc(str(spec.start))
        end = start + timedelta(days=1)
        return TimeBounds(start, end, f"{start.date().isoformat()} (UTC)")
    return resolve_expression(spec.expression, now=now)


def window_days(bounds: TimeBounds, *, now: datetime | None = None) -> float:
    moment = utc_now(now)
    if bounds.start is None or bounds.end is None:
        return 1.0
    seconds = (min(bounds.end, moment) - bounds.start).total_seconds()
    return max(seconds / 86400.0, 1.0 / 24.0)
