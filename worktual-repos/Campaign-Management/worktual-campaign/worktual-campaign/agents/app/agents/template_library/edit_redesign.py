"""Edit-space redesign — reuse Template Generation Director on an existing template."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.agents.image.hero_image import fields_have_hero_image, primary_header_url_from_sections
from app.agents.image.template_attach import build_attach_fields
from app.config import get_settings

_log = logging.getLogger(__name__)


async def redesign_template_with_designer(
    *,
    channel: str,
    current_fields: dict[str, Any],
    instruction: str,
    campaign: dict[str, Any],
    audience: dict[str, Any] | None = None,
    knowledge: str = "",
    campaign_profile: dict[str, Any] | None = None,
    company_pack: dict[str, Any] | None = None,
    preserve_copy: bool = True,
    preserve_hero: bool = True,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Run director → channel agent against current fields for layout/design changes."""
    ch = str(channel or "").strip().lower()
    if not ch:
        return {"ok": False, "error": "channel is required"}
    brief = str(instruction or "").strip()
    if not brief:
        return {"ok": False, "error": "redesign instruction is required"}

    if not get_settings().template_director_enabled:
        return {
            "ok": False,
            "error": (
                "Template designer is not enabled on this environment. "
                "Use apply_template_changes for section tweaks."
            ),
        }

    from app.agents.template_generation_director.workflow import plan_generation
    from app.agents.template_library.creation_agent import (
        _merge_director_plans,
        _run_channel_agent,
    )

    camp = dict(campaign or {})
    aud = dict(audience or {})
    launch = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    prior = {
        "channel": ch,
        "fields": dict(current_fields or {}),
    }
    channel_plans = [
        {
            "channel": ch,
            "how_it_works": str(
                camp.get("goal") or camp.get("objective") or "Campaign template redesign"
            ).strip(),
            "suggested_launch_at": launch,
            "regenerate_layout": True,
            "preserve_content": bool(preserve_copy),
            "creative_policy": {
                "design_mode": "rewrite",
                "content_mode": "keep" if preserve_copy else "rewrite",
            },
        }
    ]
    user_request = (
        f"Redesign the existing {ch} template. User request: {brief}. "
        "Keep campaign facts accurate. Prefer a distinct layout that matches the ask "
        "(hero placement, section order, visual hierarchy). "
        + (
            "Preserve existing copy meaning where possible; change structure and design."
            if preserve_copy
            else "Rewrite copy as needed to fit the new design."
        )
    )

    if event_callback:
        await event_callback(
            {
                "type": "template_progress",
                "payload": {
                    "status": "designing",
                    "label": "Redesigning template layout…",
                    "channels": [ch],
                    "percent": 20,
                },
            }
        )

    try:
        _creative_brief, director_plans, report = await plan_generation(
            campaign=camp,
            audience=aud,
            channels=[ch],
            channel_plans=channel_plans,
            knowledge=knowledge or "",
            campaign_profile=campaign_profile,
            company_pack=company_pack,
            user_request=user_request,
            prior_templates=[prior],
            event_callback=event_callback,
            wants_images=False,
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("edit redesign plan_generation failed: %s", exc)
        return {"ok": False, "error": f"Designer could not plan the redesign: {exc}"}

    jobs = _merge_director_plans(channel_plans, director_plans)
    plan = jobs[0] if jobs else channel_plans[0]
    if isinstance(_creative_brief, dict):
        plan = {
            **plan,
            "creative_brief": {
                **(
                    plan.get("creative_brief")
                    if isinstance(plan.get("creative_brief"), dict)
                    else {}
                ),
                **_creative_brief,
            },
        }

    try:
        card = await _run_channel_agent(
            ch,
            plan,
            camp,
            aud,
            knowledge or "",
            prior_template=prior,
            prior_templates=[prior],
        )
    except Exception as exc:  # noqa: BLE001
        _log.warning("edit redesign channel agent failed: %s", exc)
        return {"ok": False, "error": f"Designer could not rebuild the template: {exc}"}

    fields = card.get("fields") if isinstance(card, dict) else None
    if not isinstance(fields, dict) or not fields:
        return {"ok": False, "error": "Designer returned empty fields."}

    # Keep the existing hero when redesign was about layout, not a new image.
    if preserve_hero and fields_have_hero_image(current_fields):
        prior_url = str(
            current_fields.get("header_image")
            or current_fields.get("image_url")
            or ""
        ).strip()
        if not prior_url:
            sections = current_fields.get("sections")
            if isinstance(sections, list):
                prior_url = primary_header_url_from_sections(sections) or ""
        if prior_url.startswith(("http://", "https://")) and not fields_have_hero_image(
            fields
        ):
            patch = build_attach_fields(fields, image_url=prior_url)
            if patch:
                fields = {**fields, **patch}

    return {
        "ok": True,
        "fields": fields,
        "design_plan": plan.get("design_plan") if isinstance(plan, dict) else {},
        "generation_report": report if isinstance(report, dict) else {},
        "note": "Template layout redesigned with the template designer.",
    }


__all__ = ["redesign_template_with_designer"]
