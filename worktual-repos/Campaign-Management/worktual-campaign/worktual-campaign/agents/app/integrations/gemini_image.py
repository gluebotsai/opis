"""Gemini image generation — text-to-image and image edit.

Product contract:
- Public API returns rebuild media URLs only
  (https://rebuild-campaign-api.worktual.com/api/media/{id}).
- Local disk files are a temporary scratch pad: generate/save → read bytes →
  upload to campaign media API → return rebuild URL for templates/launch.
- Never return a filesystem path to callers that set template fields.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

IMAGE_GENERATION_NOT_CONFIGURED = (
    "AI image generation is not configured on the agents service "
    "(set GEMINI_API_KEY). For local UI-only testing without Gemini, "
    "set GEMINI_IMAGE_ALLOW_DEV_STUB=true."
)

_STUB_PNG_TINY = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6Q"
    "AAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAANSURB"
    "VHic7cExAQAAAMKg9U9tDQ+gAAAAAAAAAAAAAPgYfAAB4ABJRU5ErkJggg=="
)


def _dev_banner_stub_png() -> bytes:
    try:
        from io import BytesIO

        from PIL import Image, ImageDraw

        width, height = 800, 450
        img = Image.new("RGB", (width, height), color=(37, 99, 235))
        draw = ImageDraw.Draw(img)
        for y in range(height):
            shade = int(37 + (y / max(height - 1, 1)) * 40)
            draw.line([(0, y), (width, y)], fill=(shade, 99, 235))
        draw.rectangle([(40, 40), (width - 40, height - 40)], outline=(255, 255, 255), width=3)
        draw.text((60, height // 2 - 20), "Campaign hero (dev stub)", fill=(255, 255, 255))
        draw.text((60, height // 2 + 10), "Set GEMINI_API_KEY for AI images", fill=(230, 240, 255))
        buf = BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return _STUB_PNG_TINY


def _scratch_dir() -> Path:
    """Temporary local save dir (debug / intermediate only — not product URLs)."""
    root = Path(get_settings().data_dir).expanduser()
    path = root / "generated_images"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _part_image_bytes(part: Any) -> bytes | None:
    inline = getattr(part, "inline_data", None)
    if not inline or not getattr(inline, "data", None):
        return None
    data = inline.data
    if isinstance(data, str):
        return base64.b64decode(data)
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    return None


def _extract_image_bytes(response: Any) -> bytes | None:
    candidates = getattr(response, "candidates", None) or []
    reasons: list[str] = []
    for candidate in candidates:
        fr = getattr(candidate, "finish_reason", None)
        if fr is not None:
            reasons.append(str(fr))
        content = getattr(candidate, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", None) or []:
            raw = _part_image_bytes(part)
            if raw:
                return raw
            as_image = getattr(part, "as_image", None)
            if callable(as_image):
                try:
                    from io import BytesIO

                    img = as_image()
                    save = getattr(img, "save", None)
                    if callable(save):
                        buf = BytesIO()
                        save(buf, format="PNG")
                        out = buf.getvalue()
                        if out:
                            return out
                except Exception:  # noqa: BLE001
                    pass
    if reasons:
        logger.warning("Gemini returned no image bytes (finish_reason=%s)", reasons)
    return None


def _extract_all_image_bytes(response: Any) -> list[tuple[bytes, str]]:
    """Collect every inline image part (edit may return multiple)."""
    out: list[tuple[bytes, str]] = []
    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if not content:
            continue
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            raw = _part_image_bytes(part)
            if not raw:
                continue
            mime = (
                str(getattr(inline, "mime_type", None) or "image/png").strip()
                or "image/png"
            )
            out.append((raw, mime))
    return out


def _generate_sync(prompt: str, *, model: str, api_key: str) -> bytes:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=[prompt],
        config=types.GenerateContentConfig(response_modalities=["IMAGE"]),
    )
    raw = _extract_image_bytes(response)
    if not raw:
        raise RuntimeError("Gemini returned no image bytes")
    return raw


def _refine_sync(
    prompt: str,
    *,
    image_bytes: bytes,
    mime_type: str,
    model: str,
    api_key: str,
) -> list[tuple[bytes, str]]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                types.Part.from_text(text=prompt),
            ],
        )
    ]
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )
    parts = _extract_all_image_bytes(response)
    if not parts:
        raise RuntimeError("Gemini returned no refined image bytes")
    return parts


def _read_local_image(path: str) -> tuple[bytes, str]:
    raw_path = str(path or "").strip().rstrip("\\/")
    if not raw_path:
        raise FileNotFoundError("Image path is empty")
    if not os.path.exists(raw_path):
        raise FileNotFoundError(f"Image file not found: {raw_path}")
    with open(raw_path, "rb") as f:
        data = f.read()
    if not data:
        raise RuntimeError(f"Image file is empty: {raw_path}")
    mime = mimetypes.guess_type(raw_path)[0] or "image/png"
    return data, mime


def _write_scratch(image_bytes: bytes, *, prefix: str = "image", ext: str = ".png") -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    path = _scratch_dir() / f"{prefix}_{stamp}{ext}"
    path.write_bytes(image_bytes)
    return str(path)


async def _upload_rebuild(
    image_bytes: bytes,
    *,
    mime_type: str = "image/png",
    token: str = "",
    upload_base: str | None = None,
) -> dict[str, str]:
    from app.agents.image.media_upload import upload_image_bytes

    uploaded = await upload_image_bytes(
        image_bytes,
        token=token,
        mime_type=mime_type or "image/png",
        upload_base=upload_base,
    )
    url = str(uploaded.get("url") or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        raise RuntimeError(f"Upload did not return rebuild URL: {url!r}")
    return {
        "url": url,
        "media_id": str(uploaded.get("media_id") or "").strip(),
    }


async def local_path_to_rebuild_url(
    path: str,
    *,
    token: str = "",
    upload_base: str | None = None,
) -> dict[str, str]:
    """Read a Gemini-saved local file and store it on rebuild media API."""
    data, mime = await asyncio.to_thread(_read_local_image, path)
    return await _upload_rebuild(
        data, mime_type=mime, token=token, upload_base=upload_base
    )


class GeminiImageLLM:
    """
    Gemini image helper aligned with campaign rebuild.

    `run` / `edit_image` may scratch to disk (same idea as the standalone class),
    then always read those bytes and upload so the return value is a rebuild URL
    suitable for template header_image / launch.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        *,
        token: str = "",
    ) -> None:
        settings = get_settings()
        self.api_key = str(api_key or settings.gemini_api_key or "").strip()
        self.model = str(
            model or settings.gemini_image_model or "gemini-3.1-flash-image-preview"
        ).strip()
        self.token = str(token or "").strip()
        self.save_dir = str(_scratch_dir())

    def _require_key_or_stub(self) -> bytes | None:
        """Return stub bytes if allowed, else None when key present, else raise."""
        if self.api_key:
            return None
        settings = get_settings()
        if settings.gemini_image_allow_dev_stub:
            logger.warning("GEMINI_API_KEY unset — using dev stub PNG")
            return _dev_banner_stub_png()
        raise RuntimeError(IMAGE_GENERATION_NOT_CONFIGURED)

    async def run(self, prompt: str, *, upload_base: str | None = None) -> str:
        """
        Generate an image and return the rebuild media URL (not a local path).

        Flow: Gemini → scratch file → read bytes → POST /api/media → https URL.
        Never returns a filesystem path or the dummy string IMAGE_URL.
        """
        text = str(prompt or "").strip()
        if not text:
            raise RuntimeError("Image prompt is empty")

        stub = self._require_key_or_stub()
        if stub is not None:
            scratch = await asyncio.to_thread(_write_scratch, stub, prefix="stub")
            uploaded = await local_path_to_rebuild_url(
                scratch, token=self.token, upload_base=upload_base
            )
            return uploaded["url"]

        raw = await asyncio.to_thread(
            _generate_sync,
            text,
            model=self.model,
            api_key=self.api_key,
        )
        if not raw or len(raw) < 32:
            raise RuntimeError("Gemini returned empty or tiny image bytes")

        scratch = await asyncio.to_thread(_write_scratch, raw, prefix="image")
        logger.info("Generated image scratch saved at: %s", scratch)
        uploaded = await local_path_to_rebuild_url(
            scratch, token=self.token, upload_base=upload_base
        )
        logger.info("Generated image stored at rebuild URL: %s", uploaded["url"])
        return uploaded["url"]

    async def edit_image(
        self,
        prompt: str,
        image_path: str | list[str],
    ) -> list[str] | None:
        """
        Edit an image from a local path (or rebuild URL path fetch) and return
        rebuild media URL(s).
        """
        if isinstance(image_path, list):
            image_path = image_path[0] if image_path else ""
        source = str(image_path or "").strip().rstrip("\\/")
        if not source:
            raise FileNotFoundError("Image path is empty")

        text = str(prompt or "").strip() or "Improve this marketing image"

        # Source may be local scratch path OR already a rebuild/https URL.
        if source.lower().startswith(("http://", "https://")):
            async with httpx.AsyncClient(
                timeout=60.0, trust_env=False, follow_redirects=True
            ) as client:
                res = await client.get(source)
                res.raise_for_status()
                image_bytes = res.content
                mime_type = (
                    str(res.headers.get("content-type") or "")
                    .split(";")[0]
                    .strip()
                    or "image/png"
                )
        else:
            image_bytes, mime_type = await asyncio.to_thread(_read_local_image, source)

        stub = self._require_key_or_stub()
        if stub is not None:
            # Dev: re-upload source (or stub) as "edited".
            uploaded = await _upload_rebuild(
                image_bytes or stub, mime_type=mime_type, token=self.token
            )
            return [uploaded["url"]]

        parts = await asyncio.to_thread(
            _refine_sync,
            text,
            image_bytes=image_bytes,
            mime_type=mime_type or "image/png",
            model=self.model,
            api_key=self.api_key,
        )
        urls: list[str] = []
        for idx, (raw, mime) in enumerate(parts):
            ext = mimetypes.guess_extension(mime) or ".png"
            scratch = await asyncio.to_thread(
                _write_scratch, raw, prefix=f"edited_{idx}", ext=ext
            )
            logger.info("Edited image scratch saved at: %s", scratch)
            uploaded = await local_path_to_rebuild_url(scratch, token=self.token)
            urls.append(uploaded["url"])
            logger.info("Edited image stored at rebuild URL: %s", uploaded["url"])
        return urls or None


async def generate_image_bytes(prompt: str) -> tuple[bytes, str, bool]:
    """
    Generate image bytes from an enhanced prompt.

    Returns (bytes, mime_type, used_stub).
    Prefer GeminiImageLLM.run() when you need a rebuild URL for templates.
    """
    settings = get_settings()
    api_key = str(settings.gemini_api_key or "").strip()
    model = str(settings.gemini_image_model or "gemini-3.1-flash-image-preview").strip()
    text = str(prompt or "").strip()
    if not text:
        raise RuntimeError("Image prompt is empty")
    if not api_key:
        if settings.gemini_image_allow_dev_stub:
            logger.warning(
                "GEMINI_API_KEY unset — using dev banner stub PNG (GEMINI_IMAGE_ALLOW_DEV_STUB=true)"
            )
            return _dev_banner_stub_png(), "image/png", True
        raise RuntimeError(IMAGE_GENERATION_NOT_CONFIGURED)

    safe_suffix = (
        " Original abstract marketing illustration only: no text, no logos, "
        "no trademarks, no real people."
    )

    async def _once(p: str) -> bytes:
        raw = await asyncio.to_thread(
            _generate_sync,
            p,
            model=model,
            api_key=api_key,
        )
        if not raw or len(raw) < 32:
            raise RuntimeError("Gemini returned empty or tiny image bytes")
        return raw

    try:
        return await _once(text), "image/png", False
    except Exception as first_exc:
        retry_prompt = f"{text.rstrip()}{safe_suffix}".strip()
        if retry_prompt == text:
            logger.exception("Gemini generate failed: %s", first_exc)
            raise
        logger.warning(
            "Gemini image first attempt failed (%s); retrying with safety-tuned prompt",
            first_exc,
        )
        try:
            return await _once(retry_prompt), "image/png", False
        except Exception as exc:
            logger.exception("Gemini generate failed after retry: %s", exc)
            raise


async def refine_image_bytes(
    prompt: str,
    *,
    image_bytes: bytes,
    mime_type: str = "image/png",
) -> tuple[bytes, str, bool]:
    """Edit/refine an existing image with Gemini (bytes in / bytes out)."""
    settings = get_settings()
    api_key = str(settings.gemini_api_key or "").strip()
    model = str(settings.gemini_image_model or "gemini-3.1-flash-image-preview").strip()
    if not image_bytes:
        raise RuntimeError("No source image bytes for refine")
    if not api_key:
        if settings.gemini_image_allow_dev_stub:
            logger.warning(
                "GEMINI_API_KEY unset — returning input bytes unchanged (dev stub refine)"
            )
            return image_bytes, mime_type, True
        raise RuntimeError(IMAGE_GENERATION_NOT_CONFIGURED)
    try:
        parts = await asyncio.to_thread(
            _refine_sync,
            str(prompt or "").strip() or "Improve this marketing image",
            image_bytes=image_bytes,
            mime_type=mime_type or "image/png",
            model=model,
            api_key=api_key,
        )
        raw, out_mime = parts[0]
        if not raw or len(raw) < 32:
            raise RuntimeError("Gemini refine returned empty or tiny image bytes")
        return raw, out_mime or "image/png", False
    except Exception as exc:
        logger.exception("Gemini refine failed: %s", exc)
        raise


async def generate_and_upload_rebuild_url(
    prompt: str,
    *,
    token: str = "",
    upload_base: str | None = None,
) -> dict[str, str | bool]:
    """GeminiImageLLM.run: generate → scratch → /api/media → rebuild URL."""
    settings = get_settings()
    llm = GeminiImageLLM(token=token)
    used_stub = not bool(llm.api_key) and bool(settings.gemini_image_allow_dev_stub)
    url = await llm.run(prompt, upload_base=upload_base)
    from app.agents.image.media_upload import media_id_from_url

    return {
        "url": url,
        "media_id": media_id_from_url(url),
        "used_stub": used_stub,
    }


async def persist_local_copy(image_bytes: bytes, *, suffix: str = ".png") -> str:
    """Optional debug save under data_dir/generated_images (not for email/launch)."""
    return await asyncio.to_thread(
        _write_scratch, image_bytes, prefix="img", ext=suffix if suffix.startswith(".") else f".{suffix}"
    )


__all__ = [
    "IMAGE_GENERATION_NOT_CONFIGURED",
    "GeminiImageLLM",
    "generate_and_upload_rebuild_url",
    "generate_image_bytes",
    "local_path_to_rebuild_url",
    "persist_local_copy",
    "refine_image_bytes",
]
