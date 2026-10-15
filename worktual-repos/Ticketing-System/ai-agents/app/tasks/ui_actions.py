"""Structured UI actions for the Worktual co-worker (tool-catalog style).

The model chooses actions; the web app applies them. Never treat the full user
utterance as a search string.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.messages_compat import HumanMessage, SystemMessage

from app.llm import get_llm
from app.llm_log import log_llm

UI_ACTIONS_SYSTEM = """You map a user message to UI actions for Worktual (B2B ticketing).

Return ONLY raw JSON (no markdown fences):
{
  "reply_hint": "Intent seed only — never polished chat copy",
  "actions": [ ... ]
}

reply_hint rules:
- Always start with "Intent:" — never write a finished assistant bubble.
- Mention "list on the right" ONLY for set_filter / clear_filters.
- Pure navigate → "Intent: open <module>."

Allowed actions:
1) {"type":"navigate","view":"<view>"}
   views: customers | kb | agent-queues | assigned | unassigned | team-inbox | team-queue |
          tickets-list | search | work-board | dashboard | analytics | settings | create-ticket |
          macros | audit | csat-reports | priorities | escalation-directory | org-preferences
   - "go to search" / "open search" → view "search" (NEVER tickets-list)
   - "work board" → view "work-board" (NEVER team-inbox)
   - "open teams" → view "agent-queues" (never literal "teams")
   - "write macros" / "how to write macros" / "open macros" → view "macros"
   - "csat" / "csat reports" → view "csat-reports"
   - "priorities" / "priority settings" → view "priorities"
   - "escalation directory" → view "escalation-directory"
   - "org preferences" → view "org-preferences"
   - "audit" / "audit log" → view "audit" (admin only — never for "recent activity")
   - "recent activity" / "show activity" / "latest activity" → view "dashboard"
     (Home has the Recent activity feed; NOT audit)
2) {"type":"set_filter","module":"customers|kb|teams|macros|analytics|csat|audit|directory",
    "query":"<string>", "status":"<optional>", "range":"<optional analytics/csat/audit preset>"}
   - query "" clears text search (LIST ALL when no facets)
   - query must be a short entity (name, email, ticket id) — NEVER the full sentence
   - NEVER set query to "list all", "show all", "clear filter", "all customers"
   - customers status: Active | Inactive
   - Omit facet keys you are not setting. For facet-only filters use query "".
3) {"type":"clear_filters","module":"customers|tickets|kb|teams|macros|analytics|csat|audit|directory|all"}

Rules:
- "list all" / "show all" / "clear filter" / "show everyone" → set_filter query "" (current module) or clear_filters
- "recent activity" / "show activity" → navigate dashboard (Recent activity panel — NEVER audit)
- "find customer Acme" → navigate customers + set_filter customers query "Acme"
- "active customers" → set_filter customers query "" status Active
- Pure questions ("how many customers?") → actions: []  (chat answers; no filter)
- If unsure, actions: []
- Whenever actions update a list (set_filter / clear_filters), reply_hint MUST be an Intent seed (e.g. "Intent: show all tickets; list is on the right.") — never polished chat copy.
- For pure navigate (settings / home / work board / search / kb), reply_hint is "Intent: open <module>." — do NOT say "list on the right" unless a list filter also changed.
"""


# App view ids (must match ui-frontend rbac AppModule + tickets-list alias).
_VALID_NAV_VIEWS = frozenset(
    {
        "dashboard",
        "search",
        "assigned",
        "team-queue",
        "team-inbox",
        "unassigned",
        "work-board",
        "create-ticket",
        "agent-queues",
        "kb",
        "customers",
        "analytics",
        "audit",
        "csat-reports",
        "macros",
        "priorities",
        "escalation-directory",
        "org-preferences",
        "settings",
        "tickets-list",
    }
)

_VIEW_ALIASES = {
    "teams": "agent-queues",
    "team": "agent-queues",
    "queues": "agent-queues",
    "home": "dashboard",
    "overview": "dashboard",
    "knowledge-base": "kb",
    "knowledgebase": "kb",
    "articles": "kb",
    "my-tickets": "assigned",
    "mytickets": "assigned",
    "workboard": "work-board",
    "work_board": "work-board",
    "account": "settings",
    "account-settings": "settings",
    "all-tickets": "tickets-list",
    "ticket-list": "tickets-list",
    "csat": "csat-reports",
    "csat-report": "csat-reports",
    "priority": "priorities",
    "priority-settings": "priorities",
    "escalation": "escalation-directory",
    "escalations": "escalation-directory",
    "org-prefs": "org-preferences",
    "organization-preferences": "org-preferences",
    "audit-log": "audit",
    "macro": "macros",
}


def normalize_nav_view(view: str | None) -> str | None:
    """Map aliases to canonical app view ids; drop unknowns."""
    raw = str(view or "").strip().lower().replace("_", "-")
    if not raw:
        return None
    raw = _VIEW_ALIASES.get(raw, raw)
    if raw not in _VALID_NAV_VIEWS:
        return None
    return raw


# Verbs / how-to that mean open or use a sidebar module (not count questions).
_MODULE_INTENT = re.compile(
    r"\b("
    r"open|go\s+to|show|navigate|take\s+me\s+to|switch\s+to|"
    r"write|create|new|add|edit|manage|list|use|"
    r"how\s+to|how\s+do\s+i|help\s+(?:me\s+)?(?:with|on|to)"
    r")\b"
)


def _module_nav_fallback(message: str) -> dict[str, Any] | None:
    """
    Deterministic open/go-to/write/how-to module navigation (no LLM).
    Runs before facet filters so 'go to search' is never tickets-list.
    """
    lower = message.strip().lower().rstrip("!?.")
    if not lower:
        return None

    # Count / volume questions belong to specialists — not navigate.
    if re.search(r"\b(how\s+many|how\s+much|count|total\s+number)\b", lower):
        return None

    # Facet / list filters — leave to list-all / priority handlers
    if re.search(
        r"\b(urgent|p1|p2|priority|priorty|overdue|pending|resolved|on\s*hold|"
        r"high|medium|low)\b",
        lower,
    ) and re.search(r"\b(ticket|tickets|cases?|status|channel|filter)\b", lower):
        return None
    if re.search(r"\b(active|inactive)\s+customers?\b", lower):
        return None
    if re.match(
        r"^(list|show|display|get|see|view)\s+(all|everything)\b",
        lower,
    ) or re.match(r"^(clear|reset|remove)\s+(the\s+)?(search|filter|filters)$", lower):
        return None

    def _nav(view: str, label: str, *, hint: str | None = None) -> dict[str, Any]:
        return {
            "reply_hint": hint
            or f"Intent: open {label}; acknowledge navigation.",
            "actions": [{"type": "navigate", "view": view}],
        }

    # Queue pressure lives on Home dashboard
    if re.search(r"\bqueue\s+pressure\b", lower):
        return {
            "reply_hint": (
                "Intent: open Home; user should check Queue pressure on the dashboard."
            ),
            "actions": [{"type": "navigate", "view": "dashboard"}],
        }

    # Work board before generic "team"
    if re.search(r"\bwork[\s-]?board\b", lower):
        return _nav("work-board", "Work board")

    # Search module (not "search for Acme")
    if (
        re.match(r"^(go\s+to\s+|open\s+|show\s+|navigate\s+to\s+)?search$", lower)
        or re.search(r"\b(go\s+to|open|show|navigate\s+to)\s+search\b", lower)
        or lower in ("search page", "search view", "ticket search")
    ):
        return _nav("search", "Search")

    if (
        re.search(r"\b(knowledge\s*base|\bkb\b)\b", lower)
        or lower in ("kb", "knowledge base")
    ) and (
        re.search(r"\b(open|go\s+to|show|navigate)\b", lower)
        or lower in ("kb", "knowledge base")
    ):
        return _nav("kb", "Knowledge Base")

    if re.search(r"\bsettings\b", lower) and (
        re.search(r"\b(open|go\s+to|show|navigate)\b", lower) or lower == "settings"
    ):
        return _nav("settings", "Settings")

    if re.search(r"\b(home|dashboard|overview)\b", lower) and (
        re.search(r"\b(open|go\s+to|show|navigate)\b", lower)
        or lower in ("home", "dashboard", "overview")
    ):
        return _nav("dashboard", "Home")

    # Find / search a named customer → Customers + query (before bare open).
    cust_q = None
    m = re.search(
        r"(?:find|search|show|look\s*up|about)\s+(?:a\s+|the\s+)?"
        r"(?:customer|customers|client|clients)\s+(?:named\s+|called\s+)?(.+)",
        lower,
    )
    if m:
        cust_q = m.group(1).strip(" \t\"'.,!?")
    else:
        m2 = re.search(
            r"\b(?:customer|client)\s+(?:named\s+|called\s+)(.+)",
            lower,
        )
        if m2:
            cust_q = m2.group(1).strip(" \t\"'.,!?")
    if cust_q is not None:
        if not cust_q or cust_q in ("all", "everything", "list"):
            return _nav("customers", "Customers")
        return {
            "reply_hint": _list_right_hint(f"Searching customers for {cust_q}"),
            "actions": [
                {"type": "navigate", "view": "customers"},
                {
                    "type": "set_filter",
                    "module": "customers",
                    "query": cust_q,
                },
            ],
        }

    if re.search(r"\b(customers?|clients?)\b", lower) and re.search(
        r"\b(open|go\s+to|show|navigate|list|find|search|look\s*up)\b", lower
    ):
        return _nav("customers", "Customers")

    # Team inbox is a ticket list — before generic "team(s)" → Teams module.
    if re.search(r"\bteam[\s-]?inbox\b", lower) and re.search(
        r"\b(open|go\s+to|show|navigate)\b", lower
    ):
        return _nav("team-inbox", "Team inbox")

    if re.search(r"\b(teams?|agent\s*queues?)\b", lower) and re.search(
        r"\b(open|go\s+to|show|navigate)\b", lower
    ):
        return _nav("agent-queues", "Teams")

    if re.search(r"\b(analytics|reports?|metrics|stats)\b", lower) and re.search(
        r"\b(open|go\s+to|show|navigate)\b", lower
    ) and not re.search(r"\bcsat\b", lower):
        return _nav("analytics", "Analytics")

    # --- Admin / agent config modules (sidebar parity) ---
    if re.search(r"\bmacros?\b", lower) and (
        _MODULE_INTENT.search(lower) or lower in ("macros", "macro")
    ):
        write = bool(
            re.search(r"\b(write|create|new|add|edit|how\s+to|how\s+do\s+i)\b", lower)
        )
        hint = (
            "Intent: open Macros; help them write a new macro using title and body on the right."
            if write
            else "Intent: open Macros; acknowledge navigation."
        )
        return _nav("macros", "Macros", hint=hint)

    # Recent activity lives on Home dashboard — never Audit log.
    if re.search(
        r"\b(recent|latest|today'?s)?\s*activit(y|ies)\b"
        r"|\b(show|open|view|see)\s+(my\s+)?(recent\s+)?activit",
        lower,
    ) and not re.search(r"\baudit\b", lower):
        return _nav(
            "dashboard",
            "Home",
            hint="Intent: open Home dashboard Recent activity feed.",
        )

    if re.search(r"\baudit(\s+log)?\b", lower) and (
        _MODULE_INTENT.search(lower) or "audit" in lower
    ):
        return _nav("audit", "Audit log")

    if re.search(r"\bcsat(\s+reports?)?\b", lower) and (
        _MODULE_INTENT.search(lower) or lower.startswith("csat")
    ):
        return _nav("csat-reports", "CSAT reports")

    if re.search(r"\bpriorit(y|ies)\b", lower) and (
        _MODULE_INTENT.search(lower)
        or lower in ("priorities", "priority")
        or re.search(r"\b(settings?|catalog|labels?)\b", lower)
    ):
        # Avoid stealing "high priority tickets"
        if re.search(r"\b(ticket|tickets|cases?)\b", lower):
            return None
        return _nav("priorities", "Priorities")

    if re.search(r"\bescalation\s+director(y|ies)\b", lower) or (
        re.search(r"\bescalation\b", lower)
        and re.search(r"\b(directory|open|go\s+to|show|navigate|manage)\b", lower)
        and not re.search(r"\b(ticket|tickets|escalate\s+(a\s+)?ticket)\b", lower)
    ):
        return _nav("escalation-directory", "Escalation directory")

    if re.search(
        r"\b(org(anization)?\s+preferences?|org\s+prefs?)\b", lower
    ) and (
        _MODULE_INTENT.search(lower)
        or re.search(r"\b(org(anization)?\s+preferences?|org\s+prefs?)\b", lower)
    ):
        return _nav("org-preferences", "Org preferences")

    return None


def actions_for_navigate_intent(
    message: str, *, page: str | None = None
) -> list[dict[str, Any]]:
    """
    Explicit navigate/filter actions for a NAVIGATE turn.

    Deterministic module map only — never invent a view from specialist labels
    or a count/Q&A phrase.
    """
    del page  # page is reserved for callers; module map is utterance-owned
    nav = _module_nav_fallback(message)
    if not nav:
        return []
    return [a for a in (nav.get("actions") or []) if isinstance(a, dict)]


def _list_right_hint(what: str) -> str:
    """Intent seed for list updates — phrase LLM writes the user-facing reply."""
    base = (what or "Intent: updated the list").rstrip(".")
    if base.lower().startswith("intent:"):
        return f"{base}; list is on the right."
    return f"Intent: {base}; list is on the right."


def _extract_json_obj(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        parsed = json.loads(m.group(0))
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        return None
    return None


def _module_from_page(page: str | None) -> str | None:
    p = (page or "").strip().lower()
    # Create-ticket wizard is NOT the tickets list — never infer tickets filters here.
    if "create" in p and "ticket" in p:
        return None
    if "customer" in p:
        return "customers"
    if "knowledge" in p or p == "kb" or "article" in p:
        return "kb"
    # Teams module view id contains "queue" but is not a ticket queue
    if p in ("teams", "agent-queues") or p.replace(" ", "") == "agentqueues":
        return "teams"
    # Ticket views first (Team inbox / team-queue contain "team" but filter tickets)
    if any(
        x in p
        for x in (
            "ticket",
            "inbox",
            "unassigned",
            "assigned",
            "search",
            "queue",
        )
    ):
        return "tickets"
    if "team" in p:
        return "teams"
    if "macro" in p:
        return "macros"
    if "csat" in p:
        return "csat"
    if "analytic" in p or "report" in p:
        return "analytics"
    if "audit" in p:
        return "audit"
    if "escalation" in p or "directory" in p:
        return "directory"
    return None


def _legacy_fallback(message: str, page: str | None) -> dict[str, Any]:
    lower = message.strip().lower().rstrip("!?.")
    mod = _module_from_page(page)

    # Module open/go-to before list-all / facets (fixes search → tickets-list, etc.)
    nav = _module_nav_fallback(message)
    if nav:
        return nav

    list_all = bool(
        re.match(
            r"^(list|show|display|get|see|view)\s+(all|everything)(\s+(of\s+them|please))?$",
            lower,
        )
        or re.match(r"^(clear|reset|remove)\s+(the\s+)?(search|filter|filters)$", lower)
        or lower in ("all", "everything")
        or re.match(
            r"^(list|show)\s+all\s+(customers?|clients?|tickets?|teams?|articles?|kb)$",
            lower,
        )
        or re.match(r"^(show|list)\s+everyone$", lower)
    )
    if list_all and mod and mod != "tickets":
        return {
            "reply_hint": _list_right_hint(f"Showing all {mod}"),
            "actions": [{"type": "set_filter", "module": mod, "query": ""}],
        }

    if re.search(r"\binactive\b", lower) and (
        mod == "customers" or re.search(r"\bcustomers?\b", lower)
    ):
        actions = []
        if mod != "customers":
            actions.append({"type": "navigate", "view": "customers"})
        actions.append(
            {
                "type": "set_filter",
                "module": "customers",
                "query": "",
                "status": "Inactive",
            }
        )
        return {
            "reply_hint": _list_right_hint("Showing inactive customers"),
            "actions": actions,
        }

    if re.search(r"\bactive\b", lower) and re.search(r"\bcustomers?\b", lower):
        actions = []
        if mod != "customers":
            actions.append({"type": "navigate", "view": "customers"})
        actions.append(
            {
                "type": "set_filter",
                "module": "customers",
                "query": "",
                "status": "Active",
            }
        )
        return {
            "reply_hint": _list_right_hint("Showing active customers"),
            "actions": actions,
        }

    return {"reply_hint": "", "actions": []}


def _fallback(message: str, page: str | None) -> dict[str, Any]:
    """Compatibility actions for unmigrated modules; tickets are LangGraph-owned."""
    result = _legacy_fallback(message, page)
    actions: list[dict[str, Any]] = []
    for raw in result.get("actions") or []:
        if not isinstance(raw, dict):
            continue
        action_type = str(raw.get("type") or "").strip().lower()
        module = str(raw.get("module") or "").strip().lower()
        view = str(raw.get("view") or "").strip().lower()
        if module == "tickets":
            continue
        if action_type == "navigate" and view in {
            "tickets",
            "tickets-list",
            "assigned",
            "team-inbox",
            "team-queue",
            "unassigned",
        }:
            continue
        actions.append(raw)
    if not actions:
        return {"reply_hint": "", "actions": []}
    return {**result, "actions": actions}


_STATUS_MAP = {
    "open": "Open",
    "new": "Open",
    "pending": "Pending",
    "waiting": "Pending",
    "in progress": "Pending",
    "on hold": "Pending",
    "hold": "Pending",
    "on-hold": "Pending",
    "resolved": "Resolved",
    "closed": "Resolved",
    "done": "Resolved",
    "overdue": "Overdue",
    "active": "Active",
    "inactive": "Inactive",
}
_PRIORITY_MAP = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    "urgent": "urgent",
    "p1": "urgent",
    "p2": "high",
    "p3": "medium",
    "p4": "low",
    "critical": "urgent",
}
_CHANNEL_MAP = {
    "email": "Email",
    "chat": "Chat",
    "messaging": "Chat",
    "phone": "Phone",
    "call": "Phone",
    "web": "Web",
    "portal": "Web",
}


def _norm_status(raw: Any, mod: str) -> str | None:
    s = str(raw or "").strip()
    if not s:
        return None
    key = s.lower()
    mapped = _STATUS_MAP.get(key)
    if mod == "tickets" and mapped in (
        "Open",
        "Pending",
        "Resolved",
        "Overdue",
    ):
        return mapped
    # Allow custom status keys from catalog (non-empty, not customer statuses)
    if mod == "tickets" and mapped is None and s and s not in ("Active", "Inactive"):
        return s
    if mod == "customers" and mapped in ("Active", "Inactive"):
        return mapped
    return None


def _norm_priority(raw: Any) -> str | None:
    key = str(raw or "").strip().lower()
    return _PRIORITY_MAP.get(key)


def _norm_channel(raw: Any) -> str | None:
    key = str(raw or "").strip().lower()
    return _CHANNEL_MAP.get(key)


def _sanitize_actions(actions: list[Any], page: str | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    banned_query = re.compile(
        r"^(list|show|display|clear|all|everything|filter|filters|search)\b",
        re.I,
    )
    for item in actions:
        if not isinstance(item, dict):
            continue
        t = str(item.get("type") or "").strip().lower()
        if t == "navigate":
            view = normalize_nav_view(str(item.get("view") or "").strip())
            if view in {
                "tickets-list",
                "assigned",
                "team-inbox",
                "team-queue",
                "unassigned",
            }:
                continue
            if view:
                out.append({"type": "navigate", "view": view})
        elif t == "set_filter":
            mod = str(item.get("module") or "").strip().lower()
            if mod in ("customer", "client", "clients"):
                mod = "customers"
            if mod in ("ticket", "case", "cases"):
                mod = "tickets"
            if mod in ("knowledge", "article", "articles"):
                mod = "kb"
            if mod in ("team", "queue", "queues"):
                mod = "teams"
            if mod in ("macro",):
                mod = "macros"
            if mod in ("csat-reports", "csatreports"):
                mod = "csat"
            if mod in ("escalation-directory", "escalation", "escalations"):
                mod = "directory"
            if mod in ("audit-log", "auditlog"):
                mod = "audit"
            if mod not in (
                "customers",
                "tickets",
                "kb",
                "teams",
                "macros",
                "analytics",
                "csat",
                "audit",
                "directory",
            ):
                inferred = _module_from_page(page)
                if not inferred:
                    continue
                mod = inferred
            if mod == "tickets":
                continue
            query = str(item.get("query") if item.get("query") is not None else "").strip()
            if query and banned_query.match(query) and len(query.split()) <= 4:
                query = ""
            if len(query) > 80:
                continue
            action: dict[str, Any] = {
                "type": "set_filter",
                "module": mod,
                "query": query,
            }
            rng = str(item.get("range") or "").strip().lower().replace(" ", "")
            if mod == "analytics" and rng in {"24hours", "7days", "30days"}:
                action["range"] = rng
            elif mod == "csat" and rng in {"7days", "30days", "90days"}:
                action["range"] = rng
            elif mod == "audit" and rng in {
                "today",
                "yesterday",
                "24hours",
                "7days",
                "30days",
                "90days",
            }:
                action["range"] = rng
            if "status" in item and item.get("status") is not None:
                st = _norm_status(item.get("status"), mod)
                if st:
                    action["status"] = st
            if mod == "tickets":
                if "priority" in item and item.get("priority") is not None:
                    pr = _norm_priority(item.get("priority"))
                    if pr:
                        action["priority"] = pr
                if "channel" in item and item.get("channel") is not None:
                    ch = _norm_channel(item.get("channel"))
                    if ch:
                        action["channel"] = ch
                if str(item.get("creator") or "").strip().lower() == "me":
                    action["creator"] = "me"
                # Promote bare facet words wrongly stuffed into query
                if query and "status" not in action and "priority" not in action and "channel" not in action:
                    q_lower = query.lower().strip()
                    # strip trailing "priority" / "tickets"
                    q_core = re.sub(
                        r"\s+(priority|tickets?|cases?|channel)$",
                        "",
                        q_lower,
                    ).strip()
                    pr = _norm_priority(q_core) or _norm_priority(q_lower)
                    st = _norm_status(q_core, "tickets") or _norm_status(q_lower, "tickets")
                    ch = _norm_channel(q_core) or _norm_channel(q_lower)
                    if pr and not st and not ch and len(q_lower.split()) <= 3:
                        action["priority"] = pr
                        action["query"] = ""
                    elif st and not pr and not ch and len(q_lower.split()) <= 3:
                        action["status"] = st
                        action["query"] = ""
                    elif ch and not pr and not st and len(q_lower.split()) <= 3:
                        action["channel"] = ch
                        action["query"] = ""
            if mod == "customers" and query and "status" not in action:
                st = _norm_status(query, "customers")
                if st and len(query.split()) <= 2:
                    action["status"] = st
                    action["query"] = ""
            out.append(action)
        elif t == "clear_filters":
            mod = str(item.get("module") or "all").strip().lower()
            if mod in ("customer", "clients", "client"):
                mod = "customers"
            if mod not in (
                "customers",
                "tickets",
                "kb",
                "teams",
                "macros",
                "analytics",
                "csat",
                "audit",
                "directory",
                "all",
            ):
                mod = "all"
            if mod == "tickets":
                continue
            out.append({"type": "clear_filters", "module": mod})
        elif t.startswith("refresh_") or t == "download":
            cleaned = {"type": t}
            for key, val in item.items():
                if key == "type" or val is None:
                    continue
                if isinstance(val, (str, int, float, bool)):
                    cleaned[key] = val
            if t == "download":
                href = str(item.get("href") or "").strip()
                if not href.startswith("/api/"):
                    continue
                cleaned["href"] = href
            out.append(cleaned)
    return out


def resolve_ui_actions(
    message: str,
    page: str | None = None,
    *,
    skip_regex: bool = False,
) -> dict[str, Any]:
    """Return { reply_hint, actions } for the web app to apply."""
    text = (message or "").strip()
    if not text:
        return {"reply_hint": "", "actions": []}

    # Questions → chat agents answer; never mutate filters
    if re.match(
        r"^(how|what|what's|whats|who|whose|when|where|why|which|is|are|do|does|did|can|could)\b",
        text.strip().lower(),
    ):
        return {"reply_hint": "", "actions": []}

    # Deletes / member updates are catalog commands — never list filters.
    lower_early = text.strip().lower()
    if re.search(
        r"\b(delete|remove)\b.*\b(team|queue|macro|article|kb)\b",
        lower_early,
    ) or re.search(
        r"\b(team|queue|macro|article)\b.*\b(delete|remove)\b",
        lower_early,
    ) or re.search(
        r"\b(add|include)\b.*\bmembers?\b",
        lower_early,
    ) or re.search(
        r"\b(add|include)\b.+\b(to|in)\b.+\b(team|queue)\b",
        lower_early,
    ) or re.search(
        r"\b(add|include)\b\s+(these|them|those|people|staff|agents?)\b",
        lower_early,
    ):
        return {"reply_hint": "", "actions": []}

    # Comma / "and" name lists are roster answers — never team list filters.
    if re.search(r"[,&]", text) or re.search(r"\band\b", lower_early):
        if not re.search(
            r"\b(filter|show|list|search|ticket|priority|status|open|urgent)\b",
            lower_early,
        ):
            parts = re.split(r"\s*(?:,|/|&|\band\b)\s*", text.strip(), flags=re.I)
            names = [p.strip(" \t\"'.") for p in parts if p.strip()]
            if len(names) >= 2 and all(
                re.fullmatch(r"[A-Za-z][A-Za-z'’.\-]{1,40}", n) for n in names
            ):
                return {"reply_hint": "", "actions": []}

    # Create-ticket page / short person-name answers are never list filters.
    page_l = (page or "").strip().lower()
    if "create" in page_l and "ticket" in page_l:
        return {"reply_hint": "", "actions": []}
    if re.fullmatch(r"[A-Za-z][A-Za-z'’.\-]*(?:\s+[A-Za-z][A-Za-z'’.\-]*){0,3}", text):
        # 1–4 word alphabetic utterance — likely a name/field answer, not a filter.
        # Allow clear/list/facet command words through to the regex fallback.
        if not re.search(
            r"\b("
            r"ticket|tickets|customer|customers|team|teams|kb|article|"
            r"urgent|priority|open|pending|all|list|show|filter|filters|"
            r"clear|reset|remove|search|everyone|everything"
            r")\b",
            text,
            re.I,
        ):
            return {"reply_hint": "", "actions": []}

    # Fast path — no LLM needed for clear list-all / facet phrasing (idle only).
    if not skip_regex:
        fb = _fallback(text, page)
        if fb["actions"]:
            return fb

    # Commands / escalate / create — never spend an LLM call here
    lower = text.strip().lower()
    if re.search(
        r"\b(escalat(e|ion|ing)|reassign|hand\s*off|handoff|create|file)\b",
        lower,
    ):
        return {"reply_hint": "", "actions": []}

    system = UI_ACTIONS_SYSTEM
    user = f"PAGE: {page or 'unknown'}\nUSER: {text}"

    try:
        llm = get_llm()
        msg = llm.invoke(
            [SystemMessage(content=system), HumanMessage(content=user)]
        )
        content = getattr(msg, "content", None) or str(msg)
        parsed = _extract_json_obj(str(content)) or {}
        actions = _sanitize_actions(
            parsed.get("actions") if isinstance(parsed.get("actions"), list) else [],
            page,
        )
        reply_hint = str(parsed.get("reply_hint") or "").strip()
        log_llm(
            kind="ui_actions",
            user_text=text,
            response=json.dumps({"reply_hint": reply_hint, "actions": actions})[:500],
            page=page,
            error=None,
        )
        if actions:
            has_list_change = any(
                str(a.get("type") or "").lower() in ("set_filter", "clear_filters")
                for a in actions
            )
            only_navigate = actions and all(
                str(a.get("type") or "").lower() == "navigate" for a in actions
            )
            if has_list_change:
                if reply_hint and "right" not in reply_hint.lower():
                    reply_hint = _list_right_hint(reply_hint)
                elif not reply_hint:
                    reply_hint = _list_right_hint("Intent: updated the list")
            elif only_navigate and not reply_hint:
                view = str(actions[0].get("view") or "that page")
                reply_hint = f"Intent: open {view}; acknowledge navigation."
            return {"reply_hint": reply_hint, "actions": actions}
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="ui_actions_error",
            user_text=text,
            response="",
            page=page,
            error=str(exc),
        )

    return _fallback(text, page)
