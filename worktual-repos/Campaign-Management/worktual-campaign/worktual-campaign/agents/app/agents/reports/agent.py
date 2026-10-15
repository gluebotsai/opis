"""Unified Reports & Analytics coordinator — LLM + tool loop + chat visuals."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.agents.reports.analytics_visual import (
    build_visual_from_campaign_report,
    build_visual_from_monitor_totals,
)
from app.agents.reports.visual_policy import (
    analytics_for_chat_payload,
    tool_result_include_visual,
)
from app.agents.reports.org_context import (
    resolve_organization_id,
    resolve_session_context,
)
from app.agents.reports.prompts import (
    SESSION_WELCOME_USER,
    build_system_prompt,
    welcome_text,
)
from app.agents.reports.tools import ALL_TOOLS, dispatch_tool
from app.agents.routing import (
    break_after_route_tool,
    filter_route_tool_calls,
    routing_postflight,
)
from app.llm import CHAT_MAX_TOKENS, CHAT_REASONING_EFFORT, LLM_UNAVAILABLE_REPLY
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

_MAX_TOOL_ROUNDS = 5
_MAX_HISTORY = 12
_MENU_NUDGE = (
    "Do not offer a menu. Call ask_ontology for analytics / past-campaign graph "
    "questions, query_analytics for KPI/report metrics, or LIST_MONITOR_CAMPAIGNS "
    "for names/lists, then answer with real data."
)


def _system_message(session: dict[str, Any]) -> dict[str, str]:
    events = session.get("events_snapshot") or {}
    meta = {
        "events_launched": len(events.get("launched") or []),
        "events_drafts": len(events.get("drafts") or []),
        "events_submissions": len(events.get("submissions") or []),
    }
    period = session.get("dashboard_period") or {}
    period_note = ""
    if isinstance(period, dict) and period.get("range"):
        period_note = (
            "Dashboard Overview period (must match GET_PORTFOLIO_PERFORMANCE):\n"
            + json.dumps(period, indent=2)
            + "\nWhen the user asks about performance without naming a new period, call "
            "GET_PORTFOLIO_PERFORMANCE with mode=launch and the same relative OR "
            "from_date/to_date from dashboard_period (custom calendar uses from_date/to_date, "
            "not relative). Pass activity_from_date/activity_to_date when present. "
            "Do not pass channels unless the user filters channels. "
            "sent/messages_sent = message deliveries; campaigns_with_send = campaign count."
        )
    snap = session.get("dashboard_snapshot")
    if isinstance(snap, dict) and snap.get("portfolio_totals"):
        snap_note = (
            "Dashboard snapshot from Overview (context only — call tools before KPI claims):\n"
            + json.dumps(
                {
                    "as_of": snap.get("as_of"),
                    "period_label": snap.get("period_label"),
                    "portfolio_totals": snap.get("portfolio_totals"),
                    "active_sends": snap.get("active_sends"),
                },
                indent=2,
            )
        )
        period_note = f"{period_note}\n\n{snap_note}" if period_note else snap_note
    return {
        "role": "system",
        "content": build_system_prompt(
            session,
            events_snapshot_availability=meta,
            dashboard_period_note=period_note or None,
        ),
    }


def _is_menu_reply(text: str) -> bool:
    t = (text or "").lower()
    return any(
        m in t
        for m in (
            "let me know which",
            "which campaign data you'd like",
            "live performance, scheduled",
            "scheduled launches, past",
        )
    )


def _extract_analytics(
    tool_results: list[tuple[str, dict[str, Any]]],
    *,
    organization_id: str,
    user_text: str = "",
) -> dict[str, Any] | None:
    """Attach KPI card only when the tool set include_visual and a visual exists."""
    for name, result in reversed(tool_results):
        if name not in ("query_analytics", "ask_semantic_layer") or not isinstance(
            result, dict
        ):
            continue
        if not tool_result_include_visual(name, result):
            continue
        analytics = result.get("analytics")
        if not analytics and isinstance(result.get("data"), dict):
            analytics = result["data"].get("analytics")
        if result.get("ok") and isinstance(analytics, dict) and analytics.get("visual"):
            return analytics_for_chat_payload(analytics)

    for name, result in reversed(tool_results):
        if not isinstance(result, dict) or not result.get("ok"):
            continue
        if not tool_result_include_visual(name, result):
            continue
        if name == "LIST_MONITOR_CAMPAIGNS":
            totals = result.get("totals_all_matched") or result.get("totals")
            if isinstance(totals, dict):
                visual = build_visual_from_monitor_totals(
                    totals=totals,
                    title="Campaign performance",
                    organization_id=organization_id,
                )
                if visual:
                    return analytics_for_chat_payload(visual)
        if name == "GET_CAMPAIGN_REPORT":
            visual = build_visual_from_campaign_report(
                report=result,
                organization_id=organization_id,
            )
            if visual:
                return analytics_for_chat_payload(visual)
        if name == "GET_PORTFOLIO_PERFORMANCE":
            totals = result.get("portfolio_totals")
            if isinstance(totals, dict):
                visual = build_visual_from_monitor_totals(
                    totals=totals,
                    title="Dashboard performance",
                    organization_id=organization_id,
                )
                if visual:
                    return analytics_for_chat_payload(visual)
    return None


def _default_suggestions(analytics: dict[str, Any] | None) -> list[str]:
    if not analytics or not analytics.get("visual"):
        return []
    source = ""
    audit = analytics.get("audit") if isinstance(analytics.get("audit"), dict) else {}
    source = str(audit.get("source") or "")
    if source == "semantic_layer":
        return [
            "Click rate for the same period",
            "How many campaigns launched this week?",
            "Best open rate campaign",
        ]
    if source == "campaign_sql":
        return [
            "Open rate this week",
            "Campaigns by status",
            "Sent volume",
        ]
    return [
        "Open rate this week",
        "List live campaigns",
        "Delivery rate",
    ]


_GROUNDING_TOOLS = frozenset(
    {
        "GET_PORTFOLIO_PERFORMANCE",
        "query_analytics",
        "ask_semantic_layer",
        "GET_OPS_FEED",
        "GET_ACTIVITY_SERIES",
        "GET_CAMPAIGN_LIVE_STATUS",
        "GET_RECENT_SEND_FAILURES",
        "LIST_MONITOR_CAMPAIGNS",
        "GET_CAMPAIGN_REPORT",
        "GET_CAMPAIGN_AUDIENCE",
        "LIST_EVENTS",
        "GET_EVENT_DETAIL",
        "ask_ontology",
    }
)


def _turn_has_grounding_tool(
    tool_results: list[tuple[str, dict[str, Any]]],
) -> bool:
    for name, result in tool_results:
        if name not in _GROUNDING_TOOLS:
            continue
        if isinstance(result, dict) and result.get("ok"):
            return True
    return False


def _reply_invents_metrics(text: str) -> bool:
    """True when the model states counts/rates without having called tools."""
    t = (text or "").lower().strip()
    if not t or not any(c.isdigit() for c in t):
        return False
    return any(
        m in t
        for m in (
            "%",
            "percent",
            "open rate",
            "click rate",
            "delivery rate",
            "sent ",
            "delivered",
            "campaigns",
            "recipients",
        )
    )


async def generate_reports_welcome(session: dict[str, Any]) -> str:
    """LLM-generated dashboard welcome (fallback to welcome_text on failure)."""
    period = session.get("dashboard_period") if isinstance(session, dict) else None
    period_note = None
    if isinstance(period, dict) and period.get("range"):
        period_note = (
            "Dashboard Overview period (for context only):\n"
            + json.dumps(period, indent=2)
        )
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": build_system_prompt(
                session,
                dashboard_period_note=period_note,
            ),
        },
        {"role": "user", "content": SESSION_WELCOME_USER},
    ]
    try:
        result = await asyncio.to_thread(
            default_llm().run,
            messages,
            [],
            CHAT_REASONING_EFFORT,
            CHAT_MAX_TOKENS,
            0.7,
        )
        text = strip_markdown_emphasis(str(result.get("content") or "")).strip()
        if text:
            return text
    except Exception:  # noqa: BLE001
        pass
    return welcome_text()


async def run_analytics_executor_turn(
    *,
    session_id: str,
    token: str,
    user_text: str = "",
    tools: list | None = None,
    system_content: str | None = None,
    module: str = "reports",
    ui_events: list | None = None,
    event_callback: Any = None,
) -> dict[str, Any]:
    """Bounded analytics tool loop (MAS executors + legacy coordinator)."""
    user_text = (user_text or "").strip()
    ui_events = list(ui_events or [])
    active_tools = tools or ALL_TOOLS
    mod = str(module or "reports").strip().lower()

    if user_text:
        await append_message(session_id, "user", user_text, token=token, module=mod)

    session = await get_or_create_session(session_id, token=token, module=mod)
    await resolve_session_context(session, token)
    org_id = await resolve_organization_id(session, token)

    if system_content:
        messages: list[dict] = [{"role": "system", "content": system_content}]
    else:
        messages = [_system_message(session)]
    history = chat_history_for_llm(session)
    if len(history) > _MAX_HISTORY:
        history = history[-_MAX_HISTORY:]
    messages.extend(history)

    def _after_no_tools(round_i: int, content: str) -> str | None:
        # Greetings / small-talk: allow LLM text with no tools.
        # Only nudge when the model menus the user or invents KPI numbers.
        if round_i != 0 or not user_text:
            return None
        if _is_menu_reply(content):
            return _MENU_NUDGE
        if _reply_invents_metrics(content):
            return (
                "Call GET_PORTFOLIO_PERFORMANCE (Dashboard parity) or another grounding tool "
                "before stating any count or rate. Use relative/from_date/to_date from "
                "dashboard_period. Never invent KPIs."
            )
        return None

    def _serialize_tool(result: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(result, dict):
            return {}
        out = dict(result)
        analytics = out.get("analytics")
        if isinstance(analytics, dict):
            findings = analytics.get("findings") if isinstance(analytics.get("findings"), dict) else {}
            audit = analytics.get("audit") if isinstance(analytics.get("audit"), dict) else {}
            out["analytics_summary"] = {
                "summary": findings.get("summary"),
                "source": audit.get("source"),
                "metricIds": audit.get("metricIds"),
                "has_visual": bool(analytics.get("visual")),
            }
            out.pop("analytics", None)
        out.pop("raw", None)
        return out

    async def after_each_tool(_name: str, _result: dict[str, Any], msgs: list[dict]) -> None:
        if system_content:
            msgs[0] = {"role": "system", "content": system_content}
        else:
            msgs[0] = _system_message(session)

    loop_result = await run_tool_loop(
        default_llm(),
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
        after_no_tools=_after_no_tools,
        serialize_tool_result=_serialize_tool,
        filter_tool_calls=filter_route_tool_calls,
        break_after_tools=break_after_route_tool,
        after_each_tool=after_each_tool if system_content else None,
    )
    ui_events = loop_result.ui_events
    final_content = loop_result.content
    tool_results = list(loop_result.round_tool_results or [])

    analytics = _extract_analytics(
        tool_results, organization_id=org_id, user_text=user_text
    )
    chat_analytics = analytics_for_chat_payload(analytics)
    suggestions = _default_suggestions(chat_analytics)

    if not final_content:
        if analytics and isinstance(analytics.get("findings"), dict):
            final_content = str(analytics["findings"].get("summary") or "").strip()
        if not final_content and loop_result.used_tools:
            final_content = (
                "I retrieved campaign/event data but could not format a reply. "
                "Please rephrase."
            )
        elif not final_content:
            # Last resort only when the model returned nothing usable.
            final_content = (
                "What would you like to know — live or past campaign counts, "
                "open rate, click rate, or a list of campaign names?"
            )

    # Do not rewrite LLM greetings into a fixed string — that made the
    # dashboard agent feel static. Soft-block menus only when no tools ran.
    if _is_menu_reply(final_content) and not loop_result.used_tools:
        final_content = (
            "I'll look that up with campaign tools. "
            "Please ask once more (for example: how many live campaigns, "
            "or list live campaign names)."
        )

    if (
        user_text
        and _reply_invents_metrics(final_content)
        and not _turn_has_grounding_tool(tool_results)
    ):
        final_content = (
            "I need to load live campaign data before quoting numbers. "
            "Ask again and I'll use GET_PORTFOLIO_PERFORMANCE for period KPIs "
            "or GET_OPS_FEED for live sends."
        )
        chat_analytics = None
        suggestions = []

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

    meta: dict[str, Any] | None = None
    if chat_analytics:
        meta = {"analytics": chat_analytics, "suggestions": suggestions}

    await append_message(
        session_id,
        "assistant",
        final_content,
        meta=meta,
        token=token,
        module=mod,
    )
    session = await get_or_create_session(session_id, token=token, module=mod)
    await save_session(session, token=token)

    return {
        "reply": final_content,
        "ui_events": ui_events,
        "analytics": chat_analytics,
        "suggestions": suggestions,
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
    result = await run_analytics_executor_turn(
        session_id=session_id,
        token=token,
        user_text=user_text,
        ui_events=ui_events,
        event_callback=event_callback,
    )
    return {
        "reply": result.get("reply") or "",
        "ui_events": result.get("ui_events") or [],
        "analytics": result.get("analytics"),
        "suggestions": result.get("suggestions") or [],
    }


_RUNNER: CoordinatorGraphRunner | None = None


def get_graph() -> CoordinatorGraphRunner:
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = CoordinatorGraphRunner(run_coordinator)
    return _RUNNER


build_graph = get_graph


async def run_reports_turn(
    session_id: str,
    token: str,
    user_text: str,
    *,
    event_callback: Any = None,
) -> dict[str, Any]:
    set_request_token(token)
    result = await run_coordinator(
        session_id=session_id,
        token=token,
        user_text=user_text,
        event_callback=event_callback,
    )
    session = await get_or_create_session(
        session_id, token=token, module="reports"
    )
    return {
        "reply": result.get("reply") or "",
        "ui_events": result.get("ui_events") or [],
        "analytics": result.get("analytics"),
        "suggestions": result.get("suggestions") or [],
        "state": public_state(session),
        "messages": session.get("messages") or [],
    }


__all__ = [
    "run_coordinator",
    "run_analytics_executor_turn",
    "run_reports_turn",
    "generate_reports_welcome",
    "welcome_text",
    "get_graph",
    "build_graph",
]
