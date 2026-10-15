"""Push live captions to CRM as soon as Vexa/Whisper emits a draft or final."""

from __future__ import annotations

import logging
import threading
from typing import Any

import httpx

from app.config import settings
from app.models import Meeting
from app.services.crm_bot import _uses_dummy
from app.services.live_timing import append_mark, latency_mark, utc_now_iso

log = logging.getLogger(__name__)


def push_live_caption(meeting: Meeting, payload: dict[str, Any]) -> None:
    """Non-blocking POST so ingest never stalls the Vexa websocket."""
    base = (settings.crm_bot_base_url or "").rstrip("/")
    if not base or _uses_dummy(base):
        return
    text = str(payload.get("text") or "").strip()
    if not text:
        return
    push_started = utc_now_iso()
    latency = payload.get("latency")
    if isinstance(latency, dict):
        latency = append_mark(
            latency,
            latency_mark("crm_push", started_at=push_started),
        )
    body = {
        "meeting_id": meeting.id,
        "organization_id": meeting.org_id,
        "segment_id": payload.get("segment_id"),
        "speaker": payload.get("speaker") or "",
        "speaker_key": payload.get("speaker_key") or "",
        "text": text,
        "completed": bool(payload.get("completed")),
        "start": payload.get("start"),
        "end": payload.get("end"),
        "speech_started_at": payload.get("speech_started_at"),
        "latency": latency,
    }
    meeting_id = meeting.id
    headers = {"Content-Type": "application/json"}
    if settings.crm_bot_api_key:
        headers["X-CRM-Bot-Key"] = settings.crm_bot_api_key

    def _run() -> None:
        try:
            with httpx.Client(timeout=8.0) as client:
                r = client.post(f"{base}/v1/assist/live-caption", json=body, headers=headers)
                push_ended = utc_now_iso()
                if isinstance(body.get("latency"), dict):
                    body["latency"] = append_mark(
                        body["latency"],
                        latency_mark(
                            "crm_push",
                            started_at=push_started,
                            ended_at=push_ended,
                        ),
                    )
                if r.status_code >= 400:
                    log.warning(
                        "crm_live_caption_failed",
                        extra={"meeting_id": meeting_id, "status": str(r.status_code)},
                    )
        except httpx.HTTPError as exc:
            log.warning(
                "crm_live_caption_unreachable",
                extra={"meeting_id": meeting_id, "error": str(exc)[:200]},
            )

    threading.Thread(target=_run, daemon=True).start()
