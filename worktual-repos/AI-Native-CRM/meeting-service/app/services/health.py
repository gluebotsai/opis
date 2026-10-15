from __future__ import annotations

import io
import logging
import wave

import httpx

from app.config import settings
from app.metrics import VEXA_READY, WHISPER_PREFLIGHT

log = logging.getLogger(__name__)


def _silent_wav() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * 1600)
    return buf.getvalue()


def whisper_ready() -> bool:
    if settings.testing:
        WHISPER_PREFLIGHT.set(1)
        return True
    url = settings.whisper_base_url.rstrip("/") + "/v1/audio/transcriptions"
    headers = {}
    if settings.whisper_api_token:
        headers["Authorization"] = f"Bearer {settings.whisper_api_token}"
    try:
        with httpx.Client(timeout=8.0) as client:
            r = client.post(
                url,
                headers=headers,
                files={"file": ("sample.wav", _silent_wav(), "audio/wav")},
                data={"model": settings.whisper_model},
            )
            ok = r.status_code < 500
    except httpx.HTTPError:
        ok = False
    WHISPER_PREFLIGHT.set(1 if ok else 0)
    return ok


def vexa_ready() -> bool:
    from app.services import vexa

    if settings.testing:
        VEXA_READY.set(1)
        return True
    ok = vexa.ping()
    VEXA_READY.set(1 if ok else 0)
    return ok


def redis_ready() -> bool:
    if not settings.redis_url:
        return True
    try:
        import redis

        r = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        return bool(r.ping())
    except Exception:
        return False


def db_ready() -> bool:
    from sqlalchemy import text

    from app.db import engine

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
