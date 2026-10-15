"""Google Meet Assist side panel. Public HTTPS origin for Marketplace sidePanelUrl."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.config import settings

router = APIRouter()
_DIR = Path(__file__).resolve().parent.parent / "static" / "addons" / "meet"
_INDEX = _DIR / "index.html"
_FRAME = "frame-ancestors https://meet.google.com https://*.meet.google.com 'self'"


@router.get("/addons/meet/config")
def addon_config() -> dict:
    return {
        "google_client_id": settings.google_addon_client_id,
        "cloud_project_number": settings.google_addon_cloud_project_number,
    }


@router.get("/addons/meet")
@router.get("/addons/meet/")
def meet_addon() -> FileResponse:
    if not _INDEX.is_file():
        raise HTTPException(status_code=404, detail="meet add-on missing")
    return FileResponse(
        _INDEX,
        media_type="text/html",
        headers={
            "Content-Security-Policy": _FRAME,
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )


@router.get("/addons/meet/{path:path}")
def meet_addon_asset(path: str):
    if path in ("", "index.html"):
        return meet_addon()
    target = (_DIR / path).resolve()
    if not str(target).startswith(str(_DIR.resolve())) or not target.is_file():
        raise HTTPException(status_code=404, detail="not found")
    resp = FileResponse(target)
    resp.headers["Content-Security-Policy"] = _FRAME
    return resp
