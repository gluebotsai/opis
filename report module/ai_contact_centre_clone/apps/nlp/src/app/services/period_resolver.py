"""Resolve a spoken analytics window before any KPI or chart tool runs.

Spoken dates override the page picker. This is date extraction, not intent routing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

_MONTH_ALT = "|".join(sorted(MONTHS, key=len, reverse=True))
_MONTH_DAY_RE = re.compile(
    rf"\b({_MONTH_ALT})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s*(20\d{{2}}))?\b",
    re.IGNORECASE,
)
_DAY_MONTH_RE = re.compile(
    rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_ALT})(?:,?\s*(20\d{{2}}))?\b",
    re.IGNORECASE,
)
_ISO_DATE_RE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
_LAST_N_DAYS_RE = re.compile(
    r"\b(?:last|past|previous|prior)\s+(\d+)\s+days?\b",
    re.IGNORECASE,
)
_THIS_WEEK_RE = re.compile(r"\bthis\s+week\b", re.IGNORECASE)
_LAST_WEEK_RE = re.compile(r"\blast\s+week\b", re.IGNORECASE)
_TODAY_RE = re.compile(r"\btoday\b", re.IGNORECASE)
_YESTERDAY_RE = re.compile(r"\byesterday\b", re.IGNORECASE)
_COMPARE_RE = re.compile(
    r"\b(versus|vs\.?|compared\s+to|compare)\b",
    re.IGNORECASE,
)
@dataclass(frozen=True)
class ResolvedPeriod:
    start: str | None
    end: str | None
    range: str | None
    spoken: bool
    label: str

    def as_params(self) -> dict[str, str]:
        if self.start and self.end:
            return {"start": self.start, "end": self.end}
        if self.range:
            return {"range": self.range}
        return {"range": "30d"}


def _iso(day: date) -> str:
    return day.isoformat()


def _label_day(day: date) -> str:
    return day.strftime("%-d %b %Y")


def _label_span(start: date, end: date) -> str:
    if start == end:
        return _label_day(start)
    return f"{start.strftime('%-d %b')} – {end.strftime('%-d %b %Y')}"


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _valid_day(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _year_for_month_day(month: int, day: int, today: date, year: int | None) -> int:
    if year:
        return year
    candidate = _valid_day(today.year, month, day)
    if candidate is None:
        return today.year - 1 if month == 2 and day == 29 else today.year
    if candidate > today + timedelta(days=1):
        return today.year - 1
    return today.year


def _collect_named_days(cleaned: str, today: date) -> list[date]:
    found: list[date] = []
    seen: set[str] = set()

    def _add(parsed: date | None) -> None:
        if parsed is None:
            return
        key = parsed.isoformat()
        if key in seen:
            return
        seen.add(key)
        found.append(parsed)

    for match in _ISO_DATE_RE.finditer(cleaned):
        _add(_valid_day(int(match.group(1)), int(match.group(2)), int(match.group(3))))
    for match in _MONTH_DAY_RE.finditer(cleaned):
        month = MONTHS[match.group(1).lower()]
        day = int(match.group(2))
        year = int(match.group(3)) if match.group(3) else None
        _add(_valid_day(_year_for_month_day(month, day, today, year), month, day))
    for match in _DAY_MONTH_RE.finditer(cleaned):
        day = int(match.group(1))
        month = MONTHS[match.group(2).lower()]
        year = int(match.group(3)) if match.group(3) else None
        _add(_valid_day(_year_for_month_day(month, day, today, year), month, day))
    if _YESTERDAY_RE.search(cleaned):
        _add(today - timedelta(days=1))
    if _TODAY_RE.search(cleaned):
        _add(today)
    return found


def resolve_compare_periods(
    query: str,
    *,
    today: date | None = None,
) -> list[ResolvedPeriod] | None:
    """Two named days in one question become two one-day windows."""
    today = today or date.today()
    cleaned = (query or "").strip()
    days = _collect_named_days(cleaned, today)
    if len(days) < 2:
        return None
    if not (
        _COMPARE_RE.search(cleaned)
        or re.search(r"\b(and|vs\.?)\b", cleaned, re.IGNORECASE)
    ):
        return None
    if _LAST_N_DAYS_RE.search(cleaned) or _THIS_WEEK_RE.search(cleaned) or _LAST_WEEK_RE.search(cleaned):
        return None
    return [
        ResolvedPeriod(_iso(day), _iso(day), None, True, _label_day(day))
        for day in days[:2]
    ]


def resolve_query_period(
    query: str,
    *,
    page_start: str | None = None,
    page_end: str | None = None,
    page_range: str | None = None,
    today: date | None = None,
) -> ResolvedPeriod:
    """Prefer a window named in the question; otherwise keep the page picker."""
    today = today or date.today()
    cleaned = (query or "").strip()

    iso = _ISO_DATE_RE.search(cleaned)
    if iso:
        parsed = _valid_day(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        if parsed:
            return ResolvedPeriod(_iso(parsed), _iso(parsed), None, True, _label_day(parsed))

    month_day = _MONTH_DAY_RE.search(cleaned)
    if month_day:
        month = MONTHS[month_day.group(1).lower()]
        day = int(month_day.group(2))
        year = int(month_day.group(3)) if month_day.group(3) else None
        parsed = _valid_day(_year_for_month_day(month, day, today, year), month, day)
        if parsed:
            return ResolvedPeriod(_iso(parsed), _iso(parsed), None, True, _label_day(parsed))

    day_month = _DAY_MONTH_RE.search(cleaned)
    if day_month:
        day = int(day_month.group(1))
        month = MONTHS[day_month.group(2).lower()]
        year = int(day_month.group(3)) if day_month.group(3) else None
        parsed = _valid_day(_year_for_month_day(month, day, today, year), month, day)
        if parsed:
            return ResolvedPeriod(_iso(parsed), _iso(parsed), None, True, _label_day(parsed))

    if _YESTERDAY_RE.search(cleaned):
        day = today - timedelta(days=1)
        return ResolvedPeriod(_iso(day), _iso(day), None, True, "yesterday")

    if _TODAY_RE.search(cleaned):
        return ResolvedPeriod(_iso(today), _iso(today), None, True, "today")

    if _THIS_WEEK_RE.search(cleaned):
        start = _monday(today)
        return ResolvedPeriod(_iso(start), _iso(today), None, True, "this week")

    if _LAST_WEEK_RE.search(cleaned):
        start = _monday(today) - timedelta(days=7)
        end = start + timedelta(days=6)
        return ResolvedPeriod(_iso(start), _iso(end), None, True, "last week")

    last_n = _LAST_N_DAYS_RE.search(cleaned)
    if last_n:
        days = max(1, int(last_n.group(1)))
        start = today - timedelta(days=days - 1)
        range_key = f"{days}d" if days in {7, 30, 90} else None
        return ResolvedPeriod(
            _iso(start),
            _iso(today),
            range_key,
            True,
            f"last {days} days",
        )

    if page_start and page_end:
        return ResolvedPeriod(
            page_start,
            page_end,
            None,
            False,
            f"{page_start} to {page_end}",
        )
    if page_range:
        return ResolvedPeriod(None, None, page_range, False, f"last {page_range}")
    return ResolvedPeriod(None, None, "30d", False, "last 30 days")


def apply_spoken_period(extra: dict[str, Any], message: str, *, today: date | None = None) -> ResolvedPeriod:
    """Override copilot context dates when the user named a different window."""
    compare = resolve_compare_periods(message, today=today)
    resolved = resolve_query_period(
        message,
        page_start=extra.get("start") if isinstance(extra.get("start"), str) else None,
        page_end=extra.get("end") if isinstance(extra.get("end"), str) else None,
        page_range=extra.get("range") if isinstance(extra.get("range"), str) else None,
        today=today,
    )
    extra["period_source"] = "spoken" if resolved.spoken else "page"
    extra["period_label"] = resolved.label
    extra["compare_periods"] = (
        [{"start": period.start, "end": period.end, "label": period.label} for period in compare]
        if compare
        else []
    )
    if compare:
        extra["period_label"] = " vs ".join(period.label for period in compare)
        extra["period_source"] = "spoken"
    if resolved.spoken:
        extra["start"] = resolved.start
        extra["end"] = resolved.end
        extra["range"] = None
    return resolved
