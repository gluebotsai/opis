"""Generate one Template Gallery row via shared create-campaign channel agents."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.agents.template_library.creation_agent import (
    _ensure_whatsapp_meta_name,
    _run_channel_agent,
)
from app.agents.template_library.channels.whatsapp.meta_rules import (
    sanitize_whatsapp_fields,
)
from app.agents.image.channel_image import build_attach_fields_for_channel
from app.config import get_settings
from app.gallery.image_attach import attach_gallery_template_image
from app.gallery.preview_meta import build_library_preview_meta, preview_image_url
from app.gallery.template_plan import (
    build_gallery_channel_plan,
    build_gallery_content_plan,
)
from app.knowledge_base import fetch_campaign_knowledge

_log = logging.getLogger(__name__)

_GALLERY_EMAIL_DESIGN_VERSION = "gallery-email-v2"

_GALLERY_PRIMARY_CHANNELS = {
    "email": "email",
    "whatsapp": "whatsapp",
    "web_push": "web_push",
    "web": "web_push",
    "push": "app_push",
    "app_push": "app_push",
}


def _email_fields_from_prior(
    prior: list[dict[str, Any]],
    idea_key: str = "",
) -> dict[str, Any] | None:
    for row in prior:
        if str(row.get("channel") or "").strip().lower() != "email":
            continue
        gk = str(row.get("gallery_key") or "").strip()
        if idea_key and gk and not gk.startswith(f"{idea_key}:"):
            continue
        fields = row.get("fields")
        if isinstance(fields, dict) and fields:
            return fields
    return None


def _email_image_url_from_spec_or_prior(
    spec: dict[str, Any],
    prior: list[dict[str, Any]],
    idea_key: str = "",
) -> str | None:
    explicit = str(spec.get("email_image_url") or "").strip()
    if explicit.startswith("http"):
        return explicit
    email_fields = _email_fields_from_prior(prior, idea_key)
    if email_fields:
        url = preview_image_url(email_fields, "email")
        if url:
            return url
    return None


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


async def generate_gallery_library_template(
    *,
    org: dict[str, Any],
    idea: dict[str, Any],
    spec: dict[str, Any],
    auth_token: str = "",
    prior_templates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    One template for one campaign idea + one channel.
    Email: Template Director design with rotated patterns. No images in gallery phase.
    """
    gallery_key = str(spec.get("gallery_key") or "").strip()
    agent_channel = str(spec.get("channel") or "email").strip().lower()
    primary_channel = str(
        spec.get("primary_channel")
        or _GALLERY_PRIMARY_CHANNELS.get(agent_channel)
        or "email"
    ).strip()
    has_image = bool(spec.get("has_image"))
    variant_index = int(spec.get("variant_index") or 1)
    prior = prior_templates or []
    idea_key = str(idea.get("idea_key") or "").strip()

    title = str(idea.get("title") or "Campaign").strip()
    summary = str(idea.get("summary") or "").strip()
    goal = str(idea.get("goal") or "Engagement").strip()
    campaign = _campaign_from_idea(org, idea)
    audience: dict[str, Any] = {}

    knowledge = await fetch_campaign_knowledge(
        campaign,
        organization_id=str(org.get("organization_id") or org.get("organizationId") or ""),
    )

    design_plan: dict[str, Any] | None = None
    if agent_channel == "email" and get_settings().template_director_enabled:
        plan = await build_gallery_channel_plan(
            org=org,
            idea=idea,
            spec=spec,
            agent_channel=agent_channel,
            has_image=has_image,
            image_url=None,
            prior_templates=prior,
        )
        design_plan = (
            plan.get("design_plan")
            if isinstance(plan.get("design_plan"), dict)
            else None
        )
    else:
        plan = build_gallery_content_plan(
            idea=idea,
            spec=spec,
            agent_channel=agent_channel,
            has_image=has_image,
        )
        if agent_channel == "web":
            email_fields = _email_fields_from_prior(prior, idea_key)
            if email_fields:
                brief = plan.get("creative_brief")
                if isinstance(brief, dict):
                    brief = {
                        **brief,
                        "email_subject": str(
                            email_fields.get("subject") or email_fields.get("title") or ""
                        ).strip(),
                        "email_body_snippet": str(
                            email_fields.get("body") or ""
                        ).strip()[:480],
                        "same_campaign_idea": True,
                    }
                    plan["creative_brief"] = brief

    template = await _run_channel_agent(
        agent_channel,
        plan,
        campaign,
        audience,
        knowledge=knowledge,
        prior_template=None,
        prior_templates=prior,
    )

    fields = template.get("fields") if isinstance(template.get("fields"), dict) else {}
    if agent_channel == "whatsapp":
        from app.agents.template_library.channels.whatsapp.meta_rules import (
            collect_whatsapp_meta_names,
        )

        taken = collect_whatsapp_meta_names(prior)
        fields = _ensure_whatsapp_meta_name(fields, campaign, taken_names=taken)
        fields = sanitize_whatsapp_fields(fields, campaign=campaign)
        template["fields"] = fields

    preview_image: str | None = None
    if has_image and agent_channel == "web":
        email_image_url = _email_image_url_from_spec_or_prior(spec, prior, idea_key)
        if email_image_url:
            patch = build_attach_fields_for_channel(
                fields,
                channel="web",
                image_url=email_image_url,
            )
            if patch:
                fields = {**fields, **patch}
                preview_image = email_image_url

    if has_image and agent_channel == "email":
        img = await attach_gallery_template_image(
            campaign=campaign,
            idea=idea,
            fields=fields,
            agent_channel=agent_channel,
            token=auth_token,
        )
        if img.get("ok") and isinstance(img.get("fields"), dict):
            patch = img["fields"]
            fields = {**fields, **patch}
            preview_image = str(img.get("image_url") or "").strip() or None
        elif not img.get("skipped"):
            _log.warning(
                "Gallery image attach failed key=%s channel=%s: %s",
                gallery_key,
                agent_channel,
                img.get("error"),
            )

    if not preview_image:
        preview_image = preview_image_url(fields, agent_channel)

    has_visual = bool(preview_image) and (
        has_image or agent_channel == "web"
    )
    preview = build_library_preview_meta(
        fields=fields,
        primary_channel=primary_channel,
        agent_channel=agent_channel,
        has_image=has_visual,
        variant_index=variant_index,
        idea_title=title,
        design_plan=design_plan,
    )

    subject = str(fields.get("subject") or fields.get("title") or title).strip()
    body_text = str(
        fields.get("body")
        or fields.get("message")
        or fields.get("text")
        or preview.get("body")
        or summary
    ).strip()

    return {
        "ok": True,
        "template": {
            "gallery_key": gallery_key,
            "name": subject[:200] or title[:200],
            "description": summary[:2000],
            "goal": goal,
            "primary_channel": primary_channel,
            "body_preview": body_text[:4000],
            "content_body": body_text[:100_000],
            "preview_image": preview_image,
            "preview": preview,
            "fields": fields,
            "metadata": {
                "galleryStatus": "active",
                "campaignIdeaKey": str(idea.get("idea_key") or ""),
                "campaignIdeaTitle": title,
                "templateType": f"gallery_{agent_channel}",
                "hasImage": has_visual,
                "galleryHeroAttached": has_visual,
                "galleryImageSource": (
                    "email_hero_reuse"
                    if agent_channel == "web" and preview_image
                    else None
                ),
                "variantIndex": variant_index,
                "generationBatchId": str(uuid.uuid4()),
                "directorPipeline": agent_channel == "email",
                "galleryEmailDesignVersion": _GALLERY_EMAIL_DESIGN_VERSION,
                "patternId": str(
                    fields.get("pattern_id")
                    or (design_plan.get("pattern_id") if design_plan else "")
                    or ""
                ),
                "themeId": str(
                    fields.get("theme_id")
                    or (design_plan.get("theme_id") if design_plan else "")
                    or ""
                ),
            },
        },
    }
