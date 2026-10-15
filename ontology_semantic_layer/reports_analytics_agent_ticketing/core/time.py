"""UTC calendar windows. Domain emits ISO bounds; named words stay as a fallback."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import NamedTuple

from .query_frame import TimeSpec


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


def resolve_expression(expression: str | None, *, now: datetime | None = None) -> TimeBounds:
    """Map Domain time words or ISO strings to half-open [start, end) UTC."""
    moment = utc_now(now)
    if not expression:
        return TimeBounds(None, None, "overall (no date filter, UTC)")

    key = expression.strip().lower()
    today = moment.date()
    today_start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)

    named = {
        "today": (today_start, today_start + timedelta(days=1), "today (UTC)"),
        "yesterday": (today_start - timedelta(days=1), today_start, "yesterday (UTC)"),
    }
    if key in named:
        start, end, echo = named[key]
        return TimeBounds(start, end, echo)
    if key == "this week":
        monday = today_start - timedelta(days=today.weekday())
        return TimeBounds(monday, monday + timedelta(days=7), "this week Monday–Sunday (UTC)")
    if key == "last week":
        monday = today_start - timedelta(days=today.weekday())
        return TimeBounds(monday - timedelta(days=7), monday, "last week Monday–Sunday (UTC)")
    if key == "this month":
        start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        end = (
            datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)
            if today.month == 12
            else datetime(today.year, today.month + 1, 1, tzinfo=timezone.utc)
        )
        return TimeBounds(start, end, "this month (UTC)")
    if key == "last month":
        first_this = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
        start = (
            datetime(today.year - 1, 12, 1, tzinfo=timezone.utc)
            if today.month == 1
            else datetime(today.year, today.month - 1, 1, tzinfo=timezone.utc)
        )
        return TimeBounds(start, first_this, "last month (UTC)")

    try:
        start = parse_utc(expression.strip())
    except ValueError as exc:
        raise ValueError(f"unsupported time expression: {expression}") from exc
    if len(expression.strip()) == 10:
        return TimeBounds(start, start + timedelta(days=1), f"{start.date().isoformat()} (UTC)")
    return TimeBounds(start, start + timedelta(seconds=1), f"{start.isoformat()} (UTC)")


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
