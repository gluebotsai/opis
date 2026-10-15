"""One LLM tool loop per edit-space turn (no regex intent, no compose router)."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.template_edit.definition import (
    industry_runtime_block,
    load_specialist,
)
from app.agents.template_edit.memory import (
    append_memory_note,
    get_preferences,
    get_working,
    push_undo,
    save_working,
)
from app.agents.template_edit.snapshot import (
    catalog_for_prompt,
    compact_live_snapshot,
    image_urls_on_fields,
)
from app.agents.template_edit.tools.handlers import (
    dispatch_edit_tool,
    serialize_tool_result,
)
from app.agents.template_edit.tools.schemas import schemas_for_names
from app.agents.template_library.fields import normalize_fields
from app.agents.template_library.shared import get_llm
from app.llm import CHAT_LLM_TIMEOUT_S, CHAT_MAX_TOKENS, CHAT_REASONING_EFFORT
from app.runtime.agent import run_tool_loop
from app.text_cleanup import strip_html_tags, strip_markdown_emphasis

_log = logging.getLogger(__name__)

_REPLY_NUDGE = (
    "Write a short plain-text reply to the user from the tool results. "
    "Do not copy a script. Do not claim a change unless a tool returned ok."
)


def _plain(text: str) -> str:
    return strip_markdown_emphasis(strip_html_tags(str(text or "").strip()))


def _recent_text(messages: list[dict[str, Any]] | None) -> list[str]:
    bits: list[str] = []
    for row in (messages or [])[-12:]:
        if not isinstance(row, dict) or row.get("kind") == "template":
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        msg = str(payload.get("text") or row.get("text") or "").strip()
        if not msg:
            continue
        role = str(row.get("role") or "user")
        bits.append(f"{role}: {msg[:280]}")
    return bits


async def run_template_edit_agent(
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
    session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """LLM + tools + memory. Channel comes from the open card, not chat parsing."""
    from app.agents.image.user_assets import session_image_library
    from app.session_store import get_or_create_session, save_session

    specialist = load_specialist(channel)
    spec_ch = specialist.channel
    raw = current_fields if isinstance(current_fields, dict) else {}
    from app.mas.phase2_compose.domain import is_compose_html_fields

    if spec_ch == "email" and is_compose_html_fields(raw):
        current = dict(raw)
    else:
        current = normalize_fields(spec_ch, raw)
        for key, val in raw.items():
            if key not in current and val not in (None, "", [], {}):
                current[key] = val
    working = dict(current)
    sess = session if isinstance(session, dict) else {}
    if session_id and token and not sess:
        try:
            sess = await get_or_create_session(session_id, token=token)
        except Exception:  # noqa: BLE001
            sess = {}

    library = session_image_library(
        sess,
        turn_uploads=pending_image_uploads,
        on_template_urls=image_urls_on_fields(working),
        edit_space=True,
    )
    working_row = get_working(sess, template_id)
    prefs = get_preferences(sess)
    soft = prefs.get("soft") if isinstance(prefs.get("soft"), dict) else {}
    snap = compact_live_snapshot(channel=spec_ch, fields=working)
    runtime = (
        f"Open channel (from the card, not chat): {spec_ch}\n"
        f"template_id={template_id}\n"
        f"undo_depth={len(working_row.get('past') or [])} "
        f"redo_depth={len(working_row.get('future') or [])}\n"
        f"last_tool_note={working_row.get('last_tool_note') or ''}\n"
        f"Live template snapshot:\n{json.dumps(snap, ensure_ascii=False)}\n"
        f"Session image library:\n{json.dumps(catalog_for_prompt(library), ensure_ascii=False)}\n"
        f"Industry / brand:\n{industry_runtime_block(sess)}\n"
        f"Soft preferences: {json.dumps(soft, ensure_ascii=False)}\n"
    )
    system = specialist.system_prompt(runtime)

    user_text = str(instruction or "").strip()
    if not user_text and library:
        user_text = "(Image attached this turn — see the session image library.)"
    recent = _recent_text(recent_messages)
    user_block = user_text
    if recent:
        user_block = (
            "Recent chat:\n" + "\n".join(recent) + "\n\nUser:\n" + user_text
        )

    state: dict[str, Any] = {
        "intent": "general",
        "fields": None,
        "emit_template": False,
        "persist_fields": False,
        "image_url": "",
        "launch_note": "",
        "launch_channels": [],
        "schedule_mode": "",
        "schedule_at": "",
        "last_note": "",
    }
    ctx: dict[str, Any] = {
        "allowed": set(specialist.tool_names),
        "channel": spec_ch,
        "working": working,
        "current": current,
        "campaign": campaign if isinstance(campaign, dict) else {},
        "session": sess,
        "library": library,
        "template_id": template_id,
        "token": token,
        "state": state,
        "event_callback": event_callback,
        "working_row": working_row,
        "push_undo": lambda: None,
    }

    def _push_undo() -> None:
        ctx["working_row"] = push_undo(sess, template_id, dict(ctx["working"]))

    ctx["push_undo"] = _push_undo

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        try:
            result = await dispatch_edit_tool(name, args, ctx=ctx)
        except Exception as exc:  # noqa: BLE001
            _log.warning("edit tool %s failed: %s", name, exc)
            return {"ok": False, "error": "That step failed. Try again or describe it another way."}
        note = str(result.get("note") or result.get("error") or "")
        if note:
            ctx["working_row"]["last_tool_note"] = note[:400]
        return result

    loop = await run_tool_loop(
        llm=get_llm(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_block},
        ],
        tools=schemas_for_names(specialist.tool_names),
        dispatch=dispatch,
        max_rounds=8,
        timeout_s=min(90.0, CHAT_LLM_TIMEOUT_S),
        timeout_retries=1,
        max_tokens=CHAT_MAX_TOKENS,
        reasoning_effort=CHAT_REASONING_EFFORT,
        require_content_after_tools=True,
        post_tools_nudge=_REPLY_NUDGE,
        empty_content_retries=2,
        disable_thinking=True,
        serialize_tool_result=serialize_tool_result,
        unavailable_reply="",
    )

    working = ctx["working"] if isinstance(ctx.get("working"), dict) else working
    row = get_working(sess, template_id)
    row["last_tool_note"] = str(
        ctx["working_row"].get("last_tool_note") or row.get("last_tool_note") or ""
    )
    row["last_kb"] = str(ctx["working_row"].get("last_kb") or row.get("last_kb") or "")
    save_working(sess, template_id, row)
    if state.get("persist_fields") and isinstance(working, dict):
        append_memory_note(sess, state.get("last_note") or "template updated")
    if session_id:
        try:
            await save_session(sess, token=token or None)
        except Exception:  # noqa: BLE001
            _log.warning("edit session save failed template_id=%s", template_id)

    reply = _plain(loop.content)
    intent = str(state.get("intent") or "general")
    if intent == "launch":
        return {
            "intent": "launch",
            "fields": None,
            "reply": reply,
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
            "ui_events": list(loop.ui_events or []),
            "used_stub": False,
            "image_url": "",
            "used_tools": bool(loop.used_tools),
            "launch_note": state.get("launch_note") or "",
            "launch_channels": list(state.get("launch_channels") or []),
            "schedule_mode": state.get("schedule_mode") or "",
            "schedule_at": state.get("schedule_at") or "",
            "skill_id": specialist.name,
        }

    persist = bool(state.get("persist_fields")) and isinstance(working, dict)
    return {
        "intent": intent,
        "fields": working if persist else None,
        "reply": reply,
        "display_fields": working if persist else (working if intent == "show" else None),
        "emit_template": persist,
        "persist_fields": persist,
        "ui_events": list(loop.ui_events or []),
        "used_stub": False,
        "image_url": str(state.get("image_url") or ""),
        "used_tools": bool(loop.used_tools),
        "skill_id": specialist.name,
    }
