"""Events report coordinator — answers from FE snapshot; LLM + tool loop."""

from __future__ import annotations

from typing import Any

from app.agents.events_report.prompts import build_system_prompt
from app.agents.events_report.tools import ALL_TOOLS, dispatch_tool
from app.agents.routing import (
    break_after_route_tool,
    filter_route_tool_calls,
    routing_postflight,
)
from app.llm import LLM_UNAVAILABLE_REPLY
from app.request_context import set_request_token
from app.runtime.agent import default_llm, run_tool_loop
from app.session_store import (
    append_message,
    chat_history_for_llm,
    get_or_create_session,
    public_state,
    save_session,
)
from app.text_cleanup import strip_markdown_emphasis

_MAX_TOOL_ROUNDS = 4
_MAX_HISTORY = 8
_DEFAULT_REPLY = (
    "Ask about launched or draft events, submissions, opens, or a named event."
)
_FALLBACK_REPLY = "Updated. What else about your events?"


def _compact_events_summary(events: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for bucket, label in (("launched", "launched"), ("drafts", "draft")):
        for row in list(events.get(bucket) or [])[:15]:
            if not isinstance(row, dict):
                continue
            rows.append(
                {
                    "bucket": label,
                    "id": row.get("id"),
                    "title": row.get("title"),
                    "kind": row.get("kind"),
                    "status": row.get("status"),
                    "submissions": row.get("submissionCount")
                    if row.get("submissionCount") is not None
                    else row.get("submission_count"),
                    "opens": row.get("openCount")
                    if row.get("openCount") is not None
                    else row.get("open_count"),
                }
            )
    return rows


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    events = session.get("events_snapshot") or {}
    if not isinstance(events, dict):
        events = {}
    summary = {
        "launched_count": len(events.get("launched") or []),
        "drafts_count": len(events.get("drafts") or []),
        "submissions_count": len(events.get("submissions") or []),
        "events": _compact_events_summary(events),
    }
    return {
        "role": "system",
        "content": build_system_prompt(
            session,
            events_snapshot=summary,
            extra_note="Use LIST_EVENTS / GET_EVENT_DETAIL for full detail or filters.",
        ),
    }


async def run_events_report_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    ui_events: list | None = None,
    event_callback: Any = None,
    skip_append_user: bool = False,
) -> dict[str, Any]:
    """Bounded events-report tool loop (MAS analytics executor)."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or ALL_TOOLS

    if user_text and not skip_append_user:
        await append_message(
            session_id, "user", user_text, token=token, module="events_report"
        )

    session = await get_or_create_session(
        session_id, token=token, module="events_report"
    )
    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    history = chat_history_for_llm(session)
    if len(history) > _MAX_HISTORY:
        history = history[-_MAX_HISTORY:]
    messages.extend(history)

    loop_result = await run_tool_loop(
        default_llm(),
        messages,
        active_tools,
        dispatch=lambda name, args: dispatch_tool(session_id, token, name, args),
        ui_events=ui_events,
        max_rounds=_MAX_TOOL_ROUNDS,
        unavailable_reply=LLM_UNAVAILABLE_REPLY,
        break_after_tools=break_after_route_tool,
        filter_tool_calls=filter_route_tool_calls,
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
        session_id, "assistant", final_content, token=token, module="events_report"
    )
    session = await get_or_create_session(
        session_id, token=token, module="events_report"
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
    skip_append_user: bool = False,
) -> dict[str, Any]:
    result = await run_events_report_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        ui_events=ui_events,
        event_callback=event_callback,
        skip_append_user=skip_append_user,
    )
    return {"reply": result.get("reply") or "", "ui_events": result.get("ui_events") or []}


class _EventsReportRunner:
    async def ainvoke(self, state: dict[str, Any]) -> dict[str, Any]:
        return await run_coordinator(
            session_id=str(state["session_id"]),
            token=str(state["token"]),
            user_text=str(state.get("user_text") or ""),
            ui_events=list(state.get("ui_events") or []),
            event_callback=state.get("event_callback"),
            skip_append_user=bool(state.get("skip_append_user")),
        )


_RUNNER: _EventsReportRunner | None = None


def get_graph() -> _EventsReportRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = _EventsReportRunner()
    return _RUNNER


build_events_report_graph = get_graph


async def run_events_report_turn(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: Any = None,
    skip_append_user: bool = True,
) -> dict[str, Any]:
    set_request_token(token)
    result = await run_coordinator(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
        skip_append_user=skip_append_user,
    )
    session = await get_or_create_session(
        session_id, token=token, module="events_report"
    )
    return {
        "reply": result.get("reply") or "",
        "ui_events": result.get("ui_events") or [],
        "state": public_state(session),
        "messages": session.get("messages") or [],
    }


__all__ = [
    "run_coordinator",
    "run_events_report_executor_turn",
    "run_events_report_turn",
    "get_graph",
    "build_events_report_graph",
]
