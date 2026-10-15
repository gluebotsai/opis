"""Inferred send windows from engagement timestamps — not chat intent, not LLM."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import re
from typing import Any, Iterable, Mapping
from zoneinfo import ZoneInfo

LOOKBACK_DAYS = 90
MIN_EVENTS = 5
WINDOW_HOURS = 2
DEFAULT_TZ = "Asia/Kolkata"

DAY_KEYS: tuple[str, ...] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_DAY_INDEX = {name: i for i, name in enumerate(DAY_KEYS)}

TIMING_CHANNELS: tuple[str, ...] = ("email", "push", "web")
_CHANNEL_TIMING_KEYS: tuple[str, ...] = (
    "email",
    "whatsapp",
    "push",
    "web",
    "sms",
)

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_TZ_OK = re.compile(r"^[A-Za-z_]+/[A-Za-z0-9_+\-]+$")


def safe_timezone(raw: Any, *, default: str = DEFAULT_TZ) -> str:
    text = str(raw or "").strip() or default
    if text == "UTC":
        return text
    if not _TZ_OK.match(text):
        return default
    try:
        ZoneInfo(text)
        return text
    except Exception:
        return default


def parse_send_window(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    start = str(raw.get("start") or "").strip()
    end = str(raw.get("end") or "").strip()
    if not _HHMM.match(start) or not _HHMM.match(end):
        return None
    days_raw = raw.get("days")
    if not isinstance(days_raw, list) or not days_raw:
        return None
    days: list[str] = []
    seen: set[str] = set()
    for item in days_raw:
        key = str(item or "").strip().lower()[:3]
        if key not in _DAY_INDEX or key in seen:
            continue
        seen.add(key)
        days.append(key)
    if not days:
        return None
    return {"days": days, "start": start, "end": end}


def parse_channel_timing(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, Mapping):
        return {}
    out: dict[str, dict[str, Any]] = {}
    for channel in _CHANNEL_TIMING_KEYS:
        window = parse_send_window(raw.get(channel))
        if window:
            out[channel] = window
    return out


def local_weekday_hour(when: datetime, tz_name: str) -> tuple[int, int] | None:
    """Monday=0 … Sunday=6, hour 0–23 in tz_name."""
    tz = ZoneInfo(safe_timezone(tz_name))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    local = when.astimezone(tz)
    return local.weekday(), local.hour


def _fmt_hour(hour: int) -> str:
    return f"{hour % 24:02d}:00"


def window_from_datetimes(
    stamps: Iterable[datetime],
    tz_name: str,
    *,
    min_events: int = MIN_EVENTS,
) -> dict[str, Any] | None:
    points: list[tuple[int, int]] = []
    for stamp in stamps:
        pair = local_weekday_hour(stamp, tz_name)
        if pair is None:
            continue
        points.append(pair)
    if len(points) < min_events:
        return None
    hour_counts = Counter(hour for _wd, hour in points)
    peak_hour, _n = hour_counts.most_common(1)[0]
    days: list[str] = []
    seen: set[str] = set()
    for wd, hour in points:
        if hour != peak_hour:
            continue
        key = DAY_KEYS[wd]
        if key in seen:
            continue
        seen.add(key)
        days.append(key)
    if not days:
        return None
    end_hour = (peak_hour + WINDOW_HOURS) % 24
    return {
        "days": days,
        "start": _fmt_hour(peak_hour),
        "end": _fmt_hour(end_hour),
    }


def event_stamp_for_channel(
    channel: str,
    *,
    opened_at: datetime | None,
    clicked_at: datetime | None,
) -> datetime | None:
    ch = str(channel or "").strip().lower()
    if ch in ("app_push", "apppush"):
        ch = "push"
    if ch in ("web_push", "webpush"):
        ch = "web"
    if ch == "email":
        return opened_at
    if ch in ("push", "web"):
        return clicked_at
    return None


def compute_preference_windows(
    rows: Iterable[Mapping[str, Any]],
    *,
    timezone_name: str = DEFAULT_TZ,
    now: datetime | None = None,
    lookback_days: int = LOOKBACK_DAYS,
    min_events: int = MIN_EVENTS,
) -> dict[str, Any]:
    """Build timing / channel_timing from recipient rows.

    Each row: channel, opened_at, clicked_at (datetime or None).
    Too few events → omit that window (do not invent org peak).
    """
    tz = safe_timezone(timezone_name)
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    since = moment - timedelta(days=lookback_days)

    by_channel: dict[str, list[datetime]] = defaultdict(list)
    all_stamps: list[datetime] = []
    for row in rows:
        ch = str(row.get("channel") or "").strip().lower()
        if ch in ("app_push", "apppush"):
            ch = "push"
        if ch in ("web_push", "webpush"):
            ch = "web"
        opened = row.get("opened_at")
        clicked = row.get("clicked_at")
        stamp = event_stamp_for_channel(
            ch,
            opened_at=opened if isinstance(opened, datetime) else None,
            clicked_at=clicked if isinstance(clicked, datetime) else None,
        )
        if stamp is None:
            continue
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        if stamp < since:
            continue
        if ch in TIMING_CHANNELS:
            by_channel[ch].append(stamp)
        all_stamps.append(stamp)

    out: dict[str, Any] = {}
    overall = window_from_datetimes(all_stamps, tz, min_events=min_events)
    if overall:
        out["timezone"] = tz
        out["timing"] = overall
    channel_timing: dict[str, dict[str, Any]] = {}
    for ch in TIMING_CHANNELS:
        window = window_from_datetimes(
            by_channel.get(ch) or [],
            tz,
            min_events=min_events,
        )
        if window:
            channel_timing[ch] = window
    if channel_timing:
        out.setdefault("timezone", tz)
        out["channel_timing"] = channel_timing
    return out


def fill_missing_windows(
    existing: Mapping[str, Any],
    computed: Mapping[str, Any],
) -> dict[str, Any]:
    """Copy inferred windows only where the stored JSON has no window yet."""
    extras: dict[str, Any] = {}
    if existing.get("timezone"):
        extras["timezone"] = safe_timezone(existing.get("timezone"))
    elif computed.get("timezone"):
        extras["timezone"] = safe_timezone(computed.get("timezone"))

    if parse_send_window(existing.get("timing")):
        extras["timing"] = parse_send_window(existing.get("timing"))
    elif parse_send_window(computed.get("timing")):
        extras["timing"] = parse_send_window(computed.get("timing"))

    stored_ct = parse_channel_timing(existing.get("channel_timing"))
    computed_ct = parse_channel_timing(computed.get("channel_timing"))
    merged_ct = dict(stored_ct)
    for channel, window in computed_ct.items():
        if channel not in merged_ct:
            merged_ct[channel] = window
    if merged_ct:
        extras["channel_timing"] = merged_ct
    return extras


__all__ = [
    "DEFAULT_TZ",
    "LOOKBACK_DAYS",
    "MIN_EVENTS",
    "compute_preference_windows",
    "event_stamp_for_channel",
    "fill_missing_windows",
    "parse_channel_timing",
    "parse_send_window",
    "safe_timezone",
    "window_from_datetimes",
]
