"""Image MAS tool handlers — enhance gate before generate/refine."""

from __future__ import annotations

import logging
import uuid
from typing import Any

import httpx

from app.agents.image.campaign_image_context import (
    build_campaign_image_context,
)
from app.agents.image.enhance import (
    REFUSAL_MESSAGE,
    _MIN_ENHANCED_LEN,
    enhance_image_prompt,
    is_unsafe_enhanced_prompt,
    merge_image_slots_from_session,
    validate_enhanced_prompt,
)
from app.agents.image.media_upload import upload_image_bytes
from app.agents.image.template_attach import attach_preserves_content, build_attach_fields
from app.integrations.gemini_image import refine_image_bytes
from app.mas.runtime.task_memory import get_mas_task
from app.session_store import get_or_create_session, save_session
from app.template_store import get_template, update_template_fields

logger = logging.getLogger(__name__)


def _image_slots(session: dict[str, Any]) -> dict[str, Any]:
    task = get_mas_task(session)
    slots = task.setdefault("slots", {})
    if not isinstance(slots.get("image"), dict):
        slots["image"] = {}
    return slots["image"]


def _create_chat_existing_cards_frozen(
    session: dict[str, Any],
    args: dict[str, Any] | None = None,
    *,
    allow_new_batch: bool = False,
) -> dict[str, Any] | None:
    """Refuse attach onto live create-chat cards.

    New images belong on a new generate (build_campaign + batch id) or in View/edit.
    """
    payload = args if isinstance(args, dict) else {}
    if str(payload.get("chat_context") or "").strip().lower() == "edit":
        return None
    if allow_new_batch and str(payload.get("generation_batch_id") or "").strip():
        return None
    mod = str(session.get("module") or "").strip().lower()
    if mod not in ("create_campaign", "recommendations"):
        return None
    from app.mas.runtime.creation_context import has_templates_for_channels

    if not has_templates_for_channels(session):
        return None
    return {
        "ok": True,
        "needs_new_generate": True,
        "skipped": True,
        "message": (
            "Existing template cards stay unchanged. Call build_campaign with "
            "wants_images for a new card, or attach in that card's View/edit space."
        ),
    }


def _slot_context(args: dict[str, Any]) -> dict[str, str]:
    return {
        "channel": str(args.get("channel") or "").strip(),
        "aspect_hint": str(args.get("aspect_hint") or "").strip(),
        "campaign_name": str(args.get("campaign_name") or "").strip(),
        "campaign_goal": str(args.get("campaign_goal") or "").strip(),
        "campaign_brief": str(args.get("campaign_brief") or "").strip(),
        "messaging_angle": str(args.get("messaging_angle") or "").strip(),
        "template_subject": str(args.get("template_subject") or "").strip(),
        "template_body_snippet": str(args.get("template_body_snippet") or "").strip(),
        "must_include": str(args.get("must_include") or "").strip(),
        "must_avoid": str(args.get("must_avoid") or "").strip(),
        "style_hint": str(args.get("style_hint") or "").strip(),
    }


async def _resolve_enhance_context(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> tuple[dict[str, str], dict[str, str]]:
    """Merge session slots + optional template fetch into enhance context."""
    merged = merge_image_slots_from_session(session, dict(args))
    ctx = _slot_context(merged)
    channel = ctx.get("channel") or ""
    template_id = str(merged.get("template_id") or session.get("template_id") or "").strip()
    template_fields: dict[str, Any] = {}
    if template_id and token:
        try:
            tpl_resp = await get_template(template_id, token=token)
            tpl = tpl_resp.get("template") if isinstance(tpl_resp, dict) else {}
            if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict):
                template_fields = tpl["fields"]
        except Exception:
            logger.debug("Could not fetch template %s for image context", template_id)
    image_ctx = build_campaign_image_context(
        session,
        channel=channel,
        template_fields=template_fields or None,
    )
    for key, val in image_ctx.items():
        if val and not ctx.get(key):
            ctx[key] = str(val)
    return ctx, merged


async def _fetch_image_bytes(url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        res = await client.get(url)
        res.raise_for_status()
        ctype = str(res.headers.get("content-type") or "image/png").split(";")[0].strip()
        return res.content, ctype or "image/png"


async def _handle_enhance(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str = "",
) -> dict[str, Any]:
    ctx, merged = await _resolve_enhance_context(session, args, token=token)
    user_prompt = str(
        merged.get("user_prompt")
        or merged.get("prompt")
        or args.get("user_prompt")
        or ""
    ).strip()
    if not user_prompt:
        return {
            "ok": False,
            "needs_image_brief": True,
            "error": "need_image_description",
            "message": (
                "Ask what to generate before Gemini: subject, setting, style, "
                "and any exact words that should appear in the image. "
                "Do not synthesize a campaign-name hero to skip that question."
            ),
        }

    enhance_kwargs = {
        k: v
        for k, v in ctx.items()
        if k
        in {
            "channel",
            "aspect_hint",
            "campaign_name",
            "campaign_goal",
            "campaign_brief",
            "messaging_angle",
            "template_subject",
            "template_body_snippet",
            "must_include",
            "must_avoid",
            "style_hint",
        }
        and v
    }
    result = await enhance_image_prompt(user_prompt, **enhance_kwargs)
    if result.refused:
        return {"ok": False, "refused": True, "error": result.error or REFUSAL_MESSAGE}
    if not result.ok:
        return {"ok": False, "error": result.error or "Enhance failed."}

    enhanced = result.enhanced_prompt
    slots = _image_slots(session)
    enhance_id = str(uuid.uuid4())
    slots["last_enhanced_prompt"] = enhanced
    slots["last_enhance_id"] = enhance_id
    slots["last_user_prompt"] = user_prompt
    slots["awaiting_generate_confirm"] = True
    for key, val in ctx.items():
        if val:
            slots[key] = val
    return {
        "ok": True,
        "enhanced_prompt": enhanced,
        "enhance_id": enhance_id,
        "awaiting_generate_confirm": True,
        "negatives_applied": result.negatives_applied,
        "message": (
            "Show this visual brief to the user. Do not call GENERATE_IMAGE until "
            "they confirm. Then pass user_confirmed=true (use the stored brief)."
        ),
        "change_summary": "Expanded your idea into a campaign visual brief.",
    }


def _gate_enhanced_for_api(
    session: dict[str, Any],
    enhanced: str,
    *,
    args: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    slots = _image_slots(session)
    stored = str(slots.get("last_enhanced_prompt") or "").strip()
    enhanced = stored or str(enhanced or "").strip()
    raw_user = str(slots.get("last_user_prompt") or "").strip()
    if not stored:
        return {
            "ok": False,
            "error": "Call ENHANCE_IMAGE_PROMPT first — raw user chat cannot reach the image API.",
        }
    if is_unsafe_enhanced_prompt(enhanced):
        return {"ok": False, "refused": True, "error": REFUSAL_MESSAGE}
    ok, err = validate_enhanced_prompt(
        raw_user,
        enhanced,
        min_length=_MIN_ENHANCED_LEN,
    )
    if not ok:
        return {"ok": False, "error": err or "Enhanced prompt failed validation."}
    _ = args
    return None


async def _handle_generate(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    slots = _image_slots(session)
    stored = str(slots.get("last_enhanced_prompt") or "").strip()
    if not stored:
        return {
            "ok": False,
            "error": "Call ENHANCE_IMAGE_PROMPT first — raw user chat cannot reach the image API.",
        }
    enhanced = stored
    confirmed = bool(args.get("user_confirmed")) or bool(slots.get("auto_generate"))
    if not confirmed:
        return {
            "ok": False,
            "needs_confirm": True,
            "awaiting_generate_confirm": True,
            "enhanced_prompt": enhanced,
            "enhance_id": str(args.get("enhance_id") or slots.get("last_enhance_id") or ""),
            "error": "generation_needs_confirm",
            "message": (
                "Gemini is costly. Show the enhanced brief, wait for the user to "
                "confirm, then call GENERATE_IMAGE with user_confirmed=true."
            ),
        }
    blocked = _gate_enhanced_for_api(session, enhanced, args=args)
    if blocked:
        return blocked
    enhance_id = str(args.get("enhance_id") or slots.get("last_enhance_id") or "").strip()
    try:
        from app.integrations.gemini_image import generate_and_upload_rebuild_url

        result = await generate_and_upload_rebuild_url(enhanced, token=token)
        public_url = str(result.get("url") or "").strip()
        used_stub = bool(result.get("used_stub"))
        uploaded = {
            "url": public_url,
            "media_id": str(result.get("media_id") or "").strip(),
        }
        if not public_url:
            return {"ok": False, "error": "Image generation returned no rebuild URL"}
    except Exception as exc:
        logger.exception("Image generation failed")
        return {"ok": False, "error": str(exc)}
    public_url = uploaded["url"]
    from app.gallery.image_asset_registry import register_gallery_image

    await register_gallery_image(
        image_url=public_url,
        token=token,
        media_id=str(uploaded.get("media_id") or ""),
        source="ai_generated",
        generation_prompt=enhanced,
        channel=str(session.get("active_edit_channel") or session.get("image_channel") or ""),
        context={"origin": "image_tool_generate"},
    )
    slots["last_image_url"] = public_url
    slots["last_image_media_id"] = uploaded.get("media_id") or ""
    slots["awaiting_generate_confirm"] = False
    channel = str(
        args.get("channel")
        or slots.get("channel")
        or session.get("active_edit_channel")
        or session.get("image_channel")
        or ""
    ).strip().lower()
    if channel:
        slots["channel"] = channel
    ui_event: dict[str, Any] = {
        "type": "image_generated",
        "image_url": public_url,
        "enhanced_prompt": enhanced,
        "stub": used_stub,
    }
    if channel:
        ui_event["channel"] = channel
        ui_event["channels"] = [channel]
    template_id = str(
        args.get("template_id") or session.get("template_id") or ""
    ).strip()
    if template_id:
        ui_event["template_id"] = template_id
    return {
        "ok": True,
        "image_url": public_url,
        "media_id": uploaded.get("media_id"),
        "enhance_id": enhance_id or slots.get("last_enhance_id"),
        "used_stub": used_stub,
        "ui_events": [ui_event],
        "change_summary": f"Generated image: {public_url}",
    }


async def _handle_refine(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    slots = _image_slots(session)
    enhanced = str(args.get("enhanced_prompt") or slots.get("last_enhanced_prompt") or "").strip()
    blocked = _gate_enhanced_for_api(session, enhanced, args=args)
    if blocked:
        return blocked
    source_url = str(
        args.get("source_image_url") or slots.get("last_image_url") or ""
    ).strip()
    if not source_url:
        return {"ok": False, "error": "No source image — generate an image first."}
    try:
        source_bytes, mime = await _fetch_image_bytes(source_url)
        image_bytes, out_mime, used_stub = await refine_image_bytes(
            enhanced,
            image_bytes=source_bytes,
            mime_type=mime,
        )
        uploaded = await upload_image_bytes(image_bytes, token=token, mime_type=out_mime)
    except Exception as exc:
        logger.exception("Image refine failed")
        return {"ok": False, "error": str(exc)}
    public_url = uploaded["url"]
    from app.gallery.image_asset_registry import register_gallery_image

    await register_gallery_image(
        image_url=public_url,
        token=token,
        media_id=str(uploaded.get("media_id") or ""),
        source="ai_generated",
        generation_prompt=enhanced,
        channel=str(session.get("active_edit_channel") or session.get("image_channel") or ""),
        context={"origin": "image_tool_refine", "source_image_url": source_url},
    )
    slots["last_image_url"] = public_url
    slots["last_image_media_id"] = uploaded.get("media_id") or ""
    channel = str(
        args.get("channel")
        or slots.get("channel")
        or session.get("active_edit_channel")
        or session.get("image_channel")
        or ""
    ).strip().lower()
    if channel:
        slots["channel"] = channel
    ui_event: dict[str, Any] = {
        "type": "image_refined",
        "image_url": public_url,
        "source_image_url": source_url,
        "stub": used_stub,
    }
    if channel:
        ui_event["channel"] = channel
        ui_event["channels"] = [channel]
    template_id = str(
        args.get("template_id") or session.get("template_id") or ""
    ).strip()
    if template_id:
        ui_event["template_id"] = template_id
    return {
        "ok": True,
        "image_url": public_url,
        "media_id": uploaded.get("media_id"),
        "used_stub": used_stub,
        "ui_events": [ui_event],
        "change_summary": f"Refined image: {public_url}",
    }


async def _handle_attach(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    frozen = _create_chat_existing_cards_frozen(session, args)
    if frozen:
        return frozen
    slots = _image_slots(session)
    template_id = str(args.get("template_id") or session.get("template_id") or "").strip()
    if not template_id:
        return {"ok": False, "error": "template_id is required to attach an image."}
    image_url = str(args.get("image_url") or slots.get("last_image_url") or "").strip()
    if not image_url:
        return {"ok": False, "error": "No image URL — generate or refine an image first."}
    field_key = str(args.get("field_key") or "header_image").strip()
    from app.agents.image.hero_image import resolve_image_attach_section_index

    try:
        tpl_resp = await get_template(template_id, token=token or None)
        tpl = tpl_resp.get("template") if isinstance(tpl_resp, dict) else {}
        existing = tpl.get("fields") if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict) else {}
        idx: int | None = None
        if args.get("section_index") is not None:
            try:
                idx = int(args.get("section_index"))
            except (TypeError, ValueError):
                idx = None
        if idx is None:
            replace_mode = bool(args.get("replace_section") or args.get("replace"))
            idx = resolve_image_attach_section_index(
                existing,
                mode="replace" if replace_mode else "fill",
                attach_target=str(args.get("attach_target") or slots.get("attach_target") or ""),
            )
        fields = build_attach_fields(
            existing,
            image_url=image_url,
            field_key=field_key,
            only_section_index=idx,
        )
        result = await update_template_fields(template_id, fields, token=token or None)
        merged = {}
        if isinstance(result, dict):
            tpl_out = result.get("template")
            if isinstance(tpl_out, dict) and isinstance(tpl_out.get("fields"), dict):
                merged = tpl_out["fields"]
        if merged and not attach_preserves_content(existing, merged):
            return {
                "ok": False,
                "error": "Attach failed — template subject/body was lost. Try again after regenerating templates.",
            }
    except Exception as exc:
        logger.exception("Template attach failed")
        return {"ok": False, "error": str(exc)}
    slots["attached_template_id"] = template_id
    slots["attached_field_key"] = field_key
    ui_event = {
        "type": "template_image_attached",
        "template_id": template_id,
        "field_key": field_key,
        "image_url": image_url,
        "fields": merged if isinstance(merged, dict) and merged else None,
        "channel": str(tpl.get("channel") or "").strip().lower() if isinstance(tpl, dict) else "",
    }
    if idx is not None:
        ui_event["section_index"] = idx
    return {
        "ok": True,
        "template_id": template_id,
        "field_key": field_key,
        "image_url": image_url,
        "ui_events": [ui_event],
        "change_summary": f"Attached image to template {template_id}.",
    }


async def _handle_get_last(session: dict[str, Any]) -> dict[str, Any]:
    slots = _image_slots(session)
    from app.agents.image.plan import get_image_plan, images_by_channel_slot

    return {
        "ok": True,
        "last_enhanced_prompt": slots.get("last_enhanced_prompt"),
        "last_enhance_id": slots.get("last_enhance_id"),
        "last_image_url": slots.get("last_image_url"),
        "last_user_prompt": slots.get("last_user_prompt"),
        "channel": slots.get("channel"),
        "images_by_channel": images_by_channel_slot(session),
        "plan": get_image_plan(session),
    }


async def _handle_plan(session: dict[str, Any], args: dict[str, Any]) -> dict[str, Any]:
    from app.agents.image.channel_image import eligible_image_channels
    from app.agents.image.plan import get_image_plan, set_image_plan

    wants = bool(args.get("wants_images"))
    plan = set_image_plan(
        session,
        wants_images=wants,
        channels=args.get("channels"),
        mode=str(args.get("mode") or "shared"),
        scope=str(args.get("scope") or "all_eligible"),
        auto_after_build=bool(args.get("auto_after_build", True)),
        user_confirmed=bool(args.get("user_confirmed", False)),
    )
    return {
        "ok": True,
        "plan": plan,
        "eligible_channels": eligible_image_channels(session),
        "change_summary": (
            "Image plan saved — no images for this campaign."
            if not wants
            else (
                f"Image plan: {plan.get('mode')} across "
                f"{', '.join(plan.get('channels') or []) or 'no channels yet'}."
            )
        ),
        "message": get_image_plan(session),
    }


async def _handle_generate_campaign(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    from app.agents.image.batch import generate_campaign_images

    return await generate_campaign_images(
        session,
        token=token,
        channels=args.get("channels"),
        mode=args.get("mode"),
    )


async def _handle_attach_campaign(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    frozen = _create_chat_existing_cards_frozen(
        session, args, allow_new_batch=True
    )
    if frozen:
        return frozen
    from app.agents.image.batch import attach_campaign_images

    return await attach_campaign_images(
        session,
        token=token,
        channels=args.get("channels"),
        images_by_channel=args.get("images_by_channel"),
        generation_batch_id=str(args.get("generation_batch_id") or "").strip()
        or None,
    )


async def _handle_run_pipeline(
    session: dict[str, Any],
    args: dict[str, Any] | None = None,
    *,
    token: str,
) -> dict[str, Any]:
    frozen = _create_chat_existing_cards_frozen(
        session, args, allow_new_batch=True
    )
    if frozen:
        return frozen
    from app.agents.image.batch import run_campaign_image_pipeline

    batch_id = str((args or {}).get("generation_batch_id") or "").strip() or None
    return await run_campaign_image_pipeline(
        session, token=token, generation_batch_id=batch_id
    )


async def _handle_confirm_chat_images(
    session: dict[str, Any],
    args: dict[str, Any],
    *,
    token: str,
) -> dict[str, Any]:
    from app.agents.image.user_assets import confirm_chat_images
    from app.mas.runtime.creation_context import has_templates_for_channels

    include = bool(args.get("include_in_templates"))
    raw_ids = args.get("asset_ids")
    asset_ids = (
        [str(x).strip() for x in raw_ids if str(x).strip()]
        if isinstance(raw_ids, list)
        else None
    )
    out = confirm_chat_images(
        session,
        include_in_templates=include,
        asset_ids=asset_ids,
        channels=args.get("channels"),
    )
    if not out.get("ok") or not include:
        return out

    # Existing chat cards stay frozen. New images belong on a new generate
    # (build_campaign) or in that card's View/edit space.
    if has_templates_for_channels(session):
        out["needs_new_generate"] = True
        out["message"] = (
            str(out.get("message") or "")
            + " Image saved for a new generate. Existing template cards stay unchanged; "
            "call build_campaign with wants_images=true for a new card, or attach in View/edit."
        ).strip()
        return out
    return out


async def dispatch_tool(
    tool_name: str,
    session_id: str,
    token: str,
    args: dict[str, Any] | None = None,
    *,
    event_callback: Any = None,
) -> dict[str, Any]:
    _ = event_callback
    name = str(tool_name or "").strip()
    payload = dict(args or {})
    session = await get_or_create_session(session_id, token=token, module="image")
    payload = merge_image_slots_from_session(session, payload)

    if name == "ENHANCE_IMAGE_PROMPT":
        out = await _handle_enhance(session, payload, token=token)
    elif name == "GENERATE_IMAGE":
        out = await _handle_generate(session, payload, token=token)
    elif name == "REFINE_IMAGE":
        out = await _handle_refine(session, payload, token=token)
    elif name == "ATTACH_IMAGE":
        out = await _handle_attach(session, payload, token=token)
    elif name == "GET_LAST_IMAGE":
        out = await _handle_get_last(session)
    elif name in ("PLAN_CAMPAIGN_IMAGES", "plan_campaign_images"):
        out = await _handle_plan(session, payload)
    elif name == "GENERATE_CAMPAIGN_IMAGES":
        out = await _handle_generate_campaign(session, payload, token=token)
    elif name == "ATTACH_CAMPAIGN_IMAGES":
        out = await _handle_attach_campaign(session, payload, token=token)
    elif name == "RUN_CAMPAIGN_IMAGE_PIPELINE":
        out = await _handle_run_pipeline(session, payload, token=token)
    elif name in ("CONFIRM_CHAT_IMAGES", "confirm_chat_images"):
        out = await _handle_confirm_chat_images(session, payload, token=token)
    elif name in ("CLEAR_CHAT_IMAGES", "clear_chat_images"):
        from app.agents.image.user_assets import clear_chat_images

        out = clear_chat_images(
            session,
            pending=payload.get("pending", True) is not False,
            confirmed=payload.get("confirmed", True) is not False,
        )
    else:
        return {"ok": False, "error": f"Unknown image tool {name!r}"}

    await save_session(session, token=token)
    return out


__all__ = ["dispatch_tool"]
