"""LLM routing for template edit — image pipeline vs copy edit."""

from __future__ import annotations

from typing import Any

from app.mas.runtime.llm_loop import run_single_tool_routing_loop

_ROUTE_IMAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "route_image_edit",
        "description": (
            "User wants to generate, replace, refine, remove, or attach a hero/header/banner "
            "image on this template — not copy/text changes."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "executor_id": {
                    "type": "string",
                    "enum": [
                        "image_generate",
                        "image_refine",
                        "image_attach",
                        "image_remove",
                    ],
                    "description": (
                        "image_generate for new assets; image_refine to edit last image; "
                        "image_attach when image exists and should be placed on template; "
                        "image_remove when user wants the hero/image gone."
                    ),
                },
                "routing_hint": {
                    "type": "string",
                    "description": "Optional restated brief for the image executor.",
                },
                "attach_target": {
                    "type": "string",
                    "enum": [
                        "hero",
                        "product",
                        "last_filled_image",
                        "next_empty_slot",
                    ],
                    "description": (
                        "Which image slot to replace or fill: hero=main banner; "
                        "product=product/grid image; last_filled_image=refine or replace "
                        "the image the user is editing; next_empty_slot=only an empty slot."
                    ),
                },
            },
            "required": ["executor_id"],
        },
    },
}

_ROUTE_COPY_TOOL = {
    "type": "function",
    "function": {
        "name": "route_copy_edit",
        "description": (
            "User wants text/copy changes — subject, body, buttons, headings, tone, "
            "WhatsApp copy, colors described as text — not image generation."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "routing_hint": {"type": "string"},
            },
        },
    },
}


async def llm_pick_template_edit_route(
    *,
    instruction: str,
    channel: str,
    has_header_image: bool = False,
) -> dict[str, Any]:
    """Returns {route: image|copy, executor_id?, routing_hint?}."""
    system = (
        "You route template editor instructions.\n"
        f"Channel: {channel or 'unknown'}.\n"
        f"Template already has a header/hero image: {has_header_image}.\n"
        "Pick exactly one tool:\n"
        "- route_image_edit when the user wants a new/changed/refined hero, banner, "
        "header image, to attach a generated image, OR to remove/delete/clear the hero.\n"
        "- route_copy_edit for subject, body, greeting, CTA, buttons, text tone, "
        "paragraph edits, or layout copy — not image generation.\n"
        "When both image and copy are requested, prefer route_copy_edit unless the "
        "primary ask is clearly visual/image.\n"
        "When user says they do not want / need / like the current image, or asks to "
        "remove/delete/clear it → route_image_edit with executor_id=image_remove.\n"
        "When user asks to change/replace the image → image_generate (or image_refine "
        "if they want a variation on the existing hero).\n"
        "Set attach_target: hero for banner/header; product for product/grid shots; "
        "last_filled_image when refining; next_empty_slot only when adding a new empty slot.\n"
        "When route_image_edit: prefer image_generate unless a real hero URL already "
        "exists AND user only asked to reposition/reattach (image_attach)."
    )
    routed = await run_single_tool_routing_loop(
        system_prompt=system,
        user_text=instruction or "(empty)",
        tools=[_ROUTE_IMAGE_TOOL, _ROUTE_COPY_TOOL],
        allowed_tool_names=frozenset({"route_image_edit", "route_copy_edit"}),
        max_rounds=2,
    )
    if not routed.get("ok"):
        return {"route": "copy", "llm": routed}
    name = str(routed.get("tool_name") or "").strip()
    args = dict(routed.get("tool_args") or {})
    if name == "route_image_edit":
        eid = str(args.get("executor_id") or "image_generate").strip().lower()
        if eid not in (
            "image_generate",
            "image_refine",
            "image_attach",
            "image_remove",
        ):
            eid = "image_generate"
        return {
            "route": "image",
            "executor_id": eid,
            "routing_hint": str(args.get("routing_hint") or instruction or "").strip(),
            "attach_target": str(args.get("attach_target") or "").strip(),
            "llm": routed,
        }
    return {
        "route": "copy",
        "routing_hint": str(args.get("routing_hint") or instruction or "").strip(),
        "llm": routed,
    }


def _has_header_image(fields: dict[str, Any]) -> bool:
    from app.agents.image.hero_image import fields_have_hero_image

    return fields_have_hero_image(fields if isinstance(fields, dict) else {})


def _needs_hero_image(fields: dict[str, Any]) -> bool:
    from app.agents.image.hero_image import fields_need_hero_image

    return fields_need_hero_image(fields if isinstance(fields, dict) else {})


def _resolve_image_executor_id(
    executor_id: str,
    *,
    has_header_image: bool,
) -> str:
    """Never attach-only when no hero URL exists yet."""
    eid = str(executor_id or "image_generate").strip().lower()
    if eid not in (
        "image_generate",
        "image_refine",
        "image_attach",
        "image_remove",
    ):
        eid = "image_generate"
    if eid == "image_remove":
        return eid
    if eid == "image_attach" and not has_header_image:
        return "image_generate"
    if eid == "image_refine" and not has_header_image:
        return "image_generate"
    return eid


def _user_facing_image_error(raw: str) -> str:
    from app.agents.create_campaign.user_facing import user_facing_image_failure

    return user_facing_image_failure(raw)


async def _emit_events(event_callback: Any, ui_events: list[dict[str, Any]]) -> None:
    if not event_callback:
        return
    for event in ui_events:
        if isinstance(event, dict):
            await event_callback(event)


async def run_template_edit_remove_image(
    *,
    session_id: str,
    token: str,
    template_id: str,
    channel: str,
) -> dict[str, Any]:
    """Clear hero/header image from template fields."""
    from app.agents.image.template_attach import clear_hero_image_fields
    from app.template_store import get_template, update_template_fields

    detail = await get_template(template_id, token=token)
    tpl = detail.get("template") if isinstance(detail, dict) else {}
    existing = tpl.get("fields") if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict) else {}
    cleared = clear_hero_image_fields(existing)
    result = await update_template_fields(template_id, cleared, token=token)
    merged = cleared
    if isinstance(result, dict):
        tpl_out = result.get("template")
        if isinstance(tpl_out, dict) and isinstance(tpl_out.get("fields"), dict):
            merged = tpl_out["fields"]
    return {
        "ok": True,
        "fields": merged,
        "edit_outcome": "image_removed",
        "reply_facts": {
            "action": "image_remove",
            "channel": channel,
            "template_id": template_id,
            "session_id": session_id,
        },
        "ui_events": [
            {
                "type": "template_fields_updated",
                "template_id": template_id,
                "fields": merged,
            }
        ],
    }


async def run_template_edit_image_pipeline(
    *,
    session_id: str,
    token: str,
    template_id: str,
    channel: str,
    instruction: str,
    executor_id: str = "image_generate",
    event_callback: Any = None,
    has_header_image: bool = False,
    attach_target: str = "",
    current_fields: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Deterministic template-edit image flow — one enhance, one generate/refine,
    one attach on a single in-memory session (no slot loss between steps).
    """
    from app.agents.image.tools.handlers import (
        _handle_attach,
        _handle_enhance,
        _handle_generate,
        _handle_refine,
    )
    from app.session_store import get_or_create_session, save_session
    from app.template_store import get_template

    eid = _resolve_image_executor_id(
        executor_id,
        has_header_image=has_header_image,
    )
    if eid == "image_remove":
        return await run_template_edit_remove_image(
            session_id=session_id,
            token=token,
            template_id=template_id,
            channel=channel,
        )

    prompt = str(instruction or "").strip()
    ui_events: list[dict[str, Any]] = []

    from app.agents.image.campaign_image_context import (
        build_campaign_image_context,
        resolve_image_user_prompt,
    )
    from app.agents.image.hero_image import (
        resolve_image_attach_section_index,
        section_image_url,
    )

    session = await get_or_create_session(
        session_id, token=token, module="create_campaign"
    )
    session["template_id"] = template_id
    session["active_edit_channel"] = str(channel or "").strip().lower()
    fields_in = dict(current_fields) if isinstance(current_fields, dict) else {}
    if not fields_in:
        detail0 = await get_template(template_id, token=token)
        tpl0 = detail0.get("template") if isinstance(detail0, dict) else {}
        fields_in = (
            tpl0.get("fields")
            if isinstance(tpl0, dict) and isinstance(tpl0.get("fields"), dict)
            else {}
        )
    ctx = build_campaign_image_context(
        session,
        channel=channel,
        template_fields=fields_in,
    )
    prompt = resolve_image_user_prompt(prompt, ctx)
    replace_mode = has_header_image and eid in ("image_refine", "image_generate")
    attach_idx = resolve_image_attach_section_index(
        fields_in,
        mode="replace" if replace_mode else "fill",
        attach_target=str(attach_target or ""),
    )
    slots_root = session.setdefault("mas_task", {}).setdefault("slots", {}).setdefault("image", {})
    if isinstance(slots_root, dict):
        slots_root["attach_target"] = str(attach_target or "")
        if attach_idx is not None:
            slots_root["attach_section_index"] = attach_idx
    tool_args_base = {
        "user_prompt": prompt,
        "template_id": template_id,
        "channel": channel,
    }

    enhance = await _handle_enhance(session, tool_args_base, token=token)
    await save_session(session, token=token)
    if not enhance.get("ok"):
        try:
            from app.mas.runtime.turn_audit_log import turn_audit_stage

            turn_audit_stage(
                "edit_image_failed",
                step="enhance",
                error=str(enhance.get("error") or "")[:300] or None,
                template_id=template_id,
                channel=channel,
            )
        except Exception:  # noqa: BLE001
            pass
        return {
            "ok": False,
            "error": enhance.get("error") or "Could not enhance image brief.",
            "edit_outcome": "image_failed",
            "reply_facts": {
                "action": "image_failed",
                "error": enhance.get("error"),
                "stage": "enhance",
            },
            "ui_events": ui_events,
        }

    enhanced = str(enhance.get("enhanced_prompt") or "").strip()
    if not enhanced:
        return {
            "ok": False,
            "error": "Enhanced prompt was empty.",
            "edit_outcome": "image_failed",
            "reply_facts": {
                "action": "image_failed",
                "error": "Enhanced prompt was empty.",
                "stage": "enhance",
            },
            "ui_events": ui_events,
        }

    refine_args: dict[str, Any] = {"enhanced_prompt": enhanced, "user_prompt": prompt}
    if eid == "image_refine" and attach_idx is not None:
        sections = fields_in.get("sections") if isinstance(fields_in.get("sections"), list) else []
        if attach_idx < len(sections) and isinstance(sections[attach_idx], dict):
            src = section_image_url(sections[attach_idx])
            if src:
                refine_args["source_image_url"] = src
    if eid == "image_refine":
        image_step = await _handle_refine(session, refine_args, token=token)
    else:
        image_step = await _handle_generate(
            session,
            {"enhanced_prompt": enhanced, "user_prompt": prompt},
            token=token,
        )
    await save_session(session, token=token)

    if not image_step.get("ok"):
        try:
            from app.mas.runtime.turn_audit_log import turn_audit_stage

            turn_audit_stage(
                "edit_image_failed",
                step="generate" if eid != "image_refine" else "refine",
                error=str(image_step.get("error") or "")[:300] or None,
                template_id=template_id,
                channel=channel,
                executor_id=eid,
            )
        except Exception:  # noqa: BLE001
            pass
        return {
            "ok": False,
            "error": image_step.get("error") or "Image generation failed.",
            "edit_outcome": "image_failed",
            "reply_facts": {
                "action": "image_failed",
                "error": image_step.get("error"),
                "stage": "generate",
            },
            "ui_events": ui_events,
        }

    used_stub = bool(image_step.get("used_stub"))
    ui_events.extend(list(image_step.get("ui_events") or []))
    await _emit_events(event_callback, ui_events)

    attach = await _handle_attach(
        session,
        {
            "template_id": template_id,
            "replace_section": replace_mode,
            "attach_target": str(attach_target or ""),
            **({"section_index": attach_idx} if attach_idx is not None else {}),
        },
        token=token,
    )
    await save_session(session, token=token)
    if not attach.get("ok"):
        return {
            "ok": False,
            "error": attach.get("error") or "Generated image but attach failed.",
            "edit_outcome": "image_failed",
            "reply_facts": {
                "action": "image_failed",
                "error": attach.get("error"),
                "stage": "attach",
                "used_stub": used_stub,
            },
            "ui_events": ui_events,
        }
    ui_events.extend(list(attach.get("ui_events") or []))
    await _emit_events(event_callback, ui_events)

    fields: dict[str, Any] | None = None
    for event in ui_events:
        if isinstance(event, dict) and isinstance(event.get("fields"), dict):
            fields = event["fields"]
    if not fields:
        detail = await get_template(template_id, token=token)
        tpl = detail.get("template") if isinstance(detail, dict) else {}
        fields = (
            tpl.get("fields")
            if isinstance(tpl, dict) and isinstance(tpl.get("fields"), dict)
            else None
        )
    image_url = str(image_step.get("image_url") or "").strip()
    outcome = "image_stub" if used_stub else "image_attached"

    return {
        "ok": True,
        "edit_outcome": outcome,
        "reply_facts": {
            "action": outcome,
            "image_used_stub": used_stub,
            "image_url": image_url,
            "user_prompt": prompt,
            "executor_id": eid,
        },
        "ui_events": ui_events,
        "fields": fields,
        "image_url": image_url,
        "used_stub": used_stub,
    }


async def try_template_image_edit(
    *,
    session_id: str,
    token: str,
    template_id: str,
    channel: str,
    instruction: str,
    current_fields: dict[str, Any],
    event_callback: Any = None,
) -> dict[str, Any] | None:
    """
    Run template-edit image pipeline when LLM routes to image.
    Returns finalize_edit_result-shaped dict, or None for copy edit path.
    """
    route = await llm_pick_template_edit_route(
        instruction=instruction,
        channel=channel,
        has_header_image=_has_header_image(current_fields),
    )
    if route.get("route") != "image" and _needs_hero_image(current_fields):
        route = {
            "route": "image",
            "executor_id": "image_generate",
            "routing_hint": instruction,
        }
    if route.get("route") != "image":
        return None

    from app.mas.executors.shared.image_native import is_native_image

    if not is_native_image():
        return {
            "intent": "clarify",
            "fields": None,
            "edit_outcome": "image_generation_disabled",
            "reply_facts": {"action": "image_generation_disabled"},
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
        }

    has_hero = _has_header_image(current_fields)
    executor_id = _resolve_image_executor_id(
        str(route.get("executor_id") or "image_generate"),
        has_header_image=has_hero,
    )
    result = await run_template_edit_image_pipeline(
        session_id=session_id,
        token=token,
        template_id=template_id,
        channel=channel,
        instruction=str(route.get("routing_hint") or instruction or "").strip(),
        executor_id=executor_id,
        event_callback=event_callback,
        has_header_image=has_hero,
        attach_target=str(route.get("attach_target") or ""),
        current_fields=current_fields,
    )

    ui_events = list(result.get("ui_events") or [])
    display_fields = result.get("fields")
    reply_facts = result.get("reply_facts") if isinstance(result.get("reply_facts"), dict) else {}
    edit_outcome = str(result.get("edit_outcome") or "").strip()

    if isinstance(display_fields, dict) and display_fields and result.get("ok"):
        return {
            "intent": "modify",
            "fields": display_fields,
            "edit_outcome": edit_outcome or "image_attached",
            "reply_facts": reply_facts,
            "display_fields": display_fields,
            "emit_template": True,
            "persist_fields": True,
            "ui_events": ui_events,
            "image_url": result.get("image_url"),
            "used_stub": result.get("used_stub"),
        }
    if result.get("ok"):
        return {
            "intent": "general",
            "fields": None,
            "edit_outcome": edit_outcome or "general",
            "reply_facts": reply_facts,
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
            "ui_events": ui_events,
        }
    return {
        "intent": "clarify",
        "fields": None,
        "edit_outcome": edit_outcome or "image_failed",
        "reply_facts": {
            **reply_facts,
            "error": result.get("error"),
        },
        "display_fields": None,
        "emit_template": False,
        "persist_fields": False,
        "ui_events": ui_events,
    }
