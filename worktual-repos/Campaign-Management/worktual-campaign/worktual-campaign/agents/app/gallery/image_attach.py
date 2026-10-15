"""Gallery template images — same Gemini + upload stack as create-campaign."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.image.channel_image import (
    build_attach_fields_for_channel,
    channel_supports_image,
)
from app.agents.image.enhance import enhance_image_prompt, normalize_channel
from app.agents.image.media_upload import gallery_upload_api_base
from app.agents.image.meta_media_upload import upload_whatsapp_meta_media_handle

_log = logging.getLogger(__name__)


def _body_snippet(fields: dict[str, Any]) -> str:
    paras = fields.get("paragraphs")
    if isinstance(paras, list):
        for row in paras:
            text = str(row or "").strip()
            if text:
                return text[:480]
    sections = fields.get("sections")
    if isinstance(sections, list):
        for row in sections:
            if not isinstance(row, dict):
                continue
            content = str(row.get("content") or "").strip()
            if content:
                return content[:480]
    return str(fields.get("body") or fields.get("message") or "")[:480]


async def attach_gallery_template_image(
    *,
    campaign: dict[str, Any],
    idea: dict[str, Any],
    fields: dict[str, Any],
    agent_channel: str,
    token: str = "",
) -> dict[str, Any]:
    """Generate + attach one image to template fields (email / whatsapp)."""
    ch = normalize_channel(agent_channel)
    if not channel_supports_image(ch):
        return {"ok": True, "skipped": True, "fields": fields, "image_url": None}

    title = str(campaign.get("name") or idea.get("title") or "Campaign").strip()
    goal = str(campaign.get("goal") or idea.get("goal") or "Engagement").strip()
    summary = str(campaign.get("objective") or idea.get("summary") or "").strip()
    user_prompt = (
        f"Premium marketing hero for campaign: {title}. "
        f"Goal: {goal}. Theme: {summary or goal}. "
        f"Professional B2B, no text overlay, suitable for email header and WhatsApp media."
    )

    enhanced = await enhance_image_prompt(
        user_prompt,
        channel=ch,
        campaign_name=title,
        campaign_goal=goal,
        campaign_brief=summary,
        messaging_angle=summary,
        template_subject=str(fields.get("subject") or fields.get("title") or title),
        template_body_snippet=_body_snippet(fields),
    )
    if not enhanced.ok:
        return {
            "ok": False,
            "error": enhanced.error or "Image prompt enhancement failed",
            "fields": fields,
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
        _log.exception("gallery template image failed channel=%s", ch)
        return {"ok": False, "error": str(exc), "fields": fields}

    url = str(uploaded.get("url") or "").strip()
    if not url:
        return {"ok": False, "error": "Upload returned no URL", "fields": fields}

    from app.gallery.image_asset_registry import register_gallery_image

    await register_gallery_image(
        image_url=url,
        token=token,
        media_id=str(uploaded.get("media_id") or ""),
        source="ai_generated",
        generation_prompt=enhanced.enhanced_prompt,
        channel=ch,
        context={
            "origin": "gallery_template_attach",
            "campaign_name": title,
            "idea_title": str(idea.get("title") or ""),
        },
    )

    patched = build_attach_fields_for_channel(fields, channel=ch, image_url=url)
    if patched:
        out_fields = {**fields, **patched}
    else:
        out_fields = dict(fields)

    if ch == "whatsapp":
        try:
            meta_up = await upload_whatsapp_meta_media_handle(
                image_url=url,
                token=token,
            )
            if meta_up.get("ok") and meta_up.get("handle"):
                out_fields["header_media_handle"] = meta_up["handle"]
        except Exception as exc:  # noqa: BLE001
            _log.warning("WhatsApp meta media upload skipped: %s", exc)

    return {
        "ok": True,
        "fields": out_fields,
        "image_url": url,
        "used_stub": used_stub,
    }
