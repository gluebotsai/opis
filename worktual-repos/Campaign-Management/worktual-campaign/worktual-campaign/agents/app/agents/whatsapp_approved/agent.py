"""Approved WhatsApp template coordinator — audience + direct send."""

from __future__ import annotations

from typing import Any

from app.agents.whatsapp_approved.prompts import build_system_prompt, welcome_text
from app.agents.whatsapp_approved.tools import ALL_TOOLS, dispatch_tool
from app.agents.whatsapp_approved.user_facing import (
    fact_reply_from_wa_tools,
    finalize_wa_user_reply,
)
from app.agents.create_campaign.user_facing import looks_like_internal_reply
from app.config import get_settings
from app.llm import LLM_UNAVAILABLE_REPLY, OpenAILLM
from app.request_context import set_request_token
from app.runtime.agent import CoordinatorGraphRunner, run_tool_loop
from app.session_store import (
    append_message,
    chat_history_for_llm,
    get_or_create_session,
    public_state,
    save_session,
)

_MAX_TOOL_ROUNDS = 6

_WA_STATE_TOOLS = frozenset(
    {
        "SET_AUDIENCE",
        "FILTER_CONTACTS",
        "UPLOAD_TEMPORARY_CONTACTS",
        "SEND_APPROVED_TEMPLATE",
        "LAUNCH_APPROVED_CAMPAIGN",
    }
)


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    return {
        "role": "system",
        "content": build_system_prompt(
            session,
            template_campaign_snapshot=session.get("whatsapp_template_snapshot") or {},
            current_audience=session.get("whatsapp_audience") or {},
        ),
    }


async def _emit_state(event_callback: Any, session_id: str, token: str) -> None:
    if not event_callback:
        return
    try:
        session = await get_or_create_session(
            session_id, token=token, module="whatsapp_approved"
        )
        await event_callback(
            {
                "type": "state_update",
                "state": public_state(session),
            }
        )
    except Exception:  # noqa: BLE001
        pass


async def run_whatsapp_approved_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Bounded whatsapp_approved_send tool loop (MAS executor + legacy coordinator)."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or ALL_TOOLS

    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_approved"
    )
    if user_text:
        session = await append_message(
            session_id,
            "user",
            user_text,
            token=token,
            module="whatsapp_approved",
        )

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    messages.extend(chat_history_for_llm(session))

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        nonlocal session
        tool_result = await dispatch_tool(
            name,
            session_id,
            token,
            args,
            event_callback=event_callback,
        )
        session = await get_or_create_session(
            session_id, token=token, module="whatsapp_approved"
        )
        if (
            name in _WA_STATE_TOOLS
            and isinstance(tool_result, dict)
            and tool_result.get("ok") is not False
        ):
            await _emit_state(event_callback, session_id, token)
        return tool_result

    async def after_each_tool(
        _name: str,
        _tool_result: dict[str, Any],
        msgs: list[dict],
    ) -> None:
        if system_content:
            msgs[0] = {"role": "system", "content": system_content}
        else:
            msgs[0] = _system_message(session)

    loop_result = await run_tool_loop(
        _llm(),
        messages,
        active_tools,
        dispatch=dispatch,
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        after_each_tool=after_each_tool,
        require_content_after_tools=True,
        post_tools_nudge=(
            "Reply in short HTML (<p> only). Summarize the tool result for the user. "
            "For sample CSV, paste the exact Download sample sheet anchor from CONTEXT "
            "once — do not escape or nest HTML."
        ),
    )
    ui_events = loop_result.ui_events
    final_content = (loop_result.content or "").strip()

    if getattr(loop_result, "used_tools", False) and getattr(
        loop_result, "round_tool_results", None
    ):
        leaked = looks_like_internal_reply(final_content)
        if not final_content or final_content == LLM_UNAVAILABLE_REPLY or leaked:
            fact = fact_reply_from_wa_tools(list(loop_result.round_tool_results))
            if fact:
                final_content = fact
            elif leaked:
                final_content = finalize_wa_user_reply(final_content)

    if not final_content:
        final_content = LLM_UNAVAILABLE_REPLY

    final_content = finalize_wa_user_reply(final_content)
    await append_message(
        session_id,
        "assistant",
        final_content,
        token=token,
        module="whatsapp_approved",
    )
    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_approved"
    )
    await save_session(session, token=token)
    await _emit_state(event_callback, session_id, token)

    return {
        "reply": final_content,
        "ui_events": ui_events,
        "state": public_state(session),
        "tool_results": list(loop_result.round_tool_results or []),
        "used_tools": bool(loop_result.used_tools),
    }


async def run_coordinator(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    turn = await run_whatsapp_approved_executor_turn(
        session_id=session_id,
        token=token,
        user_text=(user_text or "").strip(),
        ui_events=list(ui_events or []),
        event_callback=event_callback,
    )
    return {"reply": turn.get("reply") or "", "ui_events": turn.get("ui_events") or []}


_RUNNER: CoordinatorGraphRunner | None = None


def get_graph() -> CoordinatorGraphRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = CoordinatorGraphRunner(run_coordinator)
    return _RUNNER


build_graph = get_graph


async def run_whatsapp_approved_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
) -> dict[str, Any]:
    set_request_token(token)
    turn = await run_whatsapp_approved_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
    )
    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_approved"
    )
    return {
        "reply": turn.get("reply") or "",
        "ui_events": turn.get("ui_events") or [],
        "state": turn.get("state") or public_state(session),
        "messages": session.get("messages") or [],
    }


__all__ = [
    "run_coordinator",
    "run_whatsapp_approved_executor_turn",
    "run_whatsapp_approved_turn",
    "welcome_text",
    "get_graph",
    "build_graph",
]
