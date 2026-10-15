"""Register uploaded/generated images in the org Image Gallery (forward-only)."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.config import get_settings

_log = logging.getLogger(__name__)

_MEDIA_UUID_RE = re.compile(
    r"/api/media/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})",
    re.I,
)


def media_id_from_url(image_url: str, explicit: str = "") -> str:
    tid = str(explicit or "").strip()
    if tid:
        return tid
    match = _MEDIA_UUID_RE.search(str(image_url or ""))
    return match.group(1) if match else ""


def default_short_description(
    *,
    source: str,
    generation_prompt: str = "",
    user_description: str = "",
) -> str:
    user = str(user_description or "").strip()
    if user:
        return user[:500]
    prompt = " ".join(str(generation_prompt or "").split())
    if prompt:
        return prompt[:500]
    if source == "ai_generated":
        return "AI-generated campaign image"
    if source == "imported":
        return "Imported marketing image"
    return "Uploaded marketing image"


async def register_gallery_image(
    *,
    image_url: str,
    token: str = "",
    media_id: str = "",
    source: str = "ai_generated",
    generation_prompt: str = "",
    short_description: str = "",
    channel: str = "",
    context: dict[str, Any] | None = None,
    reuse_tags: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """POST /image-gallery/register — idempotent; failures are logged, not raised."""
    url = str(image_url or "").strip()
    if not url:
        return None
    mid = media_id_from_url(url, media_id)
    if not mid:
        _log.debug("image gallery skip: no media_id in url=%s", url[:120])
        return None

    settings = get_settings()
    api = settings.campaign_api_base.rstrip("/")
    endpoint = f"{api}/image-gallery/register"
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload = {
        "media_id": mid,
        "image_url": url,
        "source": source if source in ("ai_generated", "uploaded", "imported") else "uploaded",
        "generation_prompt": str(generation_prompt or "")[:8000],
        "short_description": default_short_description(
            source=source,
            generation_prompt=generation_prompt,
            user_description=short_description,
        ),
        "channel": str(channel or "").strip().lower()[:64],
        "context": context if isinstance(context, dict) else {},
        "reuse_tags": reuse_tags if isinstance(reuse_tags, dict) else {},
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(endpoint, headers=headers, json=payload)
            res.raise_for_status()
            body = res.json()
        data = body.get("data") if isinstance(body, dict) else body
        if isinstance(data, dict) and isinstance(data.get("asset"), dict):
            return data["asset"]
        return data if isinstance(data, dict) else None
    except Exception as exc:  # noqa: BLE001
        _log.warning("image gallery register failed: %s", exc)
        return None


__all__ = ["default_short_description", "media_id_from_url", "register_gallery_image"]
