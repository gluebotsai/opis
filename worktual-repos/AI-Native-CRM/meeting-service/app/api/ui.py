"""Local test console. Disabled unless ENABLE_TEST_UI=true. Not for production CRM."""

from __future__ import annotations

import time
from pathlib import Path

import jwt
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import settings

router = APIRouter()
_CONSOLE = Path(__file__).resolve().parent.parent / "static" / "console.html"


def _require_ui() -> None:
    if not settings.enable_test_ui:
        raise HTTPException(status_code=404, detail="test UI disabled")


@router.get("/ui")
def console() -> FileResponse:
    _require_ui()
    if not _CONSOLE.is_file():
        raise HTTPException(status_code=404, detail="console.html missing")
    return FileResponse(_CONSOLE, media_type="text/html")


@router.get("/")
def root() -> FileResponse:
    return console()


@router.post("/ui/token")
def mint_test_token() -> dict:
    _require_ui()
    token = jwt.encode(
        {
            "organization_id": "1003",
            "sub": "test-ui",
            "scopes": ["meetings:write"],
            "iat": int(time.time()),
        },
        settings.crm_service_jwt_secret,
        algorithm="HS256",
    )
    return {"token": token, "organization_id": "1003"}
