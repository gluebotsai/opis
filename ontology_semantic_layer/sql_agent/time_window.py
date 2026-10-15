"""Instruction-owned calendar windows for SQL agent (no MetricFlow)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

_CALENDAR_TZ_ENV = "SEMANTIC_CALENDAR_TZ"

_PERIOD_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(today|created today)\b", re.I), "today"),
    (re.compile(r"\blast\s*1\s*days?\b|\bpast\s*day\b|\blast day\b", re.I), "today"),
    (re.compile(r"\blast\s*7\s*days?\b|\blast\s*7d\b|\bpast\s*week\b|\blast week\b", re.I), "last_7d"),
    (re.compile(r"\blast\s*30\s*days?\b|\blast\s*30d\b|\bpast\s*month\b", re.I), "last_30d"),
]

_MONTH_INDEX: dict[str, int] = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}
_MONTH_ALT = "|".join(sorted(_MONTH_INDEX, key=len, reverse=True))
_ISO_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2})")
_ISO_IN_TEXT = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
_MONTH_DAY_YEAR = re.compile(
    rf"\b(?P<month>{_MONTH_ALT})\s+(?P<day>\d{{1,2}})(?:st|nd|rd|th)?,?\s+(?P<year>20\d{{2}})\b",
    re.I,
)
_DAY_MONTH_YEAR = re.compile(
    rf"\b(?P<day>\d{{1,2}})(?:st|nd|rd|th)?\s+(?P<month>{_MONTH_ALT})\s+(?P<year>20\d{{2}})\b",
    re.I,
)
_GLUED_EOD = re.compile(r"\s+23:59:59(?:\.\d+)?$")
_EQ_OPS = frozenset({"eq", "=", "in"})

WINDOW_ALIAS_METRICS: dict[str, str] = {
    "tickets_created_today_metric": "today",
    "tickets_last_7_days": "last_7d",
    "tickets_last_30_days": "last_30d",
}


def calendar_tz():
    import os

    name = (os.environ.get(_CALENDAR_TZ_ENV) or "UTC").strip() or "UTC"
    if name.upper() == "UTC":
        return timezone.utc
    return ZoneInfo(name)


def _today() -> date:
    return datetime.now(calendar_tz()).date()


def resolve_time_window(time_spec: dict[str, Any] | None) -> dict[str, Any]:
    if not time_spec:
        return {}
    out = dict(time_spec)
    period = str(out.get("period") or "").strip().lower()
    today = _today()
    if period in ("today", "day"):
        out["start"] = today.isoformat()
        out["end"] = today.isoformat()
    elif period in ("last_7_days", "last_7d", "last7d", "past_7_days"):
        out["end"] = today.isoformat()
        out["start"] = (today - timedelta(days=6)).isoformat()
    elif period in ("last_30_days", "last_30d", "last30d", "past_30_days"):
        out["end"] = today.isoformat()
        out["start"] = (today - timedelta(days=29)).isoformat()
    elif period in ("last_1_days", "last_1d"):
        out["start"] = today.isoformat()
        out["end"] = today.isoformat()
    elif period in ("yesterday",):
        day = today - timedelta(days=1)
        out["start"] = day.isoformat()
        out["end"] = day.isoformat()
    elif period in ("this_month", "month_to_date"):
        out["start"] = today.replace(day=1).isoformat()
        out["end"] = today.isoformat()
    return out


def extract_period_from_instruction(instruction: str | None) -> str | None:
    text = instruction or ""
    for pat, period in _PERIOD_PATTERNS:
        if pat.search(text):
            return period
    return None


def _ymd(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def to_calendar_date(raw: object) -> str | None:
    """Normalize warehouse ISO, date-only, or month-name values to YYYY-MM-DD.

    Does not rewrite stored timestamptz; binds use date() half-open ranges.
    """
    s = _GLUED_EOD.sub("", str(raw or "").strip())
    if not s:
        return None
    m = _ISO_PREFIX.match(s)
    if m:
        try:
            return date.fromisoformat(m.group(1)).isoformat()
        except ValueError:
            pass
    try:
        iso = s.replace("Z", "+00:00") if s.endswith("Z") else s
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=calendar_tz())
        return dt.astimezone(calendar_tz()).date().isoformat()
    except ValueError:
        pass
    md = _MONTH_DAY_YEAR.search(s) or _DAY_MONTH_YEAR.search(s)
    if md:
        month = _MONTH_INDEX.get(md.group("month").lower())
        if month:
            return _ymd(int(md.group("year")), month, int(md.group("day")))
    return None


def bind_calendar_date(raw: object) -> str:
    parsed = to_calendar_date(raw)
    if parsed:
        return parsed
    s = str(raw or "").strip()
    return s[:10] if len(s) >= 10 else s


def extract_explicit_dates_from_instruction(instruction: str | None) -> list[str]:
    text = instruction or ""
    found: list[str] = []
    seen: set[str] = set()

    def _add(day: str | None) -> None:
        if day and day not in seen:
            seen.add(day)
            found.append(day)

    for m in _MONTH_DAY_YEAR.finditer(text):
        month = _MONTH_INDEX.get(m.group("month").lower())
        if month:
            _add(_ymd(int(m.group("year")), month, int(m.group("day"))))
    for m in _DAY_MONTH_YEAR.finditer(text):
        month = _MONTH_INDEX.get(m.group("month").lower())
        if month:
            _add(_ymd(int(m.group("year")), month, int(m.group("day"))))
    for m in _ISO_IN_TEXT.finditer(text):
        _add(to_calendar_date(m.group(1)))
    return found


def bounds_from_instruction(instruction: str | None) -> tuple[str | None, str | None]:
    period = extract_period_from_instruction(instruction)
    if period:
        resolved = resolve_time_window({"period": period})
        return resolved.get("start"), resolved.get("end")
    days = extract_explicit_dates_from_instruction(instruction)
    if not days:
        return None, None
    return min(days), max(days)


def bounds_for_metric_alias(metric_id: str | None) -> tuple[str | None, str | None]:
    period = WINDOW_ALIAS_METRICS.get(metric_id or "")
    if not period:
        return None, None
    resolved = resolve_time_window({"period": period})
    return resolved.get("start"), resolved.get("end")


def time_predicate_sql(column_ref: str) -> str:
    return f"{column_ref} >= %s::date AND {column_ref} < (%s::date + interval '1 day')"


_CREATED_TIME_COLUMNS = frozenset(
    {
        "created_at",
        "created_range",
        "create_date",
        "created_date",
        "creation_date",
    }
)
_PERIOD_TOKENS: dict[str, str] = {
    "today": "today",
    "yesterday": "yesterday",
    "this_month": "this_month",
    "month_to_date": "this_month",
    "last_7d": "last_7d",
    "last_7_days": "last_7d",
    "last7d": "last_7d",
    "past_7_days": "last_7d",
    "last_30d": "last_30d",
    "last_30_days": "last_30d",
    "last30d": "last_30d",
    "past_30_days": "last_30d",
}
_START_OPS = frozenset({">=", ">", "gte", "gt", "since", "after", "from"})
_END_OPS = frozenset({"<=", "<", "lte", "lt", "until", "before", "to"})
_RANGE_OPS = frozenset({"between", "range"})
_ALLOWED_FILTER_OPS = frozenset(
    {"eq", "=", "neq", "!=", "in", "not_in", "notin", "neq_in", "contains", "ilike", "like"}
)


def _period_token(raw: object) -> str | None:
    key = str(raw or "").strip().lower().replace(" ", "_")
    return _PERIOD_TOKENS.get(key)


def _filter_parts(flt: Any) -> tuple[str, str, list[Any]]:
    if isinstance(flt, dict):
        col = str(flt.get("column") or flt.get("dimension") or "").strip()
        op = str(flt.get("op") or flt.get("operator") or "eq").strip().lower()
        vals = list(flt.get("values") or [])
        if not vals and flt.get("value") is not None:
            vals = [flt["value"]]
        return col, op, vals
    col = str(getattr(flt, "column", "") or "").strip()
    op = str(getattr(flt, "op", "eq") or "eq").strip().lower()
    vals = list(getattr(flt, "values", None) or [])
    return col, op, vals


def fold_time_filters(
    filters: list[Any] | None,
    *,
    time_start: str | None = None,
    time_end: str | None = None,
    time_column: str | None = None,
) -> tuple[list[Any], str | None, str | None, str | None]:
    """Move calendar/comparison predicates off filters[] onto time_start/time_end.

    Gemma often emits created_at op='>=' (or last_7d / yesterday as the op).
    List/count SQL only accepts eq/in/ilike filters; windows belong on time_*.
    Instruction-owned bounds already set on time_start/time_end win.
    """
    start = to_calendar_date(time_start) or time_start
    end = to_calendar_date(time_end) or time_end
    tcol = time_column
    kept: list[Any] = []
    for flt in filters or []:
        col, op, vals = _filter_parts(flt)
        col_l = col.lower()
        period = _period_token(op)
        if not period and vals:
            period = _period_token(vals[0])
        created = col_l in _CREATED_TIME_COLUMNS
        if created or period:
            if period:
                resolved = resolve_time_window({"period": period})
                if not start:
                    start = resolved.get("start")
                if not end:
                    end = resolved.get("end")
                tcol = tcol or "created_at"
                continue
            if created and op in _START_OPS and vals:
                if not start:
                    start = to_calendar_date(vals[0]) or str(vals[0])[:10]
                tcol = tcol or "created_at"
                continue
            if created and op in _END_OPS and vals:
                if not end:
                    end = to_calendar_date(vals[0]) or str(vals[0])[:10]
                tcol = tcol or "created_at"
                continue
            if created and op in _RANGE_OPS and len(vals) >= 2:
                if not start:
                    start = to_calendar_date(vals[0]) or str(vals[0])[:10]
                if not end:
                    end = to_calendar_date(vals[1]) or str(vals[1])[:10]
                tcol = tcol or "created_at"
                continue
            if created and op in _EQ_OPS and vals:
                days = [d for d in (to_calendar_date(v) for v in vals) if d]
                if days:
                    if not start:
                        start = min(days)
                    if not end:
                        end = max(days)
                    tcol = tcol or "created_at"
                    continue
            if created and op not in _ALLOWED_FILTER_OPS:
                tcol = tcol or "created_at"
                continue
        if op not in _ALLOWED_FILTER_OPS:
            continue
        kept.append(flt)
    return kept, start, end, tcol
