"""Permission policy + agent routing from cheap intent (no second LLM hop)."""

from __future__ import annotations

import logging
import re

from app.state import AgentName, AgentState

_log = logging.getLogger(__name__)

# Intent → specialist agent
INTENT_TO_AGENT: dict[str, AgentName] = {
    "GREETING": "general",
    "CHAT": "general",
    "NAVIGATE": "general",
    "TICKET": "tickets",
    "SEARCH": "tickets",
    "CREATE": "tickets",
    "UPDATE": "tickets",
    "CUSTOMER": "customers",
    "KB": "kb",
    "TEAMS": "teams",
    "MACRO": "macros",
    "ADMIN": "admin",
}


def _route_for_active_workflow(state: AgentState) -> AgentName | None:
    """Workflow Manager fields beat generic UPDATE→tickets mapping."""
    wf = (state.get("current_workflow") or "").strip().lower()
    if wf in ("create_team", "add_team_members", "delete_team"):
        return "teams"
    if wf in ("create_kb", "manage_kb_category"):
        return "kb"
    if wf in ("create_macro",):
        return "macros"
    if wf in ("create_priority", "create_status"):
        return "admin"
    if wf in ("escalate", "create_ticket"):
        return "tickets"
    if wf in ("create_customer",):
        return "customers"
    kb = state.get("kb_draft") if isinstance(state.get("kb_draft"), dict) else None
    if kb and (
        str(kb.get("flow") or "").strip().lower() == "manage_category"
        or str(kb.get("awaiting") or "").strip().lower()
        in {"manage_mode", "category_name", "title", "category", "body", "confirm"}
    ):
        return "kb"
    team = state.get("team_draft") if isinstance(state.get("team_draft"), dict) else None
    if team and str(team.get("awaiting") or "") in (
        "name",
        "confirm",
        "members",
        "members_names",
        "members_team",
        "delete_confirm",
    ):
        return "teams"
    return None

# Intents that must not bind Express tools (GeneralAgent fast path)
# CHAT still binds tools — "yeah, show today's metrics" is often labeled CHAT.
NO_TOOL_INTENTS: frozenset[str] = frozenset({"GREETING", "NAVIGATE"})


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _state_user_text(state: dict | AgentState | None) -> str:
    if not isinstance(state, dict):
        return ""
    direct = str(state.get("user_text") or "").strip()
    if direct:
        return direct
    messages = state.get("messages")
    if isinstance(messages, list) and messages:
        last = messages[-1]
        content = getattr(last, "content", None)
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(last, dict):
            return str(last.get("content") or last.get("text") or "").strip()
    return ""


def _route_from_page(page: str | None) -> AgentName | None:
    """Idle page → specialist. Labels and view ids both appear as `page`."""
    p = str(page or "").strip().lower()
    if not p:
        return None
    if "escalation-directory" in p or "escalation directory" in p:
        return "admin"
    if "customer" in p:
        return "customers"
    if p in {"kb"} or "knowledge" in p or "articles" in p:
        return "kb"
    if any(t in p for t in ("agent-queues",)) or (
        ("teams" in p or p == "queues")
        and "ticket" not in p
        and "inbox" not in p
        and "team-queue" not in p
        and "all tickets" not in p
    ):
        return "teams"
    if "macro" in p:
        return "macros"
    if any(
        t in p
        for t in (
            "priorit",
            "statuses",
            "analytics",
            "csat",
            "audit",
            "org pref",
            "org-pref",
            "settings",
        )
    ):
        return "admin"
    if any(
        t in p
        for t in (
            "home",
            "dashboard",
            "team inbox",
            "team-inbox",
            "unassigned",
            "all tickets",
            "team-queue",
            "tickets",
            "assigned",
            "work-board",
            "search",
        )
    ):
        return "tickets"
    return None


def _looks_like_kb_category_task(text: str) -> bool:
    """Article category manage/add — not ticket Priorities catalog."""
    low = (text or "").strip().lower()
    if not low:
        return False
    if re.search(r"\bpriorit(y|ies)\b", low):
        return False
    if re.search(
        r"\b(manage\s+categor(y|ies)|add(\s+a|\s+new)?\s+categor(y|ies)|"
        r"new\s+categor(y|ies)|kb\s+categor(y|ies)|article\s+categor(y|ies)|"
        r"categor(y|ies)\s+(for|on|in)\s+(kb|knowledge|article))\b",
        low,
    ):
        return True
    if re.search(r"\bcategor(y|ies)\b", low) and re.search(
        r"\b(kb|knowledge|article|articles)\b", low
    ):
        return True
    return False


def apply_policy(state: AgentState) -> dict:
    """
    Coarse conversational allow/deny + map intent → route.

    CREATE ticket without permission → general help (no invent create flow).
    Idle routing: cheap-intent LLM label + current page default specialist.
    """
    intent = (state.get("intent") or "CHAT").strip().upper()
    can_create = state.get("can_create_ticket")
    out: dict = {"intent": intent}
    role = (state.get("user_role") or "").strip().lower()
    if role in ("portal_guest", "portal_customer"):
        if intent in ("CREATE", "TICKET", "SEARCH", "UPDATE") and role == "portal_guest":
            out["route"] = "general"
            out["tools_allowed"] = True
            out["policy_note"] = "portal_auth_required"
            return out
        # Portal chat: KB specialist + LLM tools (list_kb, get_kb, portal tickets).
        out["route"] = "kb"
        out["tools_allowed"] = True
        return out

    if intent == "CREATE" and can_create is False:
        # Still route somewhere safe; agent prompt will refuse create
        out["route"] = "tickets"
        out["policy_note"] = "create_denied"
        return out

    wf_route = _route_for_active_workflow(state)
    if wf_route:
        out["route"] = wf_route
        out["tools_allowed"] = intent not in NO_TOOL_INTENTS
        return out

    route = INTENT_TO_AGENT.get(intent, "general")
    page_route = _route_from_page(state.get("page") if isinstance(state, dict) else None)
    utt = _state_user_text(state if isinstance(state, dict) else {})
    # KB article categories must never land on Admin (Priorities tools only).
    if _looks_like_kb_category_task(utt) or (
        page_route == "kb"
        and re.search(r"\bcategor(y|ies)\b", utt.lower())
        and not re.search(r"\bpriorit(y|ies)\b", utt.lower())
    ):
        route = "kb"
        out["route"] = route
        out["intent"] = "KB"
        out["tools_allowed"] = True
        return out
    if intent in ("CUSTOMER", "KB", "TEAMS", "MACRO", "ADMIN"):
        route = INTENT_TO_AGENT[intent]
    elif intent == "SEARCH":
        route = page_route or "tickets"
    elif intent == "CHAT":
        route = page_route or "general"
    elif intent == "CREATE":
        route = page_route or "tickets"
    elif intent == "UPDATE":
        route = (
            page_route
            if page_route in {"teams", "kb", "customers", "admin", "macros"}
            else "tickets"
        )
    elif intent == "NAVIGATE":
        route = page_route or "general"
    elif intent == "TICKET":
        route = "tickets"
    elif intent == "GREETING":
        from app.agents.workflow_nlu import is_pure_greeting

        if page_route and page_route != "general" and not is_pure_greeting(utt):
            route = page_route
        else:
            route = "general"

    out["route"] = route
    out["tools_allowed"] = intent not in NO_TOOL_INTENTS
    if intent == "GREETING" and out["route"] not in (None, "", "general"):
        out["tools_allowed"] = True
    _log.info(
        "policy_route intent=%s route=%s page_route=%s tools_allowed=%s",
        intent,
        out.get("route"),
        page_route,
        out.get("tools_allowed"),
    )
    return out


def agent_router(state: AgentState) -> dict:
    """
    Ensure route is set from intent (idempotent if policy already set it).
    """
    if state.get("route") in (
        "tickets",
        "teams",
        "kb",
        "customers",
        "macros",
        "admin",
        "general",
    ):
        return {}
    return {"route": apply_policy(state).get("route") or "general"}
