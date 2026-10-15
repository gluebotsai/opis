"""Gemini image generation for Digital Marketing social posts.

Uses GEMINI_API_KEY / PROPOSAL_LLM_API_KEY and SOCIAL_IMAGE_MODEL
(gemini-3.1-flash-image-preview). Captions stay on the coworker LLM.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

from app.config import get_settings
from app.services.proposal_gemini import _api_key

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
PLATFORM_ASPECT = {
    "instagram": "4:5",
    "linkedin": "16:9",
    "facebook": "16:9",
}


def social_image_model() -> str:
    s = get_settings()
    return (getattr(s, "social_image_model", "") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def social_image_configured() -> bool:
    return bool(_api_key() and social_image_model())


def aspect_ratio_for_platform(platform: str) -> str:
    return PLATFORM_ASPECT.get((platform or "").strip().lower(), "1:1")


def _extract_image_bytes(response: Any) -> tuple[bytes, str] | None:
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline = getattr(part, "inline_data", None) or getattr(part, "inlineData", None)
            if inline is None and isinstance(part, dict):
                inline = part.get("inline_data") or part.get("inlineData")
            if inline is None:
                continue
            mime = (
                getattr(inline, "mime_type", None)
                or getattr(inline, "mimeType", None)
                or (inline.get("mime_type") if isinstance(inline, dict) else None)
                or "image/png"
            )
            data = getattr(inline, "data", None)
            if data is None and isinstance(inline, dict):
                data = inline.get("data")
            if isinstance(data, str) and data.strip():
                try:
                    return base64.b64decode(data), str(mime)
                except Exception:  # noqa: BLE001
                    continue
            if isinstance(data, (bytes, bytearray)) and data:
                return bytes(data), str(mime)
    return None


def generate_social_image_sync(
    *,
    caption: str,
    platform: str,
    title: str = "",
) -> str | None:
    """Return a data URL, or None if generation fails."""
    if not social_image_configured():
        return None
    try:
        from google import genai
        from google.genai import types
    except ImportError:
        logger.warning("google-genai not installed; skip social image")
        return None

    platform_n = (platform or "social").strip().lower()
    aspect = aspect_ratio_for_platform(platform_n)
    prompt = (
        f"Create a photorealistic, on-brand social media image for {platform_n}. "
        f"No watermarks, no unreadable fake text, no logos unless abstract. "
        f"Article: {(title or '').strip()[:180]}. "
        f"Post: {(caption or '').strip()[:500]}"
    )
    model = social_image_model()
    config_kwargs: dict[str, Any] = {
        "response_modalities": ["TEXT", "IMAGE"],
    }
    ImageConfig = getattr(types, "ImageConfig", None)
    if ImageConfig is not None:
        try:
            config_kwargs["image_config"] = ImageConfig(
                aspect_ratio=aspect,
                image_size="1K",
            )
        except Exception:  # noqa: BLE001 — older SDKs
            try:
                config_kwargs["image_config"] = ImageConfig(aspect_ratio=aspect)
            except Exception:  # noqa: BLE001
                pass

    client = genai.Client(api_key=_api_key())
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(**config_kwargs),
    )
    extracted = _extract_image_bytes(response)
    if not extracted:
        logger.warning("social Gemini image returned no bytes (%s)", platform_n)
        return None
    raw, mime = extracted
    if not mime.startswith("image/"):
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


async def attach_social_images(
    posts: list[dict[str, Any]],
    *,
    title: str = "",
) -> list[dict[str, Any]]:
    if not posts or not social_image_configured():
        return posts
    sem = asyncio.Semaphore(3)

    async def one(post: dict[str, Any]) -> dict[str, Any]:
        copy = dict(post.get("copy") or {})
        async with sem:
            try:
                data_url = await asyncio.to_thread(
                    generate_social_image_sync,
                    caption=str(copy.get("caption") or ""),
                    platform=str(post.get("platform") or ""),
                    title=title,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("social Gemini image failed: %s", exc)
                data_url = None
        if data_url:
            copy["imageDataUrl"] = data_url
            copy["imageModel"] = social_image_model()
        post = dict(post)
        post["copy"] = copy
        return post

    return list(await asyncio.gather(*[one(p) for p in posts]))
