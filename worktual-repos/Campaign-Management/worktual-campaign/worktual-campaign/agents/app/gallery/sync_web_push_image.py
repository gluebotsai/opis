"""Sync web push gallery image from the sibling email hero — copy unchanged."""

from __future__ import annotations

from typing import Any

from app.agents.image.channel_image import build_attach_fields_for_channel
from app.agents.image.template_attach import attach_preserves_content
from app.gallery.preview_meta import build_library_preview_meta, preview_image_url


def _merge_attach_patch(
    existing: dict[str, Any],
    patch: dict[str, Any] | None,
) -> dict[str, Any]:
    if not patch:
        return dict(existing)
    return {**existing, **patch}


def sync_gallery_web_push_image_from_email(
    *,
    idea: dict[str, Any],
    web_fields: dict[str, Any],
    email_image_url: str,
    variant_index: int,
    existing_preview: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Attach the email hero URL to web push fields without changing copy."""
    url = str(email_image_url or "").strip()
    if not url.startswith("http"):
        return {"ok": False, "error": "missing_email_image_url"}

    patch = build_attach_fields_for_channel(web_fields, channel="web", image_url=url)
    if not patch:
        return {"ok": False, "error": "web_image_patch_failed"}

    merged = _merge_attach_patch(web_fields, patch)
    if not attach_preserves_content(web_fields, merged):
        return {"ok": False, "error": "Image sync would wipe web push copy"}

    title = str(idea.get("title") or "Campaign").strip()
    preview = build_library_preview_meta(
        fields=merged,
        primary_channel="web_push",
        agent_channel="web",
        has_image=True,
        variant_index=variant_index,
        idea_title=title,
        design_plan={
            "theme_id": (existing_preview or {}).get("visualKey"),
        },
    )

    return {
        "ok": True,
        "fields": merged,
        "preview_image": url,
        "preview": preview,
        "metadata_patch": {
            "hasImage": True,
            "galleryHeroAttached": True,
            "galleryImageSource": "email_hero_reuse",
        },
    }


def email_hero_url_from_row(
    fields: dict[str, Any] | None,
    preview_image: str | None = None,
) -> str | None:
    if preview_image and str(preview_image).strip().startswith("http"):
        return str(preview_image).strip()
    if isinstance(fields, dict):
        url = preview_image_url(fields, "email")
        if url:
            return url
    return None
