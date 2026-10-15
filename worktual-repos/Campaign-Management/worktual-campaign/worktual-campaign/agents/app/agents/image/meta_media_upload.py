"""Upload campaign image URL to Meta via campaign backend (WhatsApp IMAGE headers)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings
from app.request_context import get_request_token

logger = logging.getLogger(__name__)


def _headers(token: str = "") -> dict[str, str]:
    tok = (token or get_request_token()).strip()
    out: dict[str, str] = {"Content-Type": "application/json"}
    if tok:
        out["Authorization"] = f"Bearer {tok}"
    return out


async def upload_whatsapp_meta_media_handle(
    *,
    image_url: str,
    token: str = "",
) -> dict[str, Any]:
    """
    POST /api/media/whatsapp/upload with a public image URL.
    Returns { ok, handle?, error? } — failures are non-fatal for attach.
    """
    url = str(image_url or "").strip()
    if not url:
        return {"ok": False, "error": "image_url is empty"}

    upload_url = (
        f"{get_settings().campaign_api_base.rstrip('/')}/media/whatsapp/upload"
    )
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            res = await client.post(
                upload_url,
                headers=_headers(token),
                json={"image_url": url},
            )
            res.raise_for_status()
            body = res.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:400] if exc.response is not None else str(exc)
        logger.warning("WhatsApp Meta media upload HTTP failed: %s", detail)
        return {"ok": False, "error": detail or str(exc)}
    except Exception as exc:
        logger.warning("WhatsApp Meta media upload failed: %s", exc)
        return {"ok": False, "error": str(exc)}

    data = body.get("data") if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        data = body if isinstance(body, dict) else {}
    handle = str(data.get("handle") or "").strip()
    if not handle:
        return {"ok": False, "error": "Meta upload returned no handle"}
    return {"ok": True, "handle": handle}


__all__ = ["upload_whatsapp_meta_media_handle"]
