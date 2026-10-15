"""UTC half-open windows. Mechanical time words only — not question routing."""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple


@dataclass
class TimeSpec:
    expression: str | None = None
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


_MONTH_NAMES = {calendar.month_name[i].lower(): i for i in range(1, 13)}
_MONTH_NAMES.update({calendar.month_abbr[i].lower(): i for i in range(1, 13)})

_UNBOUNDED = frozenset(
    {
        "all time",
        "all-time",
        "all_time",
        "overall",
        "lifetime",
        "totally",
        "ever",
        "unbounded",
        "none",
        "n/a",
    }
)

_TRAILING = re.compile(r"^(?:last|past)\s+(\d+)\s*(days?|hours?|weeks?|months?)$")
_RANGE = re.compile(
    r"^(?:from\s+)?(\d{4}-\d{2}-\d{2})(?:[tT][^\s]*)?\s+(?:to|until|through|-|–)\s+(\d{4}-\d{2}-\d{2})"
)


def _month_year(raw: str) -> tuple[datetime, datetime, str] | None:
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
        return start, end, f"{calendar.month_name[month]} {year} (UTC)"
    return None


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _quarter(today: date, *, last: bool) -> tuple[datetime, datetime, str]:
    q = (today.month - 1) // 3
    year = today.year
    if last:
        q -= 1
        if q < 0:
            q = 3
            year -= 1
    start_month = q * 3 + 1
    start = datetime(year, start_month, 1, tzinfo=timezone.utc)
    end_month = start_month + 3
    end = (
        datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        if end_month > 12
        else datetime(year, end_month, 1, tzinfo=timezone.utc)
    )
    return start, end, f"Q{q + 1} {year} (UTC)"


def _calendar_days(today_start: datetime, count: int) -> tuple[datetime, datetime, str]:
    """Today plus the previous count-1 UTC calendar days. Half-open through tomorrow midnight."""
    n = max(int(count), 1)
    start = today_start - timedelta(days=n - 1)
    end = today_start + timedelta(days=1)
    prev = n - 1
    echo = (
        f"past {n} days (UTC calendar: today + previous {prev} day"
        f"{'' if prev == 1 else 's'})"
    )
    return start, end, echo


def _calendar_months(today: date, count: int) -> tuple[datetime, datetime, str]:
    """This month plus the previous count-1 calendar months, through the first of next month."""
    n = max(int(count), 1)
    start_y, start_m = _shift_month(today.year, today.month, -(n - 1))
    end_y, end_m = _shift_month(today.year, today.month, 1)
    start = datetime(start_y, start_m, 1, tzinfo=timezone.utc)
    end = datetime(end_y, end_m, 1, tzinfo=timezone.utc)
    prev = n - 1
    echo = (
        f"past {n} months (UTC calendar: this month + previous {prev} month"
        f"{'' if prev == 1 else 's'})"
    )
    return start, end, echo


def resolve_expression(expression: str | None, *, now: datetime | None = None) -> TimeBounds:
    """Map time words or ISO strings to half-open [start, end) UTC."""
    moment = utc_now(now)
    if not expression or not expression.strip():
        return TimeBounds(None, None, "all time")
    key = expression.strip().lower()
    key = re.sub(r"^(?:for\s+)?(?:the\s+)", "", key).strip()
    if key in _UNBOUNDED or key in {"now", "currently", "right now"}:
        echo = "now (live)" if key in {"now", "currently", "right now"} else "all time"
        return TimeBounds(None, None, echo)

    today = moment.date()
    today_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
    week_start = today_start - timedelta(days=today.weekday())

    named = {
        "today": (today_start, today_start + timedelta(days=1), "today (UTC)"),
        "yesterday": (today_start - timedelta(days=1), today_start, "yesterday (UTC)"),
        "this week": (week_start, week_start + timedelta(days=7), "this week Monday–Sunday (UTC)"),
        "last week": (week_start - timedelta(days=7), week_start, "last week Monday–Sunday (UTC)"),
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
    if key in {"this quarter", "current quarter"}:
        start, end, echo = _quarter(today, last=False)
        return TimeBounds(start, end, echo)
    if key in {"last quarter", "previous quarter"}:
        start, end, echo = _quarter(today, last=True)
        return TimeBounds(start, end, echo)

    trailing = _TRAILING.match(key)
    if trailing:
        count = int(trailing.group(1))
        unit = trailing.group(2)
        if unit.startswith("hour"):
            return TimeBounds(moment - timedelta(hours=count), moment, f"past {count} hours (UTC)")
        if unit.startswith("day"):
            start, end, echo = _calendar_days(today_start, count)
            return TimeBounds(start, end, echo)
        if unit.startswith("week"):
            start, end, echo = _calendar_days(today_start, count * 7)
            echo = (
                f"past {count} weeks (UTC calendar: today + previous {count * 7 - 1} days)"
            )
            return TimeBounds(start, end, echo)
        start, end, echo = _calendar_months(today, count)
        return TimeBounds(start, end, echo)

    range_match = _RANGE.match(key)
    if range_match:
        start = parse_utc(range_match.group(1))
        end_day = parse_utc(range_match.group(2))
        return TimeBounds(
            start,
            end_day + timedelta(days=1),
            f"{start.date().isoformat()} to {end_day.date().isoformat()} (UTC, inclusive)",
        )

    if key.isdigit() and len(key) == 4:
        y = int(key)
        return TimeBounds(
            datetime(y, 1, 1, tzinfo=timezone.utc),
            datetime(y + 1, 1, 1, tzinfo=timezone.utc),
            f"{y} (UTC)",
        )

    month_year = _month_year(key)
    if month_year:
        start, end, echo = month_year
        return TimeBounds(start, end, echo)

    try:
        start = parse_utc(expression.strip())
        if len(expression.strip()) == 10:
            return TimeBounds(start, start + timedelta(days=1), f"{start.date().isoformat()} (UTC)")
        return TimeBounds(start, start + timedelta(seconds=1), f"{start.isoformat()} (UTC)")
    except Exception as exc:
        raise ValueError(f"unsupported time expression: {expression!r}") from exc


def previous_equal_window(start: datetime, end: datetime) -> tuple[datetime, datetime]:
    return start - (end - start), start


def resolve_time(spec: TimeSpec | None, *, now: datetime | None = None) -> TimeBounds:
    spec = spec or TimeSpec()
    if spec.start and spec.end:
        return TimeBounds(
            parse_utc(str(spec.start)),
            parse_utc(str(spec.end)),
            f"{spec.start} to {spec.end} (UTC)",
        )
    return resolve_expression(spec.expression, now=now)
