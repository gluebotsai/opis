from __future__ import annotations

import asyncio
import json
import logging
import time

from sqlalchemy import or_, select

from app.api.meetings import spawn_bot
from app.config import settings
from app.constants import IN_FLIGHT, utcnow
from app.db import SessionLocal
from app.logging import setup_logging
from app.metrics import EXTRACT_FAIL, EXTRACT_OK
from app.models import Job, Meeting, MeetingExtract, TranscriptSegment, init_db
from app.services import capacity, jobs, status as status_svc, vexa
from app.services.llm import LlmError, extract_meeting, live_tips
from app.services.retention import run_retention
from app.services.meeting_end import (
    should_finalize_active_meeting,
    vexa_snapshot_status,
)
from app.services.segments import upsert_segments
from app.services.status import lobby_timed_out

log = logging.getLogger(__name__)
_last_tip: dict[str, float] = {}
_last_retention = 0.0


def _transcript_text(db, meeting_id: str) -> str:
    segs = db.scalars(
        select(TranscriptSegment)
        .where(TranscriptSegment.meeting_id == meeting_id, TranscriptSegment.completed == 1)
        .order_by(TranscriptSegment.t0, TranscriptSegment.id)
    ).all()
    return "\n".join(f"{(s.speaker or 'Unknown')}: {s.text}" for s in segs)


def handle_extract(db, job: Job) -> None:
    meeting = db.get(Meeting, job.meeting_id)
    if not meeting:
        jobs.complete_job(db, job)
        return
    text = _transcript_text(db, meeting.id)
    if not text.strip():
        status_svc.transition(
            db, meeting, "completed_partial", error_code="no_audio", error_message="empty transcript"
        )
        db.commit()
        jobs.complete_job(db, job)
        EXTRACT_FAIL.inc()
        from app.services.crm_notify import notify_completed

        notify_completed(meeting, None)
        return
    try:
        data = extract_meeting(text, meeting.entity_type, meeting.entity_id)
    except LlmError as exc:
        jobs.fail_job(db, job, str(exc))
        job = db.get(Job, job.id)
        if job and job.status == "failed":
            status_svc.transition(
                db, meeting, "completed_partial", error_code="llm_failed", error_message=str(exc)
            )
            db.commit()
            EXTRACT_FAIL.inc()
            from app.services.crm_notify import notify_completed

            notify_completed(meeting, None)
        return
    ext = db.scalar(select(MeetingExtract).where(MeetingExtract.meeting_id == meeting.id))
    if not ext:
        ext = MeetingExtract(meeting_id=meeting.id)
        db.add(ext)
    ext.summary = data.summary
    ext.next_steps = data.next_step
    ext.action_items = data.action_items
    ext.pain_points = data.pain_points
    ext.products = data.products
    ext.speakers = data.speakers
    ext.raw_llm_json = data.model_dump()
    status_svc.transition(db, meeting, "completed")
    db.commit()
    jobs.complete_job(db, job)
    EXTRACT_OK.inc()
    from app.services.crm_notify import notify_completed

    notify_completed(meeting, ext)
    log.info("extract_ok", extra={"meeting_id": meeting.id, "org_id": meeting.org_id})


def handle_live_tip(db, job: Job) -> None:
    meeting = db.get(Meeting, job.meeting_id)
    if not meeting or meeting.status != "active":
        jobs.complete_job(db, job)
        return
    text = _transcript_text(db, meeting.id)
    if not text.strip():
        jobs.complete_job(db, job)
        return
    try:
        tip = live_tips(text)
        from app.services import live_bus

        live_bus.publish(meeting.id, {"type": "tip", **tip.model_dump()})
        jobs.complete_job(db, job)
    except LlmError as exc:
        jobs.fail_job(db, job, str(exc))


def sweep_lobby(db) -> None:
    rows = db.scalars(select(Meeting).where(Meeting.status == "awaiting_admission")).all()
    for m in rows:
        if lobby_timed_out(m, settings.lobby_timeout_sec):
            vexa.stop_bot(m.platform, m.native_meeting_id)
            status_svc.transition(db, m, "failed", error_code="not_admitted", error_message="lobby timeout")
            log.info("lobby_timeout", extra={"meeting_id": m.id, "org_id": m.org_id, "error_code": "not_admitted"})
    db.commit()


def spawn_due(db) -> None:
    now = utcnow()
    rows = db.scalars(
        select(Meeting)
        .where(
            Meeting.status == "requested",
            or_(Meeting.join_at.is_(None), Meeting.join_at <= now),
        )
        .order_by(Meeting.created_at.asc())
    ).all()
    for m in rows:
        if capacity.at_capacity(db, m.org_id):
            continue
        spawn_bot(db, m)


def _finalize_active_meeting(
    db,
    meeting: Meeting,
    *,
    reason: str,
    snapshot: dict | None,
) -> None:
    """Host ended / slot ended / Vexa terminal — stop bot and run extract."""
    vstatus = vexa_snapshot_status(snapshot)
    vexa.stop_bot(meeting.platform, meeting.native_meeting_id)
    prev = meeting.status
    if vstatus in ("failed", "evicted", "error"):
        status_svc.apply_vexa_status(db, meeting, vstatus, None)
    elif vstatus in ("completed", "stopped", "done", "ended"):
        status_svc.apply_vexa_status(db, meeting, vstatus, None)
    else:
        status_svc.transition(db, meeting, "stopping")
        status_svc.apply_vexa_status(db, meeting, "completed", None)
    if meeting.status == "processing" and prev != "processing":
        jobs.enqueue(db, "extract", meeting.id)
    log.info(
        "meeting_finalize",
        extra={
            "meeting_id": meeting.id,
            "org_id": meeting.org_id,
            "reason": reason,
            "error_code": "host_ended",
        },
    )


def sweep_stale_bots(db) -> None:
    """Release slots when Vexa already has no bot (user stop / Meet ended, webhook blocked)."""
    rows = db.scalars(
        select(Meeting).where(Meeting.status.in_(("joining", "awaiting_admission", "active", "stopping")))
    ).all()
    if not rows:
        return
    running = vexa.running_keys()
    for m in rows:
        if m.status == "active":
            data = vexa.get_meeting_snapshot(m.platform, m.native_meeting_id)
            bot_running = (m.platform, m.native_meeting_id) in running
            finalize, reason = should_finalize_active_meeting(
                m, data, vexa_bot_running=bot_running
            )
            if finalize:
                _finalize_active_meeting(db, m, reason=reason, snapshot=data)
                continue
        if (m.platform, m.native_meeting_id) in running:
            continue
        if m.status == "stopping":
            prev = m.status
            status_svc.apply_vexa_status(db, m, "completed", None)
            if m.status == "processing" and prev != "processing":
                jobs.enqueue(db, "extract", m.id)
        elif m.status in ("joining", "awaiting_admission"):
            continue
        elif m.status == "active":
            data = vexa.get_meeting_snapshot(m.platform, m.native_meeting_id)
            finalize, reason = should_finalize_active_meeting(
                m, data, vexa_bot_running=False
            )
            if finalize:
                _finalize_active_meeting(db, m, reason=reason, snapshot=data)
    db.commit()


def poll_transcripts(db) -> None:
    rows = db.scalars(
        select(Meeting).where(Meeting.status.in_(("active", "awaiting_admission", "joining", "stopping")))
    ).all()
    if not rows:
        return
    running = vexa.running_keys()
    for m in rows:
        data = vexa.get_meeting_snapshot(m.platform, m.native_meeting_id)
        if not data:
            continue
        prev = m.status
        vstatus = vexa_snapshot_status(data)
        if vstatus:
            status_svc.apply_vexa_status(db, m, str(vstatus), None)
            if m.status == "processing" and prev != "processing":
                jobs.enqueue(db, "extract", m.id)
        if m.status == "active":
            bot_running = (m.platform, m.native_meeting_id) in running
            finalize, reason = should_finalize_active_meeting(
                m, data, vexa_bot_running=bot_running
            )
            if finalize:
                _finalize_active_meeting(db, m, reason=reason, snapshot=data)
                continue
        segs = data.get("segments") or []
        if segs:
            upsert_segments(db, m, segs)
    db.commit()


def maybe_tips(db) -> None:
    if not settings.live_tips_enabled:
        return
    now = time.time()
    rows = db.scalars(select(Meeting).where(Meeting.status == "active")).all()
    for m in rows:
        if now - _last_tip.get(m.id, 0) < 30:
            continue
        _last_tip[m.id] = now
        jobs.enqueue(db, "live_tip", m.id)
    db.commit()


def process_jobs(db) -> None:
    for job in jobs.claim_jobs(db):
        if job.kind == "extract":
            handle_extract(db, job)
        elif job.kind == "live_tip":
            handle_live_tip(db, job)
        else:
            jobs.complete_job(db, job)


def ingest_ws_message(raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        return
    segs = msg.get("segments") or []
    if not segs:
        return
    db = SessionLocal()
    try:
        native = msg.get("native_id") or msg.get("native_meeting_id")
        platform = msg.get("platform")
        q = select(Meeting).where(Meeting.status.in_(IN_FLIGHT))
        if native:
            q = q.where(Meeting.native_meeting_id == str(native))
        if platform:
            q = q.where(Meeting.platform == platform)
        meeting = db.scalar(q.order_by(Meeting.created_at.desc()))
        if not meeting:
            return
        upsert_segments(db, meeting, segs)
    finally:
        db.close()


async def vexa_ws_loop() -> None:
    import websockets

    backoff = 1.0
    while True:
        if not settings.vexa_api_key:
            await asyncio.sleep(5)
            continue
        db = SessionLocal()
        try:
            active = db.scalars(select(Meeting).where(Meeting.status.in_(IN_FLIGHT))).all()
            meetings = [{"platform": m.platform, "native_id": m.native_meeting_id} for m in active]
        finally:
            db.close()
        if not meetings:
            await asyncio.sleep(2)
            continue
        try:
            kwargs = {"ping_interval": 20, "ping_timeout": 20}
            try:
                ws_ctx = websockets.connect(
                    vexa.ws_url(),
                    additional_headers={"X-API-Key": settings.vexa_api_key},
                    **kwargs,
                )
            except TypeError:
                ws_ctx = websockets.connect(
                    vexa.ws_url(),
                    extra_headers={"X-API-Key": settings.vexa_api_key},
                    **kwargs,
                )
            async with ws_ctx as ws:
                await ws.send(json.dumps({"action": "subscribe", "meetings": meetings}))
                backoff = 1.0
                async for raw in ws:
                    ingest_ws_message(raw if isinstance(raw, str) else raw.decode())
        except Exception:
            log.warning("vexa_ws_reconnect", extra={"error_code": "vexa_unavailable"})
            db = SessionLocal()
            try:
                poll_transcripts(db)
            finally:
                db.close()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


def run_sync_loop() -> None:
    global _last_retention
    while True:
        db = SessionLocal()
        try:
            spawn_due(db)
            sweep_lobby(db)
            sweep_stale_bots(db)
            process_jobs(db)
            maybe_tips(db)
            now = time.time()
            if now - _last_retention > 3600:
                run_retention(db)
                _last_retention = now
        except Exception:
            log.exception("worker_tick_failed")
        finally:
            db.close()
        time.sleep(2)


def run_transcript_loop() -> None:
    """Poll Vexa for in-progress captions more often than the 2s worker tick."""
    while True:
        db = SessionLocal()
        try:
            poll_transcripts(db)
        except Exception:
            log.exception("transcript_tick_failed")
        finally:
            db.close()
        time.sleep(0.4)


def main() -> None:
    import threading

    setup_logging()
    init_db()
    log.info("worker_start")
    threading.Thread(target=lambda: asyncio.run(vexa_ws_loop()), daemon=True).start()
    threading.Thread(target=run_transcript_loop, daemon=True).start()
    run_sync_loop()


if __name__ == "__main__":
    main()
