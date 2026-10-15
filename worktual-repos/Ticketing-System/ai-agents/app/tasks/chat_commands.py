"""LangGraph chat commands — escalate, create, filters — decided in Python/LLM.

Express still performs DB writes for escalate; this module returns structured
actions the UI/Express apply. Q&A specialists are skipped when handled=True.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.messages_compat import HumanMessage, SystemMessage

from app.llm import get_llm
from app.llm_log import log_llm
from app.tasks.assign import (
    agents_for_team,
    list_org_agents,
    list_org_teams,
    match_team_by_name,
    org_skills_by_user,
    pick_assignee,
    skill_pick_agent_and_resolver,
)
from app.tasks.ui_actions import (
    _module_nav_fallback,
    normalize_nav_view,
    resolve_ui_actions,
)
from app.rbac import MODULES_BY_ROLE as _MODULES_BY_ROLE

COMMAND_SYSTEM = """You classify a Worktual co-worker chat message into ONE command.

Return ONLY raw JSON (no markdown):
{
  "kind": "escalate" | "create_ticket" | "create_team" | "create_macro" | "create_kb" | "create_priority" | "create_customer" | "ui" | "none",
  "ticket_number": "optional ticket id without inventing",
  "assignee_hint": "optional person name if user named someone",
  "reply": "short acknowledgement the UI may show"
}

Rules:
- escalate: escalate / reassign / hand off / assign to someone (or named person).
  Also escalate when the user is continuing an open escalate step:
  • naming a person (any roster name, or "assign to …" / "to …")
  • auto-pick ("best resolver", "by skill", "pick for me") including typos
    ("bets resolver", "best resolvr", "besst agent")
  • referring to the current ticket ("same ticket", "same tickrt", "this one", "that")
  Put a real person name in assignee_hint. For auto-pick phrases leave assignee_hint
  empty (do NOT put "best resolver" / "bets resolver" as a person name).
  Never invent ticket_number. Only extract when clearly present (#12504, 12504, TKT-…).
  "same ticket" / typos do not invent an id — leave ticket_number empty; the app
  already has the open escalate ticket.
  Resolve people only against the live org roster for this turn — never a fixed name list.
- create_ticket: create/file/new ticket (not "how many tickets")
- create_team: create a **new** team/queue only ("create team", "new team").
  NEVER create_team for "add members", "add X to team Y", or "add these to an existing team".
  Those are member updates on an existing team → kind "none" (catalog handles them).
  Interpret obvious spelling mistakes by meaning: a misspelled add-member request
  is still an existing-team membership update, not CHAT and not create_team.
- create_macro: write/create/how to write macros (not "how many macros")
- create_kb: create/add knowledge base article
- create_priority: create/add a priority label (admin catalog)
- create_customer: add/register a customer in the directory (not find/search)
- update_ticket: change status or priority on a known ticket number
- add_note: add an internal note to a ticket
- ui: list-all / clear filters / filter by status|priority|channel|active customers (no Q&A)
- none: questions, greetings, chitchat, add-members-to-team (including obvious
  spelling mistakes), or anything needing live data
- Prefer none when unsure.
"""

# Role modules imported from app.rbac (mirrors ui-frontend/src/rbac.ts).

_VIEW_LABEL = {
    "dashboard": "Home",
    "search": "Search",
    "assigned": "My Tickets",
    "team-queue": "All tickets",
    "team-inbox": "Team inbox",
    "unassigned": "Unassigned",
    "work-board": "Work board",
    "create-ticket": "Create ticket",
    "agent-queues": "Teams",
    "kb": "Knowledge Base",
    "customers": "Customers",
    "analytics": "Analytics",
    "audit": "Audit log",
    "csat-reports": "CSAT reports",
    "macros": "Macros",
    "priorities": "Priorities",
    "escalation-directory": "Escalation directory",
    "org-preferences": "Org preferences",
    "settings": "Settings",
    "tickets-list": "tickets",
    "teams": "Teams",
}

_FILTER_MODULE_VIEW = {
    "customers": "customers",
    "kb": "kb",
    "teams": "agent-queues",
    "macros": "macros",
    "analytics": "analytics",
    "csat": "csat-reports",
    "audit": "audit",
    "directory": "escalation-directory",
}


def _can_access_module(role: str, module: str) -> bool:
    mods = _MODULES_BY_ROLE.get((role or "").strip().lower())
    if not mods:
        mods = _MODULES_BY_ROLE["agent"]
    return module in mods


def _tickets_list_for_role(role: str) -> str:
    # Prefer the role's primary ticket list (agent "Tickets" / assigned) over
    # team-inbox, which is often empty when the agent is not on a team queue.
    if _can_access_module(role, "team-queue"):
        return "team-queue"
    if _can_access_module(role, "assigned"):
        return "assigned"
    if _can_access_module(role, "team-inbox"):
        return "team-inbox"
    if _can_access_module(role, "search"):
        return "search"
    return "dashboard"


def _list_scope_for_ticket_view(view: str | None, role: str) -> str | None:
    v = (view or _tickets_list_for_role(role) or "").strip().lower()
    if v == "team-inbox":
        return "team"
    if v == "unassigned":
        return "unassigned"
    if v in ("assigned", "work-board"):
        return "assignee"
    if v == "search":
        return "search"
    if v == "team-queue":
        return "org"
    r = (role or "").strip().lower()
    if r == "admin":
        return "org"
    if r in ("agent", "resolver", "viewer"):
        return "assignee"
    return None


def _format_ticket_list_details(
    tickets: list[dict[str, Any]], *, limit: int = 8
) -> str:
    if not tickets:
        return "(no matching tickets)"
    lines: list[str] = []
    for t in tickets[: max(1, min(int(limit), 12))]:
        tn = str(t.get("ticket_number") or "").strip()
        if tn and not tn.startswith("#"):
            tn = f"#{tn}"
        subj = str(t.get("subject") or "ticket").strip() or "ticket"
        st = str(t.get("status") or "").strip() or "—"
        pri = str(t.get("priority") or "").strip()
        pri_bit = pri.title() if pri else "—"
        asn = str(t.get("assignee_name") or "").strip() or "Unassigned"
        lines.append(f"* **{tn}**: {subj} — **{st}** / {pri_bit} · {asn}")
    return "\n".join(lines)


def _format_priority_wise_details(
    tickets: list[dict[str, Any]], *, per_group: int = 3
) -> str:
    if not tickets:
        return "(no matching tickets)"
    groups: dict[str, list[dict[str, Any]]] = {}
    for t in tickets:
        key = str(t.get("priority") or "unknown").strip().lower() or "unknown"
        groups.setdefault(key, []).append(t)
    order = ["urgent", "high", "medium", "low"]
    keys = [k for k in order if k in groups] + [
        k for k in groups if k not in order
    ]
    parts: list[str] = []
    for key in keys:
        rows = groups[key]
        parts.append(f"**{key.title()}** ({len(rows)})")
        parts.append(_format_ticket_list_details(rows, limit=per_group))
    return "\n".join(parts)


def _live_tickets_matching_filter(
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    view: str | None,
    status: str | None,
    priority: str | None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Fetch role-scoped tickets from Express and apply status/priority filters."""
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_read import list_tickets

    scope = _list_scope_for_ticket_view(view, role)
    actor = _escalate_tool_actor(
        org, user_id=user_id, user_name=user_name, user_role=role
    )
    if actor.user_id == "unknown" or not str(org or "").strip():
        return []
    with tool_actor_scope(actor):
        result = list_tickets(scope=scope, limit=max(limit, 20))
        if not result.get("success") and scope:
            result = list_tickets(limit=max(limit, 20))
    rows = _tickets_from_tool_result(result)
    status_l = (status or "").strip().lower()
    priority_l = (priority or "").strip().lower()
    out: list[dict[str, Any]] = []
    for r in rows:
        if status_l and str(r.get("status") or "").strip().lower() != status_l:
            continue
        if priority_l and str(r.get("priority") or "").strip().lower() != priority_l:
            continue
        out.append(r)
    return out


def _with_live_ticket_list_in_reply(
    gated: dict[str, Any],
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    user_text: str,
) -> dict[str, Any]:
    """
    For ticket list/filter actions: phrase with live Express rows in chat.
    Never invent IDs — only DB results.
    """
    if not gated.get("handled"):
        return gated
    actions = list(gated.get("actions") or [])
    ticket_filt = next(
        (
            a
            for a in actions
            if str(a.get("type") or "").lower() == "set_filter"
            and str(a.get("module") or "").lower() == "tickets"
        ),
        None,
    )
    if not ticket_filt:
        return gated

    nav_view = next(
        (
            str(a.get("view") or "")
            for a in actions
            if str(a.get("type") or "").lower() == "navigate"
        ),
        None,
    ) or _tickets_list_for_role(role)

    status = str(ticket_filt.get("status") or "").strip() or None
    priority = str(ticket_filt.get("priority") or "").strip() or None
    lower = (user_text or "").strip().lower()
    priority_wise = bool(
        re.search(r"\bpriority[- ]?wise\b", lower)
        or re.search(r"\b(by|per)\s+priority\b", lower)
    )

    rows = _live_tickets_matching_filter(
        org=org,
        role=role,
        user_id=user_id,
        user_name=user_name,
        view=nav_view,
        status=status,
        priority=None if priority_wise else priority,
        limit=60,
    )
    show = rows[:8]
    if priority_wise:
        list_summary = _format_priority_wise_details(rows, per_group=3)
    else:
        list_summary = _format_ticket_list_details(show, limit=8)

    filter_bits = []
    if status:
        filter_bits.append(f"status={status}")
    if priority and not priority_wise:
        filter_bits.append(f"priority={priority}")
    if priority_wise:
        filter_bits.append("grouped=priority")
    filter_label = ", ".join(filter_bits) or "all"

    hint = (
        f"Intent: report {len(rows)} live ticket(s) matching {filter_label}; "
        "do not paste Context.listSummary (code appends exact bullets); list is on the right."
    )
    intro = _llm_phrase(
        module="nav",
        kind="filter",
        fallback=hint,
        user_text=user_text or hint,
        page_label=_VIEW_LABEL.get(nav_view, "Tickets"),
        context={
            "listCount": len(rows),
            "listSummary": list_summary,
            "filter": filter_label,
            "shown": len(show) if not priority_wise else min(len(rows), 12),
            "empty": len(rows) == 0,
            "nextStep": "offer a ticket number or refine filters",
        },
    )
    # Keep Express rows exact — never rely on the LLM to invent ticket IDs.
    reply = _compose_intro_and_list(intro, list_summary)
    return {
        **gated,
        "reply": reply,
        "data": {
            **(gated.get("data") if isinstance(gated.get("data"), dict) else {}),
            "tickets": show,
            "ticketCount": len(rows),
            "filter": {"status": status, "priority": priority},
        },
    }


def _rows_from_tool_payload(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            return [r for r in payload["data"] if isinstance(r, dict)]
        return [payload]
    return []


def _with_live_module_list_in_reply(
    gated: dict[str, Any],
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    user_text: str,
) -> dict[str, Any]:
    """Hydrate customers / KB / teams filter replies with Express rows."""
    if not gated.get("handled"):
        return gated
    if isinstance(gated.get("data"), dict) and gated["data"].get("tickets") is not None:
        return gated
    actions = list(gated.get("actions") or [])
    filt = next(
        (
            a
            for a in actions
            if str(a.get("type") or "").lower() == "set_filter"
            and str(a.get("module") or "").lower() in ("customers", "kb", "teams")
        ),
        None,
    )
    if not filt:
        return gated

    mod = str(filt.get("module") or "").lower()
    status = str(filt.get("status") or "").strip()
    query = str(filt.get("query") or "").strip().lower()
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.catalog_tools import list_customers, list_kb, list_queues

    actor = ToolActor(
        user_id=str(user_id or "").strip() or "unknown",
        organization_id=str(org or "").strip(),
        user_role=role or None,
        user_name=user_name or None,
    )
    if actor.user_id == "unknown" or not actor.organization_id:
        return gated

    with tool_actor_scope(actor):
        if mod == "customers":
            raw = list_customers()
        elif mod == "kb":
            raw = list_kb()
        else:
            raw = list_queues()
    rows = _rows_from_tool_payload(raw)
    matched: list[dict[str, Any]] = []
    for r in rows:
        if mod == "customers":
            name = str(r.get("name") or r.get("customerName") or "").strip()
            email = str(r.get("email") or r.get("customerEmail") or "").strip()
            st = str(r.get("status") or "").strip()
            if status and st.lower() != status.lower():
                continue
            blob = f"{name} {email}".lower()
            if query and query not in blob:
                continue
            matched.append({"name": name or "—", "email": email or "—", "status": st or "—"})
        elif mod == "kb":
            title = str(r.get("title") or "").strip()
            cat = str(r.get("category") or "").strip()
            blob = f"{title} {cat}".lower()
            if query and query not in blob:
                continue
            matched.append({"title": title or "—", "category": cat or "—"})
        else:
            name = str(
                r.get("queueName") or r.get("name") or r.get("queue_name") or ""
            ).strip()
            if query and query not in name.lower():
                continue
            matched.append({"name": name or "—"})

    lines: list[str] = []
    for item in matched[:8]:
        if mod == "customers":
            lines.append(
                f"* **{item['name']}** — {item['email']} ({item['status']})"
            )
        elif mod == "kb":
            lines.append(f"* **{item['title']}** — {item['category']}")
        else:
            lines.append(f"* **{item['name']}**")
    list_summary = "\n".join(lines) if lines else f"(no matching {mod})"
    hint = (
        f"Intent: report {len(matched)} live {mod} row(s); "
        "do not paste Context.listSummary (code appends exact bullets); list is on the right."
    )
    intro = _llm_phrase(
        module="nav",
        kind="filter",
        fallback=hint,
        user_text=user_text or hint,
        page_label=mod.title(),
        context={
            "listCount": len(matched),
            "listSummary": list_summary,
            "module": mod,
            "empty": len(matched) == 0,
        },
    )
    reply = _compose_intro_and_list(intro, list_summary)
    return {
        **gated,
        "reply": reply,
        "data": {
            **(gated.get("data") if isinstance(gated.get("data"), dict) else {}),
            mod: matched[:8],
            "listCount": len(matched),
        },
    }


def _with_live_list_in_reply(
    gated: dict[str, Any],
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    user_text: str,
) -> dict[str, Any]:
    """Compatibility live lists for modules not yet migrated to LangGraph tools."""
    return _with_live_module_list_in_reply(
        gated,
        org=org,
        role=role,
        user_id=user_id,
        user_name=user_name,
        user_text=user_text,
    )


def _resolve_nav_for_role(view: str, role: str) -> str | None:
    """Normalize + remap tickets-list; return None if role cannot open it."""
    v = normalize_nav_view(view)
    if not v:
        return None
    if v == "tickets-list":
        v = _tickets_list_for_role(role)
    elif v == "team-queue" and not _can_access_module(role, "team-queue"):
        v = _tickets_list_for_role(role)
    if _can_access_module(role, v):
        return v
    return None


def _deny_module_reply(feature: str, *, user_text: str = "", page: str | None = None) -> str:
    return _llm_phrase(
        module="nav",
        kind="forbidden",
        fallback=f"Role cannot use {feature}. Suggest My Tickets, Search, or Knowledge Base.",
        user_text=user_text or feature,
        page_label=page,
        context={"feature": feature, "denied": True},
    )


def _gate_ui_actions_for_role(
    actions: list[dict[str, Any]],
    *,
    role: str,
    reply_hint: str,
    user_text: str = "",
    page: str | None = None,
) -> dict[str, Any]:
    """
    Remap navigate targets for the role and drop forbidden modules.
    If every action was forbidden, return a deny reply.
    """
    out: list[dict[str, Any]] = []
    denied: str | None = None
    for raw in actions:
        t = str(raw.get("type") or "").lower()
        if t == "navigate":
            wanted = str(raw.get("view") or "")
            resolved = _resolve_nav_for_role(wanted, role)
            if not resolved:
                denied = _VIEW_LABEL.get(
                    normalize_nav_view(wanted) or wanted.lower(),
                    wanted or "that module",
                )
                continue
            out.append({**raw, "view": resolved})
            continue
        if t == "set_filter":
            mod = str(raw.get("module") or "").lower()
            if mod == "tickets":
                # Filters apply on the role's primary ticket list (not empty team inbox).
                list_view = _tickets_list_for_role(role)
                if list_view != "dashboard" or _can_access_module(role, "assigned"):
                    if not any(a.get("type") == "navigate" for a in out):
                        out.insert(0, {"type": "navigate", "view": list_view})
                    out.append(raw)
                else:
                    denied = "tickets"
                continue
            view = _FILTER_MODULE_VIEW.get(mod)
            if view and not _can_access_module(role, view):
                denied = _VIEW_LABEL.get(view, mod)
                continue
            out.append(raw)
            continue
        if t == "clear_filters":
            mod = str(raw.get("module") or "all").lower()
            if mod in _FILTER_MODULE_VIEW and not _can_access_module(
                role, _FILTER_MODULE_VIEW[mod]
            ):
                denied = _VIEW_LABEL.get(_FILTER_MODULE_VIEW[mod], mod)
                continue
            out.append(raw)
            continue
        if t in ("create_ticket", "create_team"):
            # Handled earlier in resolve_chat_command; drop here if leaked
            continue
        out.append(raw)

    if out:
        has_list_change = any(
            str(a.get("type") or "").lower() in ("set_filter", "clear_filters")
            for a in out
        )
        hint = (reply_hint or "").strip()
        if not hint:
            hint = (
                "Intent: acknowledge list/filter; live rows belong in Context."
                if has_list_change
                else "Intent: acknowledge navigation."
            )
        phrased = _llm_phrase(
            module="nav",
            kind="filter",
            fallback=hint,
            user_text=user_text or hint,
            page_label=page,
            context={"intentHint": hint[:160]},
        )
        return {
            "handled": True,
            # Never paint the intent seed — empty is OK; UI still gets actions.
            "reply": phrased,
            "actions": out,
            "route": _route_from_ui_actions(out),
            "escalate_draft": None,
        }
    if denied:
        return {
            "handled": True,
            "reply": _deny_module_reply(denied, user_text=user_text, page=page),
            "actions": [],
            "route": "general",
            "escalate_draft": None,
        }
    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "escalate_draft": None,
    }


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


def _extract_ticket_number(text: str) -> str | None:
    m = re.search(r"\b(?:ticket|case)\s*#?\s*([A-Za-z0-9][-A-Za-z0-9]{1,24})\b", text, re.I)
    if m:
        return m.group(1).lstrip("#")
    m = re.search(r"#([A-Za-z0-9][-A-Za-z0-9]{1,24})\b", text)
    if m:
        return m.group(1)
    # Short org sequences (#4) as well as longer ids — only when the token is
    # the whole answer or clearly a ticket id (avoid "2" inside other phrases).
    raw = (text or "").strip()
    if re.fullmatch(r"#?\d{1,8}", raw):
        return raw.lstrip("#")
    m = re.search(r"\b(\d{4,8})\b", text)
    if m:
        return m.group(1)
    return None


def _looks_like_ticket_number(raw: str | None) -> bool:
    val = str(raw or "").strip().lstrip("#")
    return bool(val and re.fullmatch(r"\d{1,8}", val))


def _normalize_ticket_ref(raw: str | None) -> str | None:
    """Canonical ticket number token from entity name/id or free text."""
    text = str(raw or "").strip()
    if not text:
        return None
    extracted = _extract_ticket_number(text)
    if extracted:
        return extracted.lstrip("#")
    val = text.lstrip("#").strip()
    if re.fullmatch(r"\d{1,8}", val):
        return val
    # UUID / opaque ids are not display ticket numbers — reject for seeding asks.
    if re.fullmatch(r"[0-9a-fA-F-]{16,}", val):
        return None
    if re.fullmatch(r"[A-Za-z0-9][-A-Za-z0-9]{0,24}", val):
        return val
    return None


def _ticket_number_from_entity(entity: dict[str, Any] | None) -> str | None:
    if not isinstance(entity, dict):
        return None
    if str(entity.get("type") or "").strip().lower() not in {"ticket", "tickets"}:
        return None
    return _normalize_ticket_ref(entity.get("name")) or _normalize_ticket_ref(
        entity.get("id")
    )


def _refers_to_same_ticket(text: str) -> bool:
    """User means the open / just-discussed ticket (same/this/above created…)."""
    lower = _normalize_ticket_typos(text).strip().rstrip("!?.")
    if re.fullmatch(
        r"(the\s+)?(same|this|that|current|above|previous)\s+(one|ticket|case)",
        lower,
    ):
        return True
    if re.fullmatch(r"(same|this|that)\s*(ticket|case)?", lower):
        return True
    if lower in ("same", "this one", "that one", "same one", "it", "that"):
        return True
    if re.search(
        r"\b(above|just|recently|previously)\s+(created|filed|opened)\b"
        r".*\b(ticket|one|case)\b",
        lower,
    ):
        return True
    if re.search(
        r"\b(the\s+)?(ticket|one|case)\s+(i|we)\s+(just\s+)?(created|filed|opened)\b",
        lower,
    ):
        return True
    if re.search(r"\b(above|previous|last)\s+created\b", lower):
        return True
    if re.search(
        r"\b(reassign|escalate|assign)\s+(this|that|the\s+same|the\s+current)\s+ticket\b",
        lower,
    ):
        return True
    return False


def _resolve_open_ticket_number(
    *,
    draft: dict[str, Any] | None = None,
    history: list | None = None,
    last_entity: dict[str, Any] | None = None,
    conversation_context: dict[str, Any] | None = None,
) -> str | None:
    """Prefer draft → focused/last ticket entity → transcript → candidates."""
    ctx = conversation_context if isinstance(conversation_context, dict) else {}
    le = last_entity if isinstance(last_entity, dict) else None
    if not le and isinstance(ctx.get("last_entity"), dict):
        le = ctx.get("last_entity")
    recent = ctx.get("recent_entities") if isinstance(ctx.get("recent_entities"), list) else []
    candidates = [
        str((draft or {}).get("ticket_number") or "").strip(),
        _ticket_number_from_entity(le),
    ]
    for item in recent:
        tn = _ticket_number_from_entity(item if isinstance(item, dict) else None)
        if tn:
            candidates.append(tn)
            break
    candidates.append(_last_ticket_from_history(history) or "")
    for raw in candidates:
        tn = _normalize_ticket_ref(raw)
        if tn:
            return tn
    draft_cands = (draft or {}).get("candidates") if isinstance(draft, dict) else None
    if isinstance(draft_cands, list):
        for c in draft_cands:
            tn = _normalize_ticket_ref(str(c or ""))
            if tn:
                return tn
    return None


def _person_hint_from_collect(
    text: str,
    decision: dict[str, Any] | None,
    *,
    ticket_number: str | None = None,
    roster_names: list[str] | None = None,
    allow_fuzzy: bool = True,
) -> str:
    """Person collect: canonical roster name from LLM fields, then the utterance.

    allow_fuzzy=False (reassign/escalate): clear matches only — typos stay as the
    raw fragment so ticket_person_resolution can propose \"Did you mean?\".
    """
    from app.workflow_schemas import person_from_user_text, resolve_roster_name

    raw = (text or "").strip()
    tn = str(ticket_number or "").strip().lstrip("#")
    decision = decision if isinstance(decision, dict) else {}
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    roster = [str(n).strip() for n in (roster_names or []) if str(n).strip()]

    def _ok(val: str | None) -> str | None:
        cand = str(val or "").strip()
        if not cand:
            return None
        if tn and cand.lstrip("#") == tn:
            return None
        if _looks_like_ticket_number(cand) and raw and not _looks_like_ticket_number(raw):
            return None
        if not roster:
            return cand if not _looks_like_ticket_number(cand) else None
        hit = person_from_user_text(
            cand, roster, allow_fuzzy=allow_fuzzy, allow_substring=allow_fuzzy
        ) or resolve_roster_name(
            cand, roster, allow_fuzzy=allow_fuzzy, allow_substring=allow_fuzzy
        )
        if hit:
            return hit
        if not allow_fuzzy and not _looks_like_ticket_number(cand):
            # Keep short/typo fragments for the propose step. Ack words are not
            # filtered here — when a proposed_person is pending, _build_reassign
            # ignores non-roster fragments and waits for CONFIRM_WORKFLOW.
            return cand
        return None

    for val in (
        fields.get("person"),
        person_from_user_text(
            raw, roster, allow_fuzzy=allow_fuzzy, allow_substring=allow_fuzzy
        ),
        str(decision.get("entity_name") or "").strip(),
        *[
            str(v).strip()
            for v in (decision.get("values") or [])
            if str(v).strip()
        ],
        raw,
    ):
        hit = _ok(val if isinstance(val, str) else (str(val) if val else None))
        if hit:
            return hit
    return ""


def _extract_assignee_hint(text: str) -> str | None:
    m = re.search(
        r"\b(?:assign|escalate|reassign|hand\s*off|handoff)\s+"
        r"(?:(?:this|the|that|same)\s+)?(?:ticket|case)?\s*(?:#?\S+\s+)?"
        r"(?:to|onto)\s+(?!resolver\b|agent\b)([A-Za-z][A-Za-z .'-]{1,60})",
        text,
        re.I,
    )
    if not m:
        # Bare "to Annamalai" while already in escalate assignee step
        m = re.search(
            r"^(?:please\s+)?(?:assign\s+)?(?:to|onto)\s+([A-Za-z][A-Za-z .'-]{1,60})$",
            (text or "").strip(),
            re.I,
        )
    if not m:
        return None
    name = m.group(1).strip().rstrip(".,!?")
    if re.search(
        r"\b(resolver|agent|someone|anybody|anyone|best|auto|skill)\b",
        name,
        re.I,
    ):
        return None
    if _is_auto_pick_phrase(name) or _is_auto_pick_phrase(text):
        return None
    return name or None


def _is_auto_pick_phrase(text: str) -> bool:
    """True for best/auto skill pick, including common typos (bets resolver)."""
    lower = _normalize_ticket_typos(text or "")
    # Collapse doubled spaces after typo fixes
    lower = re.sub(r"\s+", " ", lower).strip()
    if re.search(
        r"\b(best|any|auto|available)\s+(resolver|agent)s?\b",
        lower,
    ):
        return True
    # Fuzzy: "bets resolvr", "best reslover" — best-ish + resolver-ish tokens
    tokens = re.findall(r"[a-z]+", lower)
    has_bestish = any(
        t in ("best", "bets", "besst", "auto", "any", "whoever")
        or (len(t) >= 4 and _edit_distance(t, "best") <= 1)
        for t in tokens
    )
    has_resolverish = any(
        t.startswith("resolv")
        or t in ("resolver", "resolvers", "agent", "agents")
        or (len(t) >= 6 and _edit_distance(t, "resolver") <= 2)
        for t in tokens
    )
    if has_bestish and has_resolverish:
        return True
    if lower in (
        "best",
        "auto",
        "anyone",
        "anybody",
        "someone",
        "by skill",
        "skills",
        "best agent",
        "best resolver",
    ):
        return True
    return bool(
        re.search(
            r"\bpick\s+(for\s+me|one|best)\b"
            r"|\bwhoever\b"
            r"|\b(auto[- ]?assign|assign\s+by\s+skills?|based\s+on\s+skills?)\b"
            r"|\b(agent\s+and\s+resolver|both\s+(owners|people))\b",
            lower,
        )
    )


def _edit_distance(a: str, b: str) -> int:
    """Tiny Levenshtein for typo tolerance (short strings only)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    if abs(len(a) - len(b)) > 2:
        return 99
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(
                min(
                    prev[j] + 1,
                    cur[j - 1] + 1,
                    prev[j - 1] + (0 if ca == cb else 1),
                )
            )
        prev = cur
    return prev[-1]


def _is_data_question(text: str) -> bool:
    lower = text.strip().lower()
    # Require a data noun — bare "is/are/can …" mid-flow is often a field answer.
    entity_noun = bool(
        re.search(
            r"\b("
            r"ticket|tickets|customer|customers|team|teams|queue|queues|"
            r"macro|macros|article|articles|kb|csat|metric|metrics|"
            r"assignee|count|total"
            r")\b",
            lower,
        )
    )
    if re.match(
        r"^(how|what|what's|whats|who|whose|when|where|why|which)\b",
        lower,
    ):
        return entity_noun or bool(
            re.search(r"\b(how many|count|total|priority|status|sla)\b", lower)
        )
    # "is/are/can …" only with entity nouns — not "is the priority high?" field talk.
    if re.match(r"^(is|are|do|does|did|can|could)\b", lower):
        return entity_noun
    return bool(
        re.search(
            r"\b(how many|count|total|list of|show me my|assigned to me)\b",
            lower,
        )
    )


def _is_greeting_or_chitchat(text: str) -> bool:
    """True → skip command/UI layers; specialist LLM owns the reply (never static)."""
    lower = text.strip().lower().rstrip("!?.")
    if not lower or len(lower) > 80:
        return False
    if lower in {
        "hi",
        "hello",
        "hey",
        "yo",
        "thanks",
        "thank you",
        "thx",
        "ok",
        "okay",
        "sure",
        "cool",
        "great",
        "good morning",
        "good afternoon",
        "good evening",
    }:
        return True
    return bool(
        re.match(
            r"^(hi|hello|hey|thanks|thank you)(\s+(there|team|all|folks))?$",
            lower,
        )
    )


def _is_meta_help(text: str) -> bool:
    """
    Co-worker identity / capability / page-help questions.

    These must still go through the specialist LLM, but they do not need a full
    org DB snapshot (tickets/customers/teams/KB dump) or a router LLM call.
    """
    lower = (text or "").strip().lower()
    if not lower or len(lower) > 160:
        return False
    # Never treat live-data questions as meta
    if re.search(
        r"\b("
        r"how many|count|total|assigned to me|my tickets|"
        r"raised|filed|created today|open tickets|priority|status|"
        r"find|search|list all|show all|filter"
        r")\b",
        lower,
    ):
        return False
    return bool(
        re.search(
            r"\b("
            r"your role|who are you|what are you|what('?s| is) your|"
            r"what can you( do| help)?|how can you help|what do you do|"
            r"introduce yourself|your (job|purpose)|"
            r"what can i do( on (this|the) page)?|help me( out)?"
            r")\b",
            lower,
        )
    )


def _should_skip_live_context(text: str) -> bool:
    """Skip expensive org DB snapshot when the answer cannot use those numbers."""
    if _is_greeting_or_chitchat(text) or _is_meta_help(text):
        return True
    lower = (text or "").strip().lower()
    # UI bootstrap greeting prompts (phrase fallback into /chat)
    if re.match(r"^greet(\s+the\s+user)?\b", lower) or re.search(
        r"\bas the worktual co-?worker\b", lower
    ):
        return True
    return False


def _route_from_ui_actions(actions: list[dict[str, Any]]) -> str:
    for a in actions:
        t = str(a.get("type") or "").lower()
        if t == "set_filter":
            mod = str(a.get("module") or "").lower()
            if mod == "tickets":
                return "tickets"
            if mod == "customers":
                return "customers"
            if mod == "kb":
                return "kb"
            if mod == "teams":
                return "teams"
        if t == "navigate":
            view = str(a.get("view") or "").lower()
            if "customer" in view:
                return "customers"
            if view in ("kb",) or "knowledge" in view:
                return "kb"
            if "queue" in view or view == "agent-queues":
                return "teams"
            if "ticket" in view or view in (
                "assigned",
                "unassigned",
                "team-inbox",
                "tickets-list",
                "create-ticket",
            ):
                return "tickets"
    return "general"


def _normalize_ticket_typos(text: str) -> str:
    """Collapse common spaced/misspelled ticket tokens for intent matching."""
    t = (text or "").strip().lower()
    t = re.sub(r"\btic\s*ket\b", "ticket", t)
    t = re.sub(r"\btick\s*et\b", "ticket", t)
    t = re.sub(r"\bticekt\b", "ticket", t)
    t = re.sub(r"\btikcet\b", "ticket", t)
    t = re.sub(r"\btickrt\b", "ticket", t)
    t = re.sub(r"\bticketr\b", "ticket", t)
    t = re.sub(r"\bticet\b", "ticket", t)
    t = re.sub(r"\bbets\b", "best", t)
    t = re.sub(r"\bbestt\b", "best", t)
    t = re.sub(r"\bresovler\b", "resolver", t)
    t = re.sub(r"\bresolvr\b", "resolver", t)
    t = re.sub(r"\breslover\b", "resolver", t)
    # create / macro typos ("creaye macros")
    t = re.sub(r"\b(creaye|craete|creat|crate|crete|creaet|craeate)\b", "create", t)
    t = re.sub(r"\b(makro|macor)s?\b", "macros", t)
    return t


def _continue_macro_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    macro_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Multi-turn create-macro (title → body → confirm); specialist owns write."""
    from app.workflow_schemas import (
        bind_awaiting_value,
        merge_workflow_state,
        missing_fields,
        sanitize_macro_draft_fields,
    )

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    extracted = (
        dict(decision.get("fields") or {})
        if isinstance(decision.get("fields"), dict)
        else {}
    )
    start = str(macro_draft.get("_intent_start_text") or "").strip()
    merged = merge_workflow_state(
        "create_macro", macro_draft, extracted, user_text=text
    )
    if start:
        merged["_intent_start_text"] = start
    merged = sanitize_macro_draft_fields(merged)
    if start:
        merged["_intent_start_text"] = start
    awaiting = str(macro_draft.get("awaiting") or "").strip().lower()
    if awaiting not in ("confirm", "delete_confirm"):
        from app.workflow_schemas import (
            awaiting_hint_from_missing,
            bind_primary_missing,
        )

        miss_now = missing_fields("create_macro", merged)
        if miss_now:
            bound: dict[str, Any] = {}
            if awaiting in miss_now:
                bound = bind_awaiting_value("create_macro", awaiting, text)
            elif not extracted:
                # Stale awaiting only — never re-bind text already placed via NLU fields.
                bound = bind_primary_missing("create_macro", merged, text)
            if bound:
                merged = merge_workflow_state(
                    "create_macro", merged, bound, user_text=text
                )
                if start:
                    merged["_intent_start_text"] = start
                merged = sanitize_macro_draft_fields(merged)
                if start:
                    merged["_intent_start_text"] = start
            awaiting = awaiting_hint_from_missing("create_macro", merged)
        else:
            awaiting = "confirm"
    title = str(merged.get("title") or "").strip()
    body = str(merged.get("body") or "").strip()
    action = str(decision.get("action") or "").strip().upper()

    if action == "CANCEL_WORKFLOW":
        reply = _llm_phrase(
            module="macro",
            kind="cancelled",
            fallback="Acknowledge cancelling macro create.",
            user_text=text,
            page_label=page or "Macros",
            context={"cancelled": True},
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": "macros"}],
            "route": "general",
            "escalate_draft": None,
            "macro_draft": None,
        }

    if awaiting == "title":
        if not title:
            reply = _llm_phrase(
                module="macro",
                kind="validation",
                fallback="Ask again for a short macro title.",
                user_text=text,
                page_label=page or "Macros",
                context={"nextStep": "macro title"},
            )
            title_draft: dict[str, Any] = {"awaiting": "title", "step": "title"}
            if start:
                title_draft["_intent_start_text"] = start
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "macros"},
                    {"type": "create_macro", "step": "title", "awaiting": "title"},
                ],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": title_draft,
            }
        if not (body and not missing_fields("create_macro", merged)):
            reply = _llm_phrase(
                module="macro",
                kind="got_title",
                fallback=(
                    f"Title is {title}. Explain you need the reply body next so the macro "
                    "can be reused in notes; ask for that body only."
                ),
                user_text=text,
                page_label=page or "Macros",
                context={
                    "title": title,
                    "nextStep": "macro reply body",
                },
            )
            body_draft: dict[str, Any] = {
                "awaiting": "body",
                "step": "body",
                "title": title,
            }
            if start:
                body_draft["_intent_start_text"] = start
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "macros"},
                    {
                        "type": "create_macro",
                        "title": title,
                        "step": "body",
                        "awaiting": "body",
                    },
                ],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": body_draft,
            }
        awaiting = "body"

    if awaiting == "body":
        if len(str(body or "").strip()) < 2:
            reply = _llm_phrase(
                module="macro",
                kind="validation",
                fallback="Ask again for the macro body.",
                user_text=text,
                page_label=page or "Macros",
                context={"nextStep": "macro reply body"},
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [{"type": "navigate", "view": "macros"}],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": {"awaiting": "body", "title": title},
            }
        reply = _llm_phrase(
            module="macro",
            kind="got_body",
            fallback=(
                f"Body captured for macro {title}. Explain a save is needed to "
                "write it to the org macros list; ask whether to save or change it."
            ),
            user_text=text,
            page_label=page or "Macros",
            context={
                "title": title,
                "bodyPreview": body[:80],
                "awaiting": "confirm",
                "nextStep": "review the draft and tell me to save it, or change a field",
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "macros"},
                {
                    "type": "create_macro",
                    "title": title,
                    "body": body,
                    "step": "confirm",
                },
            ],
            "route": "general",
            "escalate_draft": None,
            "macro_draft": {"awaiting": "confirm", "title": title, "body": body},
        }

    if awaiting == "confirm":
        if action in {"CONFIRM_WORKFLOW", "CANCEL_WORKFLOW"}:
            return {
                "handled": False,
                "reply": "",
                "actions": [],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": {"awaiting": "confirm", "title": title, "body": body},
            }
        if action == "CONTINUE_WORKFLOW" and not extracted:
            return {
                "handled": False,
                "reply": "",
                "actions": [],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": {"awaiting": "confirm", "title": title, "body": body},
            }
        reply = _llm_phrase(
            module="macro",
            kind="got_body",
            fallback=(
                f"Body captured for macro {title}. Explain a save is needed to "
                "write it to the org macros list; ask whether to save or change it."
            ),
            user_text=text,
            page_label=page or "Macros",
            context={
                "title": title,
                "bodyPreview": body[:80],
                "awaiting": "confirm",
                "nextStep": "review the draft and tell me to save it, or change a field",
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "macros"},
                {
                    "type": "create_macro",
                    "title": title,
                    "body": body,
                    "step": "confirm",
                },
            ],
            "route": "general",
            "escalate_draft": None,
            "macro_draft": {"awaiting": "confirm", "title": title, "body": body},
        }

    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "escalate_draft": None,
        "macro_draft": macro_draft,
    }


def _macros_payload(raw: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(raw, dict):
        return []
    payload = raw.get("payload")
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        data = payload.get("data") or payload.get("items") or payload.get("macros")
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
    data = raw.get("data")
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    return []


def start_or_continue_delete_macro(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    macro_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Delete macro by title via chat — same DELETE as MacrosView."""
    from app.tools.catalog_tools import list_macros
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.macro_write import delete_macro as delete_macro_tool

    draft = macro_draft if isinstance(macro_draft, dict) else None
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    operation = str(decision.get("operation") or "").strip().upper()

    if awaiting == "delete_confirm" and draft:
        if action == "CANCEL_WORKFLOW":
            return {
                "handled": True,
                "reply": _llm_phrase(
                    module="macro",
                    kind="cancelled",
                    fallback="Acknowledge cancelling macro delete.",
                    user_text=text,
                    page_label=page or "Macros",
                    context={"cancelled": True, "deleting": True},
                ),
                "actions": [{"type": "navigate", "view": "macros"}],
                "route": "general",
                "macro_draft": None,
            }
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "general",
            "macro_draft": draft,
        }

    if operation != "DELETE_MACRO":
        return None

    if not _can_access_module(role or "agent", "macros"):
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="nav",
                kind="forbidden",
                fallback="Role cannot use Macros.",
                user_text=text,
                page_label=page,
                context={"feature": "Macros", "denied": True},
            ),
            "actions": [],
            "route": "general",
            "macro_draft": None,
        }

    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    filters = decision.get("filters") if isinstance(decision.get("filters"), dict) else {}
    title_hint = (
        str(decision.get("entity_name") or "").strip()
        or str(fields.get("title") or fields.get("name") or "").strip()
        or str(filters.get("query") or "").strip()
    )
    if not title_hint or title_hint in ("macro", "macros", "the"):
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="macro",
                kind="validation",
                fallback="Ask which macro to delete by title.",
                user_text=text,
                page_label=page or "Macros",
                context={
                    "deleting": True,
                    "nextStep": (
                        "Which macro should I delete? Say **delete macro TITLE**."
                    ),
                },
            ),
            "actions": [{"type": "navigate", "view": "macros"}],
            "route": "general",
            "macro_draft": None,
        }

    actor = ToolActor(
        user_id=str(user_id or "").strip(),
        organization_id=str(org or "").strip(),
        user_role=(role or None),
        user_name=(user_name or None),
    )
    rows: list[dict[str, Any]] = []
    if actor.user_id and actor.organization_id:
        try:
            with tool_actor_scope(actor):
                rows = _macros_payload(list_macros())
        except Exception:  # noqa: BLE001
            rows = []

    needle = title_hint.lower()
    hit = None
    for r in rows:
        title = str(r.get("title") or "").strip()
        if title.lower() == needle or needle in title.lower():
            hit = r
            break
    if not hit:
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="macro",
                kind="validation",
                fallback=f"No macro titled {title_hint} found.",
                user_text=text,
                page_label=page or "Macros",
                context={"error": True, "title": title_hint, "deleting": True},
            ),
            "actions": [{"type": "navigate", "view": "macros"}],
            "route": "general",
            "macro_draft": None,
        }

    title = str(hit.get("title") or title_hint).strip()
    mid = str(hit.get("id") or "").strip()
    return {
        "handled": True,
        "reply": _llm_phrase(
            module="macro",
            kind="confirm_hint",
            fallback=f"Confirm delete macro {title}.",
            user_text=text,
            page_label=page or "Macros",
            context={
                "title": title,
                "deleting": True,
                "nextStep": (
                    f"whether to permanently delete **{title}** or keep it"
                ),
            },
        ),
        "actions": [
            {"type": "navigate", "view": "macros"},
            {
                "type": "delete_macro",
                "title": title,
                "id": mid,
                "step": "confirm",
            },
        ],
        "route": "general",
        "macro_draft": {
            "awaiting": "delete_confirm",
            "title": title,
            "id": mid,
        },
    }


def start_create_team_flow(
    text: str,
    *,
    role: str,
    page: str | None,
) -> dict[str, Any]:
    """Start guided create-team after semantic START_CREATE_TEAM (RBAC in code)."""
    if (role or "").strip().lower() != "admin":
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="nav",
                kind="forbidden",
                fallback="Role cannot use Teams. Suggest My Tickets or Search.",
                user_text=text,
                page_label=page,
                context={"feature": "Teams", "denied": True},
            ),
            "actions": [],
            "route": "general",
            "escalate_draft": None,
            "team_draft": None,
        }
    reply = _llm_phrase(
        module="team",
        kind="start",
        fallback="Start create-team: acknowledge and ask for the team name.",
        user_text=text,
        page_label=page or "Teams",
        context={"nextStep": "team name"},
    )
    return {
        "handled": True,
        "reply": reply,
        "actions": [
            {"type": "navigate", "view": "agent-queues"},
            {"type": "create_team", "step": "name"},
        ],
        "route": "teams",
        "escalate_draft": None,
        "macro_draft": None,
        "team_draft": {"awaiting": "name"},
        "kb_draft": None,
        "ticket_draft": None,
    }


def _clean_person_name(name: str) -> str:
    """Validate an extracted person-name field using the schema slot type."""
    from app.workflow_schemas import looks_like_person_name

    value = (name or "").strip(" .,;:-")
    if not looks_like_person_name(value):
        return ""
    return value


def _merge_ticket_turn(
    ticket_draft: dict[str, Any],
    text: str,
    decision: dict[str, Any],
    *,
    bind_awaiting: bool = True,
) -> dict[str, Any]:
    """Merge validated NLU fields and the awaited typed value without wiping state."""
    from app.workflow_schemas import (
        bind_primary_missing,
        ground_fields_in_utterance,
        looks_like_create_ticket_command,
        merge_ticket_state,
        missing_ticket_fields,
    )

    awaiting = str(ticket_draft.get("awaiting") or "").strip().lower()
    restart_same_flow = looks_like_create_ticket_command(text)
    values = [
        str(v).strip()
        for v in (decision.get("values") or [])
        if str(v).strip()
    ]
    field_value = values[0] if values else (text or "").strip()
    extracted = ground_fields_in_utterance(decision.get("fields"), text)
    if restart_same_flow:
        extracted.pop("customerName", None)
        extracted.pop("issue", None)
        extracted.pop("subject", None)
        bind_awaiting = False
    raw_name = str(extracted.get("customerName") or "").strip()
    cleaned_name = _clean_person_name(raw_name) if raw_name else ""
    if cleaned_name:
        extracted["customerName"] = cleaned_name
    elif "customerName" in extracted:
        extracted.pop("customerName", None)
    merged = merge_ticket_state(ticket_draft, extracted, user_text=text)
    miss = set(missing_ticket_fields(merged))

    if not bind_awaiting:
        # Subject/description come from triage LLM at confirm — not utterance truncates.
        if merged.get("issue") and not merged.get("description"):
            merged["description"] = str(merged["issue"])
        return merged

    # Typed slot bind from first missing field (SoT) — not stale draft.awaiting.
    may_bind_primary = not extracted
    if miss and may_bind_primary:
        bound = bind_primary_missing(
            "create_ticket", merged, field_value or text or ""
        )
        if not bound and awaiting in ("name", "contact", "issue", "priority"):
            from app.workflow_schemas import bind_awaiting_value

            bound = bind_awaiting_value(
                "create_ticket", awaiting, field_value or text or ""
            )
        if bound:
            merged = merge_ticket_state(merged, bound, user_text=text)

    if merged.get("issue") and not merged.get("description"):
        merged["description"] = str(merged.get("description") or merged["issue"])
    return merged


def _ticket_ui_action(
    data: dict[str, Any],
    *,
    step: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    from app.workflow_schemas import ticket_draft_from_state

    draft = ticket_draft_from_state(data, awaiting=step)
    payload: dict[str, Any] = {"type": "create_ticket", "step": draft.get("awaiting")}
    for key in (
        "customerId",
        "customerName",
        "customerEmail",
        "customerPhone",
        "issue",
        "subject",
        "priority",
        "category",
        "skill",
        "queue",
        "queueId",
        "assignee",
        "assigneeId",
        "resolver",
        "resolverId",
        "resolverConfidence",
        "confidence",
        "rationale",
        "description",
        "enrichedByAi",
    ):
        val = draft.get(key)
        if val not in (None, ""):
            payload[key] = val
    if payload.get("resolverConfidence") is None:
        conf = draft.get("resolver_confidence")
        if conf not in (None, ""):
            payload["resolverConfidence"] = conf
    payload.update({k: v for k, v in extra.items() if v is not None})
    return payload


def _ticket_ask_missing(
    text: str,
    *,
    page: str | None,
    data: dict[str, Any],
    missing: list[str],
    kind: str,
) -> dict[str, Any]:
    from app.workflow_schemas import next_missing_label, ticket_draft_from_state

    draft = ticket_draft_from_state(data)
    label = next_missing_label(missing)
    name = str(data.get("customerName") or "")
    email = str(data.get("customerEmail") or "")
    phone = str(data.get("customerPhone") or "")
    return {
        "handled": True,
        "reply": _llm_phrase(
            module="ticket",
            kind=kind,
            fallback=f"Ask for the {label}.",
            user_text=text,
            page_label=page or "Create Ticket",
            context={
                "customerName": name or None,
                "customerEmail": email or None,
                "customerPhone": phone or None,
                "subject": str(data.get("subject") or data.get("issue") or "")[:120]
                or None,
                "priority": data.get("priority") or None,
                "nextStep": label,
                "missingFields": missing,
            },
        ),
        "actions": [
            {"type": "navigate", "view": "create-ticket"},
            _ticket_ui_action(data),
        ],
        "route": "tickets",
        "ticket_draft": draft,
    }


def _ticket_confirm_prompt(
    text: str,
    *,
    page: str | None,
    data: dict[str, Any],
) -> dict[str, Any]:
    from app.workflow_schemas import ticket_draft_from_state

    name = str(data.get("customerName") or "")
    issue = str(data.get("issue") or data.get("subject") or "")
    draft = ticket_draft_from_state(data, awaiting="confirm")
    draft["description"] = str(data.get("description") or issue)
    return {
        "handled": True,
        "reply": _llm_phrase(
            module="ticket",
            kind="confirm_hint",
            fallback="Summarize the draft and ask if they want it filed or changed.",
            user_text=text,
            page_label=page or "Create Ticket",
            context={
                "customerName": name,
                "subject": issue[:120],
                "priority": data.get("priority") or "medium",
                "nextStep": "whether to file this draft or change a field",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "create-ticket"},
            _ticket_ui_action(data, step="confirm"),
        ],
        "route": "tickets",
        "ticket_draft": draft,
        "current_workflow": "create_ticket",
        "current_step": "confirm",
    }


def start_create_ticket_flow(
    text: str,
    *,
    org: str,
    role: str,
    page: str | None,
    can_create_ticket: bool | None = None,
    semantic_decision: dict[str, Any] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    """Start guided create-ticket after semantic START_CREATE_TICKET (RBAC in code)."""
    from app.workflow_schemas import missing_ticket_fields, ticket_draft_from_state

    role_l = (role or "").strip().lower()
    if role_l == "portal_guest":
        # State + navigate only — specialist speaks (policy_note / PORTAL_SELF_SERVICE).
        return _portal_specialist_handoff(
            draft=None,
            step=None,
            route="kb",
            actions=[{"type": "navigate", "view": "login"}],
            data={"portal_auth_required": True},
        )

    if role_l == "portal_customer":
        decision = semantic_decision if isinstance(semantic_decision, dict) else {}
        seed = _merge_ticket_turn(
            {"awaiting": "issue", "surface": "portal"},
            text,
            decision,
            bind_awaiting=False,
        )
        seed["surface"] = "portal"
        missing = missing_ticket_fields(seed)
        if not missing:
            return _portal_advance_after_issue(
                text,
                page=page,
                org=org,
                data=seed,
            )
        draft = ticket_draft_from_state(seed, awaiting="issue")
        draft["surface"] = "portal"
        return _portal_specialist_handoff(draft=draft, step="issue", route="kb")

    allowed = can_create_ticket
    if allowed is None:
        allowed = role in ("admin", "agent", "customer")
    if role in ("resolver", "viewer"):
        allowed = False
    if not allowed:
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="nav",
                kind="forbidden",
                fallback=(
                    "Role cannot create tickets. Suggest My Tickets, Search, or Knowledge Base."
                ),
                user_text=text,
                page_label=page,
                context={"feature": "Create ticket", "denied": True},
            ),
            "actions": [],
            "route": "general",
            "escalate_draft": None,
            "ticket_draft": None,
        }

    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    # Do not bind the start utterance ("create ticket") as customerName.
    seed = _merge_ticket_turn(
        {"awaiting": "name"}, text, decision, bind_awaiting=False
    )
    missing = missing_ticket_fields(seed)
    if not missing:
        seed, bind_status, _ = _bind_directory_customer(
            seed,
            org,
            user_id=user_id,
            user_name=user_name,
            user_role=role,
        )
        if bind_status != "ok":
            return _ticket_unknown_customer(
                text,
                page=page,
                data=seed,
                bind_status=bind_status,
                org=org,
                role=role,
                user_id=user_id,
                user_name=user_name,
            )
        seed, enrichment_error = _enrich_ticket_preview(
            seed,
            org,
            user_id=user_id,
            user_name=user_name,
            user_role=role,
        )
        if enrichment_error:
            return _ticket_enrichment_failure(
                text,
                page=page,
                data=seed,
                error=enrichment_error,
            )
        return _ticket_confirm_prompt(text, page=page, data=seed)
    if missing != ["customerName", "contact", "issue"]:
        # Partial extract on start — ask only the next missing field.
        kind = {
            "customerName": "start",
            "contact": "got_name",
            "issue": "got_contact",
        }.get(missing[0], "start")
        return _ticket_ask_missing(
            text, page=page, data=seed, missing=missing, kind=kind
        )

    reply = _llm_phrase(
        module="ticket",
        kind="start",
        fallback="Start create-ticket: acknowledge and ask for the customer full name only.",
        user_text=text,
        page_label=page or "Create Ticket",
        context={"nextStep": "customer full name"},
    )
    return {
        "handled": True,
        "reply": reply,
        "actions": [
            {"type": "navigate", "view": "create-ticket"},
            {"type": "create_ticket"},
        ],
        "route": "tickets",
        "escalate_draft": None,
        "macro_draft": None,
        "team_draft": None,
        "kb_draft": None,
        "ticket_draft": ticket_draft_from_state({}),
        "current_workflow": "create_ticket",
        "current_step": "name",
    }


def _portal_draft_payload(data: dict[str, Any], *, awaiting: str) -> dict[str, Any]:
    """Project portal ticket_draft without dropping collected issue fields."""
    from app.workflow_schemas import ticket_draft_from_state

    draft = ticket_draft_from_state({**data, "surface": "portal"}, awaiting=awaiting)
    draft["surface"] = "portal"
    if data.get("kb_offered"):
        draft["kb_offered"] = True
    if data.get("description") and not draft.get("description"):
        draft["description"] = data.get("description")
    return draft


def _portal_specialist_handoff(
    *,
    draft: dict[str, Any] | None,
    step: str | None,
    route: str = "kb",
    actions: list[Any] | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Portal state processor exit: never paint user text here.
    Specialist (run_specialist) is the only UI reply gateway.
    """
    out: dict[str, Any] = {
        "handled": False,
        "reply": "",
        "actions": list(actions or []),
        "route": route,
        "ticket_draft": draft,
        "current_workflow": "create_ticket" if draft else None,
        "current_step": step,
    }
    if data:
        out["data"] = data
    return out


def _portal_advance_after_issue(
    text: str,
    *,
    page: str | None,
    org: str,
    data: dict[str, Any],
) -> dict[str, Any]:
    """
    Issue collected → save draft; KB/DSSA only mutates step + pending_kb data.
    Never returns user-facing prose — specialist owns the reply.
    """
    from app.proactive.dssa import SPEC as DSSA_SPEC
    from app.proactive.dssa import evaluate_deflection
    from app.workflow_schemas import issue_looks_usable

    blob = {**data, "surface": "portal"}
    issue = str(
        blob.get("issue") or blob.get("description") or blob.get("subject") or ""
    ).strip()
    subject = str(blob.get("subject") or "").strip()
    if not issue_looks_usable(issue) and issue_looks_usable(subject):
        issue = subject
        blob["issue"] = issue
    if issue and not blob.get("description"):
        blob["description"] = issue

    try:
        dssa = evaluate_deflection(
            issue,
            organization_id=str(org or "").strip(),
            channel="portal",
            subject=subject or None,
        )
    except Exception:
        dssa = {"deflect": False, "reply": "", "confidence": 0.0}

    if (
        dssa.get("deflect")
        and (
            float(dssa.get("confidence") or 0) >= DSSA_SPEC.confidence_threshold
            or (
                float(dssa.get("confidence") or 0) >= 0.55
                and (
                    (isinstance(dssa.get("article_ids"), list) and dssa.get("article_ids"))
                    or (
                        isinstance(dssa.get("chosen_articles"), list)
                        and dssa.get("chosen_articles")
                    )
                )
                and str(dssa.get("reply") or "").strip()
            )
        )
    ):
        blob["kb_offered"] = True
        # Structured KB material for Context Factory — not a chat bubble.
        pending: dict[str, Any] = {
            "confidence": dssa.get("confidence"),
            "article_ids": dssa.get("article_ids") or [],
            "interactive": True,
            "steps_shown": int(dssa.get("steps_shown") or 0),
        }
        chosen = dssa.get("chosen_articles")
        if isinstance(chosen, list) and chosen:
            pending["articles"] = chosen
        steps = dssa.get("steps")
        if isinstance(steps, list) and steps:
            pending["steps"] = [str(s).strip() for s in steps if str(s).strip()]
        guidance = str(dssa.get("reply") or "").strip()
        if guidance:
            pending["guidance_notes"] = guidance
        blob["pending_kb"] = pending
        draft = _portal_draft_payload(blob, awaiting="kb_resolution")
        if pending:
            draft["pending_kb"] = pending
        return _portal_specialist_handoff(
            draft=draft,
            step="kb_resolution",
            route="kb",
            data={
                "dssa_deflected": True,
                "confidence": dssa.get("confidence"),
                "seed_reply": guidance or None,
            },
        )

    draft = _portal_draft_payload(blob, awaiting="confirm")
    return _portal_specialist_handoff(draft=draft, step="confirm", route="kb")


def _file_portal_ticket(
    text: str,
    *,
    page: str | None,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    data: dict[str, Any],
    force_create: bool = False,
) -> dict[str, Any]:
    """File via portal_create_ticket → Express portal intake (same ticketing DB)."""
    from app.tools.catalog_tools import portal_create_ticket
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.workflow_schemas import issue_looks_usable, ticket_draft_from_state

    issue = str(data.get("issue") or data.get("description") or "").strip()
    subject = str(data.get("subject") or "").strip()
    if not issue_looks_usable(issue) and issue_looks_usable(subject):
        issue = subject
    if not issue_looks_usable(issue):
        draft = _portal_draft_payload({**data, "surface": "portal"}, awaiting="issue")
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="validation",
                fallback="Ask for a clearer description of the issue before filing.",
                user_text=text,
                page_label=page or "Support portal",
                context={"nextStep": "short description of the issue", "portal": True},
            ),
            "actions": [],
            "route": "tickets",
            "ticket_draft": draft,
            "current_workflow": "create_ticket",
            "current_step": "issue",
        }

    # After KB guidance the user already insisted — skip DSSA re-gate.
    force = bool(force_create or data.get("kb_offered"))
    actor = ToolActor(
        user_id=str(user_id or "").strip() or "portal-customer",
        organization_id=str(org or "").strip(),
        user_role=role or "portal_customer",
        user_name=(user_name or None),
        portal_customer_id=str(user_id or "").strip() or None,
    )
    with tool_actor_scope(actor):
        result = portal_create_ticket(
            issue=issue,
            subject=subject or issue[:120],
            description=issue,
            force_create=force,
        )
    if not result.get("success"):
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        if payload.get("deflected") or str(result.get("error_code") or "") == "DSSA_DEFLECTED":
            reply = str(payload.get("reply") or result.get("message") or "").strip()
            # Keep canonical draft; only advance step to kb_resolution.
            blob = {
                **data,
                "surface": "portal",
                "issue": issue,
                "subject": subject or issue[:120],
                "description": data.get("description") or issue,
                "kb_offered": True,
            }
            draft = _portal_draft_payload(blob, awaiting="kb_resolution")
            return {
                "handled": True,
                "reply": reply
                or "I found help in our knowledge base. Try those steps, then tell me if you still need a ticket.",
                "actions": [],
                "route": "kb",
                "agent": "dssa",
                "ticket_draft": draft,
                "current_workflow": "create_ticket",
                "current_step": "kb_resolution",
                "data": {
                    "dssa_deflected": True,
                    "confidence": payload.get("confidence"),
                },
            }
        err = str(result.get("message") or "Could not create ticket")
        draft = ticket_draft_from_state({**data, "surface": "portal", "issue": issue})
        draft["surface"] = "portal"
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="validation",
                fallback=err,
                user_text=text,
                page_label=page or "Support portal",
                context={"error": True, "portal": True},
            ),
            "actions": [],
            "route": "tickets",
            "ticket_draft": draft,
        }
    pl = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    tn = str(
        pl.get("ticketNumber") or pl.get("ticket_number") or pl.get("id") or ""
    ).strip()
    subj = str(pl.get("subject") or subject or issue)[:120]
    return {
        "handled": True,
        "reply": _llm_phrase(
            module="ticket",
            kind="created",
            fallback=f"Filed ticket {tn or ''} for this issue.",
            user_text=text,
            page_label=page or "Support portal",
            context={
                "ticketNumber": tn,
                "subject": subj,
                "portal": True,
                "filed": True,
            },
        ),
        "actions": [],
        "route": "tickets",
        "ticket_draft": None,
        "current_workflow": None,
        "current_step": None,
    }


def _bind_directory_customer(
    data: dict[str, Any],
    org: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    """
    Attach a directory row once email/phone is known.

    Returns (data, status, hits) where status is ok | none | many.
    Name-only drafts are left unbound (ok) until contact is collected.
    """
    out = dict(data or {})
    cid = str(out.get("customerId") or "").strip()
    if cid:
        if str(out.get("customerDirectoryStatus") or "").strip().lower() == "verified":
            return out, "ok", []
        out.pop("customerId", None)
    email = str(out.get("customerEmail") or "").strip().lower()
    phone_digits = re.sub(r"\D", "", str(out.get("customerPhone") or ""))
    if not email and len(phone_digits) < 7:
        return out, "ok", []
    from app.tools.catalog_tools import list_customers
    from app.tools.express_client import ToolActor, tool_actor_scope

    actor = ToolActor(
        user_id=str(user_id or "").strip(),
        organization_id=str(org or "").strip(),
        user_role=user_role,
        user_name=user_name,
    )
    with tool_actor_scope(actor):
        # Express accepts only one of exactEmail / exactPhone — never both.
        if email:
            result = list_customers(exact_email=email)
        else:
            result = list_customers(exact_phone=phone_digits or None)
    if not result.get("success"):
        # Do not treat API/lookup failures as "customer missing".
        return out, "error", []
    payload = result.get("payload")
    if isinstance(payload, list):
        raw_hits = payload
    elif isinstance(payload, dict):
        raw_hits = payload.get("data") if isinstance(payload.get("data"), list) else []
    else:
        raw_hits = []
    hits = [h for h in raw_hits if isinstance(h, dict)]
    exact: list[dict[str, Any]] = []
    for h in hits:
        hit_email = str(h.get("email") or "").strip().lower()
        hit_phone = re.sub(r"\D", "", str(h.get("phone") or ""))
        if email and hit_email == email:
            exact.append(h)
            continue
        if (
            len(phone_digits) >= 7
            and hit_phone
            and (
                hit_phone == phone_digits
                or hit_phone.endswith(phone_digits)
                or phone_digits.endswith(hit_phone)
            )
        ):
            exact.append(h)
    pool = exact or []
    if len(pool) == 1:
        row = pool[0]
        cid = str(row.get("id") or "").strip()
        if cid:
            out["customerId"] = cid
            if row.get("name"):
                out["customerName"] = str(row["name"])
            if row.get("email"):
                out["customerEmail"] = str(row["email"])
            if row.get("phone"):
                out["customerPhone"] = str(row["phone"])
            out["customerDirectoryStatus"] = "verified"
            return out, "ok", pool
        return out, "none", pool
    if len(pool) > 1:
        return out, "many", pool
    return out, "none", hits


def _enrich_ticket_preview(
    data: dict[str, Any],
    org: str,
    *,
    user_id: str | None,
    user_name: str | None,
    user_role: str | None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Confirm preview: local triage (no Express round-trip — that deadlocks uvicorn).

    Same pipeline as POST /api/tickets (L1 agent + L2 resolver + team). Resolver is
    chosen by the LLM from the live roster (skills, workload, priority) — not a
    score gate.
    """
    merged = dict(data)
    issue = str(merged.get("issue") or merged.get("subject") or "").strip()
    # Do NOT pre-seed subject/description from the raw utterance — triage LLM owns
    # ticket copy. Keep customer issue text only in `issue` until enrich runs.
    priority = str(merged.get("priority") or "").strip().lower()
    if priority not in ("urgent", "high", "medium", "low"):
        merged["priority"] = "medium"
    if not issue or not str(org or "").strip():
        merged["enriched"] = True
        return merged, None
    try:
        from app.tasks.pipeline import run_triage_assign
        from app.tasks.schemas import TriageAssignRequest

        role_l = (user_role or "").strip().lower()
        created_role = (
            "agent"
            if role_l == "agent"
            else "admin"
            if role_l == "admin"
            else "customer"
        )
        # Drop utterance-truncates so triage can replace with LLM copy.
        prior_subject = str(merged.get("subject") or "").strip()
        prior_desc = str(merged.get("description") or "").strip()
        if prior_subject and (
            prior_subject == issue
            or prior_subject.rstrip("…") == issue[: len(prior_subject.rstrip("…"))]
            or issue.startswith(prior_subject.rstrip("…"))
        ):
            merged.pop("subject", None)
        if prior_desc and (
            prior_desc == issue
            or prior_desc == f"Customer reported:\n\n{issue}"
            or issue in prior_desc
        ):
            merged.pop("description", None)

        out = run_triage_assign(
            TriageAssignRequest(
                organization_id=str(org).strip(),
                customer_name=str(merged.get("customerName") or "Customer"),
                customer_email=str(merged.get("customerEmail") or "") or None,
                customer_phone=str(merged.get("customerPhone") or "") or None,
                issue=issue,
                created_by_role=created_role,
                force_assignee_id=str(user_id).strip() if role_l == "agent" and user_id else None,
                force_assignee_name=(
                    str(user_name).strip() if role_l == "agent" and user_name else None
                ),
            )
        )
        if out.subject:
            merged["subject"] = out.subject
        if out.description:
            merged["description"] = out.description
        if out.priority:
            merged["priority"] = out.priority
        if out.assignee:
            merged["assignee"] = out.assignee
        if out.assignee_id:
            merged["assigneeId"] = out.assignee_id
        if out.queue:
            merged["queue"] = out.queue
        if out.category:
            merged["category"] = out.category
        if out.skill:
            merged["skill"] = out.skill
        if out.resolver:
            merged["resolver"] = out.resolver
        if out.resolver_id:
            merged["resolverId"] = out.resolver_id
        if out.resolver_confidence is not None:
            merged["resolver_confidence"] = out.resolver_confidence
            merged["confidence"] = out.resolver_confidence
            merged["resolverConfidence"] = out.resolver_confidence
        if out.rationale:
            merged["rationale"] = out.rationale
        merged["enrichedByAi"] = bool(out.enrichedByAi)
        merged["channel"] = out.channel or "Web"
    except Exception:  # noqa: BLE001 — preview must not block confirm
        pass
    if not str(merged.get("subject") or "").strip() and issue:
        merged["subject"] = issue[:200]
    if not str(merged.get("description") or "").strip() and issue:
        merged["description"] = issue
    merged["enriched"] = True
    return merged, None


def _ticket_enrichment_failure(
    text: str,
    *,
    page: str | None,
    data: dict[str, Any],
    error: dict[str, Any],
) -> dict[str, Any]:
    from app.workflow_schemas import ticket_draft_from_state

    return {
        "handled": True,
        "reply": _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Explain that the ticket preview could not be validated and offer retry.",
            user_text=text,
            page_label=page or "Create Ticket",
            context={
                "errorCode": error.get("error_code"),
                "previewUnavailable": True,
                "nextStep": "retry preview or cancel",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "create-ticket"},
            _ticket_ui_action(data, step="confirm"),
        ],
        "route": "tickets",
        "ticket_draft": ticket_draft_from_state(data, awaiting="confirm"),
        "data": {
            "serviceError": error.get("error_code") or "TICKET_ENRICHMENT_FAILED",
            "retryable": error.get("error_code") == "RETRYABLE",
        },
    }


def _ticket_unknown_customer(
    text: str,
    *,
    page: str | None,
    data: dict[str, Any],
    bind_status: str,
    org: str = "",
    role: str | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
) -> dict[str, Any]:
    """Directory miss/ambiguous during create-ticket — stay on the ticket draft.

    Do not auto-start add-customer mid-filing (that steals the turn into a confirm
    the user thinks is still ticket issue collection).
    """
    del org, user_id, user_name  # reserved for future directory UX
    from app.workflow_schemas import ticket_draft_from_state

    many = bind_status == "many"
    name = str(data.get("customerName") or "").strip()
    email = str(data.get("customerEmail") or "").strip()
    phone = str(data.get("customerPhone") or "").strip()
    has_contact = bool(email) or len(re.sub(r"\D", "", phone)) >= 7

    if many:
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="validation",
                fallback="Intent: several directory matches; ask which existing customer.",
                user_text=text,
                page_label=page or "Create Ticket",
                context={
                    "customerName": name or None,
                    "nextStep": "which existing customer",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "create-ticket"},
                _ticket_ui_action(data, step="contact"),
            ],
            "route": "tickets",
            "ticket_draft": ticket_draft_from_state(data, awaiting="contact"),
            "current_workflow": "create_ticket",
            "current_step": "contact",
        }

    # Unknown contact: keep filing — ask for the issue next when name+contact exist.
    if name and has_contact:
        draft = ticket_draft_from_state(data, awaiting="issue")
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="got_contact",
                fallback=(
                    "Contact saved for this ticket even though they are not in the "
                    "directory yet. Ask for the issue description next."
                ),
                user_text=text,
                page_label=page or "Create Ticket",
                context={
                    "customerName": name,
                    "customerEmail": email or None,
                    "customerPhone": phone or None,
                    "notInDirectory": True,
                    "nextStep": "issue description",
                    "role": (role or "").strip().lower() or None,
                },
            ),
            "actions": [
                {"type": "navigate", "view": "create-ticket"},
                _ticket_ui_action(draft, step="issue"),
            ],
            "route": "tickets",
            "ticket_draft": draft,
            "customer_draft": None,
            "current_workflow": "create_ticket",
            "current_step": "issue",
        }

    return {
        "handled": True,
        "reply": _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask again for a valid email or phone for this customer.",
            user_text=text,
            page_label=page or "Create Ticket",
            context={
                "customerName": name or None,
                "nextStep": "email address or phone number",
            },
        ),
        "actions": [
            {"type": "navigate", "view": "create-ticket"},
            _ticket_ui_action(data, step="contact"),
        ],
        "route": "tickets",
        "ticket_draft": ticket_draft_from_state(data, awaiting="contact"),
        "current_workflow": "create_ticket",
        "current_step": "contact",
    }


def _continue_ticket_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    ticket_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Schema-driven create-ticket: extract → store → missing? → ask | hand off confirm."""
    from app.workflow_schemas import missing_ticket_fields, ticket_draft_from_state

    awaiting = str(ticket_draft.get("awaiting") or "").strip().lower()
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    # Gemma owns cancel meaning — no utterance keyword fallback.
    if action == "CANCEL_WORKFLOW":
        from app.memory import emit_workflow_event

        emit_workflow_event("workflow_cancelled", workflow="create_ticket")
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="cancelled",
                fallback="Acknowledge cancelling create-ticket.",
                user_text=text,
                page_label=page or "Create Ticket",
                context={"cancelled": True},
            ),
            "actions": [],
            "route": "tickets",
            "ticket_draft": None,
        }

    # Portal: state processor only — specialist is the sole UI reply gateway.
    if str(ticket_draft.get("surface") or "").strip().lower() == "portal":
        awaiting_portal = str(ticket_draft.get("awaiting") or "").strip().lower()
        bind_fields = awaiting_portal not in ("confirm", "kb_resolution")
        merged = _merge_ticket_turn(
            ticket_draft,
            text,
            decision,
            bind_awaiting=bind_fields,
        )
        merged["surface"] = "portal"
        if ticket_draft.get("kb_offered"):
            merged["kb_offered"] = True
        if isinstance(ticket_draft.get("pending_kb"), dict):
            merged["pending_kb"] = ticket_draft["pending_kb"]
        for key in ("issue", "subject", "description"):
            if not str(merged.get(key) or "").strip() and ticket_draft.get(key):
                merged[key] = ticket_draft.get(key)

        if action == "CANCEL_WORKFLOW":
            return _portal_specialist_handoff(draft=None, step=None, route="kb")

        if awaiting_portal == "kb_resolution":
            op = str(decision.get("operation") or "").strip().upper()
            if action == "CONFIRM_WORKFLOW" or (
                action == "CONTINUE_WORKFLOW" and op in {"CREATE_TICKET", "CREATE"}
            ):
                # Arm confirm — specialist calls portal_create_ticket.
                draft = _portal_draft_payload(
                    {**merged, "kb_offered": True}, awaiting="confirm"
                )
                return _portal_specialist_handoff(draft=draft, step="confirm", route="kb")
            draft = _portal_draft_payload(merged, awaiting="kb_resolution")
            if merged.get("pending_kb"):
                draft["pending_kb"] = merged["pending_kb"]
            return _portal_specialist_handoff(
                draft=draft, step="kb_resolution", route="kb"
            )

        if awaiting_portal == "confirm":
            draft = _portal_draft_payload(merged, awaiting="confirm")
            return _portal_specialist_handoff(draft=draft, step="confirm", route="kb")

        missing = missing_ticket_fields(merged)
        if missing:
            draft = _portal_draft_payload(merged, awaiting="issue")
            return _portal_specialist_handoff(draft=draft, step="issue", route="kb")
        return _portal_advance_after_issue(
            text,
            page=page,
            org=org,
            data=merged,
        )

    if awaiting == "confirm" or (
        action == "CONFIRM_WORKFLOW" and not missing_ticket_fields(ticket_draft)
    ):
        if action == "CANCEL_WORKFLOW":
            from app.memory import emit_workflow_event

            emit_workflow_event("workflow_cancelled", workflow="create_ticket")
            return {
                "handled": True,
                "reply": _llm_phrase(
                    module="ticket",
                    kind="cancelled",
                    fallback="Acknowledge cancelling create-ticket.",
                    user_text=text,
                    page_label=page or "Create Ticket",
                    context={"cancelled": True},
                ),
                "actions": [],
                "route": "tickets",
                "ticket_draft": None,
            }

        # Customer-not-found: "yes" means start create_customer, park ticket.
        if ticket_draft.get("customer_not_found") and action != "CANCEL_WORKFLOW":
            from app.tasks.catalog_commands import start_create_customer_flow

            parked_ticket = ticket_draft_from_state(ticket_draft, awaiting="confirm")
            parked_ticket.pop("customer_not_found", None)
            parked_drafts = [
                {"flow": "ticket", "draft": parked_ticket},
            ]
            out = start_create_customer_flow(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                ticket_draft=parked_ticket,
                parked_drafts=parked_drafts,
                session_history=None,
                semantic_decision=decision or None,
            )
            out["ticket_draft"] = None
            out["parked_drafts"] = parked_drafts
            return out

        # Specialist LLM owns confirm semantic → create_ticket tool_call.
        # Do not POST from Python on CONFIRM_WORKFLOW / CONTINUE_WORKFLOW.
        if missing_ticket_fields(ticket_draft):
            return _ticket_confirm_prompt(text, page=page, data=dict(ticket_draft))
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "tickets",
            "ticket_draft": ticket_draft_from_state(ticket_draft, awaiting="confirm"),
            "current_workflow": "create_ticket",
            "current_step": "confirm",
        }

    from app.workflow_schemas import awaiting_hint_from_missing

    prior_miss = missing_ticket_fields(ticket_draft)
    if not prior_miss:
        # Complete draft — specialist handoff (missing SoT, not awaiting label).
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "tickets",
            "ticket_draft": ticket_draft_from_state(ticket_draft, awaiting="confirm"),
            "current_workflow": "create_ticket",
            "current_step": "confirm",
        }

    # Project UI hint from missing SoT — stale draft.awaiting must not block collect.
    awaiting = awaiting_hint_from_missing("create_ticket", ticket_draft)

    merged = _merge_ticket_turn(ticket_draft, text, decision)
    merged, bind_status, _hits = _bind_directory_customer(
        merged,
        org,
        user_id=user_id,
        user_name=user_name,
        user_role=role,
    )
    # Name/contact can pause for directory. Issue/priority answers must not
    # collapse create-ticket into create-customer or a ticket-list clarify.
    if bind_status in ("none", "many") and awaiting in ("name", "contact"):
        return _ticket_unknown_customer(
            text, page=page, data=merged, bind_status=bind_status,
            org=org, role=role, user_id=user_id, user_name=user_name,
        )
    missing = missing_ticket_fields(merged)
    prior_miss = missing_ticket_fields(ticket_draft)
    progressed = any(
        str(merged.get(key) or "").strip()
        != str(ticket_draft.get(key) or "").strip()
        for key in (
            "customerName",
            "customerEmail",
            "customerPhone",
            "issue",
            "priority",
        )
    )
    if missing:
        if not progressed:
            return _ticket_ask_missing(
                text, page=page, data=merged, missing=missing, kind="validation"
            )
        kind = {
            "customerName": "start",
            "contact": "got_name",
            "issue": "got_contact",
        }.get(missing[0], "got_name")
        filled_now = [m for m in prior_miss if m not in missing]
        if filled_now:
            kind = {
                "customerName": "got_name",
                "contact": "got_contact",
                "issue": "got_issue",
            }.get(filled_now[0], kind)
        return _ticket_ask_missing(
            text, page=page, data=merged, missing=missing, kind=kind
        )

    merged, enrichment_error = _enrich_ticket_preview(
        merged,
        org,
        user_id=user_id,
        user_name=user_name,
        user_role=role,
    )
    if enrichment_error:
        return _ticket_enrichment_failure(
            text,
            page=page,
            data=merged,
            error=enrichment_error,
        )
    return _ticket_confirm_prompt(text, page=page, data=merged)


def _looks_like_person_name(text: str) -> bool:
    raw = (text or "").strip()
    if len(raw) < 2 or len(raw) > 60:
        return False
    if re.search(
        r"\b(create|file|make|new|ticket|tickets|case|show|list|filter|all)\b",
        raw,
        re.I,
    ):
        return False
    if not re.fullmatch(
        r"[A-Za-z][A-Za-z'’.\-]*(?:\s+[A-Za-z][A-Za-z'’.\-]*){0,3}", raw
    ):
        return False
    return True


def _awaiting_create_customer_name(history: list | None) -> bool:
    """True when the last assistant turn asked for the customer name (create flow)."""
    if not isinstance(history, list):
        return False
    for item in reversed(history):
        if not isinstance(item, dict):
            continue
        if str(item.get("role") or "").lower() != "assistant":
            continue
        text = str(item.get("text") or "")
        if re.search(
            r"customer.?s?\s+full\s+name|full\s+name\s+of\s+the\s+customer|"
            r"what\s+is\s+the\s+customer|customer.?s?\s+name",
            text,
            re.I,
        ):
            return True
        # Stop at first other assistant turn
        return False
    return False


def _heuristic_kind(text: str) -> dict[str, Any]:
    """Mutate starts come from Super Agent START_* / operation — not keywords."""
    del text
    return {"kind": "none", "ticket_number": None, "assignee_hint": None, "reply": ""}


def _classify_with_llm(message: str, page: str | None) -> dict[str, Any]:
    try:
        llm = get_llm()
        result = llm.invoke(
            [
                SystemMessage(content=COMMAND_SYSTEM),
                HumanMessage(content=f"PAGE: {page or 'unknown'}\nUSER: {message}"),
            ]
        )
        content = getattr(result, "content", None) or str(result)
        parsed = _extract_json_obj(str(content)) or {}
        kind = str(parsed.get("kind") or "none").strip().lower()
        if kind not in (
            "escalate",
            "create_ticket",
            "create_team",
            "create_macro",
            "create_kb",
            "create_priority",
            "create_customer",
            "update_ticket",
            "add_note",
            "ui",
            "none",
        ):
            kind = "none"
        ticket = str(parsed.get("ticket_number") or "").strip().lstrip("#") or None
        if ticket and re.search(r"\b(list|all|show|clear|filter)\b", ticket, re.I):
            ticket = None
        hint = str(parsed.get("assignee_hint") or "").strip() or None
        reply = str(parsed.get("reply") or "").strip()
        log_llm(
            kind="chat_command",
            user_text=message,
            response=json.dumps({"kind": kind, "ticket_number": ticket})[:400],
            page=page,
        )
        return {
            "kind": kind,
            "ticket_number": ticket or _extract_ticket_number(message),
            "assignee_hint": hint or _extract_assignee_hint(message),
            "reply": reply,
        }
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="chat_command_error",
            user_text=message,
            response="",
            page=page,
            error=str(exc),
        )
        return {
            "kind": "none",
            "ticket_number": None,
            "assignee_hint": None,
            "reply": "",
        }


def _normalize_ticket_row(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """Map Express/MCP ticket payload → escalate picklist shape."""
    if not isinstance(raw, dict):
        return None
    tn = str(raw.get("ticket_number") or raw.get("id") or "").strip()
    if not tn:
        return None
    return {
        "ticket_number": tn,
        "subject": raw.get("subject"),
        "status": raw.get("status"),
        "priority": raw.get("priority"),
        "skill": raw.get("skill"),
        "category": raw.get("category"),
        "description": raw.get("description"),
        "queue_name": raw.get("queue_name") or raw.get("queue"),
        "assignee_id": raw.get("assignee_id") or raw.get("assigneeId"),
        "assignee_name": raw.get("assignee_name") or raw.get("assignee"),
        "resolver_id": raw.get("resolver_id") or raw.get("resolverId"),
        "resolver_name": raw.get("resolver_name") or raw.get("resolver"),
        "created_by_id": raw.get("created_by_id") or raw.get("createdById"),
    }


def _tickets_from_tool_result(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            rows = payload["data"]
        elif payload.get("id") or payload.get("ticket_number"):
            rows = [payload]
    out: list[dict[str, Any]] = []
    for row in rows:
        norm = _normalize_ticket_row(row if isinstance(row, dict) else None)
        if norm:
            out.append(norm)
    return out


def _escalate_tool_actor(
    org_id: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
):
    from app.tools.express_client import ToolActor

    return ToolActor(
        user_id=str(user_id or "").strip() or "unknown",
        organization_id=str(org_id or "").strip(),
        user_role=(user_role or None),
        user_name=(user_name or None),
    )


def _find_ticket(
    org_id: str,
    ticket_number: str | None,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
) -> dict[str, Any] | None:
    """Look up one ticket via shared tools (MCP/Express). Never auto-picks."""
    if not ticket_number:
        return None
    raw = str(ticket_number).strip().lstrip("#")
    if not raw:
        return None
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_read import get_ticket

    actor = _escalate_tool_actor(
        org_id, user_id=user_id, user_name=user_name, user_role=user_role
    )
    if not str(org_id or "").strip() or actor.user_id == "unknown":
        # Still try get when org is known — actor required by Express
        if not str(org_id or "").strip():
            return None
    with tool_actor_scope(actor):
        result = get_ticket(raw)
    rows = _tickets_from_tool_result(result)
    if rows:
        return rows[0]
    # Retry with leading # if Express stores UI-style numbers
    with tool_actor_scope(actor):
        result = get_ticket(f"#{raw}")
    rows = _tickets_from_tool_result(result)
    return rows[0] if rows else None


def _list_escalate_ticket_choices(
    org_id: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Recent open tickets via list_tickets tool (role-scoped by Express)."""
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_read import list_tickets

    lim = max(1, min(int(limit), 10))
    role = (user_role or "").strip().lower()
    if role in ("resolver", "viewer"):
        scope = "assignee"
    elif role == "customer":
        scope = "requester"
    elif role == "admin":
        scope = "org"
    elif role == "agent":
        scope = "team"
    else:
        scope = None

    actor = _escalate_tool_actor(
        org_id, user_id=user_id, user_name=user_name, user_role=user_role
    )
    with tool_actor_scope(actor):
        result = list_tickets(scope=scope, limit=lim * 3)
        if not result.get("success") and scope:
            result = list_tickets(limit=lim * 3)

    rows = _tickets_from_tool_result(result)
    open_rows = [
        r
        for r in rows
        if str(r.get("status") or "").strip().lower() not in ("resolved", "closed")
    ]
    return open_rows[:lim]


def _format_ticket_choices(tickets: list[dict[str, Any]]) -> str:
    if not tickets:
        return "(no open tickets found)"
    lines = []
    for t in tickets:
        tn = str(t.get("ticket_number") or "").strip()
        if tn and not tn.startswith("#"):
            tn = f"#{tn}"
        subj = str(t.get("subject") or "ticket").strip()
        pri = str(t.get("priority") or "").strip()
        pri_bit = f" (**{pri.title()}**)" if pri else ""
        lines.append(f"* **{tn}**: {subj}{pri_bit}")
    return "\n".join(lines)


def _looks_like_ticket_choice(text: str) -> bool:
    if _extract_ticket_number(text):
        return True
    raw = (text or "").strip().lstrip("#")
    return bool(re.fullmatch(r"[A-Za-z0-9][-A-Za-z0-9]{1,24}", raw))


def _ask_which_ticket_to_escalate(
    org_id: str,
    *,
    user_id: str | None,
    user_name: str | None,
    user_role: str | None,
    user_text: str = "",
) -> dict[str, Any]:
    choices = _list_escalate_ticket_choices(
        org_id,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
    )
    role = (user_role or "").strip().lower()
    if not choices:
        ask = _llm_phrase(
            module="ticket",
            kind="escalate_prompt",
            fallback=(
                "No open tickets assigned to escalate; ask for a ticket number "
                "(e.g. #12802)."
                if role == "resolver"
                else "No open tickets to escalate; ask for a ticket number (e.g. #12802)."
            ),
            user_text=user_text or "escalate",
            page_label="Tickets",
            context={"empty": True, "role": role},
        )
        return {
            "handled": True,
            "reply": ask,
            "actions": [{"type": "navigate", "view": "tickets-list"}],
            "route": "tickets",
            "escalate_draft": {"awaiting": "ticket", "candidates": []},
        }
    scope = "your recent tickets" if role == "resolver" else "recent open tickets"
    example = str(choices[0].get("ticket_number") or "")
    facts = f"{_format_ticket_choices(choices)}\n\nScope: {scope}"
    reply = _phrase_plus_facts(
        fallback=(
            f"Ask which ticket to escalate from {scope}. "
            "User replies with a ticket number or 'same ticket' — then ask who."
        ),
        user_text=user_text or "escalate",
        page_label="Tickets",
        facts=facts,
        context={
            "scope": scope,
            "example": example,
            "awaiting": "ticket",
            "nextStep": (
                f"ticket number (e.g. #{example.lstrip('#')}) or same ticket"
            ),
        },
    )
    return {
        "handled": True,
        "reply": reply,
        "actions": [{"type": "navigate", "view": "tickets-list"}],
        "route": "tickets",
        "escalate_draft": {
            "awaiting": "ticket",
            "candidates": [str(t.get("ticket_number") or "") for t in choices],
        },
    }


def _match_named_assignee(
    org_id: str,
    name_hint: str,
    exclude_id: str | None = None,
    *,
    candidates: list[str] | None = None,
) -> dict[str, Any] | None:
    """Map a natural name hint to a live DB staff row (canonical spelling + id).

    Prefer offered escalate candidates, then fall back to the full org roster.
    Returns:
      {assignee, assignee_id, rationale_extra} on a clear unique hit
      {assignee, assignee_id, needs_name_confirm: True} on fuzzy-only unique
      {ambiguous: [{id,name}, ...]} when several people match
      None when nothing matches
    """
    from app.workflow_schemas import ticket_person_resolution

    needle = str(name_hint or "").strip()
    if not needle:
        return None
    agents = list_org_agents(org_id)
    if exclude_id:
        agents = [a for a in agents if str(a.get("id") or "") != str(exclude_id)]

    cand_names = [
        str(c).strip() for c in (candidates or []) if str(c).strip()
    ]
    pool: list[dict[str, Any]] = []
    if cand_names:
        by_lower = {
            str(a.get("name") or "").strip().lower(): a
            for a in agents
            if str(a.get("name") or "").strip()
        }
        for name in cand_names:
            row = by_lower.get(name.lower())
            if row:
                pool.append(row)
            else:
                pool.append({"id": "", "name": name, "role": "resolver"})
    if not pool:
        pool = [a for a in agents if str(a.get("name") or "").strip()]

    def _hit_from_pool(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not rows:
            return None
        hit = ticket_person_resolution(needle, rows)
        if not isinstance(hit, dict):
            return None
        if hit.get("kind") == "ambiguous":
            return {"ambiguous": list(hit.get("candidates") or [])}
        kind = str(hit.get("kind") or "").strip()
        if kind not in {"clear", "propose"}:
            return None
        name = str(hit.get("name") or "").strip()
        if not name:
            return None
        person_id = str(hit.get("id") or "").strip()
        if not person_id:
            for row in rows:
                if str(row.get("name") or "").strip().lower() == name.lower():
                    person_id = str(row.get("id") or "").strip()
                    name = str(row.get("name") or "").strip() or name
                    break
        if not person_id:
            for row in agents:
                if str(row.get("name") or "").strip().lower() == name.lower():
                    name = str(row.get("name") or "").strip()
                    person_id = str(row.get("id") or "").strip()
                    break
        if not person_id:
            return None
        out: dict[str, Any] = {
            "assignee": name,
            "assignee_id": person_id,
            "rationale_extra": f"Matched named assignee “{name}”.",
        }
        if kind == "propose":
            out["needs_name_confirm"] = True
        return out

    primary = _hit_from_pool(pool)
    if primary and not primary.get("ambiguous"):
        return primary
    if primary and primary.get("ambiguous") and cand_names:
        # Ambiguous within the offered list — ask; do not widen to whole org.
        return primary
    # No unique hit on candidates → try full org (still unique-or-ambiguous).
    if cand_names:
        widened = _hit_from_pool([a for a in agents if str(a.get("name") or "").strip()])
        if widened:
            return widened
    return primary


def _wants_auto_resolver(text: str, assignee_hint: str | None) -> bool:
    if _is_auto_pick_phrase(text or ""):
        return True
    hint = (assignee_hint or "").strip()
    if hint and _is_auto_pick_phrase(hint):
        return True
    return False


def _list_team_resolvers(
    org_id: str,
    ticket: dict[str, Any],
    *,
    exclude_id: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Resolvers on the ticket's team (fallback: all org resolvers)."""
    agents = list_org_agents(org_id)
    teams = list_org_teams(org_id)
    queue = str(ticket.get("queue_name") or "").strip()
    team = match_team_by_name(queue, teams) if queue else None
    team_label = str((team or {}).get("name") or queue or "your org")
    all_resolvers = [
        a for a in agents if str(a.get("role") or "").lower() == "resolver"
    ]
    pool = agents_for_team(team, agents)
    resolvers = [
        a for a in pool if str(a.get("role") or "").lower() == "resolver"
    ]
    label = team_label
    if exclude_id:
        resolvers = [a for a in resolvers if str(a.get("id") or "") != str(exclude_id)]
        all_resolvers = [
            a for a in all_resolvers if str(a.get("id") or "") != str(exclude_id)
        ]
    # Team empty (or only the current assignee) → offer other org resolvers
    if not resolvers:
        resolvers = all_resolvers
        label = "the organization" if not team else f"{team_label} (org-wide)"
    # Stable order by name
    resolvers.sort(key=lambda a: str(a.get("name") or "").lower())
    return resolvers, label


def _format_resolver_choices(resolvers: list[dict[str, Any]]) -> str:
    if not resolvers:
        return "(none available)"
    lines = []
    for a in resolvers:
        name = str(a.get("name") or "").strip()
        if not name:
            continue
        role = str(a.get("role") or "resolver")
        skills = a.get("skills")
        if isinstance(skills, list) and skills:
            skill_bit = ", ".join(str(s) for s in skills[:4])
            lines.append(f"* **{name}** ({role} — {skill_bit})")
        else:
            lines.append(f"* **{name}** ({role})")
    return "\n".join(lines) if lines else "(none available)"


def _enrich_staff_skills(
    org_id: str, people: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    skills_map = org_skills_by_user(org_id)
    out = []
    for a in people:
        row = dict(a)
        sid = str(a.get("id") or "")
        row["skills"] = list(skills_map.get(sid) or [])
        out.append(row)
    return out


def _last_ticket_from_history(history: list | None) -> str | None:
    """Most recent ticket number mentioned in session history (user or assistant)."""
    if not isinstance(history, list):
        return None
    for item in reversed(history):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "")
        tn = _extract_ticket_number(text)
        if tn:
            return tn
        m = re.search(r"\*\*#?([A-Za-z0-9][-A-Za-z0-9]{1,24})\*\*", text)
        if m:
            return m.group(1)
    return None


def _pending_from_history(history: list | None) -> dict[str, Any] | None:
    """Recover escalate-pending state from the last assistant prompt."""
    if not isinstance(history, list) or len(history) < 1:
        return None
    for item in reversed(history):
        if not isinstance(item, dict):
            continue
        if str(item.get("role") or "").lower() != "assistant":
            continue
        text = str(item.get("text") or "")
        # Prefer "which ticket" over "who" when both could match LLM phrasing.
        if re.search(
            r"which ticket|reply with a ticket number|"
            r"give (me )?a ticket number|ticket number (if|you)",
            text,
            re.I,
        ) and not re.search(
            r"who (should|do|shall)|available resolver|reply with a name",
            text,
            re.I,
        ):
            cands = re.findall(
                r"#([A-Za-z0-9][-A-Za-z0-9]{1,24})",
                text,
            )
            focused = _last_ticket_from_history(history)
            return {
                "awaiting": "ticket",
                "candidates": cands,
                "ticket_number": focused,
            }
        who_ask = re.search(
            r"who (should|do|shall)|available resolver|reply with a name|"
            r"pick (a |the )?(resolver|person|name)|assign this to",
            text,
            re.I,
        )
        m = re.search(r"\*\*#?([A-Za-z0-9][-A-Za-z0-9]{1,24})\*\*", text)
        if not m:
            m = re.search(r"#([A-Za-z0-9][-A-Za-z0-9]{1,24})", text)
        if who_ask and m:
            return {"ticket_number": m.group(1), "awaiting": "assignee"}
    return None


def _build_escalate(
    org_id: str,
    ticket_number: str | None,
    assignee_hint: str | None,
    reply_seed: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    user_text: str = "",
    escalate_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    draft = escalate_draft if isinstance(escalate_draft, dict) else None
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    nlu_fields = (
        decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    )

    # Continuing: user picked a ticket number after we asked
    if draft and draft.get("awaiting") == "ticket" and not ticket_number:
        ticket_number = _extract_ticket_number(user_text)
        if not ticket_number and _looks_like_ticket_choice(user_text):
            ticket_number = (user_text or "").strip().lstrip("#")

    # Continuing: pending assignee — keep ticket from draft
    if (
        draft
        and draft.get("awaiting") == "assignee"
        and draft.get("ticket_number")
        and not ticket_number
    ):
        ticket_number = str(draft.get("ticket_number"))
        proposed = str(draft.get("proposed_assignee") or "").strip()
        if proposed:
            from app.workflow_schemas import person_from_user_text

            affirmed = action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}
            if affirmed:
                from app.workflow_schemas import person_from_user_text

                # CONTINUE with a *different* clear roster name = switch, not affirm.
                other = person_from_user_text(
                    str(nlu_fields.get("assignee") or nlu_fields.get("person") or ""),
                    # Prefer candidates from draft when present
                    [
                        str(c).strip()
                        for c in ((draft or {}).get("candidates") or [])
                        if str(c).strip()
                    ]
                    or [proposed],
                    allow_fuzzy=False,
                    allow_substring=False,
                )
                if other and other != proposed:
                    assignee_hint = other
                    draft = {
                        **draft,
                        "proposed_assignee": None,
                        "proposed_assignee_id": None,
                    }
                    affirmed = False
            if affirmed:
                assignee_hint = proposed
            elif action == "CANCEL_WORKFLOW":
                assignee_hint = None
                draft = {
                    **draft,
                    "proposed_assignee": None,
                    "proposed_assignee_id": None,
                }
            elif not assignee_hint:
                from app.workflow_schemas import person_from_user_text

                maybe = str(
                    nlu_fields.get("assignee")
                    or nlu_fields.get("person")
                    or ""
                ).strip()
                clear = person_from_user_text(
                    maybe or user_text,
                    [proposed],
                    allow_fuzzy=False,
                    allow_substring=False,
                )
                if clear == proposed:
                    assignee_hint = proposed
                else:
                    assignee_hint = None
        elif not assignee_hint:
            cand_raw = (draft or {}).get("candidates") if draft else None
            roster_names = (
                [str(c).strip() for c in cand_raw if str(c).strip()]
                if isinstance(cand_raw, list)
                else None
            )
            role_only = _escalate_role_only_turn(
                decision=decision,
                user_text=user_text,
                assignee_hint=None,
                awaiting="assignee",
                roster_names=roster_names,
            )
            if not role_only:
                nlu_person = _nlu_reassign_person_slot(
                    decision, roster_names=roster_names
                )
                if nlu_person:
                    assignee_hint = nlu_person
                else:
                    maybe = _extract_assignee_hint(user_text or "")
                    if maybe and not _is_auto_pick_phrase(maybe):
                        assignee_hint = maybe
                    elif roster_names:
                        from app.workflow_schemas import (
                            person_from_user_text,
                            resolve_roster_name,
                        )

                        hit = person_from_user_text(
                            user_text or "",
                            roster_names,
                            allow_fuzzy=False,
                            allow_substring=False,
                        ) or resolve_roster_name(
                            (user_text or "").strip(),
                            roster_names,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                        if hit:
                            assignee_hint = hit
                        elif (user_text or "").strip() and not re.search(
                            r"\b(escalat|ticket|cancel|never\s*mind|resolver|agent)\b",
                            user_text or "",
                            re.I,
                        ):
                            assignee_hint = (user_text or "").strip()

    # No ticket yet → always ask which (never auto-pick)
    if not ticket_number:
        return _ask_which_ticket_to_escalate(
            org_id,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            user_text=user_text,
        )

    ticket = _find_ticket(
        org_id,
        ticket_number,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
    )
    if not ticket:
        tn_disp = str(ticket_number).lstrip("#")
        choices = _list_escalate_ticket_choices(
            org_id,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
        )
        facts = ""
        if choices:
            facts = (
                f"{_format_ticket_choices(choices)}\n\nReply with a ticket number."
            )
        ask = _phrase_plus_facts(
            fallback=(
                f"Could not find ticket #{tn_disp}. Ask which ticket to escalate."
            ),
            user_text=user_text or tn_disp,
            page_label="Tickets",
            facts=facts,
            context={"missingTicket": tn_disp, "awaiting": "ticket"},
        )
        return {
            "handled": True,
            "reply": ask,
            "actions": [{"type": "navigate", "view": "tickets-list"}],
            "route": "tickets",
            "escalate_draft": {
                "awaiting": "ticket",
                "candidates": [str(t.get("ticket_number") or "") for t in choices],
            },
        }

    tn = str(ticket["ticket_number"])
    exclude = str(ticket["assignee_id"]) if ticket.get("assignee_id") else None
    cand_raw = (draft or {}).get("candidates") if draft else None
    roster_names = (
        [str(c).strip() for c in cand_raw if str(c).strip()]
        if isinstance(cand_raw, list)
        else None
    )
    # Role words / role-only utterances are not people — treat as "ask who".
    if assignee_hint and (
        re.fullmatch(
            r"resolvers?|agents?|someone|anybody|anyone|a\s+resolver|a\s+agent",
            assignee_hint.strip(),
            re.I,
        )
        or _escalate_role_only_turn(
            decision=decision,
            user_text=user_text,
            assignee_hint=assignee_hint,
            awaiting="assignee",
            roster_names=roster_names,
        )
    ):
        assignee_hint = None
    auto = _wants_auto_resolver(user_text, assignee_hint)
    # Never treat auto-pick phrases / typos as a named person lookup.
    if assignee_hint and _is_auto_pick_phrase(assignee_hint):
        assignee_hint = None
        auto = True

    pending_proposed = str((draft or {}).get("proposed_assignee") or "").strip()
    pending_proposed_id = str((draft or {}).get("proposed_assignee_id") or "").strip()
    if pending_proposed and not assignee_hint and not auto:
        cand_raw = (draft or {}).get("candidates") if draft else None
        cand_list = (
            [str(c).strip() for c in cand_raw if str(c).strip()]
            if isinstance(cand_raw, list)
            else [pending_proposed]
        )
        facts = "\n".join(f"- **{n}**" for n in cand_list if n) or "(none)"
        reply = _phrase_plus_facts(
            fallback=(
                f"Ask again: Did you mean **{pending_proposed}** for escalate "
                f"on ticket #{tn}? Any affirmation means yes — do not treat "
                f"ack words as a person name."
            ),
            user_text=user_text or pending_proposed,
            page_label="Tickets",
            facts=(
                f"{facts}\n\n"
                f"Ticket **#{tn.lstrip('#')}** stays selected."
            ),
            context={
                "ticketNumber": tn,
                "didYouMean": pending_proposed,
                "awaiting": "assignee",
                "nextStep": (
                    f"Confirm {pending_proposed} or pick another resolver"
                ),
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "escalate_draft": {
                "ticket_number": tn,
                "awaiting": "assignee",
                "candidates": cand_list,
                "proposed_assignee": pending_proposed,
                "proposed_assignee_id": pending_proposed_id,
                "person_query": (draft or {}).get("person_query"),
            },
            "current_workflow": "escalate",
            "current_step": "assignee",
        }

    # No named person yet → ask and list team resolvers (with skills)
    if not assignee_hint and not auto:
        resolvers, team_label = _list_team_resolvers(
            org_id, ticket, exclude_id=exclude
        )
        resolvers = _enrich_staff_skills(org_id, resolvers)
        if not resolvers:
            reply = _llm_phrase(
                module="ticket",
                kind="escalate_prompt",
                fallback=(
                    f"Found {tn} but no other resolvers on team {team_label}."
                ),
                user_text=user_text or tn,
                page_label="Tickets",
                context={
                    "ticketNumber": tn,
                    "subject": ticket.get("subject") or "",
                    "team": team_label,
                    "emptyResolvers": True,
                },
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "tickets-list"},
                    {"type": "set_filter", "module": "tickets", "query": tn},
                ],
                "route": "tickets",
                "escalate_draft": None,
            }
        choices = _format_resolver_choices(resolvers)
        scope = (
            f"No other resolvers on team {team_label.replace(' (org-wide)', '')} — "
            f"available across the organization"
            if "org-wide" in team_label
            else f"Available resolvers on team {team_label}"
        )
        facts = (
            f"{choices}\n\n"
            f"Ticket **#{tn.lstrip('#')}** — {ticket.get('subject') or 'ticket'}"
        )
        reply = _phrase_plus_facts(
            fallback=(
                f"Ask who to escalate ticket #{tn.lstrip('#')} "
                f"(\"{ticket.get('subject') or 'ticket'}\") to. {scope}. "
                "Do not ask which ticket again."
            ),
            user_text=user_text or tn,
            page_label="Tickets",
            facts=facts,
            context={
                "ticketNumber": tn,
                "subject": ticket.get("subject") or "",
                "team": team_label,
                "scope": scope,
                "awaiting": "assignee",
                "nextStep": (
                    f"Who should I escalate #{tn.lstrip('#')} to "
                    "(name from list, or best resolver / by skill)?"
                ),
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "escalate_draft": {
                "ticket_number": tn,
                "awaiting": "assignee",
                "team": team_label,
                "candidates": [str(a.get("name") or "") for a in resolvers],
            },
        }

    picked: dict[str, Any]
    if assignee_hint and not auto:
        cand_raw = (draft or {}).get("candidates") if draft else None
        cand_list = (
            [str(c).strip() for c in cand_raw if str(c).strip()]
            if isinstance(cand_raw, list)
            else None
        )
        named = _match_named_assignee(
            org_id,
            assignee_hint,
            exclude_id=exclude,
            candidates=cand_list,
        )
        if named and named.get("ambiguous"):
            amb = [
                a
                for a in (named.get("ambiguous") or [])
                if isinstance(a, dict) and str(a.get("name") or "").strip()
            ]
            names = [str(a.get("name") or "").strip() for a in amb]
            facts = "\n".join(f"- **{n}**" for n in names) if names else "(none)"
            reply = _phrase_plus_facts(
                fallback=(
                    f"Several people match “{assignee_hint}”. Ask which one for "
                    f"ticket #{tn}."
                ),
                user_text=user_text or assignee_hint,
                page_label="Tickets",
                facts=(
                    f"{facts}\n\n"
                    f"Ticket **#{tn.lstrip('#')}** stays selected. "
                    "Reply with the full name from the list."
                ),
                context={
                    "ticketNumber": tn,
                    "missingName": assignee_hint,
                    "ambiguous": True,
                    "awaiting": "assignee",
                    "nextStep": (
                        f"Which person should I escalate #{tn.lstrip('#')} to?"
                    ),
                },
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "tickets-list"},
                    {"type": "set_filter", "module": "tickets", "query": tn},
                ],
                "route": "tickets",
                "escalate_draft": {
                    "ticket_number": tn,
                    "awaiting": "assignee",
                    "candidates": names
                    or (cand_list if cand_list else names),
                },
                "current_workflow": "escalate",
                "current_step": "assignee",
            }
        if not named:
            resolvers, team_label = _list_team_resolvers(
                org_id, ticket, exclude_id=exclude
            )
            resolvers = _enrich_staff_skills(org_id, resolvers)
            facts = _format_resolver_choices(resolvers)
            reply = _phrase_plus_facts(
                fallback=(
                    f"Could not find resolver “{assignee_hint}” for ticket #{tn}. "
                    f"Keep ticket #{tn}; list available on {team_label}; ask who again."
                ),
                user_text=user_text or assignee_hint,
                page_label="Tickets",
                facts=(
                    f"{facts}\n\n"
                    f"Ticket **#{tn.lstrip('#')}** stays selected. "
                    "Reply with a name from the list, or **best resolver**."
                ),
                context={
                    "ticketNumber": tn,
                    "missingName": assignee_hint,
                    "team": team_label,
                    "awaiting": "assignee",
                    "nextStep": (
                        f"Who should I escalate #{tn.lstrip('#')} to instead?"
                    ),
                },
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "tickets-list"},
                    {"type": "set_filter", "module": "tickets", "query": tn},
                ],
                "route": "tickets",
                "escalate_draft": {
                    "ticket_number": tn,
                    "awaiting": "assignee",
                    "team": team_label,
                    "candidates": [str(a.get("name") or "") for a in resolvers],
                },
            }
        if named.get("needs_name_confirm"):
            cand = (
                cand_list
                if cand_list
                else [str(named.get("assignee") or "").strip()]
            )
            facts = "\n".join(f"- **{n}**" for n in cand if n) or "(none)"
            person = str(named.get("assignee") or "").strip()
            reply = _phrase_plus_facts(
                fallback=(
                    f"Ask: Did you mean **{person}** for escalate on ticket "
                    f"#{tn}? Wait for yes before escalating."
                ),
                user_text=user_text or assignee_hint,
                page_label="Tickets",
                facts=(
                    f"{facts}\n\n"
                    f"Ticket **#{tn.lstrip('#')}** stays selected."
                ),
                context={
                    "ticketNumber": tn,
                    "didYouMean": person,
                    "personQuery": assignee_hint,
                    "awaiting": "assignee",
                    "nextStep": (
                        f"Confirm {person} or pick another resolver from the list"
                    ),
                },
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "tickets-list"},
                    {"type": "set_filter", "module": "tickets", "query": tn},
                ],
                "route": "tickets",
                "escalate_draft": {
                    "ticket_number": tn,
                    "awaiting": "assignee",
                    "candidates": cand,
                    "proposed_assignee": person,
                    "proposed_assignee_id": str(
                        named.get("assignee_id") or ""
                    ).strip(),
                    "person_query": assignee_hint,
                },
                "current_workflow": "escalate",
                "current_step": "assignee",
            }
        picked = named
        agent_pick: dict[str, Any] | None = None
        resolver_pick = {
            "assignee": picked.get("assignee"),
            "assignee_id": picked.get("assignee_id"),
            "rationale_extra": picked.get("rationale_extra") or "",
        }
    else:
        skill = " ".join(
            str(x)
            for x in (
                ticket.get("skill"),
                ticket.get("category"),
                ticket.get("subject"),
                ticket.get("description"),
            )
            if x
        )
        # Escalate handoff is L2 (resolver). Do not also invent a new L1 agent —
        # that made confirm copy say "from <proposed agent>" and confuse users.
        exclude_for_pick = (
            str(ticket.get("resolver_id") or "").strip()
            or exclude
        )
        dual = skill_pick_agent_and_resolver(
            org_id=org_id,
            skill_hint=skill,
            queue=str(ticket.get("queue_name") or ""),
            ticket_subject=str(ticket.get("subject") or ""),
            ticket_description=str(ticket.get("description") or ""),
            exclude_user_id=exclude_for_pick,
            use_llm=True,
        )
        agent_pick = None
        resolver_pick = {
            "assignee": dual.get("resolver"),
            "assignee_id": dual.get("resolver_id"),
            "rationale_extra": dual.get("rationale") or "",
        }

    assignee = str(resolver_pick.get("assignee") or "Unassigned")
    assignee_id = resolver_pick.get("assignee_id")
    if not assignee_id or assignee == "Unassigned":
        # Still allow agent-only reassign when no resolver matched
        if not agent_pick or not agent_pick.get("assignee_id"):
            reply = _llm_phrase(
                module="ticket",
                kind="escalate_prompt",
                fallback="No skill-matched agent/resolver available to assign.",
                user_text=user_text or tn,
                page_label="Tickets",
                context={"ticketNumber": tn, "emptyResolvers": True},
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "tickets-list"},
                    {"type": "set_filter", "module": "tickets", "query": tn},
                ],
                "route": "tickets",
                "escalate_draft": None,
            }

    rationale = str(resolver_pick.get("rationale_extra") or "")
    agent_name = (
        str(agent_pick.get("assignee"))
        if agent_pick and agent_pick.get("assignee_id")
        else None
    )
    agent_id = (
        str(agent_pick.get("assignee_id"))
        if agent_pick and agent_pick.get("assignee_id")
        else None
    )
    who_bits = []
    if agent_name:
        who_bits.append(f"agent {agent_name}")
    if assignee_id and assignee != "Unassigned":
        who_bits.append(f"resolver {assignee}")
    who_label = " + ".join(who_bits) if who_bits else assignee

    if str((draft or {}).get("awaiting") or "").strip().lower() != "confirm":
        current_agent = str(ticket.get("assignee_name") or "").strip() or "Unassigned"
        current_resolver = str(ticket.get("resolver_name") or "").strip() or "Unassigned"
        confirm_draft = {
            "awaiting": "confirm",
            "ticket_number": tn,
            "assignee": assignee if assignee_id and assignee != "Unassigned" else None,
            "assignee_id": str(assignee_id) if assignee_id and assignee != "Unassigned" else None,
            "agent": agent_name,
            "agent_id": agent_id,
            "note": rationale or None,
            "current_agent": current_agent,
            "current_resolver": current_resolver,
        }
        proposed_resolver = (
            assignee if assignee_id and assignee != "Unassigned" else ""
        )
        facts_lines = [
            f"**Ticket #{tn.lstrip('#')}**",
            f"- Current agent: **{current_agent}**",
            f"- Current resolver: **{current_resolver}**",
        ]
        if proposed_resolver:
            facts_lines.append(f"- Proposed resolver: **{proposed_resolver}**")
        if agent_name:
            facts_lines.append(f"- Proposed agent: **{agent_name}**")
        facts_lines.append("")
        facts_lines.append(
            "Reply to proceed with this escalation, or name a different person."
        )
        return {
            "handled": True,
            "reply": _phrase_plus_facts(
                kind="confirm_hint",
                fallback=(
                    f"Ticket #{tn.lstrip('#')} currently has agent {current_agent} "
                    f"and resolver {current_resolver}. Propose escalating the "
                    f"resolver to {who_label}. Do not invent other current owners. "
                    f"Ask them to go ahead or name someone else."
                ),
                user_text=user_text or tn,
                page_label="Tickets",
                facts="\n".join(facts_lines),
                context={
                    "ticketNumber": tn,
                    "currentAgent": current_agent,
                    "currentResolver": current_resolver,
                    "proposedResolver": proposed_resolver,
                    "proposedAgent": agent_name or "",
                    # Legacy keys = proposed targets only (never current owners).
                    "assignee": assignee,
                    "agent": agent_name or "",
                    "awaiting": "confirm",
                    "nextStep": "review and tell me to escalate, or name a different assignee",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "escalate", "ticketNumber": tn, "step": "confirm"},
            ],
            "route": "tickets",
            "escalate_draft": confirm_draft,
            "current_workflow": "escalate",
            "current_step": "confirm",
        }

    # Phase 1: mutate via Express escalate API (same path as UI) — not chat-handler SQL.
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.ticket_write import escalate_ticket

    actor = ToolActor(
        user_id=str(user_id or "").strip(),
        organization_id=str(org_id).strip(),
        user_role=(user_role or None),
        user_name=(user_name or None),
    )
    if not actor.user_id:
        reply = _llm_phrase(
            module="ticket",
            kind="escalate_prompt",
            fallback="Cannot escalate without an authenticated user; ask them to sign in.",
            user_text=user_text or tn,
            page_label="Tickets",
            context={"ticketNumber": tn, "denied": True},
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "escalate_draft": {
                "ticket_number": tn,
                "awaiting": "assignee",
            },
        }

    with tool_actor_scope(actor):
        tool_result = escalate_ticket(
            tn,
            assignee=assignee if assignee_id and assignee != "Unassigned" else None,
            assignee_id=str(assignee_id) if assignee_id and assignee != "Unassigned" else None,
            agent=agent_name,
            agent_id=agent_id,
            rationale=rationale or None,
        )

    if not tool_result.get("success"):
        err_code = str(tool_result.get("error_code") or "")
        err_msg = str(tool_result.get("message") or "Escalate failed")
        kind = "forbidden" if err_code in ("FORBIDDEN", "UNAUTHORIZED") else "escalate_prompt"
        reply = _llm_phrase(
            module="ticket",
            kind=kind if kind == "forbidden" else "escalate_prompt",
            fallback=err_msg,
            user_text=user_text or tn,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "error": True,
                "missingName": assignee if err_code == "UNPROCESSABLE" else "",
                "denied": err_code in ("FORBIDDEN", "UNAUTHORIZED"),
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "escalate_draft": {
                "ticket_number": tn,
                "awaiting": "assignee",
            },
        }

    payload = tool_result.get("payload") or {}
    resolver_out = str(payload.get("resolver") or assignee or "")
    agent_out = str(payload.get("agent") or agent_name or "")
    rationale_out = str(payload.get("rationale") or rationale or "")
    unchanged = bool(payload.get("unchanged"))

    seed = _llm_phrase(
        module="ticket",
        kind="escalate_done",
        fallback=reply_seed
        or (
            f"{tn} is already assigned that way."
            if unchanged
            else f"Acknowledge assigning {tn} by skill to {who_label}."
        ),
        user_text=user_text or tn,
        page_label="Tickets",
        context={
            "ticketNumber": tn,
            "assignee": resolver_out,
            "agent": agent_out,
            "rationale": rationale_out[:200] if rationale_out else "",
            "alreadyAssigned": unchanged,
        },
    )
    # UI-only actions — mutation already applied by Express escalate API.
    return {
        "handled": True,
        "reply": seed,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
            {"type": "set_filter", "module": "tickets", "query": tn},
        ],
        "route": "tickets",
        "escalate_draft": None,
        "data": {
            "ticket_number": tn,
            "resolver": resolver_out,
            "agent": agent_out,
            "unchanged": unchanged,
        },
        "last_entity": {"type": "ticket", "id": "", "name": tn},
    }


def continue_escalate_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    escalate_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Continue escalate using a semantic decision when available."""
    draft = escalate_draft if isinstance(escalate_draft, dict) else {}
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    entity_name = str(decision.get("entity_name") or "").strip()
    values = [
        str(value).strip()
        for value in (decision.get("values") or [])
        if str(value).strip()
    ]

    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="cancelled",
                fallback="Acknowledge cancelling the escalation; offer other help.",
                user_text=text,
                page_label=page,
                context={"cancelled": True, "flow": "escalate"},
            ),
            "actions": [],
            "route": "tickets",
            "escalate_draft": None,
        }

    if awaiting == "confirm":
        # "recommend best agent" / new person = re-pick, never silent write.
        fields = (
            decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
        )
        field_person = str(fields.get("assignee") or fields.get("person") or "").strip()
        wants_repick = (
            _is_auto_pick_phrase(text)
            or action == "PROVIDE_ASSIGNEE"
            or (action == "CONTINUE_WORKFLOW" and bool(field_person))
        )
        if wants_repick:
            hint = (
                field_person
                or entity_name
                or (values[0] if values else "")
                or None
            )
            if _is_auto_pick_phrase(text) or _is_auto_pick_phrase(hint or ""):
                hint = "best resolver"
            return _build_escalate(
                org,
                str(draft.get("ticket_number") or "") or None,
                hint,
                "",
                user_id=user_id,
                user_name=user_name,
                user_role=role or None,
                user_text=text,
                escalate_draft={
                    **draft,
                    "awaiting": "assignee",
                    "assignee": None,
                    "assignee_id": None,
                    "agent": None,
                    "agent_id": None,
                },
            )
        # LLM owns agreement wording. At confirm, CONTINUE or CONFIRM → specialist write.
        if action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}:
            return {
                "handled": False,
                "reply": "",
                "actions": [],
                "route": "tickets",
                "escalate_draft": draft,
                "current_workflow": "escalate",
                "current_step": "confirm",
            }
        # Unclear turn while armed — restate confirm; do not claim a write.
        current_agent = str(draft.get("current_agent") or "").strip() or "Unassigned"
        current_resolver = str(draft.get("current_resolver") or "").strip() or "Unassigned"
        proposed = str(draft.get("assignee") or "").strip()
        tn = str(draft.get("ticket_number") or "").lstrip("#")
        facts_lines = [
            f"**Ticket #{tn}**",
            f"- Current agent: **{current_agent}**",
            f"- Current resolver: **{current_resolver}**",
        ]
        if proposed:
            facts_lines.append(f"- Proposed resolver: **{proposed}**")
        facts_lines.extend(
            [
                "",
                "Say go ahead to escalate, name someone else, or ask for the best resolver.",
            ]
        )
        return {
            "handled": True,
            "reply": _phrase_plus_facts(
                kind="confirm_hint",
                fallback=(
                    "Escalation is ready but not applied yet. Restate current vs "
                    "proposed owners and ask them to proceed or pick someone else."
                ),
                user_text=text,
                page_label=page,
                facts="\n".join(facts_lines),
                context={
                    "ticketNumber": tn,
                    "currentAgent": current_agent,
                    "currentResolver": current_resolver,
                    "proposedResolver": proposed,
                    "awaiting": "confirm",
                    "nextStep": "proceed, name someone else, or best resolver",
                },
            ),
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "escalate", "ticketNumber": tn, "step": "confirm"},
            ],
            "route": "tickets",
            "escalate_draft": draft,
            "current_workflow": "escalate",
            "current_step": "confirm",
        }

    ticket_number: str | None = None
    assignee_hint: str | None = None

    if action == "PROVIDE_TICKET" or (awaiting == "ticket" and decision):
        ticket_number = entity_name or (values[0] if values else "") or None
        if not ticket_number:
            ticket_number = _extract_ticket_number(text) or (text or "").strip().lstrip("#")
    elif action == "PROVIDE_ASSIGNEE" or (awaiting == "assignee" and decision):
        ticket_number = str(draft.get("ticket_number") or "") or None
        assignee_hint = _resolve_escalate_assignee_hint(
            text,
            decision=decision,
            draft=draft,
            entity_name=entity_name,
            values=values,
        )
    elif awaiting == "ticket":
        ticket_number = _extract_ticket_number(text) or (
            (text or "").strip().lstrip("#") if _looks_like_ticket_choice(text) else None
        )
        if not ticket_number or _refers_to_same_ticket(text):
            resolved = _resolve_open_ticket_number(draft=draft)
            if resolved and (_refers_to_same_ticket(text) or not ticket_number):
                ticket_number = resolved
            elif not ticket_number and _refers_to_same_ticket(text):
                ticket_number = str(draft.get("ticket_number") or "").strip() or None
    elif awaiting == "assignee":
        ticket_number = str(draft.get("ticket_number") or "") or None
        fields = (
            decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
        )
        proposed = str(draft.get("proposed_assignee") or "").strip()
        field_person = str(
            fields.get("assignee") or fields.get("person") or ""
        ).strip()
        if proposed and action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}:
            from app.workflow_schemas import person_from_user_text

            other = person_from_user_text(
                field_person or text,
                [
                    str(n).strip()
                    for n in (draft.get("candidates") or [])
                    if str(n).strip()
                ]
                or [proposed],
                allow_fuzzy=False,
                allow_substring=False,
            )
            if other and other != proposed:
                assignee_hint = other
                draft = {
                    **draft,
                    "proposed_assignee": None,
                    "proposed_assignee_id": None,
                }
            else:
                assignee_hint = proposed
        elif proposed and field_person:
            from app.workflow_schemas import person_from_user_text

            if (
                person_from_user_text(
                    field_person,
                    [proposed],
                    allow_fuzzy=False,
                    allow_substring=False,
                )
                == proposed
            ):
                assignee_hint = proposed
            else:
                # New name from NLU — pass through for clear/propose matching.
                assignee_hint = field_person
        elif proposed:
            # Pending Did-you-mean; do not pass raw ack text as a person name.
            assignee_hint = None
        else:
            assignee_hint = _resolve_escalate_assignee_hint(
                text,
                decision=decision,
                draft=draft,
                entity_name=entity_name,
                values=values,
            )

    return _build_escalate(
        org,
        ticket_number,
        assignee_hint,
        "",
        user_id=user_id,
        user_name=user_name,
        user_role=role or None,
        user_text=text,
        escalate_draft=draft,
        semantic_decision=decision,
    )


def _infer_target_role(text: str, *, explicit: str | None = None) -> str | None:
    """Return agent|resolver when the utterance makes the assignment target clear."""
    role = str(explicit or "").strip().lower()
    if role in ("agent", "resolver"):
        return role
    lower = (text or "").strip().lower()
    # "show me the resolvers" / "list agents" while choosing the column.
    if re.search(
        r"\b(show|list|see|who\s+are|available)\b.{0,24}\bresolvers?\b",
        lower,
    ) or re.search(r"\bresolvers?\b", lower):
        return "resolver"
    if re.search(
        r"\b(show|list|see|who\s+are|available)\b.{0,24}\bagents?\b",
        lower,
    ):
        return "agent"
    if re.search(
        r"\b(as\s+)?resolver\b|\bset\s+resolver\b|\bescalate\s+to\b|\bhand\s*off\b",
        lower,
    ):
        return "resolver"
    if re.search(
        r"\b(as\s+)?agent\b|\b(l1|new\s+agent)\b|\breassign\s+agent\b|\bassignee\b",
        lower,
    ):
        return "agent"
    return None


def utterance_is_reassign_role_column(text: str | None) -> str | None:
    """Return agent|resolver when the turn only picks the assignment column.

    Used so confirm-step handoff does not swallow 'resolver' / 'agent' after the
    other column was already set — those turns must list the live roster.
    """
    raw = (text or "").strip()
    if not raw:
        return None
    if re.fullmatch(
        r"(please\s+)?(set\s+|change\s+|update\s+|pick\s+|choose\s+)?"
        r"(the\s+|as\s+)?(agent|resolver|l1|l2|assignee)s?"
        r"(\s+please)?[!?.]*",
        raw,
        re.I,
    ):
        token = re.search(r"\b(agent|resolver|l1|l2|assignee)s?\b", raw, re.I)
        return _normalize_target_role(token.group(1) if token else raw) or _infer_target_role(
            raw
        )
    lower = raw.lower()
    if re.search(
        r"\b(show|list|see|who\s+are|available|display)\b.{0,40}\b"
        r"(agents?|resolvers?|roster|teammates?|staff|directory)\b",
        lower,
    ) or re.search(
        r"\b(agents?|resolvers?)\b.{0,20}\b(list|available|names?)\b",
        lower,
    ):
        return _infer_target_role(raw)
    return None


def _asks_reassign_roster_list(text: str | None) -> bool:
    """True when the user wants the agent/resolver name list mid-reassign."""
    return utterance_is_reassign_role_column(text) is not None or bool(
        (text or "").strip()
        and re.search(
            r"\b(show|list|see|who\s+are|available|display)\b.{0,40}\b"
            r"(agents?|resolvers?|roster|teammates?|staff|directory)\b",
            (text or "").strip().lower(),
        )
    )

def _normalize_target_role(raw: str | None) -> str | None:
    val = str(raw or "").strip().lower()
    if val in ("agent", "l1", "assignee", "agents"):
        return "agent"
    if val in ("resolver", "l2", "escalate", "resolvers"):
        return "resolver"
    return None


_ROLE_PERSON_BLOCKLIST = frozenset(
    {
        "agent",
        "agents",
        "resolver",
        "resolvers",
        "assignee",
        "l1",
        "l2",
        "role",
        "column",
        "person",
        "someone",
        "anybody",
        "anyone",
    }
)


def _is_reassign_role_token(raw: str | None) -> bool:
    """True when a string is a role/column token, not a person name."""
    val = str(raw or "").strip().lower()
    if not val:
        return False
    if _normalize_target_role(val):
        return True
    return val in _ROLE_PERSON_BLOCKLIST


def _nlu_reassign_person_slot(
    decision: dict[str, Any] | None,
    *,
    roster_names: list[str] | None = None,
) -> str | None:
    """Person from NLU fields only — never role words (agent/resolver)."""
    from app.workflow_schemas import person_from_user_text

    decision = decision if isinstance(decision, dict) else {}
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    for key in ("person", "assignee"):
        raw = str(fields.get(key) or "").strip()
        if not raw or _is_reassign_role_token(raw):
            continue
        roster = [str(n).strip() for n in (roster_names or []) if str(n).strip()]
        if roster:
            hit = person_from_user_text(
                raw, roster, allow_fuzzy=False, allow_substring=False
            )
            if hit:
                return hit
            # Typo / short name: keep as query hint (Did-you-mean path).
            return raw
        return raw
    return None


def _reassign_role_only_turn(
    *,
    decision: dict[str, Any] | None,
    user_text: str | None,
    role_hint: str | None,
    person_hint: str | None,
    awaiting: str | None,
    roster_names: list[str] | None = None,
) -> bool:
    """Semantic contract: role selected, person not provided this turn.

    AI-native: NLU sets fields.target_role and leaves fields.person empty.
    Code must never fall back to user_text as a person name on that turn.
    """
    if not role_hint:
        return False
    if person_hint and not _is_reassign_role_token(person_hint):
        return False
    decision = decision if isinstance(decision, dict) else {}
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    nlu_role = _normalize_target_role(str(fields.get("target_role") or ""))
    nlu_person = _nlu_reassign_person_slot(decision, roster_names=roster_names)
    if nlu_person:
        return False
    # Explicit ROLE target from NLU (or awaiting column pick).
    if nlu_role or str(awaiting or "").strip().lower() == "target_role":
        from app.workflow_schemas import person_from_user_text

        roster = [str(n).strip() for n in (roster_names or []) if str(n).strip()]
        if roster and person_from_user_text(
            user_text or "", roster, allow_fuzzy=False, allow_substring=False
        ):
            return False
        return True
    return False


def _escalate_role_only_turn(
    *,
    decision: dict[str, Any] | None,
    user_text: str | None,
    assignee_hint: str | None,
    awaiting: str | None,
    roster_names: list[str] | None = None,
) -> bool:
    """Semantic contract: resolver role referenced, person not provided this turn.

    Escalate always targets the resolver column — but "the resolver" / "escalate
    to the resolver" must list the roster, not search for that phrase as a name.
    """
    if str(awaiting or "").strip().lower() != "assignee":
        return False
    nlu_person = _nlu_reassign_person_slot(decision, roster_names=roster_names)
    if nlu_person:
        return False
    if assignee_hint and not _is_reassign_role_token(assignee_hint):
        return False
    from app.workflow_schemas import person_from_user_text

    roster = [str(n).strip() for n in (roster_names or []) if str(n).strip()]
    if roster and person_from_user_text(
        user_text or "", roster, allow_fuzzy=False, allow_substring=False
    ):
        return False
    if utterance_is_reassign_role_column(user_text):
        return True
    if _infer_target_role(user_text or ""):
        return True
    decision = decision if isinstance(decision, dict) else {}
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    if _is_reassign_role_token(
        str(fields.get("assignee") or fields.get("person") or "")
    ):
        return True
    if _is_reassign_role_token(str(decision.get("entity_name") or "")):
        return True
    raw = (user_text or "").strip()
    if raw and re.fullmatch(
        r"resolvers?|agents?|someone|anybody|anyone|a\s+resolver|a\s+agent",
        raw,
        re.I,
    ):
        return True
    return False


def _resolve_escalate_assignee_hint(
    text: str,
    *,
    decision: dict[str, Any] | None = None,
    draft: dict[str, Any] | None = None,
    entity_name: str = "",
    values: list[str] | None = None,
) -> str | None:
    """Resolve escalate assignee from NLU — never treat role-only utterance as a name."""
    from app.workflow_schemas import person_from_user_text, resolve_roster_name

    roster_names = [
        str(c).strip()
        for c in ((draft or {}).get("candidates") or [])
        if str(c).strip()
    ]
    decision = decision if isinstance(decision, dict) else {}
    values = [str(v).strip() for v in (values or []) if str(v).strip()]
    entity_name = str(entity_name or "").strip()
    fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}

    assignee_hint = _nlu_reassign_person_slot(
        decision, roster_names=roster_names or None
    )
    if not assignee_hint:
        raw_field = str(fields.get("assignee") or fields.get("person") or "").strip()
        if raw_field and not _is_reassign_role_token(raw_field):
            assignee_hint = raw_field
        elif entity_name and not _is_reassign_role_token(entity_name):
            assignee_hint = entity_name
        elif values and not _is_reassign_role_token(values[0]):
            assignee_hint = values[0]
        elif not _escalate_role_only_turn(
            decision=decision,
            user_text=text,
            assignee_hint=None,
            awaiting="assignee",
            roster_names=roster_names or None,
        ):
            assignee_hint = _extract_assignee_hint(text)
            if not assignee_hint and roster_names:
                assignee_hint = person_from_user_text(
                    text,
                    roster_names,
                    allow_fuzzy=False,
                    allow_substring=False,
                ) or resolve_roster_name(
                    text.strip(),
                    roster_names,
                    allow_fuzzy=False,
                    allow_substring=False,
                )
            if not assignee_hint and text.strip() and not re.search(
                r"\b(escalat|ticket|cancel|never\s*mind|resolver|agent)\b",
                text,
                re.I,
            ):
                assignee_hint = text.strip()
    if _is_auto_pick_phrase(assignee_hint or "") or _is_auto_pick_phrase(text):
        return "best resolver"
    return assignee_hint or None


def _reassign_roster_for_role(
    org_id: str,
    actor_role: str | None,
    target_role: str,
    *,
    ticket: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """RBAC-filtered roster for the chosen assignment column (agent vs resolver)."""
    from app.tasks.assign import agents_for_team, list_org_agents, list_org_teams, match_team_by_name

    agents = list_org_agents(org_id)
    actor = str(actor_role or "").strip().lower()
    want = str(target_role or "").strip().lower()
    ticket = ticket if isinstance(ticket, dict) else {}
    queue = str(ticket.get("queue_name") or ticket.get("queue") or "").strip()
    teams = list_org_teams(org_id) if queue else []
    team = match_team_by_name(queue, teams) if queue else None
    pool = agents_for_team(team, agents) if team else agents

    out: list[dict[str, Any]] = []
    for row in pool:
        tr = str(row.get("role") or "").strip().lower()
        if want == "agent" and tr != "agent":
            continue
        if want == "resolver" and tr != "resolver":
            # Team empty of resolvers → fall through to org-wide below
            continue
        if actor == "admin" and tr not in ("agent", "resolver"):
            continue
        if actor == "agent" and tr not in ("agent", "resolver"):
            continue
        if actor == "resolver" and tr != "resolver":
            continue
        out.append(row)

    # Team had no matching role → offer org-wide (same as escalate).
    if not out:
        for row in agents:
            tr = str(row.get("role") or "").strip().lower()
            if want == "agent" and tr != "agent":
                continue
            if want == "resolver" and tr != "resolver":
                continue
            if actor == "admin" and tr not in ("agent", "resolver"):
                continue
            if actor == "agent" and tr not in ("agent", "resolver"):
                continue
            if actor == "resolver" and tr != "resolver":
                continue
            out.append(row)

    out.sort(key=lambda a: str(a.get("name") or "").lower())
    return out


def _resolve_person_on_roster(
    roster: list[dict[str, Any]], name_hint: str
) -> dict[str, Any] | None:
    """Map a typed name to a live roster row for reassign/escalate.

    Clear matches bind immediately. Fuzzy-only unique hits return
    needs_name_confirm=True so the assistant asks \"Did you mean <name>?\"
    instead of silently treating the typo as confirmed.
    """
    from app.workflow_schemas import ticket_person_resolution

    needle = str(name_hint or "").strip()
    if not needle or not roster:
        return None
    hit = ticket_person_resolution(needle, roster)
    if not isinstance(hit, dict):
        return None
    if hit.get("kind") == "ambiguous":
        return {"ambiguous": list(hit.get("candidates") or [])}
    kind = str(hit.get("kind") or "").strip()
    if kind not in {"clear", "propose"}:
        return None
    canonical = str(hit.get("name") or "").strip()
    if not canonical:
        return None
    person_id = str(hit.get("id") or "").strip()
    role = ""
    for row in roster:
        if str(row.get("name") or "").strip().lower() == canonical.lower():
            role = str(row.get("role") or "").strip()
            person_id = person_id or str(row.get("id") or "").strip()
            canonical = str(row.get("name") or "").strip() or canonical
            break
    return {
        "person": canonical,
        "person_id": person_id,
        "role": role,
        "needs_name_confirm": kind == "propose",
    }


def _match_person_on_roster(
    roster: list[dict[str, Any]], name_hint: str
) -> dict[str, Any] | None:
    return _resolve_person_on_roster(roster, name_hint)


def _format_reassign_roster(roster: list[dict[str, Any]], *, limit: int = 40) -> str:
    """Markdown bullets from the live org roster (display only; matching uses full list)."""
    if not roster:
        return "(none available)"
    lines: list[str] = []
    shown = 0
    for row in roster:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        if shown >= limit:
            break
        role = str(row.get("role") or "").strip()
        lines.append(f"- **{name}**" + (f" ({role})" if role else ""))
        shown += 1
    remaining = max(0, len([r for r in roster if str(r.get("name") or "").strip()]) - shown)
    if remaining:
        lines.append(f"- …and **{remaining}** more on this org’s roster")
    return "\n".join(lines) if lines else "(none available)"


def _strip_invented_staff_pick_list(intro: str) -> str:
    """Drop LLM-invented name lines; the DB roster is appended separately."""
    text = (intro or "").strip()
    if not text:
        return ""
    keep: list[str] = []
    for line in text.splitlines():
        low = line.strip().lower()
        if not low:
            keep.append(line)
            continue
        if "current resolver" in low or "current agent" in low:
            continue
        if re.search(r"\((current\s+)?(agent|resolver|assignee)\)\s*$", low):
            continue
        if re.match(r"^[-*•]\s+", line.strip()) and re.search(
            r"\b(agent|resolver)\b", low
        ):
            continue
        keep.append(line)
    cleaned = "\n".join(keep).strip()
    if not cleaned:
        # First sentence only if the model turned the whole reply into a fake list.
        first = re.split(r"(?<=[.!?])\s+", text, maxsplit=1)[0].strip()
        if "current resolver" in first.lower() or "current agent" in first.lower():
            return ""
        return first
    return cleaned


def _reassign_actions(ticket_number: str) -> list[dict[str, Any]]:
    tn = str(ticket_number or "").strip()
    return [
        {"type": "navigate", "view": "tickets-list"},
        {"type": "set_filter", "module": "tickets", "query": tn},
    ]


def _build_reassign(
    org_id: str,
    ticket_number: str | None,
    person_hint: str | None,
    target_role_hint: str | None,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    user_text: str = "",
    reassign_draft: dict[str, Any] | None = None,
    semantic_decision: dict[str, Any] | None = None,
    session_history: list | None = None,
    last_entity: dict[str, Any] | None = None,
    conversation_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    draft = reassign_draft if isinstance(reassign_draft, dict) else {}
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()

    if action == "CANCEL_WORKFLOW":
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="cancelled",
                fallback="Acknowledge cancelling the reassignment; offer other help.",
                user_text=user_text,
                page_label="Tickets",
                context={"cancelled": True, "flow": "reassign"},
            ),
            "actions": [],
            "route": "tickets",
            "reassign_draft": None,
        }

    if draft.get("awaiting") == "ticket" and not ticket_number:
        ticket_number = _extract_ticket_number(user_text)
        if not ticket_number and _looks_like_ticket_choice(user_text):
            ticket_number = (user_text or "").strip().lstrip("#")
        if not ticket_number and _refers_to_same_ticket(user_text):
            ticket_number = _resolve_open_ticket_number(
                draft=draft,
                history=session_history,
                last_entity=last_entity,
                conversation_context=conversation_context,
            )

    if (
        draft.get("awaiting") == "person"
        and draft.get("ticket_number")
        and not ticket_number
    ):
        ticket_number = str(draft.get("ticket_number"))

    # Fresh start / deictic "reassign this ticket" — use open memory before asking.
    if not ticket_number and (
        _refers_to_same_ticket(user_text)
        or re.search(r"\b(this|that|the\s+same|current)\s+ticket\b", user_text or "", re.I)
        or not draft.get("awaiting")
    ):
        ticket_number = _resolve_open_ticket_number(
            draft=draft,
            history=session_history,
            last_entity=last_entity,
            conversation_context=conversation_context,
        )

    if not ticket_number:
        asked = _ask_which_ticket_to_escalate(
            org_id,
            user_id=user_id,
            user_name=user_name,
            user_role=user_role,
            user_text=user_text,
        )
        # Keep a memory hint so "same ticket" / "above created" can resolve next turn.
        hint = _resolve_open_ticket_number(
            draft=None,
            history=session_history,
            last_entity=last_entity,
            conversation_context=conversation_context,
        )
        reassign_state = {
            "awaiting": "ticket",
            "flow": "reassign",
            "candidates": list(
                (asked.get("escalate_draft") or {}).get("candidates") or []
            ),
        }
        if hint:
            reassign_state["ticket_number"] = hint
        reply = str(asked.get("reply") or "")
        reply = reply.replace("escalate", "reassign").replace("Escalate", "Reassign")
        return {
            **asked,
            "reply": reply
            or _llm_phrase(
                module="ticket",
                kind="escalate_prompt",
                fallback="Ask which ticket to reassign (number, or say same ticket).",
                user_text=user_text or "reassign",
                page_label="Tickets",
                context={"awaiting": "ticket", "flow": "reassign"},
            ),
            "escalate_draft": None,
            "reassign_draft": reassign_state,
            "current_workflow": "reassign_ticket",
            "current_step": "ticket",
        }

    ticket = _find_ticket(
        org_id,
        ticket_number,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
    )
    if not ticket:
        tn_disp = str(ticket_number).lstrip("#")
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="validation",
                fallback=f"Could not find ticket #{tn_disp}. Ask which ticket to reassign.",
                user_text=user_text or tn_disp,
                page_label="Tickets",
                context={"missingTicket": tn_disp, "awaiting": "ticket"},
            ),
            "actions": [{"type": "navigate", "view": "tickets-list"}],
            "route": "tickets",
            "reassign_draft": {"awaiting": "ticket", "flow": "reassign"},
            "current_workflow": "reassign_ticket",
            "current_step": "ticket",
        }

    tn = str(ticket.get("ticket_number") or ticket_number).lstrip("#")

    role_hint = (
        _normalize_target_role(target_role_hint)
        or _normalize_target_role(
            str((decision.get("fields") or {}).get("target_role") or "")
            if isinstance(decision.get("fields"), dict)
            else ""
        )
        or _normalize_target_role(draft.get("target_role"))
        or _infer_target_role(user_text)
        or _normalize_target_role(
            str((decision.get("values") or [""])[0] if decision.get("values") else "")
        )
    )
    if draft.get("awaiting") == "target_role" and not role_hint:
        raw = str(decision.get("entity_name") or user_text or "").strip().lower()
        role_hint = _normalize_target_role(raw)

    if not role_hint:
        facts = (
            f"Ticket **#{tn}** — {ticket.get('subject') or 'ticket'}\n"
            f"Current agent: {ticket.get('assignee_name') or 'unassigned'}\n"
            f"Current resolver: {ticket.get('resolver_name') or 'unassigned'}"
        )
        reply = _phrase_plus_facts(
            fallback=(
                f"Ask whether to set the **agent** (L1) or **resolver** (L2) "
                f"for ticket #{tn}."
            ),
            user_text=user_text or tn,
            page_label="Tickets",
            facts=facts,
            context={
                "ticketNumber": tn,
                "awaiting": "target_role",
                "nextStep": "agent or resolver",
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": {
                "awaiting": "target_role",
                "ticket_number": tn,
                "flow": "reassign",
            },
            "current_workflow": "reassign_ticket",
            "current_step": "target_role",
        }

    roster = _reassign_roster_for_role(org_id, user_role, role_hint, ticket=ticket)
    roster_names = [str(r.get("name") or "") for r in roster if str(r.get("name") or "").strip()]
    from app.workflow_schemas import person_from_user_text

    nlu_fields = decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    awaiting_now = str(draft.get("awaiting") or "").strip().lower()
    # Prefer NLU person slot; never treat role words as people.
    nlu_person = _nlu_reassign_person_slot(decision, roster_names=roster_names)
    person_hint = str(person_hint or nlu_person or draft.get("person") or "").strip() or None
    if person_hint and _is_reassign_role_token(person_hint):
        person_hint = None
    proposed_person = str(draft.get("proposed_person") or "").strip() or None
    proposed_person_id = str(draft.get("proposed_person_id") or "").strip() or None

    def _canonical_on_roster(*cands: str | None) -> str | None:
        for cand in cands:
            hit = person_from_user_text(
                cand,
                roster_names,
                allow_fuzzy=False,
                allow_substring=False,
            )
            if hit:
                return hit
        return None

    def _nlu_picks_proposed() -> bool:
        """Pending Did-you-mean affirmed via NLU action — not yes-keyword lists.

        Architecture: at a confirm-like step, CONTINUE_WORKFLOW means the user is
        agreeing to continue (specialist/NLU judged the utterance). CONFIRM_WORKFLOW
        is equivalent. A clear *different* roster name means they picked someone else.
        """
        if not proposed_person:
            return False
        if action == "CANCEL_WORKFLOW":
            return False
        other = _canonical_on_roster(
            str(nlu_fields.get("person") or ""),
            str(nlu_fields.get("assignee") or ""),
            str(decision.get("entity_name") or ""),
            user_text
            if not _reassign_role_only_turn(
                decision=decision,
                user_text=user_text,
                role_hint=role_hint,
                person_hint=None,
                awaiting=awaiting_now,
                roster_names=roster_names,
            )
            else None,
        )
        if other and other != proposed_person:
            return False
        if other == proposed_person:
            return True
        if action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}:
            # No clear new roster name this turn → affirm the pending proposal
            # (yeah/, yesh, go ahead, proceed, noo proceed, …).
            return True
        return False

    # ROLE-only turn (AI contract): target_role set, person not provided → list roster.
    # Never fall back to user_text / "agent" as a person name.
    role_only = _reassign_role_only_turn(
        decision=decision,
        user_text=user_text,
        role_hint=role_hint,
        person_hint=person_hint,
        awaiting=awaiting_now,
        roster_names=roster_names,
    )
    if role_only or utterance_is_reassign_role_column(user_text):
        person_hint = None
        proposed_person = None
        proposed_person_id = None
        draft = {
            **draft,
            "person": None,
            "person_id": None,
            "proposed_person": None,
            "proposed_person_id": None,
            "person_query": None,
            "target_role": role_hint,
        }

    # Pending Did-you-mean: NLU CONTINUE/CONFIRM advances; CANCEL clears.
    if proposed_person and action == "CANCEL_WORKFLOW":
        person_hint = None
        proposed_person = None
        proposed_person_id = None
        draft = {
            **draft,
            "proposed_person": None,
            "proposed_person_id": None,
            "person_query": None,
        }
    elif proposed_person and _nlu_picks_proposed():
        person_hint = proposed_person
    elif roster_names and not role_only:
        clear_hint = _canonical_on_roster(
            str(nlu_fields.get("person") or "")
            if not _is_reassign_role_token(str(nlu_fields.get("person") or ""))
            else None,
            person_hint,
            None
            if _reassign_role_only_turn(
                decision=decision,
                user_text=user_text,
                role_hint=role_hint,
                person_hint=None,
                awaiting=awaiting_now,
                roster_names=roster_names,
            )
            else user_text,
        )
        if clear_hint:
            person_hint = clear_hint
            proposed_person = None
            proposed_person_id = None
        elif proposed_person:
            # Still pending and NLU did not CONTINUE/CONFIRM — keep proposal,
            # do not treat ack/noise as a person name.
            person_hint = None
        elif not person_hint:
            # Person collect: NLU person slot, else roster-resolved fragment only.
            raw_frag = str(nlu_person or "").strip()
            if not raw_frag and awaiting_now == "person":
                if not _reassign_role_only_turn(
                    decision=decision,
                    user_text=user_text,
                    role_hint=role_hint,
                    person_hint=None,
                    awaiting=awaiting_now,
                    roster_names=roster_names,
                ):
                    hit = _canonical_on_roster(user_text)
                    if hit:
                        raw_frag = hit
                    else:
                        from app.workflow_schemas import resolve_roster_name

                        frag = resolve_roster_name(
                            str(user_text or "").strip(),
                            roster_names,
                            allow_fuzzy=False,
                            allow_substring=False,
                        )
                        if frag:
                            raw_frag = frag
                        elif (
                            str(user_text or "").strip()
                            and not _infer_target_role(user_text)
                            and not _is_reassign_role_token(user_text)
                            and re.fullmatch(
                                r"[A-Za-z][A-Za-z .'-]{0,60}",
                                str(user_text or "").strip(),
                            )
                            and len(str(user_text or "").split()) <= 3
                        ):
                            raw_frag = str(user_text or "").strip()
            if (
                raw_frag
                and not _looks_like_ticket_number(raw_frag)
                and not _is_reassign_role_token(raw_frag)
            ):
                person_hint = raw_frag
        if person_hint and _looks_like_ticket_number(person_hint):
            person_hint = _canonical_on_roster(user_text)

    # LLM skill-match suggestion from the live ticket issue (Phase 5).
    suggested_person = str(draft.get("suggested_person") or "").strip() or None
    if not suggested_person and org_id and role_hint:
        try:
            pick = skill_pick_agent_and_resolver(
                org_id=org_id,
                skill_hint=str(ticket.get("skill") or ticket.get("category") or ""),
                queue=str(ticket.get("queue_name") or ticket.get("queue") or ""),
                ticket_subject=str(ticket.get("subject") or ""),
                ticket_description=str(
                    ticket.get("description") or ticket.get("issue") or ""
                ),
                use_llm=True,
            )
            if role_hint == "agent":
                suggested_person = str(pick.get("agent") or "").strip() or None
            elif role_hint == "resolver":
                suggested_person = str(pick.get("resolver") or "").strip() or None
            if suggested_person and suggested_person not in roster_names:
                hit = _canonical_on_roster(suggested_person)
                suggested_person = hit or suggested_person
        except Exception:  # noqa: BLE001
            suggested_person = None

    if _is_auto_pick_phrase(user_text) or _is_auto_pick_phrase(person_hint or ""):
        person_hint = suggested_person or person_hint

    # Pending proposal + no new clear name this turn → restate Did you mean.
    # Stay on confirm with canonical person already bound (confirmation precedence).
    if proposed_person and not person_hint:
        roster_text = _format_reassign_roster(roster)
        facts = f"{roster_text}\n\nTicket **#{tn}**"
        intro = _llm_phrase(
            module="ticket",
            kind="confirm_hint",
            fallback=(
                f"Ask again: Did you mean **{proposed_person}** for the "
                f"{role_hint} on ticket #{tn}? If they agree in any wording, "
                f"proceed — do not treat ack words as a person name."
            ),
            user_text=user_text or proposed_person,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "targetRole": role_hint,
                "person": proposed_person,
                "awaiting": "confirm",
                "didYouMean": proposed_person,
                "personQuery": draft.get("person_query") or "",
                "nextStep": f"Confirm {proposed_person} or pick another name",
                "rosterFollows": True,
            },
        )
        intro = _strip_invented_staff_pick_list(intro)
        reply = _compose_intro_and_list(intro, facts)
        return {
            "handled": True,
            "reply": reply,
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": {
                "awaiting": "confirm",
                "ticket_number": tn,
                "target_role": role_hint,
                "person": proposed_person,
                "person_id": proposed_person_id,
                "candidates": roster_names,
                "proposed_person": proposed_person,
                "proposed_person_id": proposed_person_id,
                "person_query": draft.get("person_query"),
                "suggested_person": suggested_person,
                "flow": "reassign",
            },
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }

    if not person_hint:
        roster_text = _format_reassign_roster(roster)
        current_for_role = (
            str(ticket.get("assignee_name") or "").strip()
            if role_hint == "agent"
            else str(ticket.get("resolver_name") or "").strip()
            if role_hint == "resolver"
            else ""
        )
        suggested_already = bool(
            suggested_person
            and current_for_role
            and suggested_person.strip().lower() == current_for_role.lower()
        )
        if suggested_person and suggested_already:
            suggest_line = (
                f"Skill match: **{suggested_person}** is already the current "
                f"{role_hint} on this ticket — a strong fit.\n\n"
            )
            next_step = (
                f"{suggested_person} is already the {role_hint}; pick someone else "
                f"only if you want to change, or keep them"
            )
            fallback = (
                f"Ticket #{tn}: skill match {suggested_person} is already the "
                f"current {role_hint} and a good fit. Say that clearly; ask for "
                f"another name from the list only if they still want to reassign."
            )
        elif suggested_person:
            suggest_line = f"Suggested (skill match): **{suggested_person}**\n\n"
            next_step = f"Pick a {role_hint} from the list, or accept suggested {suggested_person}"
            fallback = f"Ask who to assign as {role_hint} on ticket #{tn}."
        else:
            suggest_line = ""
            next_step = f"Pick a {role_hint} from the list"
            fallback = f"Ask who to assign as {role_hint} on ticket #{tn}."
        # Facts = DB roster (+ optional tool suggestion). Instructions stay in LLM context.
        facts = f"{suggest_line}{roster_text}\n\nTicket **#{tn}**"
        intro = _llm_phrase(
            module="ticket",
            kind="reassign",
            fallback=fallback,
            user_text=user_text or tn,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "targetRole": role_hint,
                "awaiting": "person",
                "nextStep": next_step,
                "rosterFollows": True,
                "suggestedPerson": suggested_person,
                "suggestedAlreadyAssigned": suggested_already,
                "currentPerson": current_for_role or "",
            },
        )
        intro = _strip_invented_staff_pick_list(intro)
        reply = _compose_intro_and_list(intro, facts)
        return {
            "handled": True,
            "reply": reply,
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": {
                "awaiting": "person",
                "ticket_number": tn,
                "target_role": role_hint,
                "candidates": roster_names,
                "suggested_person": suggested_person,
                "flow": "reassign",
            },
            "current_workflow": "reassign_ticket",
            "current_step": "person",
        }

    matched = _match_person_on_roster(roster, person_hint)
    if matched and matched.get("ambiguous"):
        amb = [
            a
            for a in (matched.get("ambiguous") or [])
            if isinstance(a, dict) and str(a.get("name") or "").strip()
        ]
        names = [str(a.get("name") or "").strip() for a in amb]
        roster_text = "\n".join(f"- **{n}**" for n in names) if names else _format_reassign_roster(roster)
        facts = f"{roster_text}\n\nTicket **#{tn}** stays selected."
        intro = _llm_phrase(
            module="ticket",
            kind="reassign",
            fallback=(
                f"Several people match “{person_hint}”. Ask which full name "
                f"from the list for ticket #{tn}."
            ),
            user_text=user_text or person_hint,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "targetRole": role_hint,
                "missingName": person_hint,
                "ambiguous": True,
                "awaiting": "person",
                "rosterFollows": True,
            },
        )
        intro = _strip_invented_staff_pick_list(intro)
        reply = _compose_intro_and_list(intro, facts)
        return {
            "handled": True,
            "reply": reply,
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": {
                "awaiting": "person",
                "ticket_number": tn,
                "target_role": role_hint,
                "candidates": names or roster_names,
                "person_query": person_hint,
                "flow": "reassign",
            },
            "current_workflow": "reassign_ticket",
            "current_step": "person",
        }

    if not matched:
        roster_text = _format_reassign_roster(roster)
        facts = (
            f"{roster_text}\n\nTicket **#{tn}** stays selected."
            if roster_text
            else f"Ticket **#{tn}** stays selected."
        )
        intro = _llm_phrase(
            module="ticket",
            kind="reassign",
            fallback=(
                f"Could not find “{person_hint}” on the roster for {role_hint}. "
                f"Ask for a name from the team list."
            ),
            user_text=user_text or person_hint,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "targetRole": role_hint,
                "missingName": person_hint,
                "awaiting": "person",
                "rosterFollows": True,
            },
        )
        intro = _strip_invented_staff_pick_list(intro)
        reply = _compose_intro_and_list(intro, facts)
        return {
            "handled": True,
            "reply": reply,
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": {
                "awaiting": "person",
                "ticket_number": tn,
                "target_role": role_hint,
                "candidates": roster_names,
                "flow": "reassign",
            },
            "current_workflow": "reassign_ticket",
            "current_step": "person",
        }

    person = matched["person"]
    person_id = matched["person_id"] or proposed_person_id
    awaiting_now = str(draft.get("awaiting") or "").strip().lower()
    armed = {
        "awaiting": "confirm",
        "ticket_number": tn,
        "target_role": role_hint,
        "person": person,
        "person_id": person_id,
        "candidates": roster_names,
        "proposed_person": person,
        "proposed_person_id": person_id,
        "person_query": draft.get("person_query") or person_hint,
        "suggested_person": suggested_person,
        "flow": "reassign",
    }

    # Typo/short name → Did-you-mean on confirm with CANONICAL person bound.
    # Acknowledgement turns must not re-enter person collection / rematch.
    if matched.get("needs_name_confirm") and awaiting_now != "confirm":
        roster_text = _format_reassign_roster(roster)
        facts = f"{roster_text}\n\nTicket **#{tn}**"
        intro = _llm_phrase(
            module="ticket",
            kind="confirm_hint",
            fallback=(
                f"Ask: Did you mean **{person}** as the {role_hint} on "
                f"ticket #{tn}? If they agree in any wording, proceed to reassign."
            ),
            user_text=user_text or person_hint,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "targetRole": role_hint,
                "person": person,
                "awaiting": "confirm",
                "didYouMean": person,
                "personQuery": person_hint,
                "nextStep": f"Confirm reassign to {person} or name someone else",
                "rosterFollows": True,
            },
        )
        intro = _strip_invented_staff_pick_list(intro)
        reply = _compose_intro_and_list(intro, facts)
        return {
            "handled": True,
            "reply": reply,
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": {**armed, "person_query": person_hint},
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }

    # Affirmed a pending Did-you-mean → hand off to specialist write (no second ask).
    if (
        awaiting_now != "confirm"
        and proposed_person
        and person == proposed_person
        and action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}
    ):
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "tickets",
            "reassign_draft": armed,
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }

    if awaiting_now != "confirm":
        return {
            "handled": True,
            "reply": _llm_phrase(
                module="ticket",
                kind="confirm_hint",
                fallback=(
                    f"Summarize reassigning #{tn} {role_hint} to {person} "
                    "and ask them to confirm or cancel."
                ),
                user_text=user_text or person,
                page_label="Tickets",
                context={
                    "ticketNumber": tn,
                    "targetRole": role_hint,
                    "person": person,
                    "awaiting": "confirm",
                    "nextStep": "confirm or cancel",
                },
            ),
            "actions": _reassign_actions(tn),
            "route": "tickets",
            "reassign_draft": armed,
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }

    # Confirm writes are owned by the specialist LLM (bind_tools), not this shim.
    return {
        "handled": False,
        "reply": "",
        "actions": [],
        "route": "tickets",
        "reassign_draft": armed,
        "current_workflow": "reassign_ticket",
        "current_step": "confirm",
    }


def continue_reassign_draft(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    reassign_draft: dict[str, Any],
    semantic_decision: dict[str, Any] | None = None,
    session_history: list | None = None,
    last_entity: dict[str, Any] | None = None,
    conversation_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    draft = reassign_draft if isinstance(reassign_draft, dict) else {}
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    decision = semantic_decision if isinstance(semantic_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()

    # After agent confirm (or mid-person), role-column picks switch the assignment
    # column and must re-list names — never treat as write-confirm handoff.
    # Prefer NLU fields.target_role (AI contract); regex helper is last-resort only.
    fields_early = (
        decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
    )
    nlu_person_early = _nlu_reassign_person_slot(decision)
    role_column = (
        _normalize_target_role(str(fields_early.get("target_role") or ""))
        or utterance_is_reassign_role_column(text)
    )
    if (
        not role_column
        and awaiting in ("confirm", "person", "target_role")
        and not nlu_person_early
    ):
        inferred = _infer_target_role(text)
        if inferred and awaiting == "target_role":
            role_column = inferred
        elif inferred and awaiting in ("person", "confirm"):
            # Column switch only when the utterance is not a clear roster person.
            from app.workflow_schemas import person_from_user_text

            roster = [
                str(n).strip()
                for n in (draft.get("candidates") or [])
                if str(n).strip()
            ]
            if not roster or not person_from_user_text(
                text, roster, allow_fuzzy=False, allow_substring=False
            ):
                role_column = inferred
    if (
        role_column
        and awaiting in ("confirm", "person", "target_role")
        and (awaiting == "target_role" or not nlu_person_early)
    ):
        draft = {
            "awaiting": "target_role",
            "ticket_number": draft.get("ticket_number"),
            "flow": "reassign",
            "target_role": role_column,
        }
        awaiting = "target_role"
        decision = {
            **decision,
            "action": "CONTINUE_WORKFLOW",
            "entity_name": role_column,
            "values": [role_column],
            "fields": {
                **fields_early,
                "target_role": role_column,
                "person": None,
            },
        }
        action = "CONTINUE_WORKFLOW"

    if action == "CANCEL_WORKFLOW":
        return _build_reassign(
            org,
            None,
            None,
            None,
            user_id=user_id,
            user_name=user_name,
            user_role=role or None,
            user_text=text,
            reassign_draft=draft,
            semantic_decision={"action": "CANCEL_WORKFLOW"},
            session_history=session_history,
            last_entity=last_entity,
            conversation_context=conversation_context,
        )

    if awaiting == "confirm" and action not in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW", "CANCEL_WORKFLOW"}:
        # Keep draft; specialist/NLU should emit CONTINUE or CONFIRM — do not rematch.
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "tickets",
            "reassign_draft": draft,
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }

    if awaiting == "confirm" and action in {"CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}:
        from app.workflow_schemas import person_from_user_text

        # Confirmation precedence: agreement → specialist write with existing person_id.
        # Different clear roster name → replacement pick (back to person step).
        fields = (
            decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
        )
        roster = [
            str(n).strip()
            for n in (draft.get("candidates") or [])
            if str(n).strip()
        ]
        bound = str(draft.get("person") or draft.get("proposed_person") or "").strip()
        other = None
        if roster:
            other = person_from_user_text(
                str(fields.get("person") or ""),
                roster,
                allow_fuzzy=False,
                allow_substring=False,
            )
            if not other:
                other = person_from_user_text(
                    text,
                    roster,
                    allow_fuzzy=False,
                    allow_substring=False,
                )
        if other and bound and other != bound:
            return _build_reassign(
                org,
                str(draft.get("ticket_number") or "") or None,
                other,
                str(draft.get("target_role") or "") or None,
                user_id=user_id,
                user_name=user_name,
                user_role=role or None,
                user_text=text,
                reassign_draft={
                    **draft,
                    "awaiting": "person",
                    "person": None,
                    "person_id": None,
                    "proposed_person": None,
                    "proposed_person_id": None,
                },
                semantic_decision={
                    **decision,
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {**fields, "person": other},
                },
                session_history=session_history,
                last_entity=last_entity,
                conversation_context=conversation_context,
            )
        # Ensure canonical person + id stay on draft for the write tool.
        person = bound
        person_id = str(
            draft.get("person_id") or draft.get("proposed_person_id") or ""
        ).strip()
        armed = {
            **draft,
            "awaiting": "confirm",
            "person": person,
            "person_id": person_id,
            "proposed_person": person or draft.get("proposed_person"),
            "proposed_person_id": person_id or draft.get("proposed_person_id"),
        }
        return {
            "handled": False,
            "reply": "",
            "actions": [],
            "route": "tickets",
            "reassign_draft": armed,
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }

    ticket_number: str | None = str(draft.get("ticket_number") or "").strip() or None
    person_hint: str | None = None
    role_hint: str | None = str(draft.get("target_role") or "").strip() or None

    if awaiting == "ticket":
        ticket_number = (
            _extract_ticket_number(text)
            or (text.strip().lstrip("#") if _looks_like_ticket_choice(text) else None)
            or ticket_number
        )
        if not ticket_number or _refers_to_same_ticket(text):
            resolved = _resolve_open_ticket_number(
                draft=draft,
                history=session_history,
                last_entity=last_entity,
                conversation_context=conversation_context,
            )
            if resolved and (
                _refers_to_same_ticket(text) or not ticket_number
            ):
                ticket_number = resolved
    elif awaiting == "target_role":
        fields = (
            decision.get("fields") if isinstance(decision.get("fields"), dict) else {}
        )
        role_hint = (
            role_column
            or _normalize_target_role(str(fields.get("target_role") or ""))
            or _normalize_target_role(decision.get("entity_name"))
            or _normalize_target_role(
                (decision.get("values") or [""])[0] if decision.get("values") else ""
            )
            or _infer_target_role(text)
            or role_hint
        )
        # Role-only turn: never carry the utterance forward as a person name.
        person_hint = _nlu_reassign_person_slot(decision)
        if role_hint:
            draft = {
                **draft,
                "target_role": role_hint,
                "person": None,
                "person_id": None,
                "proposed_person": None,
                "proposed_person_id": None,
            }
    elif awaiting == "person":
        if _asks_reassign_roster_list(text):
            # Re-list candidates; do not treat "show me the resolvers" as a name.
            person_hint = None
            role_hint = (
                role_column
                or _infer_target_role(text)
                or str(draft.get("target_role") or "").strip()
                or role_hint
            )
            if role_hint:
                draft = {**draft, "target_role": role_hint, "person": None, "person_id": None}
        elif draft.get("proposed_person") and action in {
            "CONFIRM_WORKFLOW",
            "CONTINUE_WORKFLOW",
        }:
            # Affirm Did-you-mean unless NLU named a *different* clear roster person.
            from app.workflow_schemas import person_from_user_text

            proposed = str(draft.get("proposed_person") or "").strip()
            roster = [
                str(n).strip()
                for n in (draft.get("candidates") or [])
                if str(n).strip()
            ]
            other = person_from_user_text(
                text,
                roster,
                allow_fuzzy=False,
                allow_substring=False,
            ) or person_from_user_text(
                str((decision.get("fields") or {}).get("person") or ""),
                roster,
                allow_fuzzy=False,
                allow_substring=False,
            )
            if other and other != proposed:
                person_hint = other
                draft = {
                    **draft,
                    "proposed_person": None,
                    "proposed_person_id": None,
                }
            else:
                person_hint = proposed
        else:
            person_hint = _person_hint_from_collect(
                text,
                decision,
                ticket_number=str(draft.get("ticket_number") or ""),
                roster_names=(
                    draft.get("candidates")
                    if isinstance(draft.get("candidates"), list)
                    else None
                ),
                allow_fuzzy=False,
            )
            # Pending proposal: ignore non-roster fragments (e.g. "yesh").
            if draft.get("proposed_person") and person_hint:
                from app.workflow_schemas import person_from_user_text

                roster = [
                    str(n).strip()
                    for n in (draft.get("candidates") or [])
                    if str(n).strip()
                ]
                if roster and not person_from_user_text(
                    person_hint,
                    roster,
                    allow_fuzzy=False,
                    allow_substring=False,
                ):
                    person_hint = None
    elif awaiting == "confirm":
        ticket_number = str(draft.get("ticket_number") or "").strip() or ticket_number
        person_hint = str(draft.get("person") or "").strip() or None
        role_hint = str(draft.get("target_role") or "").strip() or role_hint
        draft = {**draft, "awaiting": "confirm"}

    return _build_reassign(
        org,
        ticket_number,
        person_hint,
        role_hint,
        user_id=user_id,
        user_name=user_name,
        user_role=role or None,
        user_text=text,
        reassign_draft=draft,
        semantic_decision=decision,
        session_history=session_history,
        last_entity=last_entity,
        conversation_context=conversation_context,
    )


def start_or_continue_reassign(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    reassign_draft: dict[str, Any] | None = None,
    intent_confirmed: bool = False,
    resolved_ticket_number: str | None = None,
    resolved_person: str | None = None,
    resolved_target_role: str | None = None,
    semantic_decision: dict[str, Any] | None = None,
    session_history: list | None = None,
    last_entity: dict[str, Any] | None = None,
    conversation_context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Start or continue ticket reassign (agent vs resolver) after semantic confirmation."""
    draft = reassign_draft if isinstance(reassign_draft, dict) else None
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    if awaiting in ("ticket", "target_role", "person", "confirm"):
        return continue_reassign_draft(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            reassign_draft=draft or {},
            semantic_decision=semantic_decision
            or (
                {
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": resolved_person or resolved_ticket_number,
                    "values": [resolved_person or resolved_target_role]
                    if (resolved_person or resolved_target_role)
                    else ([resolved_ticket_number] if resolved_ticket_number else []),
                }
                if intent_confirmed
                else None
            ),
            session_history=session_history,
            last_entity=last_entity,
            conversation_context=conversation_context,
        )
    if not intent_confirmed and not semantic_decision:
        return None
    role_hint = _normalize_target_role(resolved_target_role) or _infer_target_role(text)
    seed = (resolved_ticket_number or "").strip() or None
    if not seed:
        seed = _resolve_open_ticket_number(
            draft=draft,
            history=session_history,
            last_entity=last_entity,
            conversation_context=conversation_context,
        )
    return _build_reassign(
        org,
        seed,
        (resolved_person or "").strip() or None,
        role_hint,
        user_id=user_id,
        user_name=user_name,
        user_role=role or None,
        user_text=text,
        reassign_draft=None,
        semantic_decision=semantic_decision,
        session_history=session_history,
        last_entity=last_entity,
        conversation_context=conversation_context,
    )


def start_or_continue_escalate(
    text: str,
    *,
    org: str,
    role: str,
    user_id: str | None,
    user_name: str | None,
    page: str | None,
    escalate_draft: dict[str, Any] | None = None,
    intent_confirmed: bool = False,
    resolved_ticket_number: str | None = None,
    resolved_assignee: str | None = None,
    semantic_decision: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Start or continue escalate after semantic confirmation."""
    draft = escalate_draft if isinstance(escalate_draft, dict) else None
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    if awaiting in ("ticket", "assignee", "note", "confirm"):
        return continue_escalate_draft(
            text,
            org=org,
            role=role,
            user_id=user_id,
            user_name=user_name,
            page=page,
            escalate_draft=draft or {},
            semantic_decision=semantic_decision
            or (
                {
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": resolved_ticket_number or resolved_assignee,
                    "values": [resolved_assignee]
                    if resolved_assignee
                    else ([resolved_ticket_number] if resolved_ticket_number else []),
                }
                if intent_confirmed
                else None
            ),
        )
    if not intent_confirmed:
        return None
    return _build_escalate(
        org,
        (resolved_ticket_number or "").strip() or None,
        (resolved_assignee or "").strip() or None,
        "",
        user_id=user_id,
        user_name=user_name,
        user_role=role or None,
        user_text=text,
        escalate_draft=None,
    )


def _actor_or_deny(
    *,
    org_id: str,
    user_id: str | None,
    user_name: str | None,
    user_role: str | None,
    user_text: str,
    tn: str,
) -> dict[str, Any] | Any:
    """Return ToolActor or a handled deny response dict."""
    from app.tools.express_client import ToolActor

    actor = ToolActor(
        user_id=str(user_id or "").strip(),
        organization_id=str(org_id).strip(),
        user_role=(user_role or None),
        user_name=(user_name or None),
    )
    if actor.user_id:
        return actor
    reply = _llm_phrase(
        module="ticket",
        kind="forbidden",
        fallback="Cannot update tickets without an authenticated user; ask them to sign in.",
        user_text=user_text or tn,
        page_label="Tickets",
        context={"ticketNumber": tn, "denied": True},
    )
    return {
        "handled": True,
        "reply": reply,
        "actions": [],
        "route": "tickets",
        "escalate_draft": None,
    }


def _build_update_ticket(
    org_id: str,
    ticket_number: str | None,
    *,
    status: str | None = None,
    priority: str | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    user_text: str = "",
) -> dict[str, Any]:
    """Update ticket status/priority via Express PUT (same as UI)."""
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_write import update_ticket

    tn = (ticket_number or "").strip().lstrip("#")
    if not tn:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask which ticket number to update.",
            user_text=user_text,
            page_label="Tickets",
            context={"nextStep": "ticket number to update"},
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": "tickets-list"}],
            "route": "tickets",
            "escalate_draft": None,
        }

    if not status and not priority:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask for the new status or priority.",
            user_text=user_text,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "nextStep": "new status or priority",
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "escalate_draft": None,
        }

    actor = _actor_or_deny(
        org_id=org_id,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        user_text=user_text,
        tn=tn,
    )
    if isinstance(actor, dict):
        return actor

    with tool_actor_scope(actor):
        tool_result = update_ticket(tn, status=status, priority=priority)

    if not tool_result.get("success"):
        err_code = str(tool_result.get("error_code") or "")
        err_msg = str(tool_result.get("message") or "Update failed")
        reply = _llm_phrase(
            module="ticket",
            kind="forbidden" if err_code in ("FORBIDDEN", "UNAUTHORIZED") else "validation",
            fallback=err_msg,
            user_text=user_text or tn,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "error": True,
                "denied": err_code in ("FORBIDDEN", "UNAUTHORIZED"),
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "escalate_draft": None,
        }

    bits = []
    if status:
        bits.append(f"status **{status}**")
    if priority:
        bits.append(f"priority **{priority}**")
    reply = _llm_phrase(
        module="ticket",
        kind="confirm_hint",
        fallback=f"Confirm ticket #{tn} updated: {', '.join(bits)}.",
        user_text=user_text or tn,
        page_label="Tickets",
        context={
            "ticketNumber": tn,
            "status": status or "",
            "priority": priority or "",
            "filed": True,
        },
    )
    return {
        "handled": True,
        "reply": reply,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
            {"type": "set_filter", "module": "tickets", "query": tn},
        ],
        "route": "tickets",
        "escalate_draft": None,
        "data": {"ticket_number": tn, "status": status, "priority": priority},
    }


def _build_add_note(
    org_id: str,
    ticket_number: str | None,
    note_text: str,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    user_text: str = "",
) -> dict[str, Any]:
    """Add ticket note via Express POST (same as UI)."""
    from app.tools.express_client import tool_actor_scope
    from app.tools.ticket_write import add_ticket_note

    tn = (ticket_number or "").strip().lstrip("#")
    body = (note_text or "").strip()
    if not tn:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask which ticket to add a note to.",
            user_text=user_text,
            page_label="Tickets",
            context={"nextStep": "ticket number for the note"},
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [{"type": "navigate", "view": "tickets-list"}],
            "route": "tickets",
            "escalate_draft": None,
        }
    if not body:
        reply = _llm_phrase(
            module="ticket",
            kind="validation",
            fallback="Ask for the note text.",
            user_text=user_text,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "nextStep": "note text",
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [
                {"type": "navigate", "view": "tickets-list"},
                {"type": "set_filter", "module": "tickets", "query": tn},
            ],
            "route": "tickets",
            "escalate_draft": {"awaiting": "note", "ticket_number": tn},
        }

    # Customers cannot mutate notes (canMutate staff only)
    role = (user_role or "").strip().lower()
    if role in ("customer", "viewer"):
        reply = _llm_phrase(
            module="nav",
            kind="forbidden",
            fallback="Role cannot add notes on tickets.",
            user_text=user_text,
            page_label="Tickets",
            context={"feature": "Ticket notes", "denied": True},
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "escalate_draft": None,
        }

    actor = _actor_or_deny(
        org_id=org_id,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        user_text=user_text,
        tn=tn,
    )
    if isinstance(actor, dict):
        return actor

    with tool_actor_scope(actor):
        tool_result = add_ticket_note(tn, body, visibility="internal")

    if not tool_result.get("success"):
        err_code = str(tool_result.get("error_code") or "")
        err_msg = str(tool_result.get("message") or "Could not add note")
        reply = _llm_phrase(
            module="ticket",
            kind="forbidden" if err_code in ("FORBIDDEN", "UNAUTHORIZED") else "validation",
            fallback=err_msg,
            user_text=user_text or tn,
            page_label="Tickets",
            context={
                "ticketNumber": tn,
                "error": True,
                "denied": err_code in ("FORBIDDEN", "UNAUTHORIZED"),
            },
        )
        return {
            "handled": True,
            "reply": reply,
            "actions": [],
            "route": "tickets",
            "escalate_draft": None,
        }

    reply = _llm_phrase(
        module="ticket",
        kind="confirm_hint",
        fallback=f"Confirm note added on ticket #{tn}.",
        user_text=user_text or tn,
        page_label="Tickets",
        context={"ticketNumber": tn, "noteAdded": True, "filed": True},
    )
    return {
        "handled": True,
        "reply": reply,
        "actions": [
            {"type": "navigate", "view": "tickets-list"},
            {"type": "refresh_tickets"},
            {"type": "set_filter", "module": "tickets", "query": tn},
        ],
        "route": "tickets",
        "escalate_draft": None,
        "data": {"ticket_number": tn, "note": True},
    }


def _looks_like_assignee_choice(text: str, draft: dict[str, Any] | None) -> bool:
    """True only when the user is naming a person / asking for auto-pick."""
    raw = (text or "").strip()
    if not raw:
        return False
    roster_names = [
        str(c).strip()
        for c in ((draft or {}).get("candidates") or [])
        if str(c).strip()
    ]
    if _escalate_role_only_turn(
        decision=None,
        user_text=raw,
        assignee_hint=None,
        awaiting="assignee",
        roster_names=roster_names or None,
    ):
        return False
    if _wants_auto_resolver(raw, None) or _is_auto_pick_phrase(raw):
        return True
    if _extract_assignee_hint(raw):
        return True
    lower = raw.lower().rstrip("!?.")
    # Filter / navigate / create phrasing is never an assignee name
    if re.search(
        r"\b("
        r"show|list|display|view|see|get|find|search|filter|clear|reset|"
        r"open|all|my|high|low|urgent|medium|priority|priorty|"
        r"ticket|tickets|case|cases|customer|customers|client|clients|"
        r"team|teams|kb|article|articles|create|file|make|new|"
        r"how|what|who|when|where|why|which|count|total"
        r")\b",
        lower,
    ) and not re.search(r"\b(assign|escalate|reassign)\s+to\b", lower):
        return False
    candidates = [
        str(c).strip().lower()
        for c in ((draft or {}).get("candidates") or [])
        if str(c).strip()
    ]
    if candidates and any(
        c == lower or c in lower or lower in c for c in candidates
    ):
        return True
    # Plain person name: 1–4 words, letters/spaces only (not auto-pick typos)
    if _is_auto_pick_phrase(raw):
        return True
    if re.fullmatch(r"[A-Za-z][A-Za-z .'-]{0,60}", raw) and len(raw.split()) <= 4:
        return True
    return False


def _active_collect_skip_ui_regex(
    *,
    workflow_decision: dict[str, Any] | None,
    pending_escalate: bool,
    escalate_awaiting: str,
    reassign_pending: bool,
    reassign_awaiting: str,
    tixdraft: dict[str, Any] | None,
    tdraft: dict[str, Any] | None,
    mdraft: dict[str, Any] | None,
    kdraft: dict[str, Any] | None,
    cdraft: dict[str, Any] | None,
    pdraft: dict[str, Any] | None,
) -> bool:
    """During active collect steps, NLU owns meaning — skip idle regex nav/filters."""
    wd = workflow_decision if isinstance(workflow_decision, dict) else {}
    action = str(wd.get("action") or "").strip().upper()
    if action in {"SIDE_QUEST", "NEW_TASK", "NAVIGATE"}:
        return False
    collect_steps = {
        "ticket",
        "assignee",
        "target_role",
        "person",
        "name",
        "description",
        "title",
        "body",
        "email",
        "phone",
        "issue",
        "customer",
        "contact",
        "create_members",
        "hours",
        "note",
    }
    if pending_escalate and escalate_awaiting in collect_steps:
        return True
    if reassign_pending and reassign_awaiting in collect_steps:
        return True
    for active_draft in (tixdraft, tdraft, mdraft, kdraft, cdraft, pdraft):
        if (
            isinstance(active_draft, dict)
            and str(active_draft.get("awaiting") or "").strip().lower() in collect_steps
        ):
            return True
    return False


def _compose_intro_and_list(intro: str, list_summary: str) -> str:
    """LLM intro + exact Express rows once (never duplicate if the model already pasted)."""
    intro = (intro or "").strip()
    list_summary = (list_summary or "").strip()
    if intro and list_summary:
        if list_summary in intro:
            return intro
        return f"{intro}\n\n{list_summary}"
    return intro or list_summary


def _llm_phrase(
    *,
    module: str,
    kind: str,
    fallback: str,
    user_text: str,
    page_label: str | None,
    context: dict[str, Any] | None = None,
) -> str:
    """LLM-written chat reply. Never returns the fallback seed as user-facing copy."""
    from app.tasks.phrase import (
        is_seed_or_next_step_echo,
        phrase_reply,
        strip_leading_intent_label,
        strip_llm_thought_preamble,
    )

    next_step = ""
    if isinstance(context, dict) and context.get("nextStep") is not None:
        next_step = str(context.get("nextStep") or "").strip()

    def _sanitize(raw: str) -> str:
        text = strip_leading_intent_label(strip_llm_thought_preamble(raw))
        if is_seed_or_next_step_echo(text, fallback=fallback, next_step=next_step):
            return ""
        return text

    try:
        return _sanitize(
            phrase_reply(
                module=module,
                kind=kind,
                fallback=fallback,
                user_text=user_text,
                page_label=page_label,
                context=context,
            )
        )
    except Exception:
        try:
            return _sanitize(
                phrase_reply(
                    module=module,
                    kind=kind,
                    fallback=fallback,
                    user_text=user_text,
                    page_label=page_label,
                    context=context,
                )
            )
        except Exception:
            return ""


def _phrase_plus_facts(
    *,
    fallback: str,
    user_text: str,
    page_label: str | None,
    facts: str,
    context: dict[str, Any] | None = None,
    kind: str = "escalate_prompt",
) -> str:
    """LLM intro + factual block (ticket/resolver lists stay exact)."""
    intro = _llm_phrase(
        module="ticket",
        kind=kind,
        fallback=fallback,
        user_text=user_text,
        page_label=page_label,
        context=context,
    )
    return _compose_intro_and_list(intro, facts)


def resolve_chat_command(
    message: str,
    *,
    page: str | None = None,
    organization_id: str,
    can_create_ticket: bool | None = None,
    user_role: str | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    escalate_draft: dict | None = None,
    reassign_draft: dict | None = None,
    macro_draft: dict | None = None,
    team_draft: dict | None = None,
    kb_draft: dict | None = None,
    ticket_draft: dict | None = None,
    priority_draft: dict | None = None,
    customer_draft: dict | None = None,
    parked_drafts: list | None = None,
    session_history: list | None = None,
    last_entity: dict | None = None,
    skip_active_workflow: bool = False,
    workflow_decision: dict | None = None,
    semantic_intent: str | None = None,
) -> dict[str, Any]:
    """
    Decide chat command for this turn.

    Active workflow continuation lives in Workflow Manager
    (`resolve_active_workflow`). Pass skip_active_workflow=True when the graph
    already ran that node.

    Returns { handled, reply, actions, route?, escalate_draft?, macro_draft?,
              team_draft?, kb_draft?, parked_drafts?, workflow fields… }.
    Draft keys omitted from the return leave checkpointer memory unchanged.
    When handled is False, LangGraph continues to specialist Q&A.
    """
    from app.memory_contract import (
        collect_active_drafts,
        normalize_parked,
        park_flows,
    )
    from app.workflow_state import enrich_handler_result

    text = (message or "").strip()
    if not text:
        return {
            "handled": False,
            "reply": "",
            "actions": [],
        }

    org = (organization_id or "").strip()
    if not org:
        return {
            "handled": False,
            "reply": "",
            "actions": [],
        }

    role = (user_role or "").strip().lower()
    parked = normalize_parked(parked_drafts)

    draft = escalate_draft if isinstance(escalate_draft, dict) else None
    if not draft:
        draft = _pending_from_history(session_history)
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    pending = bool(draft and awaiting in ("assignee", "ticket", "note", "confirm"))

    rdraft = reassign_draft if isinstance(reassign_draft, dict) else None
    reassign_awaiting = str((rdraft or {}).get("awaiting") or "").strip().lower()
    reassign_pending = bool(
        rdraft and reassign_awaiting in ("ticket", "target_role", "person", "confirm")
    )

    mdraft = macro_draft if isinstance(macro_draft, dict) else None
    tdraft = team_draft if isinstance(team_draft, dict) else None
    kdraft = kb_draft if isinstance(kb_draft, dict) else None
    tixdraft = ticket_draft if isinstance(ticket_draft, dict) else None
    pdraft = priority_draft if isinstance(priority_draft, dict) else None
    cdraft = customer_draft if isinstance(customer_draft, dict) else None

    active = collect_active_drafts(
        escalate_draft=draft if pending else None,
        reassign_draft=rdraft if reassign_pending else None,
        macro_draft=mdraft,
        team_draft=tdraft,
        kb_draft=kdraft,
        ticket_draft=tixdraft,
        priority_draft=pdraft,
        customer_draft=cdraft,
    )

    def _park_except(keep: set[str]) -> list:
        return park_flows(active, except_flows=keep, existing_parked=parked)

    def _with_park(result: dict[str, Any]) -> dict[str, Any]:
        if parked:
            result = {**result, "parked_drafts": parked}
        return enrich_handler_result(result, prior_last_entity=last_entity)

    # Graph path: specialists own continue. Direct/legacy callers still continue here.
    other_collecting = any(
        [
            bool(cdraft and str(cdraft.get("awaiting") or "").strip()),
            bool(pdraft and str(pdraft.get("awaiting") or "").strip()),
            bool(mdraft and str(mdraft.get("awaiting") or "").strip()),
            bool(kdraft and str(kdraft.get("awaiting") or "").strip()),
            bool(tdraft and str(tdraft.get("awaiting") or "").strip()),
        ]
    )
    tix_await = str((tixdraft or {}).get("awaiting") or "").strip().lower()
    if (
        not skip_active_workflow
        and tixdraft
        and tix_await in ("name", "contact", "issue", "priority")
        and not other_collecting
    ):
        return _with_park(
            _continue_ticket_draft(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                ticket_draft=tixdraft,
            )
        )

    if (
        not skip_active_workflow
        and pdraft
        and str(pdraft.get("awaiting") or "").strip()
    ):
        from app.tasks.catalog_commands import continue_priority_draft

        return _with_park(
            continue_priority_draft(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                priority_draft=pdraft,
                semantic_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
            )
        )

    if (
        not skip_active_workflow
        and cdraft
        and str(cdraft.get("awaiting") or "").strip()
    ):
        from app.tasks.catalog_commands import continue_customer_draft

        return _with_park(
            continue_customer_draft(
                text,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                page=page,
                customer_draft=cdraft,
                parked_drafts=parked,
            )
        )

    if (
        not skip_active_workflow
        and mdraft
        and str(mdraft.get("awaiting") or "").strip().lower() == "delete_confirm"
    ):
        hit = start_or_continue_delete_macro(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            macro_draft=mdraft,
            semantic_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
        )
        if hit and hit.get("handled"):
            return _with_park(hit)

    # Workflow Manager path (tests + direct callers): continue active drafts first.
    if not skip_active_workflow:
        from app.agents.workflow_manager import resolve_active_workflow

        wf_hit = resolve_active_workflow(
            text,
            page=page,
            organization_id=org,
            user_role=role,
            user_id=user_id,
            user_name=user_name,
            escalate_draft=draft if pending else escalate_draft,
            reassign_draft=rdraft if reassign_pending else reassign_draft,
            macro_draft=mdraft,
            team_draft=tdraft,
            kb_draft=kdraft,
            ticket_draft=tixdraft,
            priority_draft=pdraft,
            customer_draft=cdraft,
            parked_drafts=parked,
            session_history=session_history,
            last_entity=last_entity,
            workflow_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
        )
        if wf_hit is not None:
            if wf_hit.get("handled") is False:
                # Side quest / interrupt→commands: keep/park drafts, continue shim.
                parked = normalize_parked(wf_hit.get("parked_drafts"))
                if "macro_draft" in wf_hit:
                    mdraft = wf_hit.get("macro_draft")
                if "team_draft" in wf_hit:
                    tdraft = wf_hit.get("team_draft")
                if "kb_draft" in wf_hit:
                    kdraft = wf_hit.get("kb_draft")
                if "escalate_draft" in wf_hit:
                    draft = wf_hit.get("escalate_draft")
                    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
                    pending = bool(
                        draft and awaiting in ("assignee", "ticket", "note", "confirm")
                    )
                if "reassign_draft" in wf_hit:
                    rdraft = wf_hit.get("reassign_draft")
                    reassign_awaiting = str((rdraft or {}).get("awaiting") or "").strip().lower()
                    reassign_pending = bool(
                        rdraft
                        and reassign_awaiting
                        in ("ticket", "target_role", "person", "confirm")
                    )
                if "ticket_draft" in wf_hit:
                    tixdraft = wf_hit.get("ticket_draft")
                if "customer_draft" in wf_hit:
                    cdraft = wf_hit.get("customer_draft")
                active = collect_active_drafts(
                    escalate_draft=draft if pending else None,
                    reassign_draft=rdraft if reassign_pending else None,
                    macro_draft=mdraft if isinstance(mdraft, dict) else None,
                    team_draft=tdraft if isinstance(tdraft, dict) else None,
                    kb_draft=kdraft if isinstance(kdraft, dict) else None,
                    ticket_draft=tixdraft if isinstance(tixdraft, dict) else None,
                    priority_draft=pdraft if isinstance(pdraft, dict) else None,
                    customer_draft=cdraft if isinstance(cdraft, dict) else None,
                )
            else:
                return enrich_handler_result(wf_hit, prior_last_entity=last_entity)

    _INTERRUPT = frozenset(
        {
            "escalate",
            "create_ticket",
            "create_team",
            "create_macro",
            "create_kb",
            "create_priority",
            "create_customer",
            "update_ticket",
            "add_note",
        }
    )
    _INTERRUPT_FLOW = {
        "create_kb": "kb",
        "create_macro": "macro",
        "create_team": "team",
        "create_customer": "customer",
        "create_ticket": "ticket",
        "escalate": "escalate",
    }

    heur = _heuristic_kind(text)
    _MUTATE_KINDS = frozenset(
        {
            "create_ticket",
            "create_team",
            "create_macro",
            "create_kb",
            "create_priority",
            "create_customer",
            "update_ticket",
            "add_note",
            "escalate",
        }
    )
    # Specialists own these mutations; shim must not start a second business path.
    if skip_active_workflow and heur["kind"] in _MUTATE_KINDS:
        heur = {**heur, "kind": "none"}

    # Settings/secrets always win over create-ticket heuristics ("change my password").
    from app.tasks.catalog_commands import (
        try_recent_activity_command,
        try_settings_and_prefs_command,
    )

    settings_hit = try_settings_and_prefs_command(
        text,
        org=org,
        role=role or "agent",
        user_id=user_id,
        user_name=user_name,
        page=page,
    )
    if settings_hit:
        return enrich_handler_result(
            {
                **settings_hit,
                "macro_draft": mdraft,
                "team_draft": tdraft,
                "kb_draft": kdraft,
                "escalate_draft": draft if pending else settings_hit.get("escalate_draft"),
                "ticket_draft": tixdraft,
                "parked_drafts": parked,
            },
            prior_last_entity=last_entity,
        )

    activity_hit = try_recent_activity_command(
        text,
        org=org,
        role=role or "agent",
        user_id=user_id,
        user_name=user_name,
        page=page,
    )
    if activity_hit:
        return enrich_handler_result(
            {
                **activity_hit,
                "macro_draft": mdraft,
                "team_draft": tdraft,
                "kb_draft": kdraft,
                "escalate_draft": draft if pending else activity_hit.get("escalate_draft"),
                "ticket_draft": tixdraft,
                "parked_drafts": parked,
            },
            prior_last_entity=last_entity,
        )

    def _try_module_nav() -> dict[str, Any] | None:
        module_nav = _module_nav_fallback(text)
        if not (module_nav and module_nav.get("actions")):
            return None
        gated_nav = _gate_ui_actions_for_role(
            list(module_nav.get("actions") or []),
            role=role or "agent",
            reply_hint=str(module_nav.get("reply_hint") or "").strip(),
            user_text=text,
            page=page,
        )
        if not gated_nav.get("handled"):
            return None
        gated_nav = _with_live_list_in_reply(
            gated_nav,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            user_text=text,
        )
        if pending:
            gated_nav["escalate_draft"] = draft
        if mdraft:
            gated_nav["macro_draft"] = mdraft
        if tdraft:
            gated_nav["team_draft"] = tdraft
        if kdraft:
            gated_nav["kb_draft"] = kdraft
        if cdraft:
            gated_nav["customer_draft"] = cdraft
        if parked:
            gated_nav["parked_drafts"] = parked
        return gated_nav

    # Graph path: last-resort module chrome only when Super Agent said NAVIGATE.
    if skip_active_workflow:
        intent = str(semantic_intent or "").strip().upper()
        if isinstance(workflow_decision, dict):
            intent = intent or str(workflow_decision.get("intent") or "").strip().upper()
        if intent == "NAVIGATE":
            graph_nav = _try_module_nav()
            if graph_nav:
                return enrich_handler_result(graph_nav, prior_last_entity=last_entity)

    # Form-create / ticket-mutate intents beat module-nav / data-question.
    # Specialists own edit/delete when the shim is only a fallback hop.
    if heur["kind"] not in _MUTATE_KINDS and not skip_active_workflow:
        # Remove/edit members before delete-team (otherwise "remove … from team"
        # is misread as delete team named "…").
        from app.tasks.catalog_commands import (
            start_or_continue_delete_priority_or_status,
            start_or_continue_delete_team,
            start_or_continue_edit_team,
            start_or_continue_remove_team_members,
        )

        remove_hit = start_or_continue_remove_team_members(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=tdraft,
            intent_confirmed=str(
                (workflow_decision or {}).get("operation") or ""
            ).strip().upper()
            == "REMOVE_MEMBERS"
            if isinstance(workflow_decision, dict)
            else False,
            resolved_team_name=(
                str((workflow_decision or {}).get("entity_name") or "").strip() or None
                if isinstance(workflow_decision, dict)
                else None
            ),
        )
        if remove_hit and remove_hit.get("handled"):
            return remove_hit

        edit_hit = start_or_continue_edit_team(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=tdraft,
            semantic_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
        )
        if edit_hit and edit_hit.get("handled"):
            return edit_hit

        delete_hit = start_or_continue_delete_team(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            team_draft=tdraft,
            semantic_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
        )
        if delete_hit and delete_hit.get("handled"):
            return delete_hit

        delete_pri_hit = start_or_continue_delete_priority_or_status(
            text,
            org=org,
            role=role or "agent",
            user_id=user_id,
            user_name=user_name,
            page=page,
            priority_draft=pdraft,
            semantic_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
        )
        if delete_pri_hit and delete_pri_hit.get("handled"):
            return delete_pri_hit

        # Sidebar module open/how-to before Q&A short-circuit.
        # Count questions ("how many …") stay with specialists.
        legacy_nav = _try_module_nav()
        if legacy_nav:
            return legacy_nav

        # Questions + greetings → specialists. Keep every active/parked draft.
        if _is_data_question(text) or _is_greeting_or_chitchat(text):
            out = {
                "handled": False,
                "reply": "",
                "actions": [],
            }
            if pending:
                out["escalate_draft"] = draft
            if mdraft:
                out["macro_draft"] = mdraft
            if tdraft:
                out["team_draft"] = tdraft
            if kdraft:
                out["kb_draft"] = kdraft
            if parked:
                out["parked_drafts"] = parked
            return out

    # Pending escalate: ticket pick or assignee pick.
    # Filters / create must win so "show high priority tickets" is not a person.
    # Graph path: Tickets specialist owns escalate continue.
    if (
        not skip_active_workflow
        and pending
        and heur["kind"] != "escalate"
    ):
        wd_action = (
            str((workflow_decision or {}).get("action") or "").strip().upper()
            if isinstance(workflow_decision, dict)
            else ""
        )
        if wd_action == "CANCEL_WORKFLOW":
            return {
                "handled": True,
                "reply": _llm_phrase(
                    module="ticket",
                    kind="cancelled",
                    fallback="Acknowledge cancelling the escalation; offer other help.",
                    user_text=text,
                    page_label=page,
                    context={"cancelled": True, "flow": "escalate"},
                ),
                "actions": [],
                "route": "tickets",
                "escalate_draft": None,
            }
        if awaiting == "ticket" and (
            _looks_like_ticket_choice(text) or _refers_to_same_ticket(text)
        ):
            tn = _extract_ticket_number(text) or ""
            if not tn and _refers_to_same_ticket(text):
                tn = _resolve_open_ticket_number(
                    draft=draft,
                    history=session_history,
                    last_entity=last_entity,
                ) or ""
            if not tn:
                tn = text.strip().lstrip("#")
            return _build_escalate(
                org,
                tn.lstrip("#") if tn else None,
                _extract_assignee_hint(text),
                "",
                user_id=user_id,
                user_name=user_name,
                user_role=role or None,
                user_text=text,
                escalate_draft=draft,
            )
        if awaiting == "assignee" and (
            _looks_like_assignee_choice(text, draft)
            or _extract_assignee_hint(text)
            or _is_auto_pick_phrase(text)
            or _escalate_role_only_turn(
                decision=workflow_decision
                if isinstance(workflow_decision, dict)
                else None,
                user_text=text,
                assignee_hint=None,
                awaiting="assignee",
                roster_names=[
                    str(c).strip()
                    for c in (draft.get("candidates") or [])
                    if str(c).strip()
                ],
            )
        ):
            hint = _resolve_escalate_assignee_hint(
                text,
                decision=workflow_decision
                if isinstance(workflow_decision, dict)
                else None,
                draft=draft,
            )
            return _build_escalate(
                org,
                str(draft.get("ticket_number") or "") or None,
                hint,
                "",
                user_id=user_id,
                user_name=user_name,
                user_role=role or None,
                user_text=text,
                escalate_draft=draft,
            )
        # Side quest / filter / list: keep escalate draft and fall through so
        # UI actions can run. Workflow Manager parks when it owns the turn.
        # (Do not clear mid-flow — user can resume assignee/ticket pick.)

    # Starting a new guided/mutate flow parks any other in-progress drafts.
    if heur["kind"] in _INTERRUPT:
        keep_flow = _INTERRUPT_FLOW.get(heur["kind"])
        still = collect_active_drafts(
            escalate_draft=draft if pending else None,
            macro_draft=mdraft,
            team_draft=tdraft,
            kb_draft=kdraft,
            ticket_draft=tixdraft,
        )
        if still:
            parked = park_flows(
                still,
                except_flows={keep_flow} if keep_flow else set(),
                existing_parked=parked,
            )

    # Deterministic escalate/create BEFORE any UI-actions LLM call
    if heur["kind"] == "escalate":
        # Keep escalate_draft when user continues with "assign to X" / auto-pick
        # without repeating the ticket number.
        use_draft = None
        hint = heur.get("assignee_hint")
        tn = heur.get("ticket_number")
        if pending and awaiting == "assignee":
            use_draft = draft
            if not tn:
                tn = str(draft.get("ticket_number") or "") or None
            if not hint:
                hint = _resolve_escalate_assignee_hint(
                    text,
                    decision=workflow_decision
                    if isinstance(workflow_decision, dict)
                    else None,
                    draft=draft,
                )
            # "assign to annamalai" while waiting for who → keep ticket
        elif pending and awaiting == "ticket":
            if _refers_to_same_ticket(text) and draft.get("ticket_number"):
                tn = str(draft.get("ticket_number"))
                use_draft = draft
            elif tn:
                use_draft = draft
            else:
                use_draft = draft
        elif tn:
            use_draft = None
        return _with_park(
            _build_escalate(
                org,
                tn,
                hint,
                str(heur.get("reply") or ""),
                user_id=user_id,
                user_name=user_name,
                user_role=role or None,
                user_text=text,
                escalate_draft=use_draft,
            )
        )

    if heur["kind"] == "update_ticket":
        return _build_update_ticket(
            org,
            heur.get("ticket_number"),
            status=heur.get("status"),
            priority=heur.get("priority"),
            user_id=user_id,
            user_name=user_name,
            user_role=role or None,
            user_text=text,
        )

    if heur["kind"] == "add_note":
        # Continue note body if draft awaiting note
        note_text = str(heur.get("note_text") or "").strip()
        tn = heur.get("ticket_number")
        if (
            draft
            and str(draft.get("awaiting") or "") == "note"
            and not note_text
            and heur["kind"] == "add_note"
        ):
            tn = tn or str(draft.get("ticket_number") or "") or None
            note_text = text.strip()
        return _build_add_note(
            org,
            tn,
            note_text,
            user_id=user_id,
            user_name=user_name,
            user_role=role or None,
            user_text=text,
        )

    if heur["kind"] == "create_ticket":
        return _with_park(
            start_create_ticket_flow(
                text,
                org=org,
                role=role or "agent",
                page=page,
                can_create_ticket=can_create_ticket,
                user_id=user_id,
                user_name=user_name,
            )
        )
    if heur["kind"] == "create_team":
        return _with_park(
            start_create_team_flow(
                text,
                role=role or "agent",
                page=page,
            )
        )

    if heur["kind"] == "create_customer":
        from app.tasks.catalog_commands import start_create_customer_flow

        parked_now = _park_except({"customer"}) if active else parked
        return _with_park(
            {
                **start_create_customer_flow(
                    text,
                    org=org,
                    role=role or "agent",
                    user_id=user_id,
                    user_name=user_name,
                    page=page,
                    ticket_draft=tixdraft,
                    parked_drafts=parked_now or parked,
                    session_history=session_history,
                ),
                **({"parked_drafts": parked_now} if parked_now else {}),
            }
        )

    if heur["kind"] == "create_macro":
        if not _can_access_module(role or "agent", "macros"):
            denied = _llm_phrase(
                module="nav",
                kind="forbidden",
                fallback="Role cannot use Macros. Suggest My Tickets or Search.",
                user_text=text,
                page_label=page,
                context={"feature": "Macros", "denied": True},
            )
            return {
                "handled": True,
                "reply": denied,
                "actions": [],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": None,
            }
        from app.workflow_schemas import mark_macro_intent_start

        reply = _llm_phrase(
            module="macro",
            kind="start",
            fallback="Start create-macro: acknowledge and ask for the macro title only.",
            user_text=text,
            page_label=page or "Macros",
            context={"nextStep": "macro title"},
        )
        return _with_park(
            {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "macros"},
                    {"type": "create_macro", "step": "title", "awaiting": "title"},
                ],
                "route": "general",
                "escalate_draft": None,
                "macro_draft": mark_macro_intent_start({"awaiting": "title"}, text),
                "team_draft": None,
                "kb_draft": None,
            }
        )

    if heur["kind"] == "create_kb":
        if not _can_access_module(role or "agent", "kb") or role in (
            "resolver",
            "viewer",
            "customer",
        ):
            denied = _llm_phrase(
                module="nav",
                kind="forbidden",
                fallback="Role cannot create KB articles. Suggest browsing Knowledge Base.",
                user_text=text,
                page_label=page,
                context={"feature": "Knowledge Base create", "denied": True},
            )
            return {
                "handled": True,
                "reply": denied,
                "actions": [],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": None,
            }
        reply = _llm_phrase(
            module="kb",
            kind="start",
            fallback="Start create-kb: acknowledge and ask for the article title.",
            user_text=text,
            page_label=page or "Knowledge Base",
            context={"nextStep": "article title"},
        )
        return _with_park(
            {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "kb"},
                    {"type": "create_kb", "step": "title"},
                ],
                "route": "kb",
                "escalate_draft": None,
                "macro_draft": None,
                "team_draft": None,
                "kb_draft": {"awaiting": "title"},
            }
        )

    if heur["kind"] == "create_priority":
        from app.workflow_schemas import (
            mark_priority_intent_start,
            mark_status_intent_start,
        )

        if role != "admin" or not _can_access_module("admin", "priorities"):
            denied = _llm_phrase(
                module="nav",
                kind="forbidden",
                fallback="Only admins can create priorities.",
                user_text=text,
                page_label=page,
                context={"feature": "Priorities", "denied": True},
            )
            return {
                "handled": True,
                "reply": denied,
                "actions": [],
                "route": "general",
                "escalate_draft": None,
                "priority_draft": None,
            }
        lower_pri = text.lower()
        if re.search(r"\bstatus\b", lower_pri) and not re.search(
            r"\bpriorit", lower_pri
        ):
            reply = _llm_phrase(
                module="priority",
                kind="start",
                fallback="Start create-status: ask for the display name.",
                user_text=text,
                page_label=page or "Priorities",
                context={"nextStep": "status display name"},
            )
            return _with_park(
                {
                    "handled": True,
                    "reply": reply,
                    "actions": [
                        {"type": "navigate", "view": "priorities"},
                        {"type": "create_status"},
                    ],
                    "route": "general",
                    "escalate_draft": None,
                    "priority_draft": mark_status_intent_start(
                        {"awaiting": "name", "kind": "status"}, text
                    ),
                }
            )
        reply = _llm_phrase(
            module="priority",
            kind="start",
            fallback="Start create-priority: ask for the display name.",
            user_text=text,
            page_label=page or "Priorities",
            context={"nextStep": "priority display name"},
        )
        return _with_park(
            {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "priorities"},
                    {"type": "create_priority"},
                ],
                "route": "general",
                "escalate_draft": None,
                "priority_draft": mark_priority_intent_start(
                    {"awaiting": "name", "kind": "priority"}, text
                ),
            }
        )

    # Create-ticket follow-up: last turn asked for customer name → capture name,
    # never treat it as a tickets list/filter. Graph path: Tickets specialist owns this.
    if (
        not skip_active_workflow
        and _awaiting_create_customer_name(session_history)
        and _looks_like_person_name(text)
        and heur["kind"] == "none"
    ):
        allowed = can_create_ticket
        if allowed is None:
            allowed = role in ("admin", "agent", "customer")
        if role in ("resolver", "viewer"):
            allowed = False
        if allowed:
            reply = _llm_phrase(
                module="ticket",
                kind="got_name",
                fallback=(
                    f"Acknowledge customer name {text}; ask for email or phone next."
                ),
                user_text=text,
                page_label=page or "Create Ticket",
                context={
                    "customerName": text,
                    "nextStep": "email address or phone number",
                },
            )
            return {
                "handled": True,
                "reply": reply,
                "actions": [
                    {"type": "navigate", "view": "create-ticket"},
                    {
                        "type": "create_ticket",
                        "customer_name": text,
                        "step": "contact",
                    },
                ],
                "route": "tickets",
                "escalate_draft": None,
            }

    # Graph path (skip_active_workflow): WM returned unhandled — continue escalate collect.
    if skip_active_workflow and pending and awaiting in ("assignee", "ticket"):
        wd = workflow_decision if isinstance(workflow_decision, dict) else {}
        wd_action = str(wd.get("action") or "").strip().upper()
        if wd_action != "CANCEL_WORKFLOW":
            if awaiting == "assignee":
                hint = _resolve_escalate_assignee_hint(
                    text,
                    decision=wd,
                    draft=draft,
                )
                tn = str(draft.get("ticket_number") or "") or None
            else:
                hint = None
                tn = (
                    _extract_ticket_number(text)
                    or (text.strip().lstrip("#") if _looks_like_ticket_choice(text) else None)
                )
            return enrich_handler_result(
                _build_escalate(
                    org,
                    tn,
                    hint,
                    "",
                    user_id=user_id,
                    user_name=user_name,
                    user_role=role or None,
                    user_text=text,
                    escalate_draft=draft,
                    semantic_decision=wd or None,
                ),
                prior_last_entity=last_entity,
            )

    # Filters / navigate (regex fast-path inside resolve_ui_actions; LLM only if needed)
    # Portal create-ticket draft owns the turn — never treat field answers as staff filters.
    portal_ticket_active = (
        isinstance(tixdraft, dict)
        and str(tixdraft.get("surface") or "").strip().lower() == "portal"
        and str(tixdraft.get("awaiting") or "").strip().lower() in ("issue", "confirm")
    )
    skip_ui_regex = _active_collect_skip_ui_regex(
        workflow_decision=workflow_decision if isinstance(workflow_decision, dict) else None,
        pending_escalate=pending,
        escalate_awaiting=awaiting,
        reassign_pending=reassign_pending,
        reassign_awaiting=reassign_awaiting,
        tixdraft=tixdraft,
        tdraft=tdraft,
        mdraft=mdraft,
        kdraft=kdraft,
        cdraft=cdraft,
        pdraft=pdraft,
    )
    ui = (
        {"actions": []}
        if portal_ticket_active
        else resolve_ui_actions(text, page=page, skip_regex=skip_ui_regex)
    )
    actions = list(ui.get("actions") or [])
    if actions:
        gated = _gate_ui_actions_for_role(
            actions,
            role=role or "agent",
            reply_hint=str(ui.get("reply_hint") or "").strip(),
            user_text=text,
            page=page,
        )
        if gated.get("handled"):
            gated = _with_live_list_in_reply(
                gated,
                org=org,
                role=role or "agent",
                user_id=user_id,
                user_name=user_name,
                user_text=text,
            )
            # Preserve in-progress escalate (and other drafts) across side-quest filters.
            if pending:
                gated["escalate_draft"] = draft
            if mdraft:
                gated["macro_draft"] = mdraft
            if tdraft:
                gated["team_draft"] = tdraft
            if kdraft:
                gated["kb_draft"] = kdraft
            if parked:
                gated["parked_drafts"] = parked
            return gated

    # No command — continue to intent/specialists; do not wipe guided memory.
    out = {
        "handled": False,
        "reply": "",
        "actions": [],
    }
    if pending:
        out["escalate_draft"] = draft
    if mdraft:
        out["macro_draft"] = mdraft
    if tdraft:
        out["team_draft"] = tdraft
    if kdraft:
        out["kb_draft"] = kdraft
    if parked:
        out["parked_drafts"] = parked
    return out
