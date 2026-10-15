"""Scheduling specialist.

When the user gives an explicit time (now / 7pm / today 19:00), honor it.
B2B Mon–Fri 09:00–18:00 Asia/Kolkata is only a suggestion when timing is vague.
Used by create-campaign (RECOMMEND_SEND_TIME, SET_LAUNCH_PLAN) and recommendations.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

DEFAULT_TZ = "Asia/Kolkata"
BUSINESS_START_HOUR = 9
BUSINESS_START_MINUTE = 0
BUSINESS_END_HOUR = 18
BUSINESS_END_MINUTE = 0
# Finance / B2C vague timing — evening default inside soft daily window (no weekday picker).
CONSUMER_START_HOUR = 19
CONSUMER_START_MINUTE = 0
CONSUMER_END_HOUR = 21
CONSUMER_END_MINUTE = 0
# Soft preferred daily send window for Finance (any day). Explicit times still win.
FINANCE_SOFT_START_HOUR = 9
FINANCE_SOFT_END_HOUR = 20

_WEEKDAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)


@dataclass(frozen=True)
class SendWindow:
    timezone: str
    local_date: str  # YYYY-MM-DD
    local_time: str  # HH:mm
    scheduled_at_utc: str  # ISO
    adjusted: bool
    reason: str
    within_business_hours: bool
    timing_label: str


def normalize_timezone(raw: Any) -> str:
    t = str(raw or "").strip() or DEFAULT_TZ
    try:
        ZoneInfo(t)
        return t
    except Exception:  # noqa: BLE001
        return DEFAULT_TZ


def _parse_local_dt(
    date_s: str | None,
    time_s: str | None,
    tz_name: str,
) -> datetime | None:
    date_s = (date_s or "").strip()
    time_s = (time_s or "").strip()
    tz = ZoneInfo(tz_name)
    if not date_s and not time_s:
        return None
    if not date_s:
        date_s = datetime.now(tz).strftime("%Y-%m-%d")
    if not time_s:
        time_s = f"{BUSINESS_START_HOUR:02d}:{BUSINESS_START_MINUTE:02d}"
    try:
        if len(time_s) == 5:
            time_s = f"{time_s}:00"
        local_dt = datetime.strptime(f"{date_s} {time_s}", "%Y-%m-%d %H:%M:%S")
        return local_dt.replace(tzinfo=tz)
    except Exception:  # noqa: BLE001
        return None


def _from_iso(raw: str | None, tz_name: str) -> datetime | None:
    """Parse ISO datetime. Naive values are campaign-local, not UTC."""
    s = (raw or "").strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        tz = ZoneInfo(tz_name)
        if dt.tzinfo is None:
            # LLM/tools often pass "2026-09-15T12:30:00" meaning local wall clock.
            dt = dt.replace(tzinfo=tz)
        return dt.astimezone(tz)
    except Exception:  # noqa: BLE001
        return None


def _is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5  # Mon=0 .. Fri=4


def _in_business_hours(dt: datetime) -> bool:
    if not _is_weekday(dt):
        return False
    minutes = dt.hour * 60 + dt.minute
    start = BUSINESS_START_HOUR * 60 + BUSINESS_START_MINUTE
    end = BUSINESS_END_HOUR * 60 + BUSINESS_END_MINUTE
    return start <= minutes < end


def _next_business_open(dt: datetime) -> datetime:
    """Move to next valid Mon–Fri start-of-business (or same-day start if before open)."""
    tz = dt.tzinfo or ZoneInfo(DEFAULT_TZ)
    cur = dt
    # If weekend → Monday 09:00
    # If weekday before open → today 09:00
    # If weekday at/after close → next weekday 09:00
    for _ in range(10):
        if not _is_weekday(cur):
            # Saturday=5 → +2 to Monday; Sunday=6 → +1
            days = 7 - cur.weekday() if cur.weekday() >= 5 else 1
            cur = (cur + timedelta(days=days)).replace(
                hour=BUSINESS_START_HOUR,
                minute=BUSINESS_START_MINUTE,
                second=0,
                microsecond=0,
            )
            continue
        open_dt = cur.replace(
            hour=BUSINESS_START_HOUR,
            minute=BUSINESS_START_MINUTE,
            second=0,
            microsecond=0,
        )
        close_dt = cur.replace(
            hour=BUSINESS_END_HOUR,
            minute=BUSINESS_END_MINUTE,
            second=0,
            microsecond=0,
        )
        if cur < open_dt:
            return open_dt
        if cur < close_dt:
            return cur.replace(second=0, microsecond=0)
        # after close → next calendar day 09:00 (loop handles weekend)
        cur = (cur + timedelta(days=1)).replace(
            hour=BUSINESS_START_HOUR,
            minute=BUSINESS_START_MINUTE,
            second=0,
            microsecond=0,
            tzinfo=tz,
        )
    return dt.replace(
        hour=BUSINESS_START_HOUR,
        minute=BUSINESS_START_MINUTE,
        second=0,
        microsecond=0,
    )


def _timing_label(local_dt: datetime, *, now: datetime | None = None) -> str:
    now = now or datetime.now(local_dt.tzinfo)
    days = (local_dt.date() - now.date()).days
    tod = local_dt.strftime("%H:%M")
    if days == 0:
        return f"Today {tod}"
    if days == 1:
        return f"Tomorrow {tod}"
    if 2 <= days <= 6:
        return f"{_WEEKDAY_NAMES[local_dt.weekday()]} {tod}"
    return f"{local_dt.strftime('%Y-%m-%d')} {tod}"


def _reason_for_adjust(proposed: datetime, adjusted: datetime) -> str:
    parts: list[str] = []
    if proposed.weekday() >= 5:
        parts.append(
            f"{_WEEKDAY_NAMES[proposed.weekday()]} is outside send days "
            "(no Saturday/Sunday)"
        )
    elif not _in_business_hours(proposed):
        parts.append(
            f"{proposed.strftime('%H:%M')} is outside business hours "
            f"({BUSINESS_START_HOUR:02d}:00–{BUSINESS_END_HOUR:02d}:00 Mon–Fri)"
        )
    if proposed != adjusted:
        parts.append(
            f"moved to {_WEEKDAY_NAMES[adjusted.weekday()]} "
            f"{adjusted.strftime('%Y-%m-%d %H:%M')}"
        )
    return "; ".join(parts) if parts else "within business hours"



def _parse_free_text_local(
    text: str,
    tz_name: str,
    *,
    now: datetime | None = None,
) -> datetime | None:
    """Parse structured datetimes only (ISO / YYYY-MM-DD HH:MM:SS). No word hints."""
    raw = (text or "").strip()
    if not raw:
        return None
    tz = ZoneInfo(tz_name)
    now = now or datetime.now(tz)
    candidates = [raw]
    # Normalize common "YYYY-MM-DD HH:MM:SS" to ISO
    if " " in raw and "T" not in raw[:20]:
        candidates.append(raw.replace(" ", "T", 1))
    for cand in candidates:
        try:
            dt = datetime.fromisoformat(cand.replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tz)
        else:
            dt = dt.astimezone(tz)
        return dt
    return None


def _clamp_peak_hour(hour: int) -> int:
    return max(BUSINESS_START_HOUR, min(BUSINESS_END_HOUR - 1, int(hour)))


def _next_peak_slot(
    now: datetime,
    weekday: int,
    hour: int,
) -> datetime:
    """Next Mon–Fri peak hour. weekday: 0=Mon .. 4=Fri."""
    wd = max(0, min(4, int(weekday)))
    hr = _clamp_peak_hour(hour)
    cand = now.replace(hour=hr, minute=0, second=0, microsecond=0)
    ahead = (wd - now.weekday()) % 7
    if ahead == 0 and cand <= now:
        ahead = 7
    if now.weekday() > 4:
        ahead = (wd - now.weekday()) % 7
        if ahead == 0:
            ahead = 7
    return cand + timedelta(days=ahead)


def resolve_send_window(
    *,
    timezone_name: str | None = None,
    local_date: str | None = None,
    local_time: str | None = None,
    scheduled_at: str | None = None,
    user_text: str | None = None,
    prefer_now: bool = False,
    honor_explicit: bool = True,
    peak_weekday: int | None = None,
    peak_hour: int | None = None,
    use_peak_when_unspecified: bool = False,
    consumer_hours: bool = False,
) -> SendWindow:
    """Resolve a send window.

    Explicit user time (date/time/ISO/free-text clock / now) is kept as-is.
    Vague timing: B2B business hours, or finance soft daily window (default ~19:00).
    Finance has no weekday picker — weekends allowed.
    """
    tz_name = normalize_timezone(timezone_name)
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)

    proposed: datetime | None = None
    if local_date or local_time:
        proposed = _parse_local_dt(local_date, local_time, tz_name)
    if proposed is None and scheduled_at:
        proposed = _from_iso(scheduled_at, tz_name)

    explicit = proposed is not None and bool(
        (local_date or "").strip()
        or (local_time or "").strip()
        or (scheduled_at or "").strip()
    )

    # prefer_now must not discard an explicit clock the caller already parsed.
    if prefer_now and not (honor_explicit and explicit):
        dt = now.replace(second=0, microsecond=0)
        within = _in_business_hours(dt) if not consumer_hours else True
        return SendWindow(
            timezone=tz_name,
            local_date=dt.strftime("%Y-%m-%d"),
            local_time=dt.strftime("%H:%M"),
            scheduled_at_utc=dt.astimezone(timezone.utc).isoformat(),
            adjusted=False,
            reason=f"launching now ({dt.strftime('%Y-%m-%d %H:%M')} {tz_name})",
            within_business_hours=within,
            timing_label=_timing_label(dt, now=now),
        )

    # Free-text clock / now from user_text counts as explicit when honor_explicit.
    if honor_explicit and not explicit and (user_text or "").strip():
        from_text = _parse_free_text_local(user_text or "", tz_name, now=now)
        if from_text is not None:
            proposed = from_text
            explicit = True

    if honor_explicit and explicit:
        assert proposed is not None
        dt = proposed.replace(second=0, microsecond=0)
        if dt < now - timedelta(minutes=2):
            dt = dt + timedelta(days=1)
        within = _in_business_hours(dt)
        if consumer_hours:
            hour = dt.hour + (dt.minute / 60.0)
            in_soft = FINANCE_SOFT_START_HOUR <= hour < FINANCE_SOFT_END_HOUR
            reason = (
                f"using your selected time ({dt.strftime('%Y-%m-%d %H:%M')} {tz_name})"
            )
            if not in_soft:
                reason += (
                    f"; note: outside preferred daily window "
                    f"({FINANCE_SOFT_START_HOUR:02d}:00–{FINANCE_SOFT_END_HOUR:02d}:00)"
                )
            within = True
        else:
            reason = (
                f"using your selected time ({dt.strftime('%Y-%m-%d %H:%M')} {tz_name})"
                if within
                else (
                    f"using your selected time ({dt.strftime('%Y-%m-%d %H:%M')} {tz_name}); "
                    "note: outside typical B2B hours "
                    f"(Mon–Fri {BUSINESS_START_HOUR:02d}:00–{BUSINESS_END_HOUR:02d}:00)"
                )
            )
        return SendWindow(
            timezone=tz_name,
            local_date=dt.strftime("%Y-%m-%d"),
            local_time=dt.strftime("%H:%M"),
            scheduled_at_utc=dt.astimezone(timezone.utc).isoformat(),
            adjusted=False,
            reason=reason,
            within_business_hours=within,
            timing_label=_timing_label(dt, now=now),
        )

    if consumer_hours:
        return _snap_to_consumer_hours(
            timezone_name=tz_name,
            prefer_now=prefer_now,
            now=now,
        )

    return snap_to_business_hours(
        timezone_name=tz_name,
        local_date=local_date,
        local_time=local_time,
        scheduled_at=scheduled_at,
        user_text=user_text,
        prefer_now=prefer_now,
        peak_weekday=peak_weekday,
        peak_hour=peak_hour,
        use_peak_when_unspecified=use_peak_when_unspecified,
    )


def _snap_to_consumer_hours(
    *,
    timezone_name: str,
    prefer_now: bool,
    now: datetime,
) -> SendWindow:
    """Vague finance timing → next 19:00 local (any day; soft window 09–20)."""
    if prefer_now:
        dt = now.replace(second=0, microsecond=0)
    else:
        dt = now.replace(
            hour=CONSUMER_START_HOUR,
            minute=CONSUMER_START_MINUTE,
            second=0,
            microsecond=0,
        )
        if dt <= now:
            dt = dt + timedelta(days=1)
    return SendWindow(
        timezone=timezone_name,
        local_date=dt.strftime("%Y-%m-%d"),
        local_time=dt.strftime("%H:%M"),
        scheduled_at_utc=dt.astimezone(timezone.utc).isoformat(),
        adjusted=not prefer_now,
        reason=(
            f"soft daily send window "
            f"({FINANCE_SOFT_START_HOUR:02d}:00–{FINANCE_SOFT_END_HOUR:02d}:00 {timezone_name}; "
            f"default {CONSUMER_START_HOUR:02d}:00; any day OK; no weekday picker)"
        ),
        within_business_hours=False,
        timing_label=_timing_label(dt, now=now),
    )


def snap_to_business_hours(
    *,
    timezone_name: str | None = None,
    local_date: str | None = None,
    local_time: str | None = None,
    scheduled_at: str | None = None,
    user_text: str | None = None,
    prefer_now: bool = False,
    peak_weekday: int | None = None,
    peak_hour: int | None = None,
    use_peak_when_unspecified: bool = False,
) -> SendWindow:
    """Return a send window guaranteed Mon–Fri within business hours."""
    tz_name = normalize_timezone(timezone_name)
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)

    proposed: datetime | None = None
    if local_date or local_time:
        proposed = _parse_local_dt(local_date, local_time, tz_name)
    if proposed is None and scheduled_at:
        proposed = _from_iso(scheduled_at, tz_name)
    if (
        proposed is None
        and use_peak_when_unspecified
        and not prefer_now
        and peak_weekday is not None
        and peak_hour is not None
    ):
        proposed = _next_peak_slot(now, int(peak_weekday), int(peak_hour))
    if proposed is None:
        proposed = now if prefer_now else now

    within = _in_business_hours(proposed)
    adjusted_dt = proposed if within else _next_business_open(proposed)
    # If prefer_now and already within hours, keep "now" rounded; else open snap.
    if prefer_now and within:
        adjusted_dt = proposed.replace(second=0, microsecond=0)
    elif prefer_now and not within:
        adjusted_dt = _next_business_open(now if proposed <= now else proposed)

    adjusted = adjusted_dt != proposed.replace(second=0, microsecond=0) or not within
    # Normalize equality check more carefully
    prop_norm = proposed.replace(second=0, microsecond=0)
    adj_norm = adjusted_dt.replace(second=0, microsecond=0)
    was_adjusted = prop_norm != adj_norm or not within

    reason = (
        "within business hours (Mon–Fri "
        f"{BUSINESS_START_HOUR:02d}:00–{BUSINESS_END_HOUR:02d}:00 {tz_name})"
        if not was_adjusted
        else _reason_for_adjust(prop_norm, adj_norm)
    )

    return SendWindow(
        timezone=tz_name,
        local_date=adj_norm.strftime("%Y-%m-%d"),
        local_time=adj_norm.strftime("%H:%M"),
        scheduled_at_utc=adj_norm.astimezone(timezone.utc).isoformat(),
        adjusted=was_adjusted,
        reason=reason,
        within_business_hours=True,
        timing_label=_timing_label(adj_norm, now=now),
    )


def recommend_send_time(
    *,
    timezone_name: str | None = None,
    local_date: str | None = None,
    local_time: str | None = None,
    scheduled_at: str | None = None,
    user_text: str | None = None,
    prefer_now: bool = False,
    peak_weekday: int | None = None,
    peak_hour: int | None = None,
    peak_weekday_name: str | None = None,
    peak_reason: str | None = None,
    use_peak_when_unspecified: bool | None = None,
    consumer_hours: bool = False,
) -> dict[str, Any]:
    """Public specialist payload for tools / recommendations."""
    unspecified = not any(
        (local_date, local_time, scheduled_at, (user_text or "").strip())
    )
    use_peak = (
        False
        if consumer_hours
        else (
            use_peak_when_unspecified
            if use_peak_when_unspecified is not None
            else unspecified and not prefer_now
        )
    )
    window = resolve_send_window(
        timezone_name=timezone_name,
        local_date=local_date,
        local_time=local_time,
        scheduled_at=scheduled_at,
        user_text=user_text,
        prefer_now=prefer_now,
        honor_explicit=True,
        peak_weekday=peak_weekday,
        peak_hour=peak_hour,
        use_peak_when_unspecified=use_peak,
        consumer_hours=consumer_hours,
    )
    optimizer = None
    if peak_weekday is not None and peak_hour is not None:
        optimizer = {
            "peak_weekday": int(peak_weekday),
            "peak_weekday_name": peak_weekday_name
            or _WEEKDAY_NAMES[max(0, min(4, int(peak_weekday)))],
            "peak_hour": _clamp_peak_hour(int(peak_hour)),
            "peak_local_time": f"{_clamp_peak_hour(int(peak_hour)):02d}:00",
            "reason": (peak_reason or "").strip() or None,
            "applied": bool(use_peak and unspecified and not prefer_now),
        }
    msg = (
        f"Send time: {window.timing_label} ({window.timezone}). "
        f"{window.reason}."
    )
    if optimizer and optimizer.get("applied"):
        msg += (
            f" Used past-open peak ({optimizer['peak_weekday_name']} "
            f"{optimizer['peak_local_time']})."
        )
    elif optimizer:
        msg += (
            f" Past opens peak {optimizer['peak_weekday_name']} "
            f"{optimizer['peak_local_time']} — mention if the user wants that instead."
        )
    return {
        "ok": True,
        "timezone": window.timezone,
        "launch_local_date": window.local_date,
        "launch_local_time": window.local_time,
        "scheduled_at": window.scheduled_at_utc,
        "adjusted": window.adjusted,
        "reason": window.reason,
        "within_business_hours": window.within_business_hours,
        "timing_label": window.timing_label,
        "optimizer": optimizer,
        "business_hours": {
            "timezone": window.timezone,
            "weekdays": "Mon–Fri",
            "start": f"{BUSINESS_START_HOUR:02d}:{BUSINESS_START_MINUTE:02d}",
            "end": f"{BUSINESS_END_HOUR:02d}:{BUSINESS_END_MINUTE:02d}",
            "exclude": ["Saturday", "Sunday"],
        },
        "message": msg,
    }


def apply_business_hours_to_iso(
    iso_raw: str | None,
    *,
    timezone_name: str | None = None,
) -> tuple[str, bool, str]:
    """Resolve an ISO / free datetime string; returns (iso_utc, adjusted, reason)."""
    window = resolve_send_window(
        timezone_name=timezone_name,
        scheduled_at=iso_raw,
        prefer_now=not bool(iso_raw),
        honor_explicit=True,
    )
    return window.scheduled_at_utc, window.adjusted, window.reason


__all__ = [
    "BUSINESS_END_HOUR",
    "BUSINESS_START_HOUR",
    "DEFAULT_TZ",
    "SendWindow",
    "apply_business_hours_to_iso",
    "normalize_timezone",
    "recommend_send_time",
    "resolve_send_window",
    "snap_to_business_hours",
]
