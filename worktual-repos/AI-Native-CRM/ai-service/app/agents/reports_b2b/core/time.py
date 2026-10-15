# origin: ticketing_v2/core/time.py
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple, Tuple, Optional

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
    status: str = "all_time"  # bounded | all_time | unresolved

def utc_now(now: datetime | None = None) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)

def get_as_of_utc() -> datetime:
    return utc_now()

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

_MONTH_NAMES = {calendar.month_name[i].lower(): i for i in range(1, 13)}
_MONTH_NAMES.update({calendar.month_abbr[i].lower(): i for i in range(1, 13)})

_ALL_TIME_WORDS = frozenset({
    "all time", "all-time", "all_time", "all", "overall", "total",
    "lifetime", "ever", "any", "any time", "anytime", "unbounded",
    "none", "na", "n/a", "full", "whole", "entire",
})

def _month_bounds(year: int, month: int) -> tuple[datetime, datetime, str]:
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    end = (
        datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        if month == 12
        else datetime(year, month + 1, 1, tzinfo=timezone.utc)
    )
    return start, end, f"{calendar.month_name[month]} {year} (UTC)"


def _parse_month_year(raw: str, *, today: date) -> tuple[datetime, datetime, str] | None:
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
    if not month:
        return None
    if not year:
        year = today.year if month <= today.month else today.year - 1
    return _month_bounds(year, month)

def _bounded(start: datetime, end: datetime, echo: str) -> TimeBounds:
    return TimeBounds(start, end, echo, "bounded")


def _all_time() -> TimeBounds:
    return TimeBounds(None, None, "overall (no date filter, UTC)", "all_time")


def _unresolved(expression: str) -> TimeBounds:
    return TimeBounds(
        None,
        None,
        f"unresolved time expression: {expression.strip()}",
        "unresolved",
    )


def resolve_expression(expression: str | None, *, now: datetime | None = None) -> TimeBounds:
    """Map Domain time words or ISO strings to half-open [start, end) UTC."""
    moment = utc_now(now)
    if not expression:
        return _all_time()

    key = expression.strip().lower()
    if key in _ALL_TIME_WORDS:
        return _all_time()

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
        "this_week": (
            today_start - timedelta(days=today.weekday()),
            today_start - timedelta(days=today.weekday()) + timedelta(days=7),
            "this week Monday–Sunday (UTC)",
        ),
        "last week": (
            today_start - timedelta(days=today.weekday()) - timedelta(days=7),
            today_start - timedelta(days=today.weekday()),
            "last week Monday–Sunday (UTC)",
        ),
        "last_week": (
            today_start - timedelta(days=today.weekday()) - timedelta(days=7),
            today_start - timedelta(days=today.weekday()),
            "last week Monday–Sunday (UTC)",
        ),
        "this year": (
            datetime(today.year, 1, 1, tzinfo=timezone.utc),
            datetime(today.year + 1, 1, 1, tzinfo=timezone.utc),
            f"this year {today.year} (UTC)",
        ),
        "this_year": (
            datetime(today.year, 1, 1, tzinfo=timezone.utc),
            datetime(today.year + 1, 1, 1, tzinfo=timezone.utc),
            f"this year {today.year} (UTC)",
        ),
        "last year": (
            datetime(today.year - 1, 1, 1, tzinfo=timezone.utc),
            datetime(today.year, 1, 1, tzinfo=timezone.utc),
            f"last year {today.year - 1} (UTC)",
        ),
        "last_year": (
            datetime(today.year - 1, 1, 1, tzinfo=timezone.utc),
            datetime(today.year, 1, 1, tzinfo=timezone.utc),
            f"last year {today.year - 1} (UTC)",
        ),
    }
    if key in named:
        start, end, echo = named[key]
        return _bounded(start, end, echo)

    if key in {"this month", "current month", "this_month", "current_month"}:
        start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        end = (
            datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)
            if today.month == 12
            else datetime(today.year, today.month + 1, 1, tzinfo=timezone.utc)
        )
        return _bounded(start, end, "this month (UTC)")

    if key in {"last month", "previous month", "last_month", "previous_month"}:
        first_this = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        start = (
            datetime(today.year - 1, 12, 1, tzinfo=timezone.utc)
            if today.month == 1
            else datetime(today.year, today.month - 1, 1, tzinfo=timezone.utc)
        )
        return _bounded(start, first_this, "last month (UTC)")

    if key in {"this quarter", "this_quarter", "current quarter"}:
        q = (today.month - 1) // 3 + 1
        start_month = (q - 1) * 3 + 1
        start = datetime(today.year, start_month, 1, tzinfo=timezone.utc)
        end = datetime(today.year + 1, 1, 1, tzinfo=timezone.utc) if q == 4 else datetime(today.year, start_month + 3, 1, tzinfo=timezone.utc)
        return _bounded(start, end, f"Q{q} {today.year} (UTC)")

    trailing_match = re.match(r"^(?:last|past)[_\s]+(\d+)[_\s]*(days?|hours?|weeks?|months?)$", key)
    if trailing_match:
        count = int(trailing_match.group(1))
        unit = trailing_match.group(2)
        if unit.startswith("hour"):
            return _bounded(moment - timedelta(hours=count), moment, f"past {count} hours (UTC)")
        if unit.startswith("day"):
            return _bounded(today_start - timedelta(days=count), today_start + timedelta(days=1), f"past {count} days (UTC)")
        if unit.startswith("week"):
            return _bounded(today_start - timedelta(weeks=count), today_start + timedelta(days=1), f"past {count} weeks (UTC)")
        if unit.startswith("month"):
            return _bounded(today_start - timedelta(days=count * 30), today_start + timedelta(days=1), f"past {count} months (UTC)")

    if key in {"1 day", "one day", "last 1 day", "past 1 day"}:
        return _bounded(today_start - timedelta(days=1), today_start + timedelta(days=1), "past 1 day (UTC)")

    range_match = re.match(
        r"^(?:from\s+)?(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|-|–)\s*(\d{4}-\d{2}-\d{2})$",
        key,
    )
    if range_match:
        start = parse_utc(range_match.group(1))
        end_day = parse_utc(range_match.group(2))
        end = end_day + timedelta(days=1)
        if end <= start:
            return _unresolved(expression)
        return _bounded(start, end, f"{start.date().isoformat()} to {end_day.date().isoformat()} (UTC)")

    between_match = re.match(
        r"^between\s+(\d{4}-\d{2}-\d{2})\s+and\s+(\d{4}-\d{2}-\d{2})$",
        key,
    )
    if between_match:
        start = parse_utc(between_match.group(1))
        end_day = parse_utc(between_match.group(2))
        end = end_day + timedelta(days=1)
        if end <= start:
            return _unresolved(expression)
        return _bounded(start, end, f"{start.date().isoformat()} to {end_day.date().isoformat()} (UTC)")

    short_days_match = re.match(r"^(\d+)d$", key)
    if short_days_match:
        count = int(short_days_match.group(1))
        return _bounded(today_start - timedelta(days=count), today_start + timedelta(days=1), f"past {count} days (UTC)")

    if key.isdigit() and len(key) == 4:
        y = int(key)
        start = datetime(y, 1, 1, tzinfo=timezone.utc)
        end = datetime(y + 1, 1, 1, tzinfo=timezone.utc)
        return _bounded(start, end, f"{y} (UTC)")

    month_year = _parse_month_year(key, today=today)
    if month_year:
        start, end, echo = month_year
        return _bounded(start, end, echo)

    try:
        start = parse_utc(expression.strip())
        if len(expression.strip()) == 10:
            return _bounded(start, start + timedelta(days=1), f"{start.date().isoformat()} (UTC)")
        return _bounded(start, start + timedelta(seconds=1), f"{start.isoformat()} (UTC)")
    except Exception:
        return _unresolved(expression)

def resolve_time(spec: TimeSpec | None, *, now: datetime | None = None) -> TimeBounds:
    spec = spec or TimeSpec()
    if spec.start and spec.end:
        start = parse_utc(str(spec.start))
        end = parse_utc(str(spec.end))
        return _bounded(start, end, f"{start.isoformat()}–{end.isoformat()} UTC")
    if spec.start and not spec.end:
        start = parse_utc(str(spec.start))
        end = start + timedelta(days=1)
        return _bounded(start, end, f"{start.date().isoformat()} (UTC)")
    return resolve_expression(spec.expression, now=now)

def resolve_time_window(phrase: str, as_of: Optional[datetime] = None) -> Tuple[Optional[datetime], Optional[datetime]]:
    tb = resolve_expression(phrase, now=as_of)
    return tb.start, tb.end

def window_days(bounds: TimeBounds, *, now: datetime | None = None) -> float:
    moment = utc_now(now)
    if bounds.start is None or bounds.end is None:
        return 1.0
    seconds = (min(bounds.end, moment) - bounds.start).total_seconds()
    return max(seconds / 86400.0, 1.0 / 24.0)
