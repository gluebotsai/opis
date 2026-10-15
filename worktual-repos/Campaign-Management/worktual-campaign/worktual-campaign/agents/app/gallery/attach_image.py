"""Attach hero images to existing gallery email templates — copy unchanged."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.image.hero_image import fields_have_hero_image
from app.agents.image.template_attach import attach_preserves_content
from app.gallery.image_attach import attach_gallery_template_image
from app.gallery.preview_meta import build_library_preview_meta, preview_image_url

_log = logging.getLogger(__name__)


def _campaign_from_idea(org: dict[str, Any], idea: dict[str, Any]) -> dict[str, Any]:
    title = str(idea.get("title") or "Campaign").strip()
    summary = str(idea.get("summary") or "").strip()
    goal = str(idea.get("goal") or "Engagement").strip()
    return {
        "name": title,
        "goal": goal,
        "objective": summary or goal,
        "industry": str(org.get("pack_id") or org.get("industry") or ""),
    }


def _merge_attach_patch(
    existing: dict[str, Any],
    patch: dict[str, Any] | None,
) -> dict[str, Any]:
    if not patch:
        return dict(existing)
    return {**existing, **patch}


async def attach_gallery_email_image_only(
    *,
    org: dict[str, Any],
    idea: dict[str, Any],
    fields: dict[str, Any],
    variant_index: int,
    auth_token: str = "",
) -> dict[str, Any]:
    """Generate + attach hero image without changing template copy."""
    if fields_have_hero_image(fields):
        return {"ok": True, "skipped": True, "reason": "hero_already_attached"}

    campaign = _campaign_from_idea(org, idea)
    img = await attach_gallery_template_image(
        campaign=campaign,
        idea=idea,
        fields=fields,
        agent_channel="email",
        token=auth_token,
    )
    if img.get("skipped"):
        return {"ok": True, "skipped": True, "reason": "attach_skipped"}
    if not img.get("ok"):
        return {"ok": False, "error": str(img.get("error") or "Image attach failed")}

    patch = img.get("fields") if isinstance(img.get("fields"), dict) else {}
    merged = _merge_attach_patch(fields, patch)
    if not attach_preserves_content(fields, merged):
        return {"ok": False, "error": "Image attach would wipe template copy"}

    preview_image = str(img.get("image_url") or "").strip() or preview_image_url(
        merged, "email"
    )
    title = str(idea.get("title") or "Campaign").strip()
    preview = build_library_preview_meta(
        fields=merged,
        primary_channel="email",
        agent_channel="email",
        has_image=bool(preview_image),
        variant_index=variant_index,
        idea_title=title,
        design_plan={
            "pattern_id": merged.get("pattern_id"),
            "theme_id": merged.get("theme_id"),
        },
    )

    return {
        "ok": True,
        "fields": merged,
        "preview_image": preview_image,
        "preview": preview,
        "metadata_patch": {
            "hasImage": True,
            "galleryHeroAttached": True,
        },
    }
