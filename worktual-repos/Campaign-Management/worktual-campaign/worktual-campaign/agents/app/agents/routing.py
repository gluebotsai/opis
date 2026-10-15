"""Cross-module routing — LLM calls ROUTE_TO_MODULE (multi_agent route_to_agent style).

No regex or phrase lists for routing intent. The coordinator LLM chooses the
destination via ROUTE_TO_MODULE. pending_route is session state for the LLM
(e.g. forms campaign handoff awaiting user_confirmed on the next tool call).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]

ROUTE_TOOL_NAMES = frozenset({"ROUTE_TO_MODULE"})

MODULE_HOME_PATHS: dict[str, str] = {
    "contacts": "/audience",
    "contacts_create": "/audience/new",
    "create_campaign": "/campaigns/create",
    "monitoring": "/campaigns",
    "events": "/events",
    "reports": "/dashboard",
    "recommendations": "/campaigns/create/recommendations",
    "forms": "/events?tab=draft",
    "dashboard": "/dashboard",
}

MODULE_ALIASES: dict[str, str] = {
    "contact": "contacts",
    "audience": "contacts",
    "customer": "contacts",
    "customers": "contacts",
    "campaign": "create_campaign",
    "campaigns": "create_campaign",
    "monitor": "monitoring",
    "report": "reports",
    "recommendation": "recommendations",
    "form": "forms",
    "event": "forms",
}


def normalize_module(name: str | None) -> str | None:
    raw = str(name or "").strip().lower().replace("-", "_").replace(" ", "_")
    if not raw:
        return None
    raw = MODULE_ALIASES.get(raw, raw)
    if raw in MODULE_HOME_PATHS:
        return raw
    return None


def module_home_path(module: str | None, *, create: bool = False) -> str | None:
    mod = normalize_module(module)
    if not mod:
        return None
    if create and mod == "contacts":
        return MODULE_HOME_PATHS["contacts_create"]
    return MODULE_HOME_PATHS.get(mod)


def filter_route_tool_calls(tool_calls: list) -> list:
    """When routing, keep only ROUTE_TO_MODULE — multi_agent style."""
    if not tool_calls:
        return tool_calls
    names = {
        str((call.get("function") or {}).get("name") or "")
        for call in tool_calls
    }
    if names & ROUTE_TOOL_NAMES:
        return [
            call
            for call in tool_calls
            if str((call.get("function") or {}).get("name") or "") in ROUTE_TOOL_NAMES
        ]
    return tool_calls


def route_handoff_reply(tool_result: dict[str, Any], content: str = "") -> str:
    """Chat line after a successful ROUTE_TO_MODULE tool call."""
    return str(
        tool_result.get("message") or content or "Opening that workspace now."
    ).strip()


def break_after_route_tool(
    round_calls: list[tuple[str, dict[str, Any]]],
    content: str,
) -> str | None:
    for name, tool_result in round_calls:
        if name in ROUTE_TOOL_NAMES and tool_result.get("ok"):
            reply = route_handoff_reply(tool_result, content)
            return reply or None
    return None


def route_to_module_result(
    *,
    module: str,
    query: str = "",
    create: bool = False,
    change_summary: str = "",
) -> dict[str, Any]:
    """Build tool result + ui_event for FE navigation / module handoff."""
    mod = normalize_module(module)
    if not mod:
        return {
            "ok": False,
            "error": f"Unknown module '{module}'. "
            f"Use one of: {', '.join(sorted(MODULE_HOME_PATHS))}.",
        }
    path = module_home_path(mod, create=create or mod == "contacts_create")
    if mod == "contacts_create":
        mod = "contacts"
        create = True
        path = MODULE_HOME_PATHS["contacts_create"]
    if not path:
        return {"ok": False, "error": f"No home path for module '{mod}'."}

    payload = {
        "module": mod,
        "path": path,
        "query": str(query or "").strip(),
        "create": bool(create),
    }
    return {
        "ok": True,
        "status": "handoff",
        "module": mod,
        "path": path,
        "query": payload["query"],
        "create": payload["create"],
        "message": change_summary
        or f"Routing to {mod}. The app will open that workspace.",
        "ui_event": {"type": "navigate", "payload": payload},
    }


async def dispatch_route_to_module(args: dict[str, Any]) -> dict[str, Any]:
    """Shared ROUTE_TO_MODULE handler — uses tool args from the LLM only."""
    return route_to_module_result(
        module=str(args.get("module") or ""),
        query=str(args.get("query") or ""),
        create=bool(args.get("create")),
        change_summary=str(args.get("change_summary") or ""),
    )


ROUTE_TO_MODULE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "ROUTE_TO_MODULE",
        "description": (
            "Hand the user to another campaign workspace when their request belongs "
            "elsewhere. Infer module from meaning — paraphrases count (start a campaign, "
            "new campaign, add someone, build a form, open dashboard, etc.). Call ONLY "
            "this tool when routing — do not mix with other tools in the same turn."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "module": {
                    "type": "string",
                    "description": (
                        "Target module: contacts, create_campaign, monitoring, "
                        "reports, recommendations, forms, events, dashboard."
                    ),
                },
                "query": {
                    "type": "string",
                    "description": "Short restatement of what the user wants there.",
                },
                "create": {
                    "type": "boolean",
                    "description": (
                        "True when opening a create flow (new contact, new form/event)."
                    ),
                },
                "change_summary": {"type": "string"},
            },
            "required": ["module", "change_summary"],
        },
    },
}


@dataclass
class RoutingIntent:
    module: str
    query: str = ""
    create: bool = False
    explicit: bool = False
    needs_confirmation: bool = False


def module_display_name(module: str) -> str:
    labels = {
        "create_campaign": "Create campaign",
        "contacts": "Audience",
        "monitoring": "Campaign monitoring",
        "reports": "Dashboard",
        "recommendations": "Recommendations",
        "forms": "Events",
        "events": "Events",
    }
    return labels.get(normalize_module(module) or "", module.replace("_", " ").title())


def has_navigate_event(ui_events: list) -> bool:
    return any(
        isinstance(e, dict) and e.get("type") == "navigate" for e in (ui_events or [])
    )


async def _emit_route(
    result: dict[str, Any],
    ui_events: list,
    event_callback: ProgressCallback | None,
) -> None:
    ev = result.get("ui_event")
    if not ev:
        return
    ui_events.append(ev)
    if event_callback:
        await event_callback(ev)


async def execute_route(
    intent: RoutingIntent,
    *,
    change_summary: str = "",
) -> dict[str, Any]:
    return await dispatch_route_to_module(
        {
            "module": intent.module,
            "query": intent.query,
            "create": intent.create,
            "change_summary": change_summary
            or f"Opening {module_display_name(intent.module)}.",
        }
    )


async def routing_preflight(
    session: dict[str, Any],
    user_text: str,
    *,
    ui_events: list,
    event_callback: ProgressCallback | None = None,
) -> str | None:
    """No pre-LLM routing — handoffs are decided only via ROUTE_TO_* tool calls."""
    _ = (session, user_text, ui_events, event_callback)
    return None


async def routing_postflight(
    session: dict[str, Any],
    user_text: str,
    llm_reply: str,
    *,
    ui_events: list,
    event_callback: ProgressCallback | None = None,
) -> str:
    """Clear pending route when navigation succeeded."""
    _ = (user_text, event_callback)
    if has_navigate_event(ui_events):
        session["pending_route"] = None
    return llm_reply


def set_pending_route(
    session: dict[str, Any],
    *,
    module: str,
    query: str = "",
    create: bool = False,
) -> None:
    """Store handoff context for the LLM (e.g. forms awaiting user_confirmed)."""
    mod = normalize_module(module)
    if not mod:
        return
    session["pending_route"] = {
        "module": mod,
        "query": str(query or "").strip(),
        "create": bool(create),
    }
