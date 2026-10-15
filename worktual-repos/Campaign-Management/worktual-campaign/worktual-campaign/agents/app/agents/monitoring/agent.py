"""Campaign monitoring coordinator — LLM + tool loop."""

from __future__ import annotations

from typing import Any

from app.agents.monitoring.prompts import build_system_prompt, welcome_text
from app.agents.reports.org_context import resolve_session_context
from app.agents.monitoring.tools import ALL_TOOLS, dispatch_tool
from app.agents.routing import (
    break_after_route_tool,
    filter_route_tool_calls,
    routing_postflight,
)
from app.llm import LLM_UNAVAILABLE_REPLY
from app.request_context import set_request_token
from app.runtime.agent import CoordinatorGraphRunner, default_llm, run_tool_loop
from app.session_store import (
    append_message,
    chat_history_for_llm,
    get_or_create_session,
    public_state,
    save_session,
)
from app.text_cleanup import strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 4
_DEFAULT_REPLY = (
    "Ask for a campaign status report, or list live / scheduled / past campaigns."
)
_FALLBACK_REPLY = "Updated. What would you like to check next?"


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    return {"role": "system", "content": build_system_prompt(session)}


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


async def run_monitoring_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    executor_id: str = "monitoring",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Bounded monitoring/recovery tool loop (MAS executors + legacy coordinator)."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or ALL_TOOLS

    session = await get_or_create_session(
        session_id, token=token, module="monitoring"
    )
    await resolve_session_context(session, token)
    if user_text:
        session = await append_message(
            session_id, "user", user_text, token=token, module="monitoring"
        )

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    messages.extend(chat_history_for_llm(session))

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        return await _dispatch_tool(
            session_id, token, event_callback, name, args
        )

    async def after_each_tool(_name: str, _result: dict[str, Any], msgs: list[dict]) -> None:
        if system_content:
            msgs[0] = {"role": "system", "content": system_content}
        else:
            msgs[0] = _system_message(session)

    loop_result = await run_tool_loop(
        default_llm(),
        messages,
        active_tools,
        dispatch=dispatch,
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        filter_tool_calls=filter_route_tool_calls,
        break_after_tools=break_after_route_tool,
        after_each_tool=after_each_tool if system_content else None,
    )
    ui_events = loop_result.ui_events
    final_content = loop_result.content

    if not final_content and loop_result.used_tools:
        final_content = _FALLBACK_REPLY
    if not final_content:
        final_content = _DEFAULT_REPLY

    final_content = strip_markdown_emphasis(final_content)
    if user_text:
        final_content = await routing_postflight(
            session,
            user_text,
            final_content,
            ui_events=ui_events,
            event_callback=event_callback,
        )
        await save_session(session, token=token)

    await append_message(
        session_id, "assistant", final_content, token=token, module="monitoring"
    )
    session = await get_or_create_session(
        session_id, token=token, module="monitoring"
    )
    await save_session(session, token=token)

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
    result = await run_monitoring_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        ui_events=ui_events,
        event_callback=event_callback,
    )
    return {"reply": result.get("reply") or "", "ui_events": result.get("ui_events") or []}


_RUNNER: CoordinatorGraphRunner | None = None


def get_graph() -> CoordinatorGraphRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = CoordinatorGraphRunner(run_coordinator)
    return _RUNNER


build_monitoring_graph = get_graph


async def run_monitoring_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
) -> dict[str, Any]:
    set_request_token(token)
    result = await run_coordinator(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
    )
    session = await get_or_create_session(
        session_id, token=token, module="monitoring"
    )
    return {
        "reply": result.get("reply") or "",
        "ui_events": result.get("ui_events") or [],
        "state": public_state(session),
        "messages": session.get("messages") or [],
    }


__all__ = [
    "run_coordinator",
    "run_monitoring_executor_turn",
    "run_monitoring_turn",
    "welcome_text",
    "get_graph",
    "build_monitoring_graph",
]
