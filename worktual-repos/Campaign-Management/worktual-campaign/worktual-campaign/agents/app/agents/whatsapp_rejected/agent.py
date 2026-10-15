"""Rejected WhatsApp template coordinator — LLM + tool loop."""

from __future__ import annotations

from typing import Any

from app.agents.whatsapp_rejected.prompts import build_system_prompt, welcome_text
from app.agents.whatsapp_rejected.tools import ALL_TOOLS, dispatch_tool
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
from app.text_cleanup import strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 4
_DEFAULT_REPLY = "What would you like to change in this template?"


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
            rejected_template_snapshot=session.get("whatsapp_template_snapshot") or {},
        ),
    }


async def run_whatsapp_rejected_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Bounded content_verification tool loop (MAS executor + legacy coordinator)."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or ALL_TOOLS

    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_rejected"
    )
    if user_text:
        session = await append_message(
            session_id,
            "user",
            user_text,
            token=token,
            module="whatsapp_rejected",
        )

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    messages.extend(chat_history_for_llm(session))

    async def after_each_tool(
        _name: str,
        _tool_result: dict[str, Any],
        msgs: list[dict],
    ) -> None:
        nonlocal session
        session = await get_or_create_session(
            session_id, token=token, module="whatsapp_rejected"
        )
        if system_content:
            msgs[0] = {"role": "system", "content": system_content}
        else:
            msgs[0] = _system_message(session)

    loop_result = await run_tool_loop(
        _llm(),
        messages,
        active_tools,
        dispatch=lambda name, args: dispatch_tool(
            name,
            session_id,
            token,
            args,
            event_callback=event_callback,
        ),
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        after_each_tool=after_each_tool,
    )
    ui_events = loop_result.ui_events
    final_content = loop_result.content or _DEFAULT_REPLY

    if not final_content:
        snap = session.get("whatsapp_template_snapshot") or {}
        final_content = welcome_text(
            snap.get("name"), snap.get("rejected_reason") or snap.get("rejectedReason")
        )

    final_content = strip_markdown_emphasis(final_content)
    await append_message(
        session_id,
        "assistant",
        final_content,
        token=token,
        module="whatsapp_rejected",
    )
    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_rejected"
    )
    await save_session(session, token=token)

    return {
        "reply": final_content,
        "ui_events": ui_events,
        "state": public_state(session),
    }


async def run_coordinator(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    turn = await run_whatsapp_rejected_executor_turn(
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


async def run_whatsapp_rejected_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
) -> dict[str, Any]:
    set_request_token(token)
    turn = await run_whatsapp_rejected_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
    )
    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_rejected"
    )
    return {
        "reply": turn.get("reply") or "",
        "ui_events": turn.get("ui_events") or [],
        "state": turn.get("state") or public_state(session),
        "messages": session.get("messages") or [],
    }


__all__ = [
    "run_coordinator",
    "run_whatsapp_rejected_executor_turn",
    "run_whatsapp_rejected_turn",
    "welcome_text",
    "get_graph",
    "build_graph",
]
