"""Form Event coordinator — multi_agent-style LLM + tool loop."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.agents.forms.prompts import build_system_prompt
from app.agents.forms.tools import ALL_TOOLS, ROUTE_TOOLS, SPECIALIST_TOOLS, dispatch_tool
from app.agents.routing import routing_postflight
from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    FORMS_CHAT_MAX_TOKENS,
    FORMS_CHAT_REASONING_EFFORT,
    LLM_UNAVAILABLE_REPLY,
    OpenAILLM,
)
from app.request_context import set_request_token
from app.runtime.agent import run_tool_loop
from app.session_store import (
    append_message,
    chat_history_for_llm,
    get_or_create_session,
    public_state,
    save_session,
)
from app.text_cleanup import strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 5
_TURN_TIMEOUT_SEC = 120.0
_DEFAULT_APPLIED_REPLY = (
    "Updated the form. Check the live preview on the right."
)
_APPLY_FAILED_REPLY = LLM_UNAVAILABLE_REPLY
_DEFAULT_GREET = (
    "Hi — I can help you create and edit this form, then hand off to Create campaign "
    "when you're ready. What do you need (goal, fields, colors, or layout)?"
)


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    design = session.get("form_design") if isinstance(session.get("form_design"), dict) else {}
    fields = design.get("fields") if isinstance(design.get("fields"), list) else []
    pending = session.get("pending_route")
    pending_campaign = (
        isinstance(pending, dict) and pending.get("module") == "create_campaign"
    )
    public_url = str(design.get("public_url") or design.get("publicUrl") or "").strip()
    compact = {
        "module": session.get("module"),
        "form_event_id": session.get("form_event_id"),
        "title": design.get("title"),
        "fields_in_order": [
            str(f.get("label") or "")
            for f in fields
            if isinstance(f, dict)
        ],
        "field_count": len(fields),
        "published": bool(public_url),
        "public_url": public_url or None,
        "pending_campaign_handoff": pending_campaign,
        "stage": session.get("stage"),
    }
    return {
        "role": "system",
        "content": build_system_prompt(session, form_session_summary=compact),
    }


def _reply_after_apply(content: str, change_summary: str) -> str:
    summary = (change_summary or "").strip()
    text = (content or "").strip()
    if summary and (not text or len(text) > 280):
        return summary
    if text:
        return text
    if summary:
        return summary
    return _DEFAULT_APPLIED_REPLY


def _serialize_tool_result(tool_result: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": tool_result.get("ok"),
        "change_summary": tool_result.get("change_summary"),
        "error": tool_result.get("error"),
        "field_count": tool_result.get("field_count"),
        "message": tool_result.get("message"),
        "module": tool_result.get("module"),
        "path": tool_result.get("path"),
        "status": tool_result.get("status"),
        "needs_confirmation": tool_result.get("needs_confirmation"),
        "published": tool_result.get("published"),
    }


def _break_after_tools(
    round_calls: list[tuple[str, dict[str, Any]]],
    content: str,
) -> str | None:
    for name, tool_result in round_calls:
        if name in ROUTE_TOOLS:
            if tool_result.get("status") == "pending_confirmation":
                text = (content or "").strip()
                if text:
                    return text
                return None
            if tool_result.get("ok") and tool_result.get("ui_event"):
                return str(
                    tool_result.get("message")
                    or tool_result.get("change_summary")
                    or content
                    or "Opening Create campaign — you'll continue there."
                ).strip()
            if tool_result.get("error"):
                return str(tool_result.get("error"))
    for name, tool_result in round_calls:
        if name in SPECIALIST_TOOLS and tool_result.get("ok"):
            return _reply_after_apply(
                content,
                str(tool_result.get("change_summary") or ""),
            )
    errors = [
        str(tr.get("error"))
        for _, tr in round_calls
        if tr.get("error")
    ]
    if errors:
        return _APPLY_FAILED_REPLY
    return None


async def _dispatch_tool(
    session_id: str,
    token: str,
    event_callback: Any,
    name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    return await dispatch_tool(
        name,
        session_id,
        token,
        args,
        event_callback=event_callback,
    )


def _filter_tool_calls(tool_calls: list) -> list:
    if not tool_calls:
        return tool_calls
    names = {
        str((call.get("function") or {}).get("name") or "")
        for call in tool_calls
    }
    if names & ROUTE_TOOLS:
        return [
            call
            for call in tool_calls
            if str((call.get("function") or {}).get("name") or "") in ROUTE_TOOLS
        ]
    return tool_calls


async def run_forms_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    executor_id: str = "form_theme",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Bounded Forms tool loop for one MAS executor."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or ALL_TOOLS

    session = await get_or_create_session(session_id, token=token, module="forms")
    if user_text:
        session = await append_message(
            session_id,
            "user",
            user_text,
            token=token,
            module="forms",
        )

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    messages.extend(chat_history_for_llm(session))

    async def dispatch_with_route_guard(name: str, args: dict[str, Any]) -> dict[str, Any]:
        return await _dispatch_tool(session_id, token, event_callback, name, args)

    loop_result = await run_tool_loop(
        _llm(),
        messages,
        active_tools,
        dispatch=dispatch_with_route_guard,
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        reasoning_effort=FORMS_CHAT_REASONING_EFFORT,
        max_tokens=min(FORMS_CHAT_MAX_TOKENS, 768),
        timeout_s=CHAT_LLM_TIMEOUT_S,
        unavailable_reply=_APPLY_FAILED_REPLY,
        serialize_tool_result=_serialize_tool_result,
        filter_tool_calls=_filter_tool_calls,
        break_after_tools=_break_after_tools,
    )
    ui_events = loop_result.ui_events
    final_content = loop_result.content

    if not final_content and loop_result.used_tools:
        final_content = _DEFAULT_APPLIED_REPLY
    if not final_content:
        final_content = _DEFAULT_GREET

    final_content = strip_markdown_emphasis(final_content)
    session = await get_or_create_session(session_id, token=token, module="forms")
    final_content = await routing_postflight(
        session,
        user_text,
        final_content,
        ui_events=ui_events,
        event_callback=event_callback,
    )
    await save_session(session, token=token)

    await append_message(
        session_id,
        "assistant",
        final_content,
        token=token,
        module="forms",
    )

    return {
        "reply": final_content,
        "ui_events": ui_events,
        "state": public_state(session),
        "executor_id": executor_id,
    }


async def run_coordinator(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Main forms loop: LLM → tools → reply."""
    turn = await run_forms_executor_turn(
        session_id=session_id,
        token=token,
        user_text=(user_text or "").strip(),
        ui_events=list(ui_events or []),
        event_callback=event_callback,
    )
    return {"reply": turn.get("reply") or "", "ui_events": turn.get("ui_events") or []}


class _CoordinatorRunner:
    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        return await run_coordinator(
            session_id=str(state["session_id"]),
            token=str(state["token"]),
            user_text=str(state.get("user_text") or ""),
            ui_events=list(state.get("ui_events") or []),
            event_callback=state.get("event_callback"),
        )


_RUNNER: _CoordinatorRunner | None = None


def get_graph() -> _CoordinatorRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = _CoordinatorRunner()
    return _RUNNER


build_forms_graph = get_graph


async def run_forms_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
) -> dict[str, Any]:
    set_request_token(token)
    try:
        result = await asyncio.wait_for(
            run_coordinator(
                session_id=session_id,
                token=token,
                user_text=user_text,
                event_callback=event_callback,
            ),
            timeout=_TURN_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        session = await get_or_create_session(
            session_id, token=token, module="forms"
        )
        reply = (
            "That took too long. Try a simpler edit in one sentence."
        )
        await append_message(
            session_id, "assistant", reply, token=token, module="forms"
        )
        return {
            "reply": reply,
            "followups": [],
            "state": public_state(session),
            "ui_events": [],
        }

    session = await get_or_create_session(session_id, token=token, module="forms")
    return {
        "reply": result.get("reply") or "",
        "followups": [],
        "state": public_state(session),
        "ui_events": result.get("ui_events") or [],
    }


__all__ = [
    "run_coordinator",
    "run_forms_executor_turn",
    "run_forms_turn",
    "get_graph",
    "build_forms_graph",
]
