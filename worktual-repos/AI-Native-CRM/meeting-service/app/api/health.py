from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.config import settings
from app.services.health import db_ready, redis_ready, vexa_ready, whisper_ready

router = APIRouter()


@router.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@router.get("/readyz", response_model=None)
def readyz() -> dict | Response:
    checks = {
        "db": db_ready(),
        "redis": redis_ready(),
        "vexa": vexa_ready() if not settings.testing else True,
        "whisper": whisper_ready() if not settings.testing else True,
    }
    ok = all(checks.values())
    body = {"status": "ok" if ok else "degraded", "checks": checks}
    if not ok and not settings.testing:
        return JSONResponse(body, status_code=503)
    return body


@router.get("/metrics", response_model=None)
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
