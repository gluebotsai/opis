"""WebSocket ingest for CCaaS-style live PCM → Whisper → CRM live-caption."""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models import Meeting
from app.services.auth import decode_token
from app.services.pcm_session import run_live_pcm_session

log = logging.getLogger(__name__)
router = APIRouter()


def _bot_key_state(websocket: WebSocket) -> str:
    """Why a bot-key socket is or is not accepted. Never includes the secret."""
    expected = (settings.crm_bot_api_key or "").strip()
    got = (websocket.headers.get("x-crm-bot-key") or websocket.query_params.get("bot_key") or "").strip()
    if not expected:
        return "bot_key_not_configured"
    if not got:
        return "bot_key_missing"
    if got != expected:
        return "bot_key_mismatch"
    return "ok"


async def _reject_pcm(
    websocket: WebSocket,
    *,
    code: int,
    reason: str,
    meeting_id: str = "",
    platform: str = "",
    native: str = "",
) -> None:
    log.warning(
        "live_pcm_rejected",
        extra={
            "code": code,
            "reason": reason,
            "meeting_id": meeting_id,
            "platform": platform,
            "native": native,
        },
    )
    await websocket.close(code=code, reason=reason[:120])


async def _authorize_pcm_ws(
    websocket: WebSocket,
    meeting: Meeting,
    *,
    platform: str = "",
    native: str = "",
) -> bool:
    fields = {
        "meeting_id": meeting.id,
        "platform": platform,
        "native": native or (meeting.native_meeting_id or ""),
    }
    if not settings.live_pcm_enabled:
        await _reject_pcm(websocket, code=4403, reason="live PCM disabled", **fields)
        return False
    raw = websocket.query_params.get("token")
    auth = websocket.headers.get("authorization")
    if not raw and auth and auth.lower().startswith("bearer "):
        raw = auth.split(" ", 1)[1].strip()
    if raw:
        try:
            principal = decode_token(raw)
        except Exception:
            await _reject_pcm(websocket, code=4401, reason="bad_token", **fields)
            return False
        if meeting.org_id != principal.organization_id:
            await _reject_pcm(websocket, code=4404, reason="org_mismatch", **fields)
            return False
        return True
    state = _bot_key_state(websocket)
    if state == "ok":
        return True
    await _reject_pcm(websocket, code=4401, reason=state, **fields)
    return False


def _resolve_meeting(platform: str, native_meeting_id: str) -> Meeting | None:
    db = SessionLocal()
    try:
        return db.scalar(
            select(Meeting)
            .where(
                func.lower(Meeting.platform) == platform.lower(),
                func.lower(Meeting.native_meeting_id) == native_meeting_id.lower(),
            )
            .order_by(Meeting.created_at.desc())
        )
    finally:
        db.close()


@router.websocket("/v1/meetings/{meeting_id}/live-pcm")
async def live_pcm_stream(websocket: WebSocket, meeting_id: str) -> None:
    db = SessionLocal()
    try:
        meeting = db.get(Meeting, meeting_id)
        if not meeting:
            await _reject_pcm(
                websocket,
                code=4404,
                reason="meeting not found",
                meeting_id=meeting_id,
            )
            return
        if not await _authorize_pcm_ws(websocket, meeting):
            return
        log.info("live_pcm_connected", extra={"meeting_id": meeting.id})
        await run_live_pcm_session(websocket, meeting.id)
    except WebSocketDisconnect:
        log.info("live_pcm_closed", extra={"meeting_id": meeting_id})
    finally:
        db.close()


@router.websocket("/v1/live-pcm/join/{platform}/{native_meeting_id}")
async def live_pcm_join_by_native(
    websocket: WebSocket,
    platform: str,
    native_meeting_id: str,
) -> None:
    platform_name = platform.strip()
    native_name = native_meeting_id.strip()
    meeting = _resolve_meeting(platform_name, native_name)
    if not meeting:
        await _reject_pcm(
            websocket,
            code=4404,
            reason="meeting not found",
            platform=platform_name,
            native=native_name,
        )
        return
    if not await _authorize_pcm_ws(
        websocket,
        meeting,
        platform=platform_name,
        native=native_name,
    ):
        return
    try:
        log.info(
            "live_pcm_connected",
            extra={"meeting_id": meeting.id, "platform": platform_name, "native": native_name},
        )
        await run_live_pcm_session(websocket, meeting.id)
    except WebSocketDisconnect:
        log.info(
            "live_pcm_closed",
            extra={"meeting_id": meeting.id, "platform": platform_name, "native": native_name},
        )
