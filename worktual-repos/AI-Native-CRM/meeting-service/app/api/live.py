from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Meeting, TranscriptSegment
from app.services.auth import ws_principal
from app.services.crypto import redact_meeting_url
from app.services.live_bus import poll_local, subscribe_redis

log = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/v1/meetings/{meeting_id}/live")
async def live_transcript(websocket: WebSocket, meeting_id: str) -> None:
    principal = await ws_principal(websocket)
    last_event_id = websocket.query_params.get("last_event_id")
    db = SessionLocal()
    try:
        meeting = db.get(Meeting, meeting_id)
        if not meeting or meeting.org_id != principal.organization_id:
            await websocket.close(code=4404)
            return
        await websocket.accept()
        segs = list(
            db.scalars(
                select(TranscriptSegment)
                .where(TranscriptSegment.meeting_id == meeting.id, TranscriptSegment.completed == 1)
                .order_by(TranscriptSegment.t0, TranscriptSegment.id)
            ).all()
        )
        if last_event_id:
            cut = next((i for i, s in enumerate(segs) if s.segment_id == last_event_id), None)
            if cut is not None:
                segs = segs[cut + 1 :]
        await websocket.send_json(
            {
                "type": "snapshot",
                "status": meeting.status,
                "error_code": meeting.error_code,
                "error_message": meeting.error_message,
                "meeting_url_redacted": redact_meeting_url(meeting.meeting_url),
                "segments": [
                    {
                        "segment_id": s.segment_id,
                        "speaker": s.speaker,
                        "text": s.text,
                        "completed": True,
                        "start": s.t0,
                        "end": s.t1,
                    }
                    for s in segs
                ],
            }
        )
    finally:
        db.close()

    pubsub = subscribe_redis(meeting_id)
    cursor = 0
    try:
        while True:
            if pubsub is not None:
                msg = pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
                if msg and msg.get("type") == "message":
                    data = msg.get("data")
                    payload = json.loads(data) if isinstance(data, str) else data
                    await websocket.send_json(payload)
                else:
                    await asyncio.sleep(0.05)
            else:
                items, cursor = poll_local(meeting_id, cursor)
                for item in items:
                    await websocket.send_json(item)
                await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        log.info("live_ws_closed", extra={"meeting_id": meeting_id, "org_id": principal.organization_id})
    finally:
        if pubsub is not None:
            pubsub.close()
