from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.metrics import SEGMENTS
from app.models import Meeting, TranscriptSegment
from app.services import live_bus
from app.services.crm_live import push_live_caption

log = logging.getLogger(__name__)


def _skip_vexa_legacy_stt_segment(raw: dict[str, Any]) -> bool:
    """Drop in-bot Vexa `ch-*` segments when live PCM is the STT path."""
    if not settings.live_pcm_enabled:
        return False
    seg_id = str(raw.get("segment_id") or raw.get("id") or "")
    return seg_id.startswith("ch-")


def _num(value: Any) -> Any:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return value


def _unchanged(
    row: TranscriptSegment,
    *,
    speaker: str,
    text: str,
    t0: Any,
    t1: Any,
    completed: bool,
) -> bool:
    return (
        (row.speaker or "") == speaker
        and (row.text or "") == text
        and bool(row.completed) == completed
        and _num(row.t0) == _num(t0)
        and _num(row.t1) == _num(t1)
    )


def upsert_segments(db: Session, meeting: Meeting, segments: list[dict[str, Any]]) -> int:
    saved = 0
    pending: dict[str, TranscriptSegment] = {}
    for raw in segments:
        if _skip_vexa_legacy_stt_segment(raw):
            continue
        seg_id = str(raw.get("segment_id") or raw.get("id") or f"{meeting.id}:{raw.get('start')}:{raw.get('text','')[:24]}")
        completed = bool(raw.get("completed", True))
        speaker = raw.get("speaker") or ""
        text = raw.get("text") or ""
        t0 = raw.get("start")
        t1 = raw.get("end")
        existing = pending.get(seg_id) or db.scalar(
            select(TranscriptSegment).where(
                TranscriptSegment.meeting_id == meeting.id,
                TranscriptSegment.segment_id == seg_id,
            )
        )
        is_new = existing is None
        if existing and _unchanged(existing, speaker=speaker, text=text, t0=t0, t1=t1, completed=completed):
            pending[seg_id] = existing
            continue
        was_completed = bool(existing.completed) if existing else False
        if existing:
            existing.speaker = speaker
            existing.text = text
            existing.t0 = t0
            existing.t1 = t1
            existing.completed = 1 if completed else 0
            existing.raw_json = raw
            pending[seg_id] = existing
        else:
            row = TranscriptSegment(
                meeting_id=meeting.id,
                segment_id=seg_id,
                speaker=speaker,
                text=text,
                t0=t0,
                t1=t1,
                completed=1 if completed else 0,
                raw_json=raw,
            )
            db.add(row)
            pending[seg_id] = row
        event = {
            "type": "segment",
            "segment_id": seg_id,
            "speaker": speaker,
            "text": text,
            "completed": completed,
            "start": t0,
            "end": t1,
        }
        speaker_key = str(raw.get("speaker_key") or "").strip()
        if speaker_key:
            event["speaker_key"] = speaker_key
        speech_started_at = raw.get("speech_started_at")
        if isinstance(speech_started_at, str) and speech_started_at.strip():
            event["speech_started_at"] = speech_started_at.strip()
        latency = raw.get("latency")
        if isinstance(latency, dict):
            event["latency"] = latency
        live_bus.publish(meeting.id, event)
        push_live_caption(meeting, event)
        if completed and (is_new or not was_completed):
            saved += 1
            SEGMENTS.inc()
            log.info(
                "segment_saved",
                extra={"meeting_id": meeting.id, "org_id": meeting.org_id, "segment_id": seg_id, "text_len": len(text)},
            )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        log.info("segment_unique_conflict", extra={"meeting_id": meeting.id, "org_id": meeting.org_id})
    return saved
