"""Campaign recommendation coordinator — LLM + tool loop."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.agents.routing import (
    break_after_route_tool,
    filter_route_tool_calls,
    routing_postflight,
)
from app.agents.recommendations.prompts import build_system_prompt
from app.agents.recommendations.tools import ALL_TOOLS, dispatch_tool
from app.agents.recommendations.tools.handlers import generate_recommendations
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

logger = logging.getLogger(__name__)

_MAX_TOOL_ROUNDS = 3
# GENERATE_RECOMMENDATIONS JSON needs more than the default chat 384 tokens.
_REC_MAX_TOKENS = 1024
_REC_LLM_TIMEOUT_S = 18.0
_REC_TURN_BUDGET_S = 28.0
_DEFAULT_REPLY = (
    "Tell me a goal or event and I'll generate AI campaign recommendations "
    "with template previews."
)
_FALLBACK_REPLY = "Updated recommendations. Pick a card or tell me how to refine."
_EMPTY_BOARD_REPLY = (
    "No suggestions yet. Tell me a goal or audience and I'll try again."
)


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    return {"role": "system", "content": build_system_prompt(session)}


def _has_board_event(ui_events: list) -> bool:
    return any(
        isinstance(e, dict) and e.get("type") == "recommendation_cards"
        for e in ui_events
    )


async def _ensure_board_event(
    session_id: str,
    token: str,
    ui_events: list,
    event_callback: Any = None,
    *,
    reason: str,
) -> list:
    session = await get_or_create_session(
        session_id, token=token, module="recommendations"
    )
    if _has_board_event(ui_events) or session.get("recommendations"):
        return ui_events
    gen = await generate_recommendations(
        session_id,
        token,
        {"recommendations": [], "change_summary": reason},
        event_callback=event_callback,
    )
    if gen.get("ui_event"):
        ui_events.append(gen["ui_event"])
    return ui_events


async def _run_coordinator_body(
    *,
    session_id: str,
    token: str,
    user_text: str,
    ui_events: list,
    event_callback: Any = None,
) -> dict[str, Any]:
    session = await get_or_create_session(
        session_id, token=token, module="recommendations"
    )
    if session.get("past_campaigns") is None:
        from app.agents.recommendations.tools.handlers import store_past_campaigns

        try:
            await asyncio.wait_for(store_past_campaigns(session_id, token), timeout=8.0)
        except Exception:  # noqa: BLE001
            logger.warning("recommendations past-campaign prefetch failed sid=%s", session_id)
        session = await get_or_create_session(
            session_id, token=token, module="recommendations"
        )
    if user_text:
        session = await append_message(
            session_id,
            "user",
            user_text,
            token=token,
            module="recommendations",
        )

    messages: list[dict] = [_system_message(session)]
    messages.extend(chat_history_for_llm(session))

    loop_result = await run_tool_loop(
        default_llm(),
        messages,
        ALL_TOOLS,
        dispatch=lambda name, args: dispatch_tool(
            name,
            session_id,
            token,
            args,
            event_callback=event_callback,
        ),
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        max_tokens=_REC_MAX_TOKENS,
        timeout_s=_REC_LLM_TIMEOUT_S,
        timeout_retries=0,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        filter_tool_calls=filter_route_tool_calls,
        break_after_tools=break_after_route_tool,
    )
    ui_events = loop_result.ui_events
    final_content = loop_result.content
    if loop_result.timed_out and not final_content:
        final_content = _EMPTY_BOARD_REPLY
    if not final_content and loop_result.used_tools:
        final_content = _FALLBACK_REPLY
    if not final_content:
        final_content = _DEFAULT_REPLY

    final_content = strip_markdown_emphasis(final_content)
    ui_events = await _ensure_board_event(
        session_id,
        token,
        ui_events,
        event_callback,
        reason="llm finished without GENERATE_RECOMMENDATIONS",
    )
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
        session_id,
        "assistant",
        final_content,
        token=token,
        module="recommendations",
    )
    session = await get_or_create_session(
        session_id, token=token, module="recommendations"
    )
    await save_session(session, token=token)

    return {"reply": final_content, "ui_events": ui_events}


async def run_coordinator(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    try:
        return await asyncio.wait_for(
            _run_coordinator_body(
                session_id=session_id,
                token=token,
                user_text=user_text,
                ui_events=ui_events,
                event_callback=event_callback,
            ),
            timeout=_REC_TURN_BUDGET_S,
        )
    except asyncio.TimeoutError:
        logger.warning("recommendations turn timed out sid=%s", session_id)
        ui_events = await _ensure_board_event(
            session_id,
            token,
            ui_events,
            event_callback,
            reason="turn budget exceeded",
        )
        reply = _EMPTY_BOARD_REPLY
        try:
            await append_message(
                session_id,
                "assistant",
                reply,
                token=token,
                module="recommendations",
            )
        except Exception:  # noqa: BLE001
            pass
        return {"reply": reply, "ui_events": ui_events}


_RUNNER: CoordinatorGraphRunner | None = None


def get_graph() -> CoordinatorGraphRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = CoordinatorGraphRunner(run_coordinator)
    return _RUNNER


build_recommendations_graph = get_graph


async def run_recommendations_turn(
    session_id: str,
    token: str,
    user_text: str,
    event_callback=None,
) -> dict[str, Any]:
    logger.info(
        "recommendations turn sid=%s text_len=%s",
        session_id,
        len(user_text or ""),
    )
    set_request_token(token)
    result = await run_coordinator(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
    )
    session = await get_or_create_session(
        session_id, token=token, module="recommendations"
    )
    return {
        "reply": result.get("reply") or "",
        "followups": [],
        "state": public_state(session),
        "ui_events": result.get("ui_events") or [],
    }


__all__ = [
    "run_coordinator",
    "run_recommendations_turn",
    "get_graph",
    "build_recommendations_graph",
]
