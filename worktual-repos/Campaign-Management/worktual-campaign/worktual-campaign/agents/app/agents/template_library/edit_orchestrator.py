"""Template edit orchestrator — LLM main agent picks skill or replies; executor mutates."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from app.llm import CHAT_LLM_TIMEOUT_S, CHAT_MAX_TOKENS, CHAT_REASONING_EFFORT
from app.agents.template_library.shared import get_llm
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.skills.template_edit import TEMPLATE_EDIT_MODULE
from app.runtime.agent import run_tool_loop
from app.text_cleanup import strip_html_tags, strip_markdown_emphasis

logger = logging.getLogger(__name__)

_DOMAIN_PACKAGE = Path(__file__).resolve().parents[2] / "mas" / "domains" / "template_edit"


def _plain(text: str) -> str:
    return strip_markdown_emphasis(strip_html_tags(str(text or "").strip()))


def _select_tool(skill_ids: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "select_edit_skill",
            "description": (
                "Decide this turn. Pass skill_id when the template must change; "
                "pass direct_reply when answering without changing the template."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "skill_id": {
                        "type": "string",
                        "enum": skill_ids,
                        "description": "Skill for the executor. Omit when no template change.",
                    },
                    "restated_query": {
                        "type": "string",
                        "description": "What the executor should do, in your own words.",
                    },
                    "direct_reply": {
                        "type": "string",
                        "description": "User-facing reply when the template does not change.",
                    },
                },
            },
        },
    }


def _chat_only_result(reply: str) -> dict[str, Any]:
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
        "skill_id": "",
    }


async def select_template_edit_skill(
    *,
    instruction: str,
    channel: str,
    current_fields: dict[str, Any],
    recent_messages: list[dict[str, Any]] | None = None,
    pending_uploads: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Main edit agent: LLM calls select_edit_skill (chat vs modify)."""
    from app.mas.skills.registry import get_skill_registry

    registry = get_skill_registry()
    catalog = registry.list_module(TEMPLATE_EDIT_MODULE)
    valid_ids = [s.skill_id for s in catalog]
    if not valid_ids:
        logger.error("template_edit skill catalog empty")
        return {
            "ok": False,
            "direct_reply": "",
            "skill_id": "",
            "restated_query": instruction,
            "router_content": "",
            "mode": "chat",
        }

    lines = [f"- {s.skill_id}: {s.description}" for s in catalog]
    recent_bits: list[str] = []
    for row in (recent_messages or [])[-8:]:
        if not isinstance(row, dict):
            continue
        role = row.get("role") or "user"
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        msg = str(payload.get("text") or row.get("text") or "").strip()
        if msg and row.get("kind") != "template":
            recent_bits.append(f"{role}: {msg[:240]}")

    sections = current_fields.get("sections") if isinstance(current_fields, dict) else None
    types: list[str] = []
    if isinstance(sections, list):
        for row in sections[:20]:
            if isinstance(row, dict):
                types.append(str(row.get("type") or "text"))
    summary = {
        "channel": channel,
        "subject": str((current_fields or {}).get("subject") or "")[:120],
        "has_header_image": bool(
            str((current_fields or {}).get("header_image") or "").strip()
        ),
        "section_types": types,
        "pending_uploads": len(pending_uploads or []),
    }

    md = package_agent_md(_DOMAIN_PACKAGE)
    base = str(md.get("system_prompt") or "").strip()
    runtime = (
        "Skills:\n"
        + "\n".join(lines)
        + f"\n\nTemplate summary: {json.dumps(summary, ensure_ascii=False)}\n"
        "Call select_edit_skill once."
    )
    system = f"{base}\n\n## Runtime Context\n{runtime}" if base else runtime

    user = instruction
    if recent_bits:
        user = "Recent chat:\n" + "\n".join(recent_bits) + "\n\nUser:\n" + instruction

    picked: dict[str, Any] = {}

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        nonlocal picked
        if name != "select_edit_skill":
            return {"ok": False, "error": "Only select_edit_skill is allowed"}
        picked = dict(args or {})
        return {"ok": True, "selected": True}

    loop = await run_tool_loop(
        llm=get_llm(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        tools=[_select_tool(valid_ids)],
        dispatch=dispatch,
        max_rounds=2,
        timeout_s=min(45.0, CHAT_LLM_TIMEOUT_S),
        max_tokens=512,
        reasoning_effort=CHAT_REASONING_EFFORT,
        require_content_after_tools=False,
        empty_content_retries=0,
        disable_thinking=True,
        tool_choice={
            "type": "function",
            "function": {"name": "select_edit_skill"},
        },
    )

    skill_id = str(picked.get("skill_id") or "").strip().lower()
    if skill_id and skill_id not in set(valid_ids):
        logger.warning("edit skill pick invalid id=%r", skill_id)
        skill_id = ""

    direct = _plain(str(picked.get("direct_reply") or ""))
    restated = str(picked.get("restated_query") or "").strip() or instruction
    router_content = _plain(str(loop.content or ""))

    try:
        from app.mas.runtime.turn_audit_log import turn_audit_stage

        turn_audit_stage(
            "edit_skill_pick",
            mode="modify" if skill_id else "chat",
            skill_id=skill_id or None,
            has_direct_reply=bool(direct or (not skill_id and router_content)),
            llm_empty=not bool(skill_id or direct or router_content),
        )
    except Exception:  # noqa: BLE001
        pass

    if skill_id:
        return {
            "ok": True,
            "skill_id": skill_id,
            "restated_query": restated,
            "direct_reply": direct,
            "router_content": router_content,
            "mode": "modify",
        }

    return {
        "ok": True,
        "direct_reply": direct or router_content,
        "skill_id": "",
        "restated_query": instruction,
        "router_content": router_content,
        "mode": "chat",
    }


async def run_template_edit_orchestrated(
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
    """Edit-space chat agent; canvas mutations go through request_template_change."""
    from app.agents.template_edit.runner import run_template_edit_agent

    return await run_template_edit_agent(
        channel=channel,
        current_fields=current_fields,
        instruction=instruction,
        campaign=campaign,
        recent_messages=recent_messages,
        session_id=session_id,
        token=token,
        template_id=template_id,
        event_callback=event_callback,
        pending_image_uploads=pending_image_uploads,
        session=session,
    )


__all__ = [
    "run_template_edit_orchestrated",
    "select_template_edit_skill",
]
