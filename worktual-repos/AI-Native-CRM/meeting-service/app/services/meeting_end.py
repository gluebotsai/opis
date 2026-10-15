"""Detect host-ended / terminal Meet state and finalize capture."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from app.config import settings
from app.models import Meeting

TERMINAL_VEXA_STATUSES = frozenset(
    {"completed", "stopped", "failed", "error", "evicted", "done", "ended"}
)
_HOST_ENDED_BOOL_KEYS = frozenset(
    {"meeting_ended", "call_ended", "ended", "host_left", "teardown_confirmed"}
)


def _walk_dicts(node: Any, *, depth: int = 0) -> Iterator[dict[str, Any]]:
    if depth > 8 or not isinstance(node, dict):
        return
    yield node
    for key in ("data", "meeting", "payload", "status_transition", "transcribe"):
        child = node.get(key)
        if isinstance(child, dict):
            yield from _walk_dicts(child, depth=depth + 1)
    nested = node.get("service_authority")
    if isinstance(nested, dict):
        yield from _walk_dicts(nested, depth=depth + 1)


def vexa_snapshot_status(data: dict[str, Any] | None) -> str | None:
    if not data:
        return None
    for block in _walk_dicts(data):
        for key in ("status", "meeting_status", "bot_status", "state", "code"):
            raw = block.get(key)
            if raw is not None and str(raw).strip():
                return str(raw).strip().lower()
    return None


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return _aware(value)
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts <= 0:
            return None
        if ts > 1e12:
            ts = ts / 1000.0
        # Relative offsets (seconds into the call) are not wall-clock times.
        if ts < 1e9:
            return None
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    raw = str(value).strip()
    if not raw or raw.lower() in ("null", "none"):
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return _aware(datetime.fromisoformat(raw))
    except ValueError:
        return None


def snapshot_last_speech_at(data: dict[str, Any] | None) -> datetime | None:
    if not data:
        return None
    segs = data.get("segments")
    if not isinstance(segs, list):
        return None
    latest: datetime | None = None
    for row in segs:
        if not isinstance(row, dict):
            continue
        for key in (
            "absolute_end_time",
            "absolute_start_time",
            "end",
            "start",
            "t1",
            "t0",
        ):
            dt = _parse_dt(row.get(key))
            if dt is None:
                continue
            if latest is None or dt > latest:
                latest = dt
    return latest


def snapshot_has_in_progress_speech(data: dict[str, Any] | None) -> bool:
    if not data:
        return False
    segs = data.get("segments")
    if not isinstance(segs, list):
        return False
    for row in segs:
        if isinstance(row, dict) and row.get("completed") is False:
            return True
    return False


def snapshot_silence_ended(
    meeting: Meeting,
    data: dict[str, Any] | None,
    now: datetime | None = None,
) -> bool:
    """Last-resort: quiet period after last speech when Vexa gives no end signal.

    Requires real speech segments — never counts silence from admit/start alone
    (that ejected bots seconds after admission before anyone spoke).
    """
    if settings.host_ended_silence_sec <= 0:
        return False
    if snapshot_has_in_progress_speech(data):
        return False
    last = snapshot_last_speech_at(data)
    if last is None:
        return False
    t = _aware(now or datetime.now(timezone.utc))
    return t >= _aware(last) + timedelta(seconds=settings.host_ended_silence_sec)


def _participant_humans(block: dict[str, Any]) -> tuple[int | None, bool]:
    """
    Returns (human_count_or_None, saw_participants_list).
    human_count None when participants key missing.
    """
    participants = block.get("participants")
    if not isinstance(participants, list):
        return None, False
    humans = 0
    for row in participants:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("display_name") or "").lower()
        if not name:
            humans += 1
            continue
        if "worktual" in name or "notetaker" in name or "capture" in name:
            continue
        if row.get("is_bot") is True:
            continue
        humans += 1
    return humans, True


def snapshot_hard_host_ended(data: dict[str, Any] | None) -> bool:
    """Strong end signals (not bot-alone / empty room)."""
    if not data:
        return False
    for block in _walk_dicts(data):
        end_time = block.get("end_time")
        if end_time is not None and str(end_time).strip() not in ("", "null"):
            return True
        for key in _HOST_ENDED_BOOL_KEYS:
            if block.get(key) is True:
                return True
        transition = block.get("status_transition")
        if isinstance(transition, dict):
            for tkey in ("to", "status", "state", "code"):
                val = str(transition.get(tkey) or "").strip().lower()
                if val in TERMINAL_VEXA_STATUSES:
                    return True
    return False


def snapshot_bot_alone(data: dict[str, Any] | None) -> bool:
    """Weak signal: bot alone or zero humans — often true right after admit."""
    if not data:
        return False
    for block in _walk_dicts(data):
        if block.get("bot_alone") is True or block.get("alone") is True:
            return True
        count = block.get("human_participant_count")
        if count is not None:
            try:
                if int(count) <= 0:
                    return True
            except (TypeError, ValueError):
                pass
        humans, saw = _participant_humans(block)
        if saw and humans is not None and humans <= 0:
            return True
    return False


def snapshot_host_ended(data: dict[str, Any] | None) -> bool:
    """True when Vexa snapshot signals the call is over (host left / empty room)."""
    return snapshot_hard_host_ended(data) or snapshot_bot_alone(data)


def alone_grace_elapsed(meeting: Meeting, now: datetime | None = None) -> bool:
    """Allow bot-alone finalize only after admit + grace (or if never admitted)."""
    grace = max(0, int(settings.host_ended_alone_grace_sec))
    if grace <= 0:
        return True
    start = meeting.admitted_at or meeting.started_at
    if start is None:
        # Still joining lobby — do not finalize on alone snapshots.
        return False
    t = _aware(now or datetime.now(timezone.utc))
    return t >= _aware(start) + timedelta(seconds=grace)


def vexa_bot_gone_from_meet(
    meeting: Meeting,
    *,
    vexa_bot_running: bool | None,
) -> bool:
    """Recall-like signal: Vexa dropped the bot from /bots/status after host ended."""
    if vexa_bot_running is not False:
        return False
    if meeting.status != "active":
        return False
    return meeting.admitted_at is not None or meeting.started_at is not None


def is_terminal_vexa_status(status: str | None) -> bool:
    return bool(status and status in TERMINAL_VEXA_STATUSES)


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def expected_end_time(meeting: Meeting) -> datetime | None:
    if meeting.expected_end_at is not None:
        return _aware(meeting.expected_end_at)
    start = meeting.started_at or meeting.admitted_at or meeting.join_at
    if start is None:
        return None
    return _aware(start) + timedelta(seconds=settings.meeting_slot_duration_sec)


def scheduled_slot_ended(meeting: Meeting, now: datetime | None = None) -> bool:
    """CRM slot + grace passed — treat as meeting ended even if bot lingers in Meet."""
    end = expected_end_time(meeting)
    if end is None:
        return False
    t = _aware(now or datetime.now(timezone.utc))
    grace = timedelta(seconds=settings.host_ended_grace_sec)
    return t >= end + grace


def should_finalize_active_meeting(
    meeting: Meeting,
    snapshot: dict[str, Any] | None,
    now: datetime | None = None,
    *,
    vexa_bot_running: bool | None = None,
) -> tuple[bool, str]:
    """
    Returns (finalize, reason).
    Host ended / call over / CRM slot ended → stop bot and complete.
    """
    if meeting.status != "active":
        return False, ""
    vstatus = vexa_snapshot_status(snapshot)
    if is_terminal_vexa_status(vstatus):
        return True, f"vexa_status:{vstatus}"
    if snapshot_hard_host_ended(snapshot):
        return True, "snapshot_host_ended"
    if settings.finalize_on_bot_alone and snapshot_bot_alone(snapshot):
        if alone_grace_elapsed(meeting, now=now):
            return True, "snapshot_bot_alone"
        # Early alone / empty roster is normal right after admit — keep capturing.
    if vexa_bot_gone_from_meet(meeting, vexa_bot_running=vexa_bot_running):
        return True, "vexa_bot_gone"
    if snapshot_silence_ended(meeting, snapshot, now=now):
        return True, "host_ended_silence"
    if settings.finalize_on_scheduled_slot_end and scheduled_slot_ended(meeting, now=now):
        return True, "scheduled_slot_ended"
    return False, ""
