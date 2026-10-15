"""Generate and attach multiple email section images from Director slot specs."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.image.campaign_image_context import build_campaign_image_context
from app.agents.image.enhance import enhance_image_prompt, strip_merge_tags, visual_alignment_copy
from app.agents.image.hero_image import (
    list_unfilled_image_section_indices,
    normalize_image_slot_specs,
    section_image_url,
)
from app.agents.image.template_attach import attach_preserves_content, build_attach_fields
from app.template_store import get_template, update_template_fields

logger = logging.getLogger(__name__)


def _email_design_plan(session: dict[str, Any]) -> dict[str, Any]:
    plans = session.get("template_design_plans")
    if not isinstance(plans, list):
        return {}
    for row in plans:
        if not isinstance(row, dict):
            continue
        if str(row.get("channel") or "").strip().lower() == "email":
            return row
    if plans and isinstance(plans[0], dict):
        return plans[0]
    return {}


def _slot_user_prompt(
    ctx: dict[str, str],
    spec: dict[str, Any],
    *,
    slot_index: int,
) -> str:
    role = str(spec.get("role") or "visual").strip()
    hint = strip_merge_tags(str(spec.get("subject_hint") or ""))
    aspect = str(spec.get("aspect_ratio") or "16:9").strip()
    parts = [
        f"Photoreal campaign visual for email slot {slot_index + 1} ({role}).",
        f"Aspect ratio {aspect}.",
        "No text, letters, numbers, signs, screens, or posters in the image.",
    ]
    if hint:
        parts.append(hint)
    name = visual_alignment_copy(str(ctx.get("campaign_name") or ""), max_len=80)
    if name:
        parts.append(f"Brand: {name}.")
    return " ".join(parts)


async def fill_missing_email_image_sections(
    session: dict[str, Any],
    *,
    token: str,
    template_id: str | None = None,
) -> dict[str, Any]:
    """
    For each unfilled image section on the email template, enhance → generate → attach
    at that section index only (supports multi-product / hero + product layouts).
    """
    tid_map = session.get("template_ids_by_channel") or {}
    tid = str(
        template_id
        or tid_map.get("email")
        or ""
    ).strip()
    if not tid:
        return {"ok": False, "error": "No email template_id on session."}

    detail = await get_template(tid, token=token or None)
    tpl = detail.get("template") if isinstance(detail, dict) else {}
    fields = tpl.get("fields") if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict) else {}
    if not fields:
        return {"ok": False, "error": "Email template has no fields."}

    pending = list_unfilled_image_section_indices(fields)
    if not pending:
        return {"ok": True, "skipped": True, "reason": "All image sections already filled."}

    from app.agents.image.plan import get_image_plan

    if not get_image_plan(session).get("wants_images"):
        return {
            "ok": True,
            "skipped": True,
            "reason": "Image plan does not require generation.",
        }

    design = _email_design_plan(session)
    specs = normalize_image_slot_specs(design.get("image_slot_specs"))
    while len(specs) < len(pending):
        specs.append(
            specs[-1]
            if specs
            else {
                "role": "visual",
                "aspect_ratio": "16:9",
                "display": "full_width",
                "subject_hint": "",
            }
        )

    ctx = build_campaign_image_context(session, channel="email", template_fields=fields)
    ui_events: list[dict[str, Any]] = []
    filled = 0
    working = dict(fields)

    from app.agents.image.user_assets import preferred_urls_by_channel

    preferred_email = preferred_urls_by_channel(
        session, channels=["email"], mode="shared"
    ).get("email")

    for slot_i, section_idx in enumerate(pending):
        spec = specs[slot_i] if slot_i < len(specs) else specs[-1]
        url = ""
        used_stub = False
        # Prefer confirmed chat/gallery upload for the first empty slot.
        if preferred_email and slot_i == 0:
            url = preferred_email
        if not url:
            prompt = _slot_user_prompt(ctx, spec, slot_index=slot_i)
            enhance_kwargs = {
                k: v
                for k, v in {
                    "channel": "email",
                    "aspect_hint": spec.get("aspect_ratio"),
                    "campaign_name": ctx.get("campaign_name"),
                    "campaign_goal": ctx.get("campaign_goal"),
                    "campaign_brief": ctx.get("campaign_brief"),
                    "style_hint": str(spec.get("display") or ""),
                }.items()
                if v
            }
            enhanced_result = await enhance_image_prompt(prompt, **enhance_kwargs)
            if not enhanced_result.ok:
                logger.warning(
                    "Email slot %s enhance failed: %s",
                    slot_i,
                    enhanced_result.error,
                )
                continue
            try:
                from app.integrations.gemini_image import generate_and_upload_rebuild_url

                result = await generate_and_upload_rebuild_url(
                    enhanced_result.enhanced_prompt, token=token
                )
                url = str(result.get("url") or "").strip()
                used_stub = bool(result.get("used_stub"))
            except Exception as exc:
                logger.exception("Email slot %s generate failed", slot_i)
                continue
            if not url:
                continue
        patch = build_attach_fields(
            working,
            image_url=url,
            field_key="header_image",
            only_section_index=section_idx,
        )
        merged = {**working, **patch}
        if not attach_preserves_content(working, merged):
            continue
        out = await update_template_fields(tid, merged, token=token or None)
        if isinstance(out, dict):
            tpl_out = out.get("template")
            if isinstance(tpl_out, dict) and isinstance(tpl_out.get("fields"), dict):
                working = tpl_out["fields"]
            else:
                working = merged
        else:
            working = merged
        filled += 1
        ui_events.append(
            {
                "type": "template_image_attached",
                "template_id": tid,
                "channel": "email",
                "field_key": "header_image",
                "image_url": url,
                "fields": working,
                "section_index": section_idx,
            }
        )
        ctx = build_campaign_image_context(
            session, channel="email", template_fields=working
        )

    if filled <= 0:
        return {
            "ok": False,
            "error": "Could not fill any email image sections.",
            "pending_sections": pending,
        }
    return {
        "ok": True,
        "filled_count": filled,
        "template_id": tid,
        "ui_events": ui_events,
        "fields": working,
    }


def email_template_needs_slot_fill(session: dict[str, Any]) -> bool:
    templates = session.get("templates") or []
    for row in templates:
        if not isinstance(row, dict):
            continue
        if str(row.get("channel") or "").strip().lower() != "email":
            continue
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        if list_unfilled_image_section_indices(fields):
            return True
    design = _email_design_plan(session)
    if design.get("image_slot_specs") and not fields_have_any_image(fields):
        return True
    return False


def fields_have_any_image(fields: dict[str, Any]) -> bool:
    if not isinstance(fields, dict):
        return False
    for row in fields.get("sections") or []:
        if isinstance(row, dict) and section_image_url(row):
            return True
    return False


__all__ = [
    "email_template_needs_slot_fill",
    "fill_missing_email_image_sections",
]
