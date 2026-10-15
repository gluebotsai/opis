from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.constants import IN_FLIGHT, utcnow
from app.db import get_db
from app.metrics import JOIN_FAIL, JOIN_SUCCESS
from app.models import Meeting, MeetingExtract, TranscriptSegment
from app.schemas import (
    CreateMeetingRequest,
    ExtractOut,
    MeetingOut,
    ReleaseBotRequest,
    SegmentOut,
    TokenPrincipal,
)
from app.services import capacity, jobs, status as status_svc, vexa
from app.services.auth import get_principal, require_meetings_write
from app.services.crypto import decrypt_passcode, encrypt_passcode, redact_meeting_url
from app.services.lookup import inflight_by_url
from app.services.rate_limit import allow_post_meeting
from app.services.url_parse import UrlParseError, parse_meeting_url

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/meetings", tags=["meetings"])


def _to_out(m: Meeting) -> MeetingOut:
    return MeetingOut(
        id=m.id,
        organization_id=m.org_id,
        entity_type=m.entity_type,
        entity_id=m.entity_id,
        status=m.status,
        error_code=m.error_code,
        error_message=m.error_message,
        platform=m.platform,
        native_meeting_id=m.native_meeting_id,
        bot_name=m.bot_name,
        meeting_url=redact_meeting_url(m.meeting_url),
        join_at=m.join_at,
        expected_end_at=m.expected_end_at,
        created_at=m.created_at,
        admitted_at=m.admitted_at,
        started_at=m.started_at,
        ended_at=m.ended_at,
        recording_enabled=bool(m.recording_enabled),
    )


def _load(db: Session, meeting_id: str, org_id: str) -> Meeting:
    m = db.get(Meeting, meeting_id)
    if not m or m.org_id != org_id:
        raise HTTPException(status_code=404, detail="meeting not found")
    return m


def _mark_spawn_reused(db: Session, meeting: Meeting, *, reason: str) -> None:
    """Vexa already has a bot for this Meet code — keep joining, do not fail."""
    if meeting.status == "requested":
        status_svc.transition(db, meeting, "joining")
    meeting.error_code = None
    meeting.error_message = None
    JOIN_SUCCESS.inc()
    db.commit()
    log.info(
        "spawn_reused",
        extra={
            "meeting_id": meeting.id,
            "org_id": meeting.org_id,
            "error_code": reason,
        },
    )


def spawn_bot(db: Session, meeting: Meeting) -> None:
    """
    Ask Vexa for a bot. Idempotent for double-dispatch (CRM + calendar, or
    API create + worker): if Vexa already has this Meet code, reuse it.
    """
    bot_key = (meeting.platform, meeting.native_meeting_id)
    if bot_key in vexa.running_keys():
        _mark_spawn_reused(db, meeting, reason="already_running")
        return

    if meeting.status == "requested":
        status_svc.transition(db, meeting, "joining")
        db.commit()
    elif meeting.status != "joining":
        # awaiting_admission / active / … — do not POST /bots again
        return

    try:
        result = vexa.create_bot(
            meeting_url=meeting.meeting_url,
            bot_name=meeting.bot_name,
            platform=meeting.platform,
            native_meeting_id=meeting.native_meeting_id,
            passcode=decrypt_passcode(meeting.passcode_encrypted),
            recording_enabled=bool(meeting.recording_enabled),
            metadata={
                "organization_id": meeting.org_id,
                "entity_type": meeting.entity_type,
                "entity_id": meeting.entity_id,
                "meeting_id": meeting.id,
            },
        )
        vid = result.get("id") or result.get("meeting_id")
        if vid is not None:
            meeting.vexa_meeting_id = str(vid)
        JOIN_SUCCESS.inc()
        db.commit()
    except vexa.VexaError as exc:
        # Concurrent spawn or leftover bot for same native id — reuse, don't fail.
        already = exc.status_code == 409 or (
            exc.error_code == "capacity" and "already active" in str(exc).lower()
        )
        if already:
            _mark_spawn_reused(db, meeting, reason="vexa_409_already_active")
            return
        JOIN_FAIL.labels(error_code=exc.error_code).inc()
        status_svc.transition(
            db,
            meeting,
            "failed",
            error_code=exc.error_code,
            error_message=str(exc),
        )
        db.commit()
        log.info(
            "spawn_failed",
            extra={"meeting_id": meeting.id, "org_id": meeting.org_id, "error_code": exc.error_code},
        )


@router.post("", response_model=MeetingOut)
def create_meeting(
    body: CreateMeetingRequest,
    response: Response,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> MeetingOut:
    require_meetings_write(principal)
    org_id = principal.organization_id
    if body.organization_id and body.organization_id != org_id:
        log.info("org_mismatch_ignored", extra={"org_id": org_id})

    if not allow_post_meeting(org_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="rate limited",
            headers={"Retry-After": str(settings.retry_after_sec)},
        )

    if settings.consent_required and not body.consent_captured:
        raise HTTPException(status_code=422, detail="consent_captured must be true")

    if settings.notetaker_provider != "vexa":
        raise HTTPException(
            status_code=409,
            detail="notetaker_provider is not vexa; disable Recall for this meeting first",
        )

    try:
        parsed = parse_meeting_url(body.meeting_url)
    except UrlParseError as exc:
        JOIN_FAIL.labels(error_code="invalid_url").inc()
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    key = (idempotency_key or "").strip() or None
    if key:
        existing = db.scalar(select(Meeting).where(Meeting.org_id == org_id, Meeting.idempotency_key == key))
        if existing:
            response.status_code = 200
            return _to_out(existing)

    inflight = db.scalar(
        select(Meeting).where(
            Meeting.org_id == org_id,
            Meeting.platform == parsed.platform,
            Meeting.native_meeting_id == parsed.native_meeting_id,
            Meeting.status.in_(IN_FLIGHT),
        )
    )
    if inflight:
        response.status_code = 200
        return _to_out(inflight)

    cap = capacity.queue_full(db, org_id)
    if cap:
        JOIN_FAIL.labels(error_code="capacity").inc()
        raise HTTPException(
            status_code=429,
            detail="meeting queue is full",
            headers={"Retry-After": str(settings.retry_after_sec)},
        )

    meeting = Meeting(
        id=str(uuid.uuid4()),
        org_id=org_id,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        meeting_url=parsed.meeting_url,
        platform=parsed.platform,
        native_meeting_id=parsed.native_meeting_id,
        passcode_encrypted=encrypt_passcode(parsed.passcode),
        bot_name=body.bot_name or settings.default_bot_name,
        status="requested",
        consent_captured_at=utcnow() if body.consent_captured else None,
        idempotency_key=key,
        join_at=body.join_at,
        expected_end_at=body.expected_end_at,
        provider="vexa",
        created_by=principal.sub,
        recording_enabled=(
            settings.vexa_recording_enabled if body.recording_enabled is None else body.recording_enabled
        ),
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)

    if meeting.join_at and meeting.join_at > datetime.now(timezone.utc):
        response.status_code = 201
        return _to_out(meeting)

    if capacity.at_capacity(db, org_id):
        response.status_code = 201
        return _to_out(meeting)

    spawn_bot(db, meeting)
    db.refresh(meeting)
    response.status_code = 201 if meeting.status != "failed" else 502
    if meeting.status == "failed":
        raise HTTPException(
            status_code=502,
            detail={"id": meeting.id, "error_code": meeting.error_code, "error_message": meeting.error_message},
        )
    return _to_out(meeting)


@router.get("", response_model=list[MeetingOut])
def list_meetings(
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
) -> list[MeetingOut]:
    q = select(Meeting).where(Meeting.org_id == principal.organization_id).order_by(Meeting.created_at.desc())
    if entity_type:
        q = q.where(Meeting.entity_type == entity_type)
    if entity_id:
        q = q.where(Meeting.entity_id == entity_id)
    rows = db.scalars(q.limit(100)).all()
    return [_to_out(m) for m in rows]


@router.get("/capacity")
def meeting_capacity(
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
) -> dict:
    return capacity.snapshot(db, principal.organization_id)


@router.get("/lookup", response_model=MeetingOut)
def lookup_meeting(
    meeting_url: str = Query(..., min_length=8),
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
) -> MeetingOut:
    return _to_out(inflight_by_url(db, principal.organization_id, meeting_url))


@router.post("/release-bot")
def release_bot_by_url(
    body: ReleaseBotRequest,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
) -> dict:
    """
    Force-stop any Vexa bot for this Meet URL (stale 409 / orphaned bot).
    Does not require an in-flight meeting row.
    """
    require_meetings_write(principal)
    try:
        parsed = parse_meeting_url(body.meeting_url)
    except UrlParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    vexa.stop_bot(parsed.platform, parsed.native_meeting_id)
    rows = db.scalars(
        select(Meeting).where(
            Meeting.org_id == principal.organization_id,
            Meeting.platform == parsed.platform,
            Meeting.native_meeting_id == parsed.native_meeting_id,
            Meeting.status.in_(IN_FLIGHT),
        )
    ).all()
    for m in rows:
        if m.status not in ("completed", "completed_partial", "failed"):
            status_svc.transition(
                db,
                m,
                "failed",
                error_code="capacity",
                error_message="released for re-dispatch",
            )
    db.commit()
    still = (parsed.platform, parsed.native_meeting_id) in vexa.running_keys()
    return {
        "ok": not still,
        "platform": parsed.platform,
        "native_meeting_id": parsed.native_meeting_id,
        "bot_still_running": still,
        "rows_closed": len(rows),
    }


@router.get("/{meeting_id}", response_model=MeetingOut)
def get_meeting(
    meeting_id: str,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
) -> MeetingOut:
    return _to_out(_load(db, meeting_id, principal.organization_id))


def _segment_speaker_key(raw: object) -> str:
    if not isinstance(raw, dict):
        return ""
    return str(raw.get("speaker_key") or "").strip()


@router.get("/{meeting_id}/transcript", response_model=list[SegmentOut])
def get_transcript(
    meeting_id: str,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
    include_partial: bool = Query(False),
) -> list[SegmentOut]:
    m = _load(db, meeting_id, principal.organization_id)
    q = select(TranscriptSegment).where(TranscriptSegment.meeting_id == m.id)
    if not include_partial:
        q = q.where(TranscriptSegment.completed == 1)
    segs = db.scalars(q.order_by(TranscriptSegment.t0, TranscriptSegment.id)).all()
    return [
        SegmentOut(
            segment_id=s.segment_id,
            speaker=s.speaker,
            text=s.text,
            start=s.t0,
            end=s.t1,
            completed=bool(s.completed),
            speaker_key=_segment_speaker_key(s.raw_json),
        )
        for s in segs
    ]


@router.get("/{meeting_id}/extract", response_model=ExtractOut)
def get_extract(
    meeting_id: str,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
) -> ExtractOut:
    m = _load(db, meeting_id, principal.organization_id)
    ext = db.scalar(select(MeetingExtract).where(MeetingExtract.meeting_id == m.id))
    if not ext:
        raise HTTPException(status_code=404, detail="extract not ready")
    return ExtractOut(
        meeting_id=m.id,
        organization_id=m.org_id,
        entity_type=m.entity_type,
        entity_id=m.entity_id,
        status=m.status,
        summary=ext.summary,
        next_step=ext.next_steps,
        action_items=ext.action_items or [],
        pain_points=ext.pain_points or [],
        products=ext.products or [],
        speakers=ext.speakers or [],
    )


@router.delete("/{meeting_id}", response_model=MeetingOut)
def stop_meeting(
    meeting_id: str,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
) -> MeetingOut:
    require_meetings_write(principal)
    m = _load(db, meeting_id, principal.organization_id)
    # Always release the Vexa bot — even when the row is already failed
    # (double-spawn used to mark failed while the bot stayed in Meet).
    vexa.stop_bot(m.platform, m.native_meeting_id)
    if m.status in ("completed", "completed_partial", "failed"):
        db.commit()
        return _to_out(m)
    status_svc.transition(db, m, "stopping")
    db.commit()
    if (m.platform, m.native_meeting_id) not in vexa.running_keys():
        prev = m.status
        status_svc.apply_vexa_status(db, m, "completed", None)
        if m.status == "processing" and prev != "processing":
            jobs.enqueue(db, "extract", m.id)
        db.commit()
    return _to_out(m)
