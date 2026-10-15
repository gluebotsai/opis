"""Generate one hero image per gallery campaign idea (shared across channels)."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.image.enhance import enhance_image_prompt
from app.agents.image.media_upload import gallery_upload_api_base

_log = logging.getLogger(__name__)


def _default_gallery_image_prompt(
    *,
    title: str,
    summary: str,
    goal: str,
    company_name: str,
    industry_type: str,
) -> str:
    return (
        f"Premium marketing hero image for campaign idea: {title}. "
        f"Company: {company_name}. Industry: {industry_type or 'general'}. "
        f"Theme: {summary or goal}. Clean, professional, no text overlay, "
        f"16:9 friendly crop, suitable for email header and push thumbnail."
    )


async def generate_gallery_idea_image(
    *,
    idea: dict[str, Any],
    org: dict[str, Any],
    token: str = "",
) -> dict[str, Any]:
    """One Gemini image per idea — reused by all :img: variants and visual channels."""
    title = str(idea.get("title") or "Campaign").strip()
    summary = str(idea.get("summary") or "").strip()
    goal = str(idea.get("goal") or "Engagement").strip()
    company_name = str(org.get("company_name") or "Company").strip()
    industry_type = str(org.get("industry_type") or org.get("industry") or "").strip()

    user_prompt = _default_gallery_image_prompt(
        title=title,
        summary=summary,
        goal=goal,
        company_name=company_name,
        industry_type=industry_type,
    )
    enhanced = await enhance_image_prompt(
        user_prompt,
        channel="email",
        campaign_name=title,
        campaign_goal=goal,
        campaign_brief=summary,
        messaging_angle=summary,
    )
    if not enhanced.ok:
        return {
            "ok": False,
            "error": enhanced.error or "Image prompt enhancement failed",
            "refused": enhanced.refused,
        }

    try:
        from app.integrations.gemini_image import generate_and_upload_rebuild_url

        result = await generate_and_upload_rebuild_url(
            enhanced.enhanced_prompt,
            token=token,
            upload_base=gallery_upload_api_base(),
        )
        uploaded = {
            "url": str(result.get("url") or "").strip(),
            "media_id": str(result.get("media_id") or "").strip(),
        }
        used_stub = bool(result.get("used_stub"))
    except Exception as exc:  # noqa: BLE001
        _log.exception("gallery idea image generation failed idea=%s", title)
        return {"ok": False, "error": str(exc)}

    url = str(uploaded.get("url") or "").strip()
    if not url:
        return {"ok": False, "error": "Image upload returned no URL"}

    from app.gallery.image_asset_registry import register_gallery_image

    await register_gallery_image(
        image_url=url,
        token=token,
        media_id=str(uploaded.get("media_id") or ""),
        source="ai_generated",
        generation_prompt=enhanced.enhanced_prompt,
        context={
            "origin": "gallery_idea_hero",
            "idea_key": str(idea.get("idea_key") or ""),
            "idea_title": title,
        },
    )

    return {
        "ok": True,
        "image_url": url,
        "image_meta": {
            "source": "gallery_idea_hero",
            "used_stub": used_stub,
            "enhanced_prompt": enhanced.enhanced_prompt[:4000],
            "idea_key": str(idea.get("idea_key") or ""),
        },
    }
