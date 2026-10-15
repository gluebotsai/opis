"""In-process tool dispatch for template-edit specialists (MCP call_tool shape)."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.template_edit.memory import (
    get_preferences,
    redo_fields,
    save_working,
    undo_fields,
    update_preferences,
    verify_hard_preferences,
)
from app.agents.template_edit.snapshot import compact_live_snapshot, catalog_for_prompt
from app.agents.template_library.edit_tools import _finalize_working
from app.agents.template_library.fields import (
    apply_section_operations,
    fields_ok_for_edit,
    merge_edit_fields,
)
from app.text_cleanup import strip_html_tags

_log = logging.getLogger(__name__)

_MAX_TOOL_ATTEMPTS = 2


def _http_url(raw: Any) -> str:
    url = str(raw or "").strip()
    if url.lower().startswith(("http://", "https://")):
        return url
    if url.startswith("/api/media/") or url.startswith("/media/"):
        try:
            from app.agents.image.media_upload import absolutize_media_url

            abs_url = str(absolutize_media_url(url) or "").strip()
            if abs_url.lower().startswith(("http://", "https://")):
                return abs_url
        except Exception:  # noqa: BLE001
            return ""
    if url.startswith("{{") and url.endswith("}}"):
        return url
    return ""


async def _assert_public_url(url: str) -> str:
    """Fail-closed GET for email media. Empty string means ok."""
    from app.agents.image.media_upload import ensure_public_media_url

    _ready, err = await ensure_public_media_url(url)
    return err


def _resolve_library_url(
    library: list[dict[str, Any]],
    *,
    image_id: str = "",
    image_url: str = "",
) -> str:
    wanted_id = str(image_id or "").strip()
    wanted_url = _http_url(image_url)
    if wanted_url:
        return wanted_url
    if wanted_id:
        for row in library:
            if str(row.get("id") or "") == wanted_id:
                return _http_url(row.get("image_url"))
    this_turn = [
        _http_url(r.get("image_url"))
        for r in library
        if str(r.get("status") or "") == "this_turn"
    ]
    this_turn = [u for u in this_turn if u]
    if len(this_turn) == 1:
        return this_turn[0]
    return ""


def _mark_changed(state: dict[str, Any], working: dict[str, Any], note: str) -> dict[str, Any]:
    state["intent"] = "modify"
    state["fields"] = working
    state["emit_template"] = True
    state["persist_fields"] = True
    state["last_note"] = note
    return {"ok": True, "changed": True, "note": note}


def _safe_finalize(
    channel: str,
    working: dict[str, Any],
    current: dict[str, Any],
    campaign: dict[str, Any],
) -> dict[str, Any]:
    from app.mas.phase2_compose.domain import is_compose_html_fields

    if channel == "email" and is_compose_html_fields(working):
        return dict(working)
    prior = dict(working)
    out = _finalize_working(channel, working, current, campaign=campaign)
    for key, val in prior.items():
        if key not in out and val not in (None, "", [], {}):
            out[key] = val
    return out


async def dispatch_edit_tool(
    name: str,
    args: dict[str, Any],
    *,
    ctx: dict[str, Any],
) -> dict[str, Any]:
    allowed: set[str] = ctx["allowed"]
    if name not in allowed:
        return {"ok": False, "error": f"Tool {name!r} is not available on this channel."}
    args = dict(args or {})
    channel: str = ctx["channel"]
    working: dict[str, Any] = ctx["working"]
    current: dict[str, Any] = ctx["current"]
    campaign: dict[str, Any] = ctx["campaign"]
    session: dict[str, Any] = ctx["session"]
    library: list[dict[str, Any]] = ctx["library"]
    template_id: str = ctx["template_id"]
    token: str = ctx["token"]
    state: dict[str, Any] = ctx["state"]
    event_callback = ctx.get("event_callback")

    async def _progress(label: str, percent: int) -> None:
        if not event_callback:
            return
        try:
            await event_callback(
                {
                    "type": "template_progress",
                    "payload": {
                        "status": "editing",
                        "label": label,
                        "skill_id": name,
                        "channels": [channel],
                        "percent": percent,
                    },
                }
            )
        except Exception:  # noqa: BLE001
            pass

    if name == "show_current_template":
        snap = compact_live_snapshot(channel=channel, fields=working)
        focus = str(args.get("focus") or "").strip().lower()
        if focus == "footer":
            snap["outline"] = str(snap.get("outline") or "")[-800:]
        return {"ok": True, "snapshot": snap, "changed": False}

    if name == "list_session_images":
        return {
            "ok": True,
            "images": catalog_for_prompt(library),
            "count": len(library),
            "changed": False,
        }

    if name == "search_knowledge":
        from app.knowledge_base import search_knowledge_for_agent

        q = str(args.get("query") or "").strip()
        if not q:
            return {"ok": False, "error": "Pass a short knowledge query."}
        out = await search_knowledge_for_agent(query=q, session=session, token=token)
        snippets = str(out.get("snippets") or "").strip()
        ctx["working_row"]["last_kb"] = snippets[:1800]
        save_working(session, template_id, ctx["working_row"])
        return {
            "ok": True,
            "snippets": snippets[:1800],
            "message": str(out.get("message") or ""),
            "changed": False,
        }

    if name == "get_edit_preferences":
        return {"ok": True, "preferences": get_preferences(session), "changed": False}

    if name == "update_edit_preference":
        prefs = update_preferences(session, args)
        return {"ok": True, "preferences": prefs, "changed": False}

    if name == "verify_hard_preferences":
        return verify_hard_preferences(
            session, proposed_action=str(args.get("proposed_action") or "")
        )

    if name == "save_template":
        state["persist_fields"] = True
        state["emit_template"] = True
        state["fields"] = working
        return {"ok": True, "changed": False, "note": "Current template will be saved."}

    if name == "undo_template":
        restored, note = undo_fields(session, template_id, working)
        if restored is None:
            return {"ok": False, "error": note}
        ctx["working"] = restored
        return _mark_changed(state, restored, note)

    if name == "redo_template":
        restored, note = redo_fields(session, template_id, working)
        if restored is None:
            return {"ok": False, "error": note}
        ctx["working"] = restored
        return _mark_changed(state, restored, note)

    if name == "handoff_campaign_launch":
        if not bool(args.get("user_confirmed")):
            return {
                "ok": False,
                "error": "Set user_confirmed true only when they clearly asked to launch.",
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
        }

    if name == "attach_uploaded_image":
        url = _resolve_library_url(
            library,
            image_id=str(args.get("image_id") or ""),
            image_url=str(args.get("image_url") or ""),
        )
        if not url:
            if not library:
                return {
                    "ok": False,
                    "error": "No images in this session yet. They need to attach a photo.",
                }
            return {
                "ok": False,
                "error": "Say which image (id from the library) or attach one on this message.",
                "images": catalog_for_prompt(library),
            }
        if channel == "email":
            from app.agents.image.media_upload import ensure_public_media_url

            url, err = await ensure_public_media_url(url, token=token)
            if err:
                return {"ok": False, "error": err, "log_error": err}
        await _progress("Placing image…", 40)
        from app.mas.phase2_compose.domain import is_compose_html_fields
        from app.mas.phase2_compose.html_images import map_uploaded_image_fields
        from app.agents.image.channel_image import build_attach_fields_for_channel

        placement = str(args.get("placement") or "hero").strip().lower() or "hero"
        if channel == "email" and is_compose_html_fields(working):
            ctx["push_undo"]()
            working = map_uploaded_image_fields(working, url, placement=placement)
            ctx["working"] = working
            state["image_url"] = url
            return _mark_changed(state, working, f"Placed the image ({placement}).")
        patch = build_attach_fields_for_channel(
            working,
            channel=channel,
            image_url=url,
            attach_target=placement if placement != "bottom" else "hero",
        )
        if not patch:
            return {"ok": False, "error": "This channel cannot attach that image."}
        ctx["push_undo"]()
        working = merge_edit_fields(channel, working, patch, replace_sections=False)
        working = _safe_finalize(channel, working, current, campaign)
        ctx["working"] = working
        state["image_url"] = url
        return _mark_changed(state, working, f"Placed the image ({placement}).")

    if name in {"generate_image", "enhance_image"}:
        brief = str(args.get("brief") or "").strip()
        if not brief:
            return {
                "ok": False,
                "error": "Need a short visual brief before generating a photo.",
            }
        await _progress("Generating image…", 40)
        from app.mas.phase2_compose.executors.image import generate_compose_image_url

        placement = str(args.get("placement") or "hero").strip().lower() or "hero"
        slot_role = (
            "footer"
            if placement in {"bottom", "before_footer", "footer", "end"}
            else "hero"
        )
        plan = working.get("plan") if isinstance(working.get("plan"), dict) else {}
        last_err = ""
        gen: dict[str, Any] = {}
        for _attempt in range(_MAX_TOOL_ATTEMPTS):
            try:
                gen = await generate_compose_image_url(
                    user_prompt=brief,
                    plan=plan,
                    slot={
                        "role": slot_role,
                        "needed": True,
                        "width_px": 600,
                        "height_px": 338,
                    },
                    campaign=campaign,
                    token=token,
                )
            except Exception as exc:  # noqa: BLE001
                last_err = str(exc)[:200]
                gen = {"ok": False, "error": last_err}
            if gen.get("ok"):
                break
            last_err = str(gen.get("error") or last_err or "Image generation failed.")
        if not gen.get("ok"):
            from app.agents.create_campaign.user_facing import user_facing_image_failure

            raw_err = last_err or "Image generation failed."
            _log.warning(
                "edit %s failed channel=%s template_id=%s: %s",
                name,
                channel,
                template_id,
                raw_err[:400],
            )
            try:
                from app.mas.runtime.turn_audit_log import turn_audit_stage

                turn_audit_stage(
                    "edit_generate_image_failed",
                    tool=name,
                    error=raw_err[:400],
                )
            except Exception:  # noqa: BLE001
                pass
            return {
                "ok": False,
                "error": user_facing_image_failure(raw_err, kind="generate"),
                "log_error": raw_err[:400],
            }
        url = str(gen.get("url") or "").strip()
        if channel == "email":
            from app.agents.image.media_upload import ensure_public_media_url

            url, pub = await ensure_public_media_url(url, token=token) if url else (
                "",
                "Image generation returned no URL.",
            )
            if pub:
                return {"ok": False, "error": pub, "log_error": pub}
        library.append(
            {
                "id": f"gen-{len(library)+1}",
                "image_url": url,
                "filename": "generated.png",
                "status": "generated",
                "source": "generate",
            }
        )
        return {
            "ok": True,
            "changed": False,
            "image_url": url,
            "note": "Stored a rebuild image URL. Call request_template_change to place it.",
        }

    if name == "request_template_change":
        explanation = str(args.get("explanation") or "").strip()
        urls: list[str] = []
        raw_urls = args.get("image_urls")
        if isinstance(raw_urls, list):
            for item in raw_urls:
                got = _http_url(item)
                if got and got not in urls:
                    urls.append(got)
        extra = _http_url(args.get("image_url"))
        if extra and extra not in urls:
            urls.append(extra)
        image_id = str(args.get("image_id") or "").strip()
        if image_id:
            resolved = _resolve_library_url(library, image_id=image_id)
            if resolved and resolved not in urls:
                urls.append(resolved)
        if not explanation and not urls:
            return {
                "ok": False,
                "error": "Explain the canvas change, or pass image URLs to place.",
            }
        placement = str(args.get("placement") or "hero").strip().lower() or "hero"
        checked: list[str] = []
        for url in urls:
            ready = url
            if channel == "email":
                from app.agents.image.media_upload import ensure_public_media_url

                ready, err = await ensure_public_media_url(url, token=token)
                if err:
                    return {"ok": False, "error": err, "log_error": err}
            checked.append(ready)
        from app.agents.template_edit.canvas_runner import run_template_canvas_agent

        return await run_template_canvas_agent(
            ctx=ctx,
            explanation=explanation or "Place the listed images on the live template.",
            image_urls=checked,
            placement=placement,
        )

    if name == "remove_image":
        from app.agents.image.template_attach import clear_hero_image_fields

        ctx["push_undo"]()
        working = clear_hero_image_fields(working)
        working = _safe_finalize(channel, working, current, campaign)
        ctx["working"] = working
        return _mark_changed(state, working, "Removed the hero image.")

    if name == "edit_email_html":
        if channel != "email":
            return {"ok": False, "error": "HTML edit is email-only."}
        instruction = str(args.get("instruction") or "").strip()
        if not instruction:
            return {"ok": False, "error": "Pass the edit instruction."}
        await _progress("Updating email HTML…", 35)
        from app.mas.phase2_compose.executors.html_edit import run_html_edit_executor

        last: dict[str, Any] = {}
        for _attempt in range(_MAX_TOOL_ATTEMPTS):
            last = await run_html_edit_executor(
                {
                    "query": instruction,
                    "task_spec": {"query": instruction, "fields": working},
                    "fields": working,
                }
            )
            if last.get("ok"):
                break
        if not last.get("ok"):
            err = str(last.get("error") or last.get("message") or "Could not update the email.")
            return {"ok": False, "error": err}
        new_fields = last.get("fields") if isinstance(last.get("fields"), dict) else {}
        html = str(new_fields.get("compiled_html") or "")
        if _new_anchors_missing_href(html, str(working.get("compiled_html") or "")):
            return {
                "ok": False,
                "error": "That edit would add a button without a link. Need an https URL.",
            }
        ctx["push_undo"]()
        working = dict(working)
        working.update(new_fields)
        ctx["working"] = working
        return _mark_changed(state, working, "Updated the email.")

    if name in {"add_cta", "update_cta"}:
        url = _http_url(args.get("url"))
        if not url:
            return {
                "ok": False,
                "error": "Need an https URL (from the user, KB, or the live template) before adding a button.",
            }
        label = str(args.get("label") or "Learn more").strip() or "Learn more"
        ctx["push_undo"]()
        if channel == "email":
            html = str(working.get("compiled_html") or "")
            anchor = (
                f'<a href="{url}" style="display:inline-block;padding:10px 18px;'
                f'background:#111;color:#fff;text-decoration:none;border-radius:6px">{label}</a>'
            )
            lower = html.lower()
            close = lower.rfind("</body>")
            if close >= 0:
                html = html[:close] + f'<p style="text-align:center">{anchor}</p>' + html[close:]
            else:
                html = html + f"<p>{anchor}</p>"
            working = dict(working)
            working["compiled_html"] = html
        else:
            buttons = list(working.get("buttons") or []) if isinstance(working.get("buttons"), list) else []
            buttons.append({"text": label, "url": url, "type": "URL"})
            working = dict(working)
            working["buttons"] = buttons
            working = _safe_finalize(channel, working, current, campaign)
        ctx["working"] = working
        return _mark_changed(state, working, f"Added “{label}” → {url}.")

    if name == "remove_cta":
        ctx["push_undo"]()
        working = dict(working)
        working["buttons"] = []
        ctx["working"] = working
        return _mark_changed(state, working, "Removed CTA buttons.")

    if name == "set_footer_social_links":
        from app.agents.template_library.email_brand import (
            normalize_footer_links,
            normalize_social_links,
        )

        patch: dict[str, Any] = {}
        if "social_links" in args:
            links = normalize_social_links(args.get("social_links"))
            for row in links:
                if isinstance(row, dict) and not _http_url(row.get("url")) and str(row.get("url") or "").strip():
                    return {"ok": False, "error": "Footer/social URLs must be https (or empty to clear)."}
            patch["social_links"] = links
        if "footer_links" in args:
            links = normalize_footer_links(args.get("footer_links"))
            for row in links:
                if isinstance(row, dict) and not _http_url(row.get("url")) and str(row.get("url") or "").strip():
                    return {"ok": False, "error": "Footer/social URLs must be https (or empty to clear)."}
            patch["footer_links"] = links
        if not patch:
            return {"ok": False, "error": "Pass social_links and/or footer_links."}
        ctx["push_undo"]()
        working = dict(working)
        working.update(patch)
        working = _safe_finalize(channel, working, current, campaign)
        ctx["working"] = working
        return _mark_changed(state, working, "Updated footer/social links.")

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
            return {"ok": False, "error": "Pass theme_id and/or theme colour overrides."}
        ctx["push_undo"]()
        working = dict(working)
        base = dict(working.get("theme") or {})
        if theme_id:
            if theme_id not in EMAIL_THEMES:
                return {"ok": False, "error": "Unknown theme_id."}
            working["theme_id"] = theme_id
            base = dict(EMAIL_THEMES[theme_id])
        brand = working.get("brand") if isinstance(working.get("brand"), dict) else {}
        working["theme"] = merge_brand_into_theme(base, brand, overrides=overrides or None)
        working = _safe_finalize(channel, working, current, campaign)
        ctx["working"] = working
        return _mark_changed(state, working, "Updated the email theme.")

    if name == "redesign_template":
        from app.agents.template_library.edit_redesign import redesign_template_with_designer

        instruction = str(args.get("instruction") or "").strip()
        if not instruction:
            return {"ok": False, "error": "Pass an instruction for the redesign."}
        await _progress("Redesigning layout…", 20)
        knowledge = str(ctx["working_row"].get("last_kb") or "")
        preserve_copy = True if args.get("preserve_copy") is None else bool(args.get("preserve_copy"))
        preserve_hero = True if args.get("preserve_hero") is None else bool(args.get("preserve_hero"))
        last: dict[str, Any] = {}
        for _attempt in range(_MAX_TOOL_ATTEMPTS):
            last = await redesign_template_with_designer(
                channel=channel,
                current_fields=working,
                instruction=instruction,
                campaign=campaign,
                audience=session.get("audience") if isinstance(session.get("audience"), dict) else {},
                knowledge=knowledge,
                campaign_profile=session.get("campaign_profile")
                if isinstance(session.get("campaign_profile"), dict)
                else None,
                company_pack=session.get("company_pack")
                if isinstance(session.get("company_pack"), dict)
                else None,
                preserve_copy=preserve_copy,
                preserve_hero=preserve_hero,
                event_callback=event_callback,
            )
            if last.get("ok"):
                break
        if not last.get("ok"):
            return {"ok": False, "error": str(last.get("error") or "Redesign failed.")}
        new_fields = last.get("fields")
        if not isinstance(new_fields, dict) or not fields_ok_for_edit(channel, new_fields):
            return {"ok": False, "error": "Redesign returned empty or invalid fields."}
        ctx["push_undo"]()
        working = _safe_finalize(channel, new_fields, current, campaign)
        ctx["working"] = working
        return _mark_changed(state, working, str(last.get("note") or "Template redesigned."))

    if name == "apply_template_changes":
        changes = args.get("changes") if isinstance(args.get("changes"), dict) else {}
        section_ops = args.get("section_operations")
        if not changes and not section_ops:
            return {"ok": False, "error": "Provide changes and/or section_operations."}
        snapshot = dict(working)
        ctx["push_undo"]()
        if isinstance(section_ops, list) and section_ops:
            working["sections"] = apply_section_operations(
                list(working.get("sections") or []), section_ops
            )
        if changes:
            working = merge_edit_fields(
                channel,
                working,
                changes,
                replace_sections=bool(args.get("replace_sections")),
            )
        if not fields_ok_for_edit(channel, working):
            ctx["working"] = snapshot
            return {"ok": False, "error": "Changes would leave the template invalid."}
        working = _safe_finalize(channel, working, current, campaign)
        ctx["working"] = working
        return _mark_changed(state, working, "Updated the template fields.")

    return {"ok": False, "error": f"Unknown tool {name}."}


def _new_anchors_missing_href(updated: str, original: str) -> bool:
    """HTML safety: new <a> tags must have a non-empty href."""
    def _count_bad(html: str) -> int:
        text = html or ""
        lower = text.lower()
        bad = 0
        start = 0
        while True:
            i = lower.find("<a", start)
            if i < 0:
                break
            j = lower.find(">", i)
            if j < 0:
                break
            tag = lower[i:j]
            if "href=" not in tag or 'href=""' in tag or "href=''" in tag:
                bad += 1
            start = j + 1
        return bad

    return _count_bad(updated) > _count_bad(original)


def serialize_tool_result(tool_result: dict[str, Any]) -> dict[str, Any]:
    keep = (
        "ok",
        "error",
        "log_error",
        "note",
        "changed",
        "intent",
        "snippets",
        "count",
        "images",
        "snapshot",
        "message",
        "image_url",
        "receipt",
        "channels",
        "preferences",
        "decision",
    )
    return {k: tool_result[k] for k in keep if k in tool_result}
