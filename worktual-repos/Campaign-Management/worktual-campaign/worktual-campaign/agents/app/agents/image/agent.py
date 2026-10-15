"""Image MAS executor bounded tool loop."""

from __future__ import annotations

import json
from typing import Any

from app.agents.image.tools.handlers import dispatch_tool
from app.config import get_settings
from app.llm import (
    CHAT_LLM_TIMEOUT_S,
    LLM_UNAVAILABLE_REPLY,
    OpenAILLM,
)
from app.runtime.agent import run_tool_loop
from app.session_store import (
    append_message,
    chat_history_for_llm,
    get_or_create_session,
    public_state,
    save_session,
)
from app.text_cleanup import strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 6
_DEFAULT_GREET = (
    "Describe the campaign image you need — subject, setting, style, and any words "
    "on the image. I'll draft a visual brief for you to confirm before generating."
)


def _llm() -> OpenAILLM:
    s = get_settings()
    return OpenAILLM(
        api_key=s.llm_api_key,
        model_name=s.llm_model,
        base_url=s.llm_base_url,
    )


def _serialize_tool_result(tool_result: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": tool_result.get("ok"),
        "error": tool_result.get("error"),
        "image_url": tool_result.get("image_url"),
        "enhanced_prompt": tool_result.get("enhanced_prompt"),
        "change_summary": tool_result.get("change_summary"),
        "message": tool_result.get("message"),
        "needs_confirm": tool_result.get("needs_confirm"),
        "needs_image_brief": tool_result.get("needs_image_brief"),
        "awaiting_generate_confirm": tool_result.get("awaiting_generate_confirm"),
        "enhance_id": tool_result.get("enhance_id"),
    }


async def run_image_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    executor_id: str = "image_generate",
    ui_events: list | None = None,
    event_callback: Any = None,
    persist_chat: bool = True,
) -> dict[str, Any]:
    """Bounded Image tool loop for one MAS executor."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or []

    session = await get_or_create_session(session_id, token=token, module="image")
    if user_text and persist_chat:
        session = await append_message(
            session_id,
            "user",
            user_text,
            token=token,
            module="image",
        )

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [{"role": "system", "content": _DEFAULT_GREET}]
    messages.extend(chat_history_for_llm(session))

    allowed = {str(t["function"]["name"]) for t in active_tools}

    async def dispatch(name: str, args: dict[str, Any]) -> dict[str, Any]:
        if name not in allowed:
            return {"ok": False, "error": f"Tool {name!r} not allowed for this executor."}
        out = await dispatch_tool(
            name,
            session_id,
            token,
            dict(args or {}),
            event_callback=event_callback,
        )
        for ev in out.get("ui_events") or []:
            if isinstance(ev, dict):
                ui_events.append(ev)
        return out

    loop_result = await run_tool_loop(
        _llm(),
        messages,
        active_tools,
        dispatch=dispatch,
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        max_tokens=768,
        timeout_s=CHAT_LLM_TIMEOUT_S,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        serialize_tool_result=_serialize_tool_result,
    )
    ui_events = loop_result.ui_events
    final_content = (loop_result.content or "").strip()
    if not final_content and loop_result.used_tools:
        for ev in reversed(ui_events):
            if isinstance(ev, dict) and ev.get("image_url"):
                final_content = f"Image ready: {ev['image_url']}"
                break
    if not final_content:
        final_content = _DEFAULT_GREET

    final_content = strip_markdown_emphasis(final_content)
    session = await get_or_create_session(session_id, token=token, module="image")
    await save_session(session, token=token)
    if persist_chat:
        await append_message(
            session_id,
            "assistant",
            final_content,
            token=token,
            module="image",
        )

    return {
        "reply": final_content,
        "ui_events": ui_events,
        "state": public_state(session),
        "executor_id": executor_id,
    }


__all__ = ["run_image_executor_turn"]
