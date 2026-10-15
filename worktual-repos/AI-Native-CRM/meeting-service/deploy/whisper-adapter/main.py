"""Expose OpenAI /v1/audio/transcriptions by forwarding to Worktual GPU translations."""

from __future__ import annotations

import logging
import os

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

UPSTREAM = os.environ.get(
    "WHISPER_UPSTREAM_URL",
    "http://173.234.75.165:7789/v1/audio/translations",
)
TOKEN = os.environ.get("WHISPER_UPSTREAM_TOKEN", "EMPTY")
# Vexa defaults to whisper-1 when TRANSCRIPTION_MODEL is unset; GPU only serves worktual-large-v3.
UPSTREAM_MODEL = os.environ.get("WHISPER_UPSTREAM_MODEL", "worktual-large-v3")
LEGACY_MODELS = frozenset({"whisper-1", "whisper-1-large", "large-v3", "large"})

app = FastAPI(title="whisper-adapter")


def _resolve_model(requested: str | None) -> str:
    name = (requested or "").strip()
    if not name or name in LEGACY_MODELS:
        return UPSTREAM_MODEL
    return name


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "upstream": UPSTREAM, "model": UPSTREAM_MODEL}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("worktual-large-v3"),
    language: str | None = Form("en"),
    temperature: float | None = Form(0.0),
    authorization: str | None = Header(None),
) -> dict:
    upstream_model = _resolve_model(model)
    data = await file.read()
    headers: dict[str, str] = {}
    token = TOKEN or (authorization.split(" ", 1)[1] if authorization and " " in authorization else "")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    files = {"file": (file.filename or "audio.wav", data, file.content_type or "audio/wav")}
    form: dict[str, str] = {
        "model": upstream_model,
        "response_format": "json",
    }
    if language:
        form["language"] = language
    if temperature is not None:
        form["temperature"] = str(temperature)
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(UPSTREAM, files=files, data=form, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("whisper_upstream_unreachable", extra={"error": str(exc)[:200]})
        raise HTTPException(status_code=502, detail="upstream STT unreachable") from exc
    if r.status_code >= 400:
        log.warning(
            "whisper_upstream_error",
            extra={
                "status": r.status_code,
                "requested_model": model,
                "upstream_model": upstream_model,
                "body": r.text[:400],
            },
        )
        raise HTTPException(status_code=r.status_code, detail=r.text[:500])
    try:
        body = r.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="upstream returned non-JSON") from exc
    text = body.get("text") or body.get("transcription") or ""
    return {"text": text}
