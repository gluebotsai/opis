"""Compose-email Template chat: HTML edit + snapshot undo/redo (not LLM memory)."""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

from app.llm import CHAT_LLM_TIMEOUT_S, CHAT_REASONING_EFFORT
from app.mas.phase2_compose.domain import is_compose_html_fields
from app.runtime.agent import run_tool_loop
from app.text_cleanup import strip_html_tags, strip_markdown_emphasis

_log = logging.getLogger(__name__)

_MAX_SNAPS = 8
_HISTORY_KEY = "compose_html_history"


def _plain(text: str) -> str:
    return strip_markdown_emphasis(strip_html_tags(str(text or "").strip()))


def _snap(fields: dict[str, Any]) -> dict[str, Any]:
    keep = (
        "compiled_html",
        "html",
        "subject",
        "preheader",
        "pipeline",
        "plan",
        "image_assets",
        "knowledge",
        "brand_guidelines",
        "header_image",
        "image_url",
        "warnings",
    )
    out: dict[str, Any] = {"pipeline": "compose"}
    for key in keep:
        if key in fields:
            out[key] = deepcopy(fields.get(key))
    return out


def _apply_snap(current: dict[str, Any], snap: dict[str, Any]) -> dict[str, Any]:
    merged = dict(current)
    merged.update(deepcopy(snap) if isinstance(snap, dict) else {})
    merged["pipeline"] = "compose"
    merged.pop("sections", None)
    merged.pop("blocks", None)
    return merged


def _history_row(blob: dict[str, Any], template_id: str) -> dict[str, Any]:
    raw = blob.get(template_id) if isinstance(blob.get(template_id), dict) else {}
    past = raw.get("past") if isinstance(raw.get("past"), list) else []
    future = raw.get("future") if isinstance(raw.get("future"), list) else []
    return {
        "past": [row for row in past if isinstance(row, dict)][-_MAX_SNAPS:],
        "future": [row for row in future if isinstance(row, dict)][-_MAX_SNAPS:],
    }


async def _load_history(
    session_id: str, template_id: str, token: str
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    from app.session_store import get_or_create_session

    session = await get_or_create_session(session_id, token=token or None)
    blob = (
        session.get(_HISTORY_KEY)
        if isinstance(session.get(_HISTORY_KEY), dict)
        else {}
    )
    row = _history_row(blob, template_id)
    return session, blob, row


async def _save_history(
    session: dict[str, Any],
    blob: dict[str, Any],
    template_id: str,
    row: dict[str, Any],
    token: str,
) -> None:
    from app.session_store import save_session

    blob[template_id] = {
        "past": list(row.get("past") or [])[-_MAX_SNAPS:],
        "future": list(row.get("future") or [])[-_MAX_SNAPS:],
    }
    session[_HISTORY_KEY] = blob
    try:
        await save_session(session, token=token or None)
    except Exception:  # noqa: BLE001
        _log.warning("compose_html_history save failed template_id=%s", template_id)


def _select_tool() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "select_compose_action",
            "description": (
                "Choose how to handle this Template chat turn for a full-HTML email. "
                "Use undo/redo only when the user asked to revert or go forward a version. "
                "Use attach_upload when Available uploads lists a URL and the user wants "
                "that photo on the email (hero/banner). "
                "Use generate_image only to create a new AI photo — not to place an upload. "
                "html_edit cannot create photos. Use html_edit only "
                "for copy, colors, layout, or subject that is not a new photo. "
                "Use search_knowledge for product facts from the org KB. "
                "Use chat when no template change."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "html_edit",
                            "generate_image",
                            "attach_upload",
                            "undo",
                            "redo",
                            "chat",
                            "search_knowledge",
                        ],
                    },
                    "restated_query": {
                        "type": "string",
                        "description": (
                            "Edit instruction for html_edit, or visual brief for generate_image."
                        ),
                    },
                    "direct_reply": {
                        "type": "string",
                        "description": "Short user-facing reply.",
                    },
                },
                "required": ["action"],
            },
        },
    }


def _attachable_url(raw: Any) -> str:
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
    return ""


def _this_turn_upload_url(pending: list[dict[str, Any]] | None) -> str:
    rows = [row for row in (pending or []) if isinstance(row, dict)]
    for row in rows:
        if str(row.get("status") or "").strip().lower() != "this_turn":
            continue
        url = _attachable_url(row.get("image_url") or row.get("url"))
        if url:
            return url
    # Compact uploads from the socket often omit status.
    if len(rows) == 1:
        status = str(rows[0].get("status") or "").strip().lower()
        if status in {"", "this_turn"}:
            return _attachable_url(rows[0].get("image_url") or rows[0].get("url"))
    return ""


def _library_upload_url(pending: list[dict[str, Any]] | None) -> str:
    """Prefer this-turn photo; otherwise the newest session/gallery URL."""
    this_turn = _this_turn_upload_url(pending)
    if this_turn:
        return this_turn
    rows = [row for row in (pending or []) if isinstance(row, dict)]
    for row in reversed(rows):
        url = _attachable_url(row.get("image_url") or row.get("url"))
        if url:
            return url
    return ""


def _pending_with_chat_images(
    pending: list[dict[str, Any]] | None,
    recent_messages: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    out = [row for row in (pending or []) if isinstance(row, dict)]
    seen = {
        _attachable_url(r.get("image_url") or r.get("url")).lower()
        for r in out
        if _attachable_url(r.get("image_url") or r.get("url"))
    }
    for row in recent_messages or []:
        if not isinstance(row, dict):
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        url = _attachable_url(payload.get("image_url") or row.get("image_url"))
        if not url or url.lower() in seen:
            continue
        seen.add(url.lower())
        out.append(
            {
                "image_url": url,
                "status": "in_session",
                "source": "chat_history",
                "filename": str(payload.get("image_filename") or "")[:240],
            }
        )
    return out


async def _pick_action(
    *,
    instruction: str,
    recent_messages: list[dict[str, Any]] | None,
    can_undo: bool,
    can_redo: bool,
    pending_uploads: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from app.agents.template_library.shared import get_llm

    recent_bits: list[str] = []
    for row in (recent_messages or [])[-6:]:
        if not isinstance(row, dict):
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        msg = str(payload.get("text") or row.get("text") or "").strip()
        if msg and row.get("kind") != "template":
            recent_bits.append(f"{row.get('role') or 'user'}: {msg[:200]}")

    system = (
        "You route edits for a complete HTML email template.\n"
        "Call select_compose_action once.\n"
        f"Undo available: {str(can_undo).lower()}. Redo available: {str(can_redo).lower()}.\n"
        "If the user wants the previous version, action=undo. "
        "If they want the version after undo, action=redo. "
        "If they want to add, insert, generate, replace, or include a photo, "
        "image, hero, banner, or picture — action=generate_image unless an upload "
        "URL is listed below. Put visual direction in restated_query. "
        "html_edit cannot create photos and must not be used for image requests.\n"
        "If Available uploads lists a URL and they want that photo on the email, "
        "action=attach_upload (place as hero). Do not generate a new AI image for an upload.\n"
        "If they want visual/copy/layout changes that are not a new photo, action=html_edit. "
        "If they need product/pricing/feature facts from the knowledge base, "
        "action=search_knowledge and put the lookup in restated_query. "
        "If they only asked a question that needs no template change or KB, action=chat.\n"
        "Do not invent undo when the stack is empty — use chat and say so."
    )
    user = instruction
    if recent_bits:
        user = "Recent chat:\n" + "\n".join(recent_bits) + "\n\nUser:\n" + instruction
    upload_url = _this_turn_upload_url(pending_uploads)
    library_bits: list[str] = []
    for row in pending_uploads or []:
        if not isinstance(row, dict):
            continue
        url = _attachable_url(row.get("image_url") or row.get("url"))
        if not url:
            continue
        status = str(row.get("status") or "in_session")
        library_bits.append(f"- {status}: {url[:240]}")
    if library_bits:
        user = "Available uploads:\n" + "\n".join(library_bits[:8]) + "\n\n" + user
    elif upload_url:
        user = f"Available uploads:\n- {upload_url[:240]}\n\n{user}"

    picked: dict[str, Any] = {}

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        nonlocal picked
        if name != "select_compose_action":
            return {"ok": False, "error": "Only select_compose_action is allowed"}
        picked = dict(args or {})
        return {"ok": True}

    loop = await run_tool_loop(
        llm=get_llm(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        tools=[_select_tool()],
        dispatch=dispatch,
        max_rounds=2,
        timeout_s=min(45.0, CHAT_LLM_TIMEOUT_S),
        max_tokens=256,
        reasoning_effort=CHAT_REASONING_EFFORT,
        require_content_after_tools=False,
        empty_content_retries=0,
        disable_thinking=True,
        tool_choice={
            "type": "function",
            "function": {"name": "select_compose_action"},
        },
    )

    action = str(picked.get("action") or "").strip().lower()
    if action not in {
        "html_edit",
        "generate_image",
        "attach_upload",
        "undo",
        "redo",
        "chat",
        "search_knowledge",
    }:
        action = "html_edit"
    if action == "undo" and not can_undo:
        action = "chat"
        picked["direct_reply"] = str(
            picked.get("direct_reply") or "Nothing to undo yet."
        )
    if action == "redo" and not can_redo:
        action = "chat"
        picked["direct_reply"] = str(
            picked.get("direct_reply") or "Nothing to redo."
        )
    return {
        "action": action,
        "restated_query": str(picked.get("restated_query") or instruction).strip()
        or instruction,
        "direct_reply": _plain(str(picked.get("direct_reply") or loop.content or "")),
    }


def _ok_fields(
    fields: dict[str, Any],
    reply: str,
    *,
    skill: str,
    image_url: str = "",
    ui_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "intent": "modify",
        "fields": fields,
        "reply": reply,
        "display_fields": fields,
        "emit_template": True,
        "persist_fields": True,
        "ui_events": list(ui_events or []),
        "used_stub": False,
        "image_url": str(image_url or ""),
        "used_tools": True,
        "skill_id": skill,
    }


def _chat_only(reply: str) -> dict[str, Any]:
    return {
        "intent": "general",
        "fields": None,
        "reply": reply,
        "display_fields": None,
        "emit_template": False,
        "persist_fields": False,
        "ui_events": [],
        "used_stub": False,
        "image_url": "",
        "used_tools": False,
        "skill_id": "compose_html_edit",
    }


async def _run_generate_image(
    *,
    fields: dict[str, Any],
    pick: dict[str, Any],
    instruction: str,
    session: dict[str, Any],
    blob: dict[str, Any],
    row: dict[str, Any],
    session_id: str,
    template_id: str,
    token: str,
    event_callback: Any,
) -> dict[str, Any]:
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
                        "skill_id": "compose_html_image",
                        "channels": ["email"],
                        "percent": percent,
                    },
                }
            )
        except Exception:  # noqa: BLE001
            pass

    await _progress("Generating email image…", 40)
    from app.mas.phase2_compose.executors.image import generate_and_map_compose_images

    campaign = session.get("campaign") if isinstance(session.get("campaign"), dict) else {}
    gen = await generate_and_map_compose_images(
        fields,
        brief=str(pick.get("restated_query") or instruction),
        campaign=campaign,
        token=token,
    )
    if not gen.get("ok"):
        from app.agents.create_campaign.user_facing import user_facing_image_failure

        err = str(gen.get("error") or "Image generation failed.")
        _log.warning(
            "compose generate image failed template_id=%s: %s",
            template_id,
            err[:400],
        )
        try:
            from app.mas.runtime.turn_audit_log import turn_audit_stage

            turn_audit_stage(
                "compose_generate_image_failed",
                error=err[:400],
                template_id=template_id or None,
            )
        except Exception:  # noqa: BLE001
            pass
        return _chat_only(user_facing_image_failure(err, kind="generate"))
    new_fields = gen.get("fields") if isinstance(gen.get("fields"), dict) else {}
    url = str(gen.get("url") or new_fields.get("header_image") or "").strip()
    if not url:
        return _chat_only("Image generation returned no URL. Try again.")
    past = list(row.get("past") or [])
    past.append(_snap(fields))
    row = {"past": past[-_MAX_SNAPS:], "future": []}
    if session_id and template_id:
        await _save_history(session, blob, template_id, row, token)
    merged = _apply_snap(fields, new_fields)
    await _progress("Email image ready", 90)
    events = []
    if template_id and url:
        events.append(
            {
                "type": "template_image_attached",
                "template_id": template_id,
                "channel": "email",
                "field_key": "header_image",
                "image_url": url,
                "fields": merged,
            }
        )
    return _ok_fields(
        merged,
        str(pick.get("direct_reply") or "") or "Updated the email image.",
        skill="compose_html_image",
        image_url=url,
        ui_events=events,
    )


async def _run_attach_upload(
    *,
    fields: dict[str, Any],
    pick: dict[str, Any],
    url: str,
    session: dict[str, Any],
    blob: dict[str, Any],
    row: dict[str, Any],
    session_id: str,
    template_id: str,
    token: str,
    event_callback: Any,
) -> dict[str, Any]:
    from app.mas.phase2_compose.html_images import map_uploaded_hero_fields

    target = str(url or "").strip()
    if not target.lower().startswith(("http://", "https://")):
        return _chat_only("No uploaded image URL is available. Attach a photo and try again.")

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
                        "skill_id": "compose_html_image",
                        "channels": ["email"],
                        "percent": percent,
                    },
                }
            )
        except Exception:  # noqa: BLE001
            pass

    await _progress("Placing uploaded image…", 40)
    from app.agents.image.media_upload import ensure_public_media_url

    ready, err = await ensure_public_media_url(target, token=token)
    if ready:
        target = ready
    elif err:
        _log.warning("compose attach media probe failed: %s", err)
    if not target.lower().startswith(("http://", "https://")):
        return _chat_only(
            "I have the photo, but its file URL is not reachable yet. "
            "Upload it once more and I will place it on the email."
        )
    new_fields = map_uploaded_hero_fields(fields, target)
    html = str(new_fields.get("compiled_html") or "")
    if target not in html and not str(new_fields.get("header_image") or "").strip():
        return _chat_only("Could not place that photo on the email. Try again.")
    past = list(row.get("past") or [])
    past.append(_snap(fields))
    row = {"past": past[-_MAX_SNAPS:], "future": []}
    if session_id and template_id:
        await _save_history(session, blob, template_id, row, token)
    merged = _apply_snap(fields, new_fields)
    await _progress("Email image ready", 90)
    events = []
    if template_id and target:
        events.append(
            {
                "type": "template_image_attached",
                "template_id": template_id,
                "channel": "email",
                "field_key": "header_image",
                "image_url": target,
                "source": "edit_upload",
                "attach_target": "hero",
                "fields": merged,
            }
        )
    return _ok_fields(
        merged,
        "Placed your photo as the email hero.",
        skill="compose_html_image",
        image_url=target,
        ui_events=events,
    )


async def run_compose_html_edit(
    *,
    current_fields: dict[str, Any],
    instruction: str,
    recent_messages: list[dict[str, Any]] | None = None,
    session_id: str = "",
    token: str = "",
    template_id: str = "",
    event_callback: Any = None,
    pending_image_uploads: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Template-chat path for Phase 2 HTML: edit current compiled_html, or undo/redo snapshots."""
    fields = dict(current_fields) if isinstance(current_fields, dict) else {}
    if not is_compose_html_fields(fields):
        return _chat_only("This editor is for full HTML emails only.")

    session: dict[str, Any] = {}
    blob: dict[str, Any] = {}
    row = {"past": [], "future": []}
    if session_id and template_id:
        session, blob, row = await _load_history(session_id, template_id, token)

    pending = _pending_with_chat_images(
        [u for u in (pending_image_uploads or []) if isinstance(u, dict)],
        recent_messages,
    )
    pick = await _pick_action(
        instruction=instruction,
        recent_messages=recent_messages,
        can_undo=bool(row.get("past")),
        can_redo=bool(row.get("future")),
        pending_uploads=pending,
    )
    action = pick["action"]
    this_turn = _this_turn_upload_url(pending)
    attach_url = this_turn or _library_upload_url(pending)
    from app.agents.image.hero_image import html_has_image_placeholder

    html_needs_hero = html_has_image_placeholder(
        str(fields.get("compiled_html") or fields.get("html") or "")
    )
    if this_turn and action not in {"undo", "redo", "search_knowledge"}:
        action = "attach_upload"
    elif (
        attach_url
        and action in {"attach_upload", "generate_image"}
        and action not in {"undo", "redo", "search_knowledge"}
    ):
        action = "attach_upload"
    elif attach_url and html_needs_hero and action == "chat":
        action = "attach_upload"

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
                        "skill_id": "compose_html_edit",
                        "channels": ["email"],
                        "percent": percent,
                    },
                }
            )
        except Exception:  # noqa: BLE001
            pass

    if action == "chat":
        return _chat_only(
            pick["direct_reply"]
            or "Tell me what to change in this email, or say undo to restore the last version."
        )

    if action == "search_knowledge":
        from app.knowledge_base import search_knowledge_for_agent

        q = str(pick.get("restated_query") or instruction).strip()
        out = await search_knowledge_for_agent(
            query=q,
            session=session,
            token=token,
        )
        snippets = str(out.get("snippets") or "").strip()
        if snippets:
            reply = pick["direct_reply"] or "Here's what the knowledge base has:"
            return _chat_only(f"{reply}\n\n{snippets[:1800]}")
        return _chat_only(
            pick["direct_reply"]
            or str(out.get("message") or "No knowledge snippets for that. I can still edit the email.")
        )

    if action == "undo":
        past = list(row.get("past") or [])
        if not past:
            return _chat_only("Nothing to undo yet.")
        previous = past.pop()
        future = list(row.get("future") or [])
        future.append(_snap(fields))
        row = {"past": past, "future": future}
        if session_id and template_id:
            await _save_history(session, blob, template_id, row, token)
        restored = _apply_snap(fields, previous)
        return _ok_fields(
            restored,
            pick["direct_reply"] or "Restored the previous version of this email.",
            skill="compose_html_undo",
        )

    if action == "redo":
        future = list(row.get("future") or [])
        if not future:
            return _chat_only("Nothing to redo.")
        nxt = future.pop()
        past = list(row.get("past") or [])
        past.append(_snap(fields))
        row = {"past": past, "future": future}
        if session_id and template_id:
            await _save_history(session, blob, template_id, row, token)
        restored = _apply_snap(fields, nxt)
        return _ok_fields(
            restored,
            pick["direct_reply"] or "Reapplied the later version of this email.",
            skill="compose_html_redo",
        )

    if action == "generate_image":
        return await _run_generate_image(
            fields=fields,
            pick=pick,
            instruction=instruction,
            session=session,
            blob=blob,
            row=row,
            session_id=session_id,
            template_id=template_id,
            token=token,
            event_callback=event_callback,
        )

    if action == "attach_upload":
        if not attach_url:
            return _chat_only(
                "I don't have a photo from this chat yet. Upload one and I'll place it on the email."
            )
        return await _run_attach_upload(
            fields=fields,
            pick=pick,
            url=attach_url,
            session=session,
            blob=blob,
            row=row,
            session_id=session_id,
            template_id=template_id,
            token=token,
            event_callback=event_callback,
        )

    await _progress("Updating email HTML…", 35)
    from app.mas.phase2_compose.domain import TemplateDomain
    from app.mas.phase2_compose.executors.html_edit import html_looks_like_editor_commentary
    from app.mas.phase2_compose.html_images import (
        collect_allowed_image_urls,
        strip_untrusted_content_images,
    )

    out = await TemplateDomain().invoke(
        {
            "query": pick["restated_query"],
            "task_spec": {
                "executor_id": "html_edit",
                "query": pick["restated_query"],
                "fields": fields,
            },
            "fields": fields,
        }
    )
    err = ""
    if isinstance(out, dict):
        err = str(out.get("error") or "")
    new_fields = out.get("fields") if isinstance(out, dict) and isinstance(out.get("fields"), dict) else {}
    html = str(new_fields.get("compiled_html") or "").strip()
    original_html = str(fields.get("compiled_html") or "")
    needs_image = err == "html_edit_needs_image" or (
        bool(html) and html_looks_like_editor_commentary(html, original_html)
    )
    if needs_image:
        attach_url = this_turn or _library_upload_url(pending)
        if attach_url:
            return await _run_attach_upload(
                fields=fields,
                pick=pick,
                url=attach_url,
                session=session,
                blob=blob,
                row=row,
                session_id=session_id,
                template_id=template_id,
                token=token,
                event_callback=event_callback,
            )
        return await _run_generate_image(
            fields=fields,
            pick=pick,
            instruction=instruction,
            session=session,
            blob=blob,
            row=row,
            session_id=session_id,
            template_id=template_id,
            token=token,
            event_callback=event_callback,
        )
    if not isinstance(out, dict) or not out.get("ok"):
        return _chat_only(
            pick["direct_reply"]
            or (f"Could not update the email ({err})." if err else "Could not update the email. Try again.")
        )
    if not html:
        return _chat_only("The HTML edit came back empty. Try a shorter change.")

    new_fields["compiled_html"] = strip_untrusted_content_images(
        html,
        allowed_urls=collect_allowed_image_urls(new_fields or fields),
    )

    past = list(row.get("past") or [])
    past.append(_snap(fields))
    row = {"past": past[-_MAX_SNAPS:], "future": []}
    if session_id and template_id:
        await _save_history(session, blob, template_id, row, token)

    merged = _apply_snap(fields, new_fields)
    await _progress("Email updated", 90)
    return _ok_fields(
        merged,
        pick["direct_reply"] or "Updated the email.",
        skill="compose_html_edit",
    )
