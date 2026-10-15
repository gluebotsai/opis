from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)


class VexaError(Exception):
    def __init__(self, error_code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code


def _headers() -> dict[str, str]:
    return {"X-API-Key": settings.vexa_api_key, "Content-Type": "application/json"}


def _client() -> httpx.Client:
    return httpx.Client(base_url=settings.vexa_api_base.rstrip("/"), timeout=30.0, headers=_headers())


def ping() -> bool:
    if not settings.vexa_api_key:
        return False
    try:
        with _client() as client:
            r = client.get("/bots/status")
            return r.status_code < 500
    except httpx.HTTPError:
        return False


def register_webhook() -> None:
    if not settings.vexa_api_key:
        return
    payload = {
        "webhook_url": settings.public_base_url,
        "webhook_secret": settings.webhook_secret,
        "webhook_events": {
            "meeting.status_change": True,
            "meeting.completed": True,
            "bot.failed": True,
        },
    }
    try:
        with _client() as client:
            r = client.put("/user/webhook", json=payload)
            log.info("vexa_webhook_register", extra={"status": str(r.status_code)})
    except httpx.HTTPError as exc:
        log.warning("vexa_webhook_register_failed", extra={"error_code": "vexa_unavailable"})
        log.debug(str(exc))


def create_bot(
    *,
    meeting_url: str,
    bot_name: str,
    platform: str,
    native_meeting_id: str,
    passcode: str | None,
    metadata: dict[str, Any],
    recording_enabled: bool | None = None,
) -> dict[str, Any]:
    record = settings.vexa_recording_enabled if recording_enabled is None else recording_enabled
    if not settings.live_pcm_enabled:
        raise VexaError(
            "live_pcm_disabled",
            "Live Assist requires meeting-service live PCM (LIVE_PCM_ENABLED=true); in-bot Vexa STT is not supported",
        )
    body: dict[str, Any] = {
        "meeting_url": meeting_url,
        "bot_name": bot_name,
        "platform": platform,
        "native_meeting_id": native_meeting_id,
        "transcribe_enabled": False,
        "recording_enabled": record,
        "metadata": metadata,
        # Vexa treats this as "no remote audio for this long", not "host left".
        # A short window pulls the notetaker out while the host is still in a
        # quiet Meet. Host end/leave is the removal monitor. 3h is only a
        # backstop if that signal never arrives (hard cap is 4h).
        "automatic_leave": {"max_time_left_alone": 3 * 60 * 60 * 1000},
    }
    if passcode:
        body["passcode"] = passcode
    try:
        with _client() as client:
            r = client.post("/bots", json=body)
    except httpx.HTTPError as exc:
        raise VexaError("vexa_unavailable", "vexa unreachable") from exc
    if r.status_code == 409:
        raise VexaError("capacity", "bot already active on this meeting", 409)
    if r.status_code == 429:
        raise VexaError("capacity", "vexa concurrency limit", 429)
    if r.status_code == 503:
        raise VexaError("whisper_unavailable", r.text[:300], 503)
    if r.status_code >= 500:
        raise VexaError("vexa_unavailable", r.text[:300], r.status_code)
    if r.status_code >= 400:
        raise VexaError("vexa_unavailable", r.text[:300], r.status_code)
    try:
        return r.json()
    except Exception:
        return {}


def running_keys() -> set[tuple[str, str]]:
    try:
        with _client() as client:
            r = client.get("/bots/status")
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPError:
        return set()
    rows = data.get("running") or data.get("running_bots") or []
    out: set[tuple[str, str]] = set()
    for row in rows:
        platform = str(row.get("platform") or "")
        native = str(row.get("native_meeting_id") or row.get("native_id") or "")
        if platform and native:
            out.add((platform, native))
    return out


def stop_bot(platform: str, native_meeting_id: str) -> None:
    try:
        with _client() as client:
            r = client.delete(f"/bots/{platform}/{native_meeting_id}")
            if r.status_code in (200, 204, 404):
                return
            log.info("vexa_stop_unexpected", extra={"status": str(r.status_code)})
    except httpx.HTTPError:
        log.warning("vexa_stop_failed", extra={"error_code": "vexa_unavailable"})


def get_meeting_snapshot(platform: str, native_meeting_id: str) -> dict[str, Any]:
    """Vexa Lite blocks webhooks to Docker hostnames; poll this instead."""
    try:
        with _client() as client:
            r = client.get(f"/transcripts/{platform}/{native_meeting_id}")
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, dict) else {}
    except httpx.HTTPError:
        return {}


def get_transcript(platform: str, native_meeting_id: str) -> list[dict[str, Any]]:
    return get_meeting_snapshot(platform, native_meeting_id).get("segments") or []


def ws_url() -> str:
    base = settings.vexa_api_base.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://") :] + "/ws"
    if base.startswith("http://"):
        return "ws://" + base[len("http://") :] + "/ws"
    return base + "/ws"
