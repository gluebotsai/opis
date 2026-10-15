from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.constants import utcnow
from app.services.meeting_end import expected_end_time
from app.metrics import ADMIT_LATENCY
from app.models import Meeting, MeetingEvent
from app.services import live_bus

log = logging.getLogger(__name__)

ALLOWED = {
    "requested": {"joining", "failed"},
    "joining": {"awaiting_admission", "active", "failed", "stopping", "processing"},
    "awaiting_admission": {"active", "failed", "stopping", "processing"},
    "active": {"stopping", "processing", "failed", "completed", "completed_partial"},
    "stopping": {"processing", "failed", "completed", "completed_partial"},
    "processing": {"completed", "completed_partial", "failed"},
    "completed": set(),
    "completed_partial": set(),
    "failed": set(),
}

VEXA_STATUS_MAP = {
    "requested": "joining",
    "joining": "joining",
    "awaiting_admission": "awaiting_admission",
    "active": "active",
    "stopping": "stopping",
    "completed": "processing",
    "stopped": "processing",
    "failed": "failed",
    "needs_help": "awaiting_admission",
    "evicted": "failed",
}


def transition(
    db: Session,
    meeting: Meeting,
    to_status: str,
    *,
    event_id: str | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    payload: dict | None = None,
) -> bool:
    current = meeting.status
    if to_status == current:
        return False
    allowed = ALLOWED.get(current, set())
    if to_status not in allowed and to_status not in TERMINAL_FORCE.get(current, set()):
        log.info(
            "status_ignored",
            extra={"meeting_id": meeting.id, "status": current, "error_code": error_code or ""},
        )
        return False
    meeting.status = to_status
    meeting.updated_at = utcnow()
    if error_code:
        meeting.error_code = error_code
    if error_message:
        meeting.error_message = error_message[:1000]
    now = utcnow()
    if to_status == "awaiting_admission" and not meeting.admitted_at:
        pass
    if to_status == "active":
        meeting.started_at = meeting.started_at or now
        meeting.admitted_at = meeting.admitted_at or now
        start = meeting.created_at
        if start is not None:
            try:
                ADMIT_LATENCY.observe(max(0.0, (now - start).total_seconds()))
            except TypeError:
                pass
    if to_status in ("completed", "completed_partial", "failed"):
        meeting.ended_at = meeting.ended_at or now
    db.add(
        MeetingEvent(
            meeting_id=meeting.id,
            event_id=event_id or f"{meeting.id}:{to_status}:{int(now.timestamp()*1000)}",
            from_status=current,
            to_status=to_status,
            payload=payload or {},
        )
    )
    live_bus.publish(
        meeting.id,
        {
            "type": "status",
            "status": to_status,
            "error_code": meeting.error_code,
            "error_message": meeting.error_message,
        },
    )
    return True


TERMINAL_FORCE = {
    "joining": {"failed"},
    "awaiting_admission": {"failed"},
    "active": {"failed", "processing"},
}


def apply_vexa_status(db: Session, meeting: Meeting, vexa_status: str, event_id: str | None) -> bool:
    mapped = VEXA_STATUS_MAP.get(vexa_status, vexa_status)
    return transition(db, meeting, mapped, event_id=event_id, error_code=error_code_for(vexa_status))


def error_code_for(vexa_status: str) -> str | None:
    if vexa_status == "evicted":
        return "evicted"
    if vexa_status in ("failed", "error"):
        return "vexa_unavailable"
    return None


def lobby_admission_deadline(meeting: Meeting, timeout_sec: int) -> datetime:
    """Last moment the bot may wait in Meet lobby before not_admitted."""
    start = meeting.updated_at or meeting.created_at
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    deadline = start + timedelta(seconds=timeout_sec)
    if settings.lobby_timeout_until_slot_end:
        slot_end = expected_end_time(meeting)
        if slot_end is not None and slot_end > deadline:
            deadline = slot_end
    return deadline


def lobby_timed_out(meeting: Meeting, timeout_sec: int, now: datetime | None = None) -> bool:
    if meeting.status != "awaiting_admission":
        return False
    t = now or utcnow()
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t >= lobby_admission_deadline(meeting, timeout_sec)
