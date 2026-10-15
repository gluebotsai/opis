"""PCM16 mono → Whisper (OpenAI-compatible transcriptions)."""

from __future__ import annotations

import io
import logging
import wave
from typing import Any

import httpx

from app.config import settings

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000


def pcm16_to_wav(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def transcribe_pcm_sync(
    pcm: bytes,
    *,
    sample_rate: int = SAMPLE_RATE,
    timeout_sec: float | None = None,
) -> str:
    """Blocking Whisper call; run from a thread pool in async transcoder."""
    if not pcm or len(pcm) < sample_rate * 2 // 5:
        return ""
    wav = pcm16_to_wav(pcm, sample_rate)
    url = settings.whisper_base_url.rstrip("/") + "/v1/audio/transcriptions"
    headers: dict[str, str] = {}
    if settings.whisper_api_token:
        headers["Authorization"] = f"Bearer {settings.whisper_api_token}"
    data: dict[str, Any] = {
        "model": settings.whisper_model,
        "response_format": "json",
        "temperature": "0",
    }
    lang = (settings.live_pcm_whisper_language or "").strip()
    if lang:
        data["language"] = lang
    timeout = timeout_sec if timeout_sec is not None else settings.live_pcm_whisper_timeout_sec
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(
                url,
                headers=headers,
                files={"file": ("utterance.wav", wav, "audio/wav")},
                data=data,
            )
        if r.status_code >= 400:
            log.warning(
                "live_pcm_whisper_error",
                extra={"status": str(r.status_code), "body": r.text[:200]},
            )
            return ""
        body = r.json()
        return str(body.get("text") or "").strip()
    except httpx.HTTPError as exc:
        log.warning("live_pcm_whisper_unreachable", extra={"error": str(exc)[:200]})
        return ""
