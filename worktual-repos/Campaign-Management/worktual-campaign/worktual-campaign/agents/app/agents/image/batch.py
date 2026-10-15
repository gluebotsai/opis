"""Batch generate + attach campaign images across channels."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.image.campaign_image_context import (
    build_campaign_image_context,
    default_image_user_prompt,
)
from app.agents.image.channel_image import (
    attach_spec_for_channel,
    build_attach_fields_for_channel,
    channel_supports_image,
    template_ids_by_channel,
)
from app.agents.image.enhance import enhance_image_prompt, normalize_channel
from app.agents.image.meta_media_upload import upload_whatsapp_meta_media_handle
from app.agents.image.plan import (
    get_image_plan,
    images_by_channel_slot,
    mark_plan_status,
    set_images_by_channel,
)
from app.agents.image.template_attach import attach_preserves_content
from app.mas.runtime.task_memory import get_mas_task
from app.template_store import get_template, update_template_fields

logger = logging.getLogger(__name__)


def _image_slots(session: dict[str, Any]) -> dict[str, Any]:
    task = get_mas_task(session)
    slots = task.setdefault("slots", {})
    if not isinstance(slots.get("image"), dict):
        slots["image"] = {}
    return slots["image"]


async def _enhance_and_generate_for_channel(
    session: dict[str, Any],
    *,
    channel: str,
    token: str,
    user_prompt: str = "",
) -> dict[str, Any]:
    ch = normalize_channel(channel)
    ctx = build_campaign_image_context(session, channel=ch)
    prompt = str(user_prompt or "").strip() or default_image_user_prompt(ctx)
    enhance_kwargs = {
        k: v
        for k, v in {
            "channel": ch,
            "campaign_name": ctx.get("campaign_name"),
            "campaign_goal": ctx.get("campaign_goal"),
            "campaign_brief": ctx.get("campaign_brief"),
            "messaging_angle": ctx.get("messaging_angle"),
            "template_subject": ctx.get("template_subject"),
            "template_body_snippet": ctx.get("template_body_snippet"),
        }.items()
        if v
    }
    enhanced_result = await enhance_image_prompt(prompt, **enhance_kwargs)
    if not enhanced_result.ok:
        return {
            "ok": False,
            "channel": ch,
            "error": enhanced_result.error or "Enhance failed",
            "refused": enhanced_result.refused,
        }
    enhanced = enhanced_result.enhanced_prompt
    slots = _image_slots(session)
    slots["last_enhanced_prompt"] = enhanced
    slots["last_user_prompt"] = prompt
    try:
        from app.integrations.gemini_image import generate_and_upload_rebuild_url

        result = await generate_and_upload_rebuild_url(enhanced, token=token)
        url = str(result.get("url") or "").strip()
        used_stub = bool(result.get("used_stub"))
        uploaded = {
            "url": url,
            "media_id": str(result.get("media_id") or "").strip(),
        }
    except Exception as exc:
        logger.exception("Batch image generate failed channel=%s", ch)
        return {"ok": False, "channel": ch, "error": str(exc)}
    url = str(uploaded.get("url") or "").strip()
    if not url:
        return {"ok": False, "channel": ch, "error": "Upload returned no URL"}
    from app.gallery.image_asset_registry import register_gallery_image

    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    await register_gallery_image(
        image_url=url,
        token=token,
        media_id=str(uploaded.get("media_id") or ""),
        source="ai_generated",
        generation_prompt=enhanced,
        channel=ch,
        context={
            "origin": "campaign_image_batch",
            "campaign_name": str(campaign.get("name") or ""),
        },
    )
    return {
        "ok": True,
        "channel": ch,
        "image_url": url,
        "used_stub": used_stub,
        "enhanced_prompt": enhanced,
    }


async def generate_campaign_images(
    session: dict[str, Any],
    *,
    token: str,
    channels: list[str] | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    plan = get_image_plan(session)
    if not plan.get("wants_images"):
        return {"ok": False, "error": "Image plan has wants_images=false ? call PLAN_CAMPAIGN_IMAGES first."}
    target_channels = normalize_channel_list(channels) if channels else list(plan.get("channels") or [])
    target_channels = [ch for ch in target_channels if channel_supports_image(ch)]
    if not target_channels:
        return {"ok": False, "error": "No image-capable channels in plan."}

    mode_norm = str(mode or plan.get("mode") or "shared").strip().lower()
    if mode_norm not in ("shared", "per_channel"):
        mode_norm = "shared"

    generated: dict[str, str] = {}
    details: list[dict[str, Any]] = []
    ui_events: list[dict[str, Any]] = []

    from app.agents.image.user_assets import preferred_urls_by_channel

    preferred = preferred_urls_by_channel(
        session, channels=target_channels, mode=mode_norm
    )
    if preferred:
        for ch, url in preferred.items():
            generated[ch] = url
            details.append(
                {
                    "ok": True,
                    "channel": ch,
                    "image_url": url,
                    "source": "user_or_gallery",
                    "skipped_ai": True,
                }
            )
        ui_events.append(
            {
                "type": "image_generated",
                "image_url": next(iter(preferred.values())),
                "channels": list(preferred.keys()),
                "mode": mode_norm,
                "source": "user_or_gallery",
            }
        )
        # Fill any planned channels still missing via AI.
        missing = [ch for ch in target_channels if ch not in generated]
        target_channels = missing

    if not generated and not target_channels:
        mark_plan_status(session, "generate_failed")
        return {"ok": False, "error": "No images available", "details": details}

    if target_channels and mode_norm == "shared" and not generated:
        primary = target_channels[0]
        one = await _enhance_and_generate_for_channel(session, channel=primary, token=token)
        details.append(one)
        if not one.get("ok"):
            mark_plan_status(session, "generate_failed")
            return {
                "ok": False,
                "error": one.get("error") or "Shared image generation failed",
                "details": details,
            }
        shared_url = str(one.get("image_url") or "")
        plan_recipients = [
            normalize_channel(str(c))
            for c in (plan.get("channels") or [])
            if channel_supports_image(normalize_channel(str(c)))
        ]
        recipients = list(dict.fromkeys(list(target_channels) + plan_recipients))
        for ch in recipients:
            generated[ch] = shared_url
        ui_events.append(
            {
                "type": "image_generated",
                "image_url": shared_url,
                "channels": recipients,
                "mode": "shared",
            }
        )
    elif target_channels:
        for ch in target_channels:
            if ch in generated:
                continue
            one = await _enhance_and_generate_for_channel(session, channel=ch, token=token)
            details.append(one)
            if one.get("ok") and one.get("image_url"):
                generated[ch] = str(one["image_url"])
                ui_events.append(
                    {
                        "type": "image_generated",
                        "image_url": one["image_url"],
                        "channel": ch,
                        "mode": "per_channel",
                    }
                )
        # Shared mode with partial preferred: propagate first AI or preferred to rest.
        if mode_norm == "shared" and generated:
            shared_url = next(iter(generated.values()))
            for ch in list(plan.get("channels") or []) or list(generated.keys()):
                ch_n = normalize_channel(str(ch))
                if channel_supports_image(ch_n):
                    generated.setdefault(ch_n, shared_url)

    if not generated:
        mark_plan_status(session, "generate_failed")
        return {"ok": False, "error": "No images generated", "details": details}

    set_images_by_channel(session, generated)
    slots = _image_slots(session)
    slots["last_image_url"] = next(iter(generated.values()))
    mark_plan_status(session, "generated")
    return {
        "ok": True,
        "mode": mode_norm,
        "channels": list(generated.keys()),
        "images_by_channel": generated,
        "details": details,
        "ui_events": ui_events,
        "change_summary": f"Generated images for {', '.join(generated.keys())} ({mode_norm}).",
    }


async def attach_campaign_images(
    session: dict[str, Any],
    *,
    token: str,
    channels: list[str] | None = None,
    images_by_channel: dict[str, str] | None = None,
    generation_batch_id: str | None = None,
) -> dict[str, Any]:
    plan = get_image_plan(session)
    mapping = dict(images_by_channel or images_by_channel_slot(session))
    if not mapping:
        shared = str(_image_slots(session).get("last_image_url") or "").strip()
        if shared:
            for ch in plan.get("channels") or []:
                mapping[str(ch)] = shared

    tid_map = template_ids_by_channel(session)
    batch_id = str(generation_batch_id or "").strip()
    allowed_ids: set[str] | None = None
    if batch_id:
        allowed_ids = {
            str(row.get("template_id") or "").strip()
            for row in (session.get("templates") or [])
            if isinstance(row, dict)
            and str(row.get("generation_batch_id") or "").strip() == batch_id
            and str(row.get("template_id") or "").strip()
        }
        if not allowed_ids:
            # UUID vs numeric batch must not disable the guard and write
            # to template_ids_by_channel (often the previous email).
            latest_by_ch: dict[str, str] = {}
            for row in session.get("templates") or []:
                if not isinstance(row, dict):
                    continue
                ch = str(row.get("channel") or "").strip().lower()
                tid = str(row.get("template_id") or "").strip()
                if ch and tid:
                    latest_by_ch[ch] = tid
            allowed_ids = {v for v in latest_by_ch.values() if v}
    target = normalize_channel_list(channels) if channels else list(mapping.keys())
    if not target and plan.get("channels"):
        target = list(plan.get("channels") or [])

    results: list[dict[str, Any]] = []
    ui_events: list[dict[str, Any]] = []
    ok_count = 0

    for ch in target:
        ch_norm = normalize_channel(ch)
        if not channel_supports_image(ch_norm):
            results.append(
                {
                    "ok": False,
                    "channel": ch_norm,
                    "skipped": True,
                    "reason": "Channel has no template image slot",
                }
            )
            continue
        tid = str(tid_map.get(ch_norm) or "").strip()
        if allowed_ids is not None and tid and tid not in allowed_ids:
            batch_tid = next(
                (
                    str(row.get("template_id") or "").strip()
                    for row in (session.get("templates") or [])
                    if isinstance(row, dict)
                    and str(row.get("channel") or "").strip().lower() == ch_norm
                    and str(row.get("template_id") or "").strip() in allowed_ids
                ),
                "",
            )
            tid = batch_tid
        if not tid:
            results.append(
                {
                    "ok": False,
                    "channel": ch_norm,
                    "error": "No template_id for channel ? run build_campaign first",
                }
            )
            continue
        url = str(mapping.get(ch_norm) or mapping.get(ch) or "").strip()
        if not url:
            results.append(
                {"ok": False, "channel": ch_norm, "error": "No image URL for channel"}
            )
            continue
        try:
            tpl_resp = await get_template(tid, token=token or None)
            tpl = tpl_resp.get("template") if isinstance(tpl_resp, dict) else {}
            existing = (
                tpl.get("fields")
                if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict)
                else {}
            )
            from app.agents.image.hero_image import (
                fields_have_hero_image,
                list_unfilled_image_section_indices,
            )

            if ch_norm == "email":
                pending = list_unfilled_image_section_indices(existing)
                # Empty pending means either all image slots filled OR no image
                # sections at all. Only skip when a real hero URL is already present.
                if not pending and fields_have_hero_image(existing):
                    ok_count += 1
                    results.append(
                        {
                            "ok": True,
                            "channel": ch_norm,
                            "template_id": tid,
                            "skipped": True,
                            "reason": "All email image sections filled",
                        }
                    )
                    continue
            elif fields_have_hero_image(existing):
                ok_count += 1
                results.append(
                    {
                        "ok": True,
                        "channel": ch_norm,
                        "template_id": tid,
                        "skipped": True,
                        "reason": "Hero image already attached",
                    }
                )
                continue
            fields = build_attach_fields_for_channel(
                existing, channel=ch_norm, image_url=url
            )
            if not fields:
                results.append(
                    {
                        "ok": False,
                        "channel": ch_norm,
                        "skipped": True,
                        "reason": "Unsupported channel for attach",
                    }
                )
                continue
            if ch_norm == "whatsapp":
                meta_up = await upload_whatsapp_meta_media_handle(
                    image_url=url,
                    token=token or "",
                )
                if meta_up.get("handle"):
                    fields["header_media_handle"] = meta_up["handle"]
                    try:
                        from app.agents.template_library.channels.whatsapp.meta_rules import (
                            build_meta_submit_components,
                        )

                        meta = build_meta_submit_components({**existing, **fields})
                        fields["components"] = meta["components"]
                    except Exception as exc:
                        logger.warning(
                            "Could not build Meta components after media upload: %s",
                            exc,
                        )
                elif meta_up.get("error"):
                    logger.warning(
                        "WhatsApp Meta media upload skipped for %s: %s",
                        tid,
                        meta_up.get("error"),
                    )
            attach_spec = attach_spec_for_channel(ch_norm) or {}
            field_key = str(attach_spec.get("field_key") or "header_image")
            out = await update_template_fields(tid, fields, token=token or None)
            merged = {}
            if isinstance(out, dict):
                tpl_out = out.get("template")
                if isinstance(tpl_out, dict) and isinstance(tpl_out.get("fields"), dict):
                    merged = tpl_out["fields"]
            if merged and not attach_preserves_content(existing, merged):
                results.append(
                    {
                        "ok": False,
                        "channel": ch_norm,
                        "template_id": tid,
                        "error": "Attach would wipe template copy",
                    }
                )
                continue
            ok_count += 1
            results.append(
                {
                    "ok": True,
                    "channel": ch_norm,
                    "template_id": tid,
                    "field_key": field_key,
                    "image_url": url,
                }
            )
            ui_events.append(
                {
                    "type": "template_image_attached",
                    "template_id": tid,
                    "channel": ch_norm,
                    "field_key": field_key,
                    "image_url": url,
                    "fields": merged or fields,
                }
            )
        except Exception as exc:
            logger.exception("Attach failed channel=%s template=%s", ch_norm, tid)
            results.append(
                {"ok": False, "channel": ch_norm, "template_id": tid, "error": str(exc)}
            )

    if ok_count <= 0:
        mark_plan_status(session, "attach_failed")
        return {
            "ok": False,
            "error": "No templates updated",
            "results": results,
            "ui_events": ui_events,
        }

    from app.agents.image.plan import _channel_still_needs_images

    still_pending = any(
        _channel_still_needs_images(session, str(ch))
        for ch in (get_image_plan(session).get("channels") or [])
    )
    mark_plan_status(session, "partial" if still_pending else "attached")
    _image_slots(session)["attached_channels"] = [
        r["channel"] for r in results if r.get("ok")
    ]
    return {
        "ok": True,
        "attached_count": ok_count,
        "results": results,
        "ui_events": ui_events,
        "change_summary": f"Attached images to {ok_count} template(s).",
    }


async def run_campaign_image_pipeline(
    session: dict[str, Any],
    *,
    token: str,
    generation_batch_id: str | None = None,
) -> dict[str, Any]:
    from app.agents.image.hero_image import list_unfilled_image_section_indices
    from app.agents.image.plan import _fields_for_channel, get_image_plan
    from app.agents.image.user_assets import sync_image_plan_for_confirmed_uploads

    sync_image_plan_for_confirmed_uploads(session)

    plan = get_image_plan(session)
    plan_channels = [
        normalize_channel(str(ch)) for ch in (plan.get("channels") or []) if str(ch).strip()
    ]
    email_fields = _fields_for_channel(session, "email")
    email_pending = list_unfilled_image_section_indices(email_fields)
    # Email with empty image sections goes through batch attach (inserts hero).
    # Email with unfilled placeholders uses slot_fill instead.
    batch_channels = [
        ch for ch in plan_channels if ch != "email" or not email_pending
    ]

    gen: dict[str, Any] = {"ok": True, "skipped": True, "ui_events": []}
    att: dict[str, Any] = {"ok": True, "skipped": True, "ui_events": []}
    if batch_channels:
        gen = await generate_campaign_images(session, token=token, channels=batch_channels)
        if not gen.get("ok"):
            return gen
        att = await attach_campaign_images(
            session,
            token=token,
            images_by_channel=gen.get("images_by_channel"),
            channels=batch_channels,
            generation_batch_id=generation_batch_id,
        )

    slot_fill: dict[str, Any] | None = None
    if email_pending:
        try:
            from app.agents.image.email_slot_images import fill_missing_email_image_sections

            slot_fill = await fill_missing_email_image_sections(session, token=token)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Email multi-slot image fill skipped: %s", exc)

    ok = bool(att.get("ok")) or bool(slot_fill and slot_fill.get("ok")) or bool(
        gen.get("skipped") and slot_fill and slot_fill.get("ok")
    )
    if not batch_channels and not email_pending:
        return {"ok": False, "error": "No image slots need generation."}
    extra_events: list[dict[str, Any]] = []
    if isinstance(slot_fill, dict):
        extra_events = list(slot_fill.get("ui_events") or [])
    combined_events = list(gen.get("ui_events") or []) + list(att.get("ui_events") or []) + extra_events
    from app.agents.image.plan import _channel_still_needs_images, mark_plan_status

    still_pending = any(
        _channel_still_needs_images(session, str(ch))
        for ch in (get_image_plan(session).get("channels") or [])
    )
    if ok and not still_pending:
        mark_plan_status(session, "attached")
    elif ok and still_pending:
        mark_plan_status(session, "partial")
    return {
        "ok": ok,
        "generate": gen,
        "attach": att,
        "email_slot_fill": slot_fill,
        "ui_events": combined_events,
        "change_summary": att.get("change_summary") or gen.get("change_summary"),
    }


def normalize_channel_list(raw: Any) -> list[str]:
    from app.agents.image.channel_image import normalize_channel_list as _norm

    return _norm(raw)


__all__ = [
    "attach_campaign_images",
    "generate_campaign_images",
    "run_campaign_image_pipeline",
]
