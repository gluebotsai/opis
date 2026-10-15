"""Normalize Domain frames in the pack before compile. No Streamlit logic."""

from __future__ import annotations

import calendar
from dataclasses import replace
from datetime import datetime, timezone

from .query_frame import FilterMention, QueryFrame, TimeSpec
from .time import parse_utc

TIME_FILTER_FIELDS = frozenset(
    {"created_at", "date", "time", "month", "period", "when", "year"}
)
CALENDAR_DIMS = frozenset({"month", "week", "day"})
KG_CALENDAR_ERROR = (
    "Calendar grouping (month, week, day) is SQL. "
    "Use executor sql, measure ticket_count, shape breakdown, and group_by month."
)

_MONTH_NUM = {calendar.month_name[i].lower(): i for i in range(1, 13)}
_MONTH_NUM.update({calendar.month_abbr[i].lower(): i for i in range(1, 13)})


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def month_year_bounds(mention: str) -> tuple[str, str] | None:
    raw = (mention or "").strip()
    if len(raw) == 7 and raw[4] == "-" and raw[:4].isdigit() and raw[5:].isdigit():
        year, month = int(raw[:4]), int(raw[5:])
        if 1 <= month <= 12:
            start = datetime(year, month, 1, tzinfo=timezone.utc)
            end = (
                datetime(year + 1, 1, 1, tzinfo=timezone.utc)
                if month == 12
                else datetime(year, month + 1, 1, tzinfo=timezone.utc)
            )
            return _iso(start), _iso(end)
    tokens = raw.replace(",", " ").split()
    month = year = None
    for tok in tokens:
        key = tok.lower()
        if key in _MONTH_NUM:
            month = _MONTH_NUM[key]
        elif tok.isdigit() and len(tok) == 4:
            year = int(tok)
    if month and year:
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        end = (
            datetime(year + 1, 1, 1, tzinfo=timezone.utc)
            if month == 12
            else datetime(year, month + 1, 1, tzinfo=timezone.utc)
        )
        return _iso(start), _iso(end)
    return None


def mention_to_time(mention: str) -> tuple[str, str] | None:
    bounds = month_year_bounds(mention)
    if bounds:
        return bounds
    text = (mention or "").strip()
    try:
        start = parse_utc(text)
    except ValueError:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        from datetime import timedelta

        end = start + timedelta(days=1)
        return _iso(start), _iso(end)
    return None


def _is_date_status(flt: FilterMention) -> bool:
    if flt.field != "status":
        return False
    return mention_to_time(flt.mention) is not None


def lift_time_filters(frame: QueryFrame) -> QueryFrame:
    kept: list[FilterMention] = []
    start, end = frame.time.start, frame.time.end
    date_column = frame.time.date_column
    for flt in frame.filters:
        timeish = flt.field in TIME_FILTER_FIELDS or _is_date_status(flt)
        if not timeish:
            kept.append(flt)
            continue
        if start and end:
            continue
        bounds = mention_to_time(flt.mention)
        if bounds:
            start, end = bounds
    time = TimeSpec(
        expression=frame.time.expression,
        date_column=date_column,
        start=start,
        end=end,
    )
    return replace(frame, filters=kept, time=time)


def prepare_frame(frame: QueryFrame) -> QueryFrame:
    return lift_time_filters(frame)
