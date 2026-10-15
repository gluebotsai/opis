"""Template edit chat — one LLM loop; tools mutate fields; the model talks."""

from __future__ import annotations

import json
from typing import Any

from app.agents.create_campaign.tools import SEARCH_KNOWLEDGE
from app.agents.template_library.edit_postprocess import mark_whatsapp_draft_after_edit
from app.agents.template_library.fields import (
    apply_section_operations,
    edit_schema_hint,
    fields_ok_for_edit,
    merge_edit_fields,
    normalize_fields,
)
from app.agents.template_library.shared import (
    INTERNAL_CONTEXT_RULES,
    context_block,
    get_llm,
)
from app.llm import CHAT_LLM_TIMEOUT_S, CHAT_MAX_TOKENS, CHAT_REASONING_EFFORT
from app.runtime.agent import run_tool_loop
from app.text_cleanup import strip_html_tags, strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 8

_EDIT_REPLY_NUDGE = (
    "Write a short plain-text reply to the user from the tool results."
)

APPLY_TEMPLATE_CHANGES = {
    "type": "function",
    "function": {
        "name": "apply_template_changes",
        "description": (
            "Apply a partial copy/layout update the user asked for in any wording. "
            "Pass ONLY keys that change. For designed emails with sections[], prefer "
            "section_operations for remove/move/insert (you may use type names or "
            "indexes from Current fields JSON — do not invent a fixed phrase list). "
            "Do not use this to generate or delete the hero image "
            "(use generate_hero_image / remove_hero_image / attach_uploaded_image)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "changes": {
                    "type": "object",
                    "description": (
                        "Partial fields patch — subject, body, sections, buttons, "
                        "title, etc. Only include changed keys."
                    ),
                },
                "section_operations": {
                    "type": "array",
                    "description": (
                        "Email sections[] ops from the user's meaning: update, remove, "
                        "insert, move, replace_all. Prefer type-based targeting "
                        "(type / from_type / after_type) when the user names a part "
                        "(headline, button, image, footer); use indexes when they "
                        "point at a specific slot in Current fields."
                    ),
                    "items": {
                        "type": "object",
                        "properties": {
                            "op": {
                                "type": "string",
                                "enum": [
                                    "update",
                                    "remove",
                                    "insert",
                                    "move",
                                    "replace_all",
                                ],
                            },
                            "index": {"type": "integer"},
                            "from_index": {"type": "integer"},
                            "to_index": {"type": "integer"},
                            "after_index": {"type": "integer"},
                            "after_type": {
                                "type": "string",
                                "description": (
                                    "Insert after the first section of this type "
                                    "(e.g. headline, image, cta)."
                                ),
                            },
                            "from_type": {
                                "type": "string",
                                "description": (
                                    "Move the first section of this type "
                                    "(e.g. image → top)."
                                ),
                            },
                            "to_type": {
                                "type": "string",
                                "description": (
                                    "Move onto the index of this section type "
                                    "(optional; or use to_index)."
                                ),
                            },
                            "type": {
                                "type": "string",
                                "description": "Section type (headline, cta, text, …).",
                            },
                            "one_only": {"type": "boolean"},
                            "content": {"type": "string"},
                            "label": {"type": "string"},
                            "url": {"type": "string"},
                            "items": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "section": {"type": "object"},
                            "sections": {
                                "type": "array",
                                "items": {"type": "object"},
                            },
                        },
                        "required": ["op"],
                    },
                },
                "replace_sections": {
                    "type": "boolean",
                    "description": (
                        "When true and changes.sections is set, replace the full sections array."
                    ),
                },
            },
        },
    },
}

REMOVE_HERO_IMAGE = {
    "type": "function",
    "function": {
        "name": "remove_hero_image",
        "description": (
            "Remove the hero/header/banner image from this template. "
            "Use only when the user wants the image gone — not for copy edits."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
}

GENERATE_HERO_IMAGE = {
    "type": "function",
    "function": {
        "name": "generate_hero_image",
        "description": (
            "Generate or replace a template image from the campaign idea + optional brief. "
            "When the user asks vaguely (e.g. generate for this campaign), pass a short "
            "brief or omit it — the tool builds the visual brief from campaign name/goal/copy. "
            "Do NOT use this when the user already uploaded an image — use attach_uploaded_image. "
            "Set attach_target so the image lands in the right slot (hero vs product vs empty)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "brief": {
                    "type": "string",
                    "description": (
                        "Optional visual direction. May be empty/short — campaign context fills gaps."
                    ),
                },
                "mode": {
                    "type": "string",
                    "enum": ["generate", "refine"],
                    "description": "generate a new image, or refine the last one.",
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
                        "Slot to fill/replace: hero=main banner; product=product/lifestyle; "
                        "next_empty_slot=first empty image section; last_filled_image=latest image."
                    ),
                },
            },
        },
    },
}

ATTACH_UPLOADED_IMAGE = {
    "type": "function",
    "function": {
        "name": "attach_uploaded_image",
        "description": (
            "Attach a user-uploaded image URL onto this template. "
            "Prefer this over generate_hero_image whenever Available uploads lists a URL "
            "(including images uploaded earlier in main create chat) or the user asked to "
            "use their upload. Set attach_target to place hero vs product correctly — "
            "do not attach then ask to move."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_url": {
                    "type": "string",
                    "description": (
                        "HTTPS URL of the uploaded image. "
                        "Omit to use the first available upload for this session/turn."
                    ),
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
                        "Which image slot to fill. Default hero for banner/header requests."
                    ),
                },
            },
        },
    },
}

REDESIGN_TEMPLATE_WITH_DESIGNER = {
    "type": "function",
    "function": {
        "name": "redesign_template_with_designer",
        "description": (
            "Use the Template Generation Director to redesign this template's layout/"
            "structure/visual hierarchy when the user wants a design change — not a "
            "one-line copy tweak. Use for: reorder sections, new layout, hero at top, "
            "fresher structure, full visual redesign. For tiny copy/colour tweaks prefer "
            "apply_template_changes or set_email_theme."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "instruction": {
                    "type": "string",
                    "description": "What to redesign (layout, hierarchy, section order, look).",
                },
                "preserve_copy": {
                    "type": "boolean",
                    "description": (
                        "True (default) keeps existing copy meaning while changing structure. "
                        "False allows rewriting copy to fit the new design."
                    ),
                },
                "preserve_hero": {
                    "type": "boolean",
                    "description": (
                        "True (default) keeps the current hero image URL after redesign."
                    ),
                },
            },
            "required": ["instruction"],
        },
    },
}

HANDOFF_CAMPAIGN_LAUNCH = {
    "type": "function",
    "function": {
        "name": "handoff_campaign_launch",
        "description": (
            "Hand this turn to the create-campaign launch/schedule agent — the SAME "
            "path as main create chat. Call only when the user clearly wants to launch, "
            "schedule, or send. Pass the channels they asked for (or omit to use the "
            "campaign plan). Pass schedule_mode/schedule_at when they named a time."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "user_confirmed": {
                    "type": "boolean",
                    "description": "True when the user clearly asked to launch/schedule/send.",
                },
                "channels": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["email", "whatsapp", "web", "push"],
                    },
                    "description": (
                        "Channels the user asked to launch. Omit to use the saved "
                        "campaign launch plan / selected channels."
                    ),
                },
                "schedule_mode": {
                    "type": "string",
                    "enum": ["now", "later", "recurring"],
                    "description": "now = send immediately; later/recurring need schedule_at.",
                },
                "schedule_at": {
                    "type": "string",
                    "description": "ISO datetime or natural schedule string when mode is later.",
                },
                "note": {
                    "type": "string",
                    "description": "Optional short note for the launch agent.",
                },
            },
            "required": ["user_confirmed"],
        },
    },
}

SET_EMAIL_THEME = {
    "type": "function",
    "function": {
        "name": "set_email_theme",
        "description": (
            "Update email background/brand colours and theme. Use when the user asks "
            "to change background, accent, colours, or overall look. Pass #hex colours "
            "only. Optionally set theme_id to a catalog id (clean_light, editorial_warm, "
            "bold_contrast, calm_professional)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "theme_id": {
                    "type": "string",
                    "description": "Optional catalog theme id.",
                },
                "theme": {
                    "type": "object",
                    "description": (
                        "Partial theme overrides: background, surface, text, muted, "
                        "accent, button_text, button_radius, font_heading, font_body, alignment."
                    ),
                },
            },
        },
    },
}

SET_FOOTER_SOCIAL_LINKS = {
    "type": "function",
    "function": {
        "name": "set_footer_social_links",
        "description": (
            "Set or clear website/social/footer links on the email. Only use URLs the "
            "user provided or that already exist on the template — never invent domains."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "social_links": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "network": {"type": "string"},
                            "label": {"type": "string"},
                            "url": {"type": "string"},
                        },
                        "required": ["url"],
                    },
                    "description": "Replace social links (empty array clears).",
                },
                "footer_links": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "url": {"type": "string"},
                        },
                        "required": ["label", "url"],
                    },
                    "description": "Replace footer links (empty array clears).",
                },
            },
        },
    },
}

SHOW_CURRENT_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "show_current_template",
        "description": "Refresh the live preview of the current template. No field changes.",
        "parameters": {"type": "object", "properties": {}},
    },
}

SAVE_TEMPLATE = {
    "type": "function",
    "function": {
        "name": "save_template",
        "description": "Persist the current template as-is (no copy or image changes).",
        "parameters": {"type": "object", "properties": {}},
    },
}

TEMPLATE_EDIT_TOOLS = [
    APPLY_TEMPLATE_CHANGES,
    REMOVE_HERO_IMAGE,
    GENERATE_HERO_IMAGE,
    ATTACH_UPLOADED_IMAGE,
    REDESIGN_TEMPLATE_WITH_DESIGNER,
    SET_EMAIL_THEME,
    SET_FOOTER_SOCIAL_LINKS,
    HANDOFF_CAMPAIGN_LAUNCH,
    SHOW_CURRENT_TEMPLATE,
    SAVE_TEMPLATE,
    SEARCH_KNOWLEDGE,
]

_EDIT_TOOL_INDEX: dict[str, dict[str, Any]] = {
    str(t["function"]["name"]): t for t in TEMPLATE_EDIT_TOOLS
}


def template_edit_tool_schemas_for_names(names: set[str] | frozenset[str]) -> list:
    """Skill-scoped OpenAI tool schemas for template_edit module."""
    out: list = []
    for name in sorted(names):
        schema = _EDIT_TOOL_INDEX.get(str(name))
        if schema:
            out.append(schema)
    return out


def _serialize_tool_result(tool_result: dict[str, Any]) -> dict[str, Any]:
    keep = (
        "ok",
        "error",
        "intent",
        "changed",
        "used_stub",
        "image_url",
        "hero_cleared",
        "changed_keys",
        "header_image",
        "note",
        "snippets",
        "count",
        "message",
        "query",
    )
    return {k: tool_result[k] for k in keep if k in tool_result}


def _plain_llm_text(text: str) -> str:
    return strip_markdown_emphasis(strip_html_tags(str(text or "").strip()))


def _build_system_prompt(
    *,
    channel: str,
    current_fields: dict[str, Any],
    campaign: dict[str, Any],
    schema_hint: str,
    pending_uploads: list[dict[str, Any]] | None = None,
    skill_id: str = "",
    skill_instructions: str = "",
) -> str:
    from pathlib import Path

    from app.mas.runtime.load_agent_md import package_agent_md

    pending = pending_uploads or []
    pending_block = ""
    if pending:
        lines: list[str] = []
        for u in pending[:8]:
            url = str(u.get("image_url") or "").strip()
            if not url:
                continue
            status = str(u.get("status") or "available").strip() or "available"
            fname = str(u.get("filename") or "").strip()
            label = f"{fname} " if fname else ""
            lines.append(f"- [{status}] {label}{url}")
        if lines:
            pending_block = "\nAvailable uploads:\n" + "\n".join(lines) + "\n"

    skill_block = ""
    if skill_instructions.strip():
        skill_block = (
            f"\n## Active skill: {skill_id or 'edit'}\n"
            f"{skill_instructions.strip()}\n"
        )

    executor_md = package_agent_md(
        Path(__file__).resolve().parents[2] / "mas" / "executors" / "template_edit"
    )
    base = str(executor_md.get("system_prompt") or "").strip()
    runtime = (
        f"Channel: {channel}\n"
        f"{skill_block}"
        f"{pending_block}\n"
        f"{schema_hint}\n\n"
        f"{context_block(campaign)}\n\n"
        "Use search_knowledge when copy must stay grounded in product/business facts.\n"
        f"Current fields JSON:\n{json.dumps(current_fields, ensure_ascii=False)}\n"
        f"{INTERNAL_CONTEXT_RULES}"
    )
    if base:
        return f"{base}\n\n## Runtime Context\n{runtime}"
    return runtime


def _finalize_working(
    channel: str,
    working: dict[str, Any],
    current: dict[str, Any],
    *,
    campaign: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out = normalize_fields(channel, working)
    if channel == "whatsapp":
        prior_name = str(current.get("name") or "").strip()
        if prior_name:
            out["name"] = prior_name
        out = mark_whatsapp_draft_after_edit(out)
        try:
            from app.agents.template_library.channels.whatsapp.meta_rules import (
                sanitize_whatsapp_fields,
            )

            out = sanitize_whatsapp_fields(out, campaign=campaign)
        except Exception:  # noqa: BLE001
            pass
    return out


async def _emit_fields_progress(
    event_callback: Any,
    *,
    template_id: str,
    channel: str,
    fields: dict[str, Any],
    skill_id: str = "",
) -> None:
    if not event_callback or not isinstance(fields, dict):
        return
    try:
        await event_callback(
            {
                "type": "template_fields_updated",
                "template_id": template_id,
                "channel": channel,
                "skill_id": skill_id,
                "fields": fields,
            }
        )
    except Exception:  # noqa: BLE001
        pass


async def run_template_edit_tools(
    *,
    channel: str,
    current_fields: dict[str, Any],
    instruction: str,
    campaign: dict[str, Any],
    recent_messages: list[dict[str, Any]] | None = None,
    session_id: str = "",
    token: str = "",
    template_id: str = "",
    event_callback: Any = None,
    pending_image_uploads: list[dict[str, Any]] | None = None,
    skill_id: str = "",
    skill_instructions: str = "",
) -> dict[str, Any]:
    """One LLM loop: tools mutate the template; model content is the chat reply."""
    current = normalize_fields(channel, current_fields)
    schema_hint = edit_schema_hint(channel, current)
    working = dict(current)
    ui_events: list[dict[str, Any]] = []
    pending_uploads = [
        u
        for u in (pending_image_uploads or [])
        if isinstance(u, dict) and str(u.get("image_url") or "").strip()
    ]
    state: dict[str, Any] = {
        "intent": "general",
        "fields": None,
        "emit_template": False,
        "persist_fields": False,
        "used_stub": False,
        "image_url": "",
        "launch_note": "",
        "launch_channels": [],
        "schedule_mode": "",
        "schedule_at": "",
    }

    recent_bits: list[str] = []
    for row in (recent_messages or [])[-10:]:
        role = row.get("role") or "user"
        kind = row.get("kind") or "text"
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        if kind == "template":
            continue
        msg = str(payload.get("text") or row.get("text") or "").strip()
        if msg:
            recent_bits.append(f"{role}: {msg}")

    user_block = instruction
    if pending_uploads:
        lines = []
        for u in pending_uploads:
            url = str(u.get("image_url") or "").strip()
            if not url:
                continue
            status = str(u.get("status") or "available").strip() or "available"
            lines.append(f"- [{status}] {url}")
        if lines:
            user_block = (
                instruction
                + "\n\n[System] Available uploaded image URLs (session + this turn):\n"
                + "\n".join(lines)
            )
    if recent_bits:
        user_block = (
            "Recent chat (do not copy these lines verbatim):\n"
            + "\n".join(recent_bits)
            + "\n\nUser:\n"
            + user_block
        )

    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": _build_system_prompt(
                channel=channel,
                current_fields=current,
                campaign=campaign,
                schema_hint=schema_hint,
                pending_uploads=pending_uploads,
                skill_id=skill_id,
                skill_instructions=skill_instructions,
            ),
        },
        {"role": "user", "content": user_block},
    ]

    if skill_id:
        from app.mas.skills.registry import get_skill_registry
        from app.mas.skills.template_edit import TEMPLATE_EDIT_MODULE

        scoped = get_skill_registry().tools_for_skill(
            TEMPLATE_EDIT_MODULE, skill_id
        )
        tools = scoped or list(TEMPLATE_EDIT_TOOLS)
    else:
        tools = list(TEMPLATE_EDIT_TOOLS)
    allowed = {str(t["function"]["name"]) for t in tools}

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        nonlocal working
        if name not in allowed:
            return {"ok": False, "error": f"Tool {name!r} not allowed."}
        args = dict(args or {})

        if name == "apply_template_changes":
            changes = args.get("changes")
            if not isinstance(changes, dict):
                changes = {}
            section_ops = args.get("section_operations")
            replace_sections = bool(args.get("replace_sections"))
            if not changes and not section_ops:
                return {
                    "ok": False,
                    "error": "Provide changes and/or section_operations.",
                }
            snapshot = dict(working)
            if isinstance(section_ops, list) and section_ops:
                sections = list(working.get("sections") or [])
                working["sections"] = apply_section_operations(sections, section_ops)
            if changes:
                working = merge_edit_fields(
                    channel,
                    working,
                    changes,
                    replace_sections=replace_sections,
                )
            if not fields_ok_for_edit(channel, working):
                working = snapshot
                return {
                    "ok": False,
                    "error": (
                        "Changes would leave the template empty or invalid. "
                        "Apply a smaller patch."
                    ),
                }
            working = _finalize_working(channel, working, current, campaign=campaign)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            await _emit_fields_progress(
                event_callback,
                template_id=template_id,
                channel=channel,
                fields=working,
                skill_id=skill_id,
            )
            return {
                "ok": True,
                "intent": "modify",
                "changed": True,
                "changed_keys": sorted(str(k) for k in (changes or {}).keys())[:8],
            }

        if name == "remove_hero_image":
            from app.agents.image.template_attach import clear_hero_image_fields
            from app.agents.image.hero_image import fields_have_hero_image

            had_hero = fields_have_hero_image(working)
            working = clear_hero_image_fields(working)
            working = _finalize_working(channel, working, current, campaign=campaign)
            working = clear_hero_image_fields(working)
            still_has = fields_have_hero_image(working)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            if still_has:
                return {
                    "ok": False,
                    "error": "Could not clear the hero image from saved fields.",
                    "hero_cleared": False,
                    "header_image": str(working.get("header_image") or ""),
                }
            return {
                "ok": True,
                "intent": "modify",
                "changed": had_hero,
                "hero_cleared": True,
                "header_image": "",
                "note": (
                    "Hero image was already absent."
                    if not had_hero
                    else "Hero image removed from the template fields."
                ),
            }

        if name == "attach_uploaded_image":
            from app.agents.image.channel_image import build_attach_fields_for_channel

            url = str(args.get("image_url") or "").strip()
            if not url and pending_uploads:
                url = str(pending_uploads[0].get("image_url") or "").strip()
            if not url.startswith(("http://", "https://")):
                return {
                    "ok": False,
                    "error": (
                        "No uploaded image URL available. Ask the user to attach "
                        "an image, or call generate_hero_image for an AI photo."
                    ),
                }
            attach_target = str(args.get("attach_target") or "hero").strip()
            patch = build_attach_fields_for_channel(
                working,
                channel=channel,
                image_url=url,
                attach_target=attach_target,
            )
            if not patch:
                return {
                    "ok": False,
                    "error": f"Channel {channel!r} does not support hero image attach.",
                }
            working = merge_edit_fields(channel, working, patch, replace_sections=False)
            working = _finalize_working(channel, working, current, campaign=campaign)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            state["image_url"] = url
            ui_events.append(
                {
                    "type": "template_image_attached",
                    "template_id": template_id,
                    "channel": channel,
                    "image_url": url,
                    "source": "edit_upload",
                    "attach_target": attach_target,
                    "fields": working,
                }
            )
            await _emit_fields_progress(
                event_callback,
                template_id=template_id,
                channel=channel,
                fields=working,
                skill_id=skill_id,
            )
            return {
                "ok": True,
                "intent": "modify",
                "changed": True,
                "image_url": url,
                "header_image": str(working.get("header_image") or url),
                "attach_target": attach_target,
                "note": f"Uploaded image attached ({attach_target or 'hero'} slot).",
            }

        if name == "redesign_template_with_designer":
            from app.agents.template_library.edit_redesign import (
                redesign_template_with_designer,
            )
            from app.session_store import get_or_create_session

            redesign_instruction = str(
                args.get("instruction") or instruction or ""
            ).strip()
            if not redesign_instruction:
                return {
                    "ok": False,
                    "error": "Pass instruction describing the design change.",
                }
            preserve_copy = args.get("preserve_copy")
            if preserve_copy is None:
                preserve_copy = True
            preserve_hero = args.get("preserve_hero")
            if preserve_hero is None:
                preserve_hero = True
            session_blob: dict[str, Any] = {}
            if session_id and token:
                try:
                    session_blob = await get_or_create_session(
                        session_id, token=token, module="create_campaign"
                    )
                except Exception:  # noqa: BLE001
                    session_blob = {}
            knowledge = ""
            try:
                from app.knowledge_base import fetch_campaign_knowledge

                knowledge = await fetch_campaign_knowledge(
                    campaign if isinstance(campaign, dict) else {},
                    session=session_blob,
                    token=token,
                )
            except Exception:  # noqa: BLE001
                knowledge = str(session_blob.get("knowledge") or "")
            result = await redesign_template_with_designer(
                channel=channel,
                current_fields=working,
                instruction=redesign_instruction,
                campaign=campaign if isinstance(campaign, dict) else {},
                audience=(
                    session_blob.get("audience")
                    if isinstance(session_blob.get("audience"), dict)
                    else {}
                ),
                knowledge=knowledge,
                campaign_profile=(
                    session_blob.get("campaign_profile")
                    if isinstance(session_blob.get("campaign_profile"), dict)
                    else None
                ),
                company_pack=(
                    session_blob.get("company_pack")
                    if isinstance(session_blob.get("company_pack"), dict)
                    else None
                ),
                preserve_copy=bool(preserve_copy),
                preserve_hero=bool(preserve_hero),
                event_callback=event_callback,
            )
            if not result.get("ok"):
                return {
                    "ok": False,
                    "error": str(
                        result.get("error") or "Redesign failed — try a smaller change."
                    ),
                }
            new_fields = result.get("fields")
            if not isinstance(new_fields, dict) or not new_fields:
                return {"ok": False, "error": "Redesign returned empty fields."}
            if not fields_ok_for_edit(channel, new_fields):
                return {
                    "ok": False,
                    "error": "Redesign would leave the template invalid.",
                }
            working = _finalize_working(channel, new_fields, current, campaign=campaign)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            return {
                "ok": True,
                "intent": "modify",
                "changed": True,
                "note": str(result.get("note") or "Template redesigned."),
            }

        if name == "set_email_theme":
            if channel != "email":
                return {"ok": False, "error": "Theme edits are email-only."}
            from app.agents.template_generation_director.patterns import EMAIL_THEMES
            from app.agents.template_library.email_brand import (
                merge_brand_into_theme,
                normalize_theme_dict,
            )

            theme_id = str(args.get("theme_id") or "").strip().lower()
            overrides = normalize_theme_dict(args.get("theme"))
            if not theme_id and not overrides:
                return {
                    "ok": False,
                    "error": "Pass theme_id and/or theme colour overrides (#hex).",
                }
            base = dict(working.get("theme") or {})
            if theme_id:
                if theme_id not in EMAIL_THEMES:
                    return {
                        "ok": False,
                        "error": (
                            "Unknown theme_id. Use clean_light, editorial_warm, "
                            "bold_contrast, or calm_professional."
                        ),
                    }
                working["theme_id"] = theme_id
                base = dict(EMAIL_THEMES[theme_id])
            brand = working.get("brand") if isinstance(working.get("brand"), dict) else {}
            working["theme"] = merge_brand_into_theme(
                base, brand, overrides=overrides or None
            )
            working = _finalize_working(channel, working, current, campaign=campaign)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            await _emit_fields_progress(
                event_callback,
                template_id=template_id,
                channel=channel,
                fields=working,
                skill_id=skill_id,
            )
            return {
                "ok": True,
                "intent": "modify",
                "changed": True,
                "changed_keys": ["theme"] + (["theme_id"] if theme_id else []),
                "note": "Email theme/colours updated.",
            }

        if name == "set_footer_social_links":
            if channel != "email":
                return {"ok": False, "error": "Footer/social links are email-only."}
            from app.agents.template_library.email_brand import (
                apply_brand_to_email_fields,
                normalize_footer_links,
                normalize_social_links,
            )

            patch: dict[str, Any] = {}
            if "social_links" in args:
                patch["social_links"] = normalize_social_links(args.get("social_links"))
            if "footer_links" in args:
                patch["footer_links"] = normalize_footer_links(args.get("footer_links"))
            if not patch:
                return {
                    "ok": False,
                    "error": "Pass social_links and/or footer_links (empty list clears).",
                }
            if "social_links" in patch:
                working["social_links"] = patch["social_links"]
                sections = [
                    row
                    for row in (working.get("sections") or [])
                    if not (
                        isinstance(row, dict)
                        and str(row.get("type") or "").lower() == "social_links"
                    )
                ]
                working["sections"] = sections
                brand = (
                    dict(working["brand"])
                    if isinstance(working.get("brand"), dict)
                    else {}
                )
                brand["social_links"] = list(patch["social_links"])
                working["brand"] = brand
            if "footer_links" in patch:
                working["footer_links"] = patch["footer_links"]
                brand = (
                    dict(working["brand"])
                    if isinstance(working.get("brand"), dict)
                    else {}
                )
                brand["footer_links"] = list(patch["footer_links"])
                working["brand"] = brand
            working = apply_brand_to_email_fields(
                working,
                working.get("brand") if isinstance(working.get("brand"), dict) else {},
            )
            working = _finalize_working(channel, working, current, campaign=campaign)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            return {
                "ok": True,
                "intent": "modify",
                "changed": True,
                "changed_keys": list(patch.keys()),
                "note": "Footer/social links updated.",
            }

        if name == "handoff_campaign_launch":
            if not bool(args.get("user_confirmed")):
                return {
                    "ok": False,
                    "error": (
                        "Set user_confirmed=true only when the user clearly asked "
                        "to launch, schedule, or send."
                    ),
                }
            channels = [
                str(c).strip().lower()
                for c in (args.get("channels") or [])
                if str(c).strip().lower() in {"email", "whatsapp", "web", "push"}
            ]
            state["intent"] = "launch"
            state["launch_note"] = str(args.get("note") or "").strip()
            state["launch_channels"] = channels
            state["schedule_mode"] = str(args.get("schedule_mode") or "").strip().lower()
            state["schedule_at"] = str(args.get("schedule_at") or "").strip()
            state["emit_template"] = False
            state["persist_fields"] = False
            return {
                "ok": True,
                "intent": "launch",
                "note": state["launch_note"] or "Handing off to campaign launch.",
                "channels": channels,
                "schedule_mode": state["schedule_mode"] or None,
                "schedule_at": state["schedule_at"] or None,
            }

        if name == "generate_hero_image":
            from app.mas.executors.shared.image_native import is_native_image
            from app.agents.template_library.template_edit_image import (
                run_template_edit_image_pipeline,
            )

            if not is_native_image():
                return {
                    "ok": False,
                    "error": (
                        "AI image generation isn't set up here yet. "
                        "You can upload a photo instead, or ask an admin to enable it."
                    ),
                }
            if not session_id or not template_id or not token:
                return {"ok": False, "error": "Missing session or template for image tools."}
            brief = str(args.get("brief") or instruction or "").strip()
            mode = str(args.get("mode") or "generate").strip().lower()
            attach_target = str(args.get("attach_target") or "hero").strip()
            executor_id = "image_refine" if mode == "refine" else "image_generate"
            result = await run_template_edit_image_pipeline(
                session_id=session_id,
                token=token,
                template_id=template_id,
                channel=channel,
                instruction=brief,
                executor_id=executor_id,
                event_callback=event_callback,
                has_header_image=bool(working.get("header_image")),
                attach_target=attach_target,
                current_fields=working,
            )
            ui_events.extend(list(result.get("ui_events") or []))
            if not result.get("ok"):
                from app.agents.create_campaign.user_facing import user_facing_image_failure

                raw_err = str(result.get("error") or "Image generation failed.")
                return {
                    "ok": False,
                    "error": user_facing_image_failure(raw_err, kind="generate"),
                    "log_error": raw_err[:400],
                    "used_stub": bool(result.get("used_stub")),
                }
            # Merge image onto in-memory working — never replace with stale DB fields.
            from app.agents.image.channel_image import build_attach_fields_for_channel

            image_url = str(result.get("image_url") or "").strip()
            used_stub = bool(result.get("used_stub"))
            if image_url:
                patch = build_attach_fields_for_channel(
                    working,
                    channel=channel,
                    image_url=image_url,
                    attach_target=attach_target,
                )
                if patch:
                    working = merge_edit_fields(
                        channel, working, patch, replace_sections=False
                    )
            working = _finalize_working(channel, working, current, campaign=campaign)
            state["intent"] = "modify"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            state["used_stub"] = used_stub
            state["image_url"] = image_url
            await _emit_fields_progress(
                event_callback,
                template_id=template_id,
                channel=channel,
                fields=working,
                skill_id=skill_id,
            )
            return {
                "ok": True,
                "intent": "modify",
                "changed": True,
                "used_stub": used_stub,
                "image_url": image_url,
                "header_image": str(working.get("header_image") or image_url),
                "attach_target": attach_target,
                "note": (
                    "Only a blue placeholder was attached — not a real generated photo."
                    if used_stub
                    else "A new image was attached in the chosen slot."
                ),
            }

        if name == "show_current_template":
            state["intent"] = "show"
            state["fields"] = None
            state["emit_template"] = True
            state["persist_fields"] = False
            return {"ok": True, "intent": "show"}

        if name == "save_template":
            working = _finalize_working(channel, working, current, campaign=campaign)
            state["intent"] = "save"
            state["fields"] = working
            state["emit_template"] = True
            state["persist_fields"] = True
            return {"ok": True, "intent": "save"}

        if name == "search_knowledge":
            from app.knowledge_base import search_knowledge_for_agent
            from app.session_store import get_or_create_session

            query = str(args.get("query") or instruction or "").strip()
            module = str(args.get("module") or "auto").strip().lower() or "auto"
            session_blob: dict[str, Any] = {}
            if session_id and token:
                try:
                    session_blob = await get_or_create_session(
                        session_id, token=token, module="create_campaign"
                    )
                except Exception:  # noqa: BLE001
                    session_blob = {}
            out = await search_knowledge_for_agent(
                query=query
                or campaign.get("objective")
                or campaign.get("name")
                or "campaign product",
                session=session_blob,
                token=token,
                module=module,
            )
            return out

        return {"ok": False, "error": f"Unknown tool {name!r}."}

    loop_result = await run_tool_loop(
        get_llm(),
        messages,
        tools,
        dispatch=dispatch,
        max_rounds=_MAX_TOOL_ROUNDS,
        reasoning_effort=CHAT_REASONING_EFFORT,
        max_tokens=CHAT_MAX_TOKENS,
        timeout_s=CHAT_LLM_TIMEOUT_S,
        serialize_tool_result=_serialize_tool_result,
        require_content_after_tools=True,
        post_tools_nudge=_EDIT_REPLY_NUDGE,
        unavailable_reply="",
        empty_content_retries=3,
    )

    reply = _plain_llm_text(loop_result.content)
    intent = str(state.get("intent") or "general")
    fields = state.get("fields")
    emit_template = bool(state.get("emit_template"))
    persist_fields = bool(state.get("persist_fields"))
    if intent == "launch":
        return {
            "intent": "launch",
            "fields": None,
            "reply": reply,
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
            "ui_events": ui_events + list(loop_result.ui_events or []),
            "used_stub": False,
            "image_url": "",
            "used_tools": bool(loop_result.used_tools),
            "launch_note": state.get("launch_note") or "",
            "launch_channels": list(state.get("launch_channels") or []),
            "schedule_mode": state.get("schedule_mode") or "",
            "schedule_at": state.get("schedule_at") or "",
        }
    if intent == "show":
        display_fields = current
        emit_template = True
        persist_fields = False
    elif persist_fields and isinstance(fields, dict):
        display_fields = fields
        emit_template = True
    else:
        display_fields = fields if isinstance(fields, dict) else None

    return {
        "intent": intent,
        "fields": fields if isinstance(fields, dict) else None,
        "reply": reply,
        "display_fields": display_fields,
        "emit_template": emit_template and isinstance(display_fields, dict),
        "persist_fields": persist_fields and isinstance(display_fields, dict),
        "ui_events": ui_events + list(loop_result.ui_events or []),
        "used_stub": bool(state.get("used_stub")),
        "image_url": state.get("image_url") or "",
        "used_tools": bool(loop_result.used_tools),
    }
