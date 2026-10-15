"""CRM-style agent-turn envelope.

Maps native `run_chat` results (reply + ui_actions + drafts) into the
public UI contract: assistantText, toolProposals, patch, sessionMemoryPatch,
uiRefresh. Supervisor routing stays internal — it is never copied onto this
envelope.
"""

from __future__ import annotations

import json
from typing import Any

from app.tools.registry import tool_meta
from app.workflow_schemas import missing_fields

_ADMIN_READ_VIEWS = frozenset(
    {
        "analytics",
        "audit",
        "csat-reports",
        "escalation-directory",
        "org-preferences",
        "dashboard",
        "approvals",
        "settings",
    }
)

_NAV_WORKSPACE: dict[str, tuple[str, str]] = {
    "create-ticket": ("tickets", "create"),
    "assigned": ("tickets", "list"),
    "team-queue": ("tickets", "list"),
    "team-inbox": ("tickets", "list"),
    "unassigned": ("tickets", "list"),
    "search": ("tickets", "list"),
    "tickets-list": ("tickets", "list"),
    "work-board": ("tickets", "list"),
    "agent-queues": ("teams", "list"),
    "customers": ("customers", "list"),
    "kb": ("kb", "list"),
    "macros": ("macros", "list"),
    "priorities": ("admin", "priorities"),
    "analytics": ("admin", "analytics"),
    "csat-reports": ("admin", "csat"),
    "audit": ("admin", "audit"),
    "escalation-directory": ("admin", "directory"),
    "org-preferences": ("admin", "prefs"),
    "dashboard": ("general", "list"),
    "settings": ("admin", "prefs"),
    "approvals": ("admin", "list"),
}

_CREATE_SPECS: dict[str, dict[str, str]] = {
    "create_ticket": {
        "view": "create-ticket",
        "module": "tickets",
        "patch_tool": "patch_ticket_draft",
        "propose_tool": "propose_create_ticket",
        "draft_key": "ticket_draft",
    },
    "create_team": {
        "view": "agent-queues",
        "module": "teams",
        "patch_tool": "patch_team_draft",
        "propose_tool": "propose_create_team",
        "draft_key": "team_draft",
    },
    "update_team": {
        "view": "agent-queues",
        "module": "teams",
        "patch_tool": "patch_team_draft",
        "propose_tool": "propose_update_team",
        "draft_key": "team_draft",
    },
    "create_kb": {
        "view": "kb",
        "module": "kb",
        "patch_tool": "patch_kb_draft",
        "propose_tool": "propose_create_kb",
        "draft_key": "kb_draft",
    },
    "create_macro": {
        "view": "macros",
        "module": "macros",
        "patch_tool": "patch_macro_draft",
        "propose_tool": "propose_create_macro",
        "draft_key": "macro_draft",
    },
    "create_customer": {
        "view": "customers",
        "module": "customers",
        "patch_tool": "patch_customer_draft",
        "propose_tool": "propose_create_customer",
        "draft_key": "customer_draft",
    },
    "create_priority": {
        "view": "priorities",
        "module": "admin",
        "patch_tool": "patch_priority_draft",
        "propose_tool": "propose_create_priority",
        "draft_key": "priority_draft",
    },
    "create_status": {
        "view": "priorities",
        "module": "admin",
        "patch_tool": "patch_status_draft",
        "propose_tool": "propose_create_status",
        "draft_key": "status_draft",
    },
    "escalate": {
        "view": "",
        "module": "tickets",
        "patch_tool": "patch_escalate_draft",
        "propose_tool": "propose_escalate",
        "draft_key": "escalate_draft",
    },
}

_DELETE_PROPOSE = {
    "delete_team": "propose_delete_team",
    "delete_macro": "propose_delete_macro",
    "delete_priority": "propose_delete_priority",
    "delete_status": "propose_delete_status",
}

_REFRESH_LISTS = {
    "refresh_tickets": "tickets",
    "refresh_teams": "teams",
    "refresh_kb": "kb",
    "refresh_customers": "customers",
    "refresh_macros": "macros",
    "refresh_analytics": "analytics",
    "refresh_csat": "csat",
    "refresh_audit": "audit",
    "refresh_priorities": "priorities",
    "refresh_org_preferences": "org-preferences",
    "refresh_directory": "directory",
}

_DRAFT_DATA_KEYS = (
    ("ticket_draft", "patch_ticket_draft"),
    ("team_draft", "patch_team_draft"),
    ("kb_draft", "patch_kb_draft"),
    ("macro_draft", "patch_macro_draft"),
    ("customer_draft", "patch_customer_draft"),
    ("priority_draft", "patch_priority_draft"),
    ("status_draft", "patch_status_draft"),
    ("escalate_draft", "patch_escalate_draft"),
)

_CUSTOMER_AWAITING = frozenset({"name", "email", "phone", "confirm", "contact"})
_TICKET_AWAITING = frozenset({"name", "contact", "issue", "priority", "confirm"})
_KB_AWAITING = frozenset({"title", "category", "body", "confirm"})
_MACRO_AWAITING = frozenset({"title", "body", "confirm", "delete_confirm"})
_TEAM_AWAITING = frozenset(
    {
        "name",
        "description",
        "create_members",
        "members",
        "confirm",
        "members_names",
        "members_team",
    }
)
_PRIORITY_AWAITING = frozenset({"name", "hours", "confirm"})


def resolve_client_form_drafts(
    *,
    module: str | None = None,
    page: str | None = None,
    page_surface: str | None = None,
    session_memory: dict[str, Any] | None = None,
    ticket_draft: dict[str, Any] | None = None,
    draft: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Map the React form snapshot onto the correct LangGraph draft key.

    The UI sends both `ticket_draft` and `draft` for every module. A customer
    create form must never hydrate `ticket_draft` (that misroutes phone/email
    into create-ticket and surfaces as chat failures / offline fallbacks).
    """
    from app.tools.registry import normalize_module

    mod, _surf = infer_module_surface(
        module=module,
        page_surface=page_surface,
        page=page,
        channel_surface=None,
    )
    mod = normalize_module(mod)
    memory = session_memory if isinstance(session_memory, dict) else {}
    intent = str(memory.get("pendingIntent") or "").strip().lower()
    blob = ticket_draft if isinstance(ticket_draft, dict) else None
    if blob is None and isinstance(draft, dict):
        blob = draft
    if not isinstance(blob, dict) or not blob:
        return {}

    awaiting = str(blob.get("awaiting") or blob.get("step") or "").strip().lower()
    has_issue = bool(str(blob.get("issue") or blob.get("subject") or "").strip())
    has_customer_slots = bool(
        str(blob.get("name") or "").strip()
        or str(blob.get("email") or "").strip()
        or str(blob.get("phone") or "").strip()
        or awaiting in {"email", "phone"}
    )

    def _as_customer(src: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {
            "awaiting": awaiting
            if awaiting in _CUSTOMER_AWAITING
            else ("phone" if src.get("phone") else "email" if src.get("email") else "name"),
        }
        name = str(src.get("name") or src.get("customerName") or "").strip()
        email = str(src.get("email") or src.get("customerEmail") or "").strip()
        phone = str(src.get("phone") or src.get("customerPhone") or "").strip()
        if name:
            out["name"] = name
        if email:
            out["email"] = email
        if phone:
            out["phone"] = phone
        return out

    def _as_kb(src: dict[str, Any]) -> dict[str, Any]:
        from app.workflow_schemas import sanitize_kb_draft_fields, usable_kb_title

        out: dict[str, Any] = {
            "awaiting": awaiting if awaiting in _KB_AWAITING else "title",
        }
        start = str(src.get("_intent_start_text") or "").strip()
        if start:
            out["_intent_start_text"] = start
        for key in ("title", "category", "body"):
            val = str(src.get(key) or "").strip()
            if val:
                out[key] = val
        out = sanitize_kb_draft_fields(out)
        if not usable_kb_title(
            str(out.get("title") or ""),
            start_utterance=str(out.get("_intent_start_text") or src.get("_intent_start_text") or "").strip(),
        ):
            out["awaiting"] = "title"
        return out

    def _as_macro(src: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {
            "awaiting": awaiting if awaiting in _MACRO_AWAITING else "title",
        }
        for key in ("title", "body"):
            val = str(src.get(key) or "").strip()
            if val:
                out[key] = val
        return out

    def _as_team(src: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {
            "awaiting": awaiting if awaiting in _TEAM_AWAITING else "name",
        }
        for key in ("name", "description", "id", "team", "flow", "members"):
            if src.get(key) not in (None, "", [], {}):
                out[key] = src[key]
        return out

    def _as_priority(src: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {
            "awaiting": awaiting if awaiting in _PRIORITY_AWAITING else "name",
            "kind": str(src.get("kind") or "priority").strip() or "priority",
        }
        for key in ("displayName", "name", "label", "resolutionHours", "hours"):
            if src.get(key) not in (None, ""):
                out[key] = src[key]
        return out

    # Module / pending intent win over ambiguous dual-shaped payloads.
    if mod == "customers" or intent in {"create_customer", "customer"}:
        return {"customer_draft": _as_customer(blob)}
    if mod == "kb" or intent in {"create_kb", "kb"}:
        return {"kb_draft": _as_kb(blob)}
    if mod == "macros" or intent in {"create_macro", "macro"}:
        return {"macro_draft": _as_macro(blob)}
    if mod == "teams" or intent in {
        "create_team",
        "team",
        "add_team_members",
        "add_members",
    }:
        return {"team_draft": _as_team(blob)}
    if mod == "admin" or intent in {
        "create_priority",
        "priority",
        "create_status",
        "status",
    }:
        if awaiting in _PRIORITY_AWAITING or blob.get("displayName") or blob.get("kind"):
            return {"priority_draft": _as_priority(blob)}
        return {}
    if mod == "tickets" or intent in {"create_ticket", "ticket"}:
        if has_customer_slots and not has_issue and awaiting in {"email", "phone"}:
            # Customer-not-found handoff still open on tickets page.
            return {"customer_draft": _as_customer(blob)}
        return {"ticket_draft": dict(blob)}

    # Shape fallback when module is general/home.
    if (
        not has_issue
        and has_customer_slots
        and awaiting in _CUSTOMER_AWAITING
        and (
            awaiting in {"email", "phone"}
            or str(blob.get("email") or blob.get("customerEmail") or "").strip()
        )
    ):
        return {"customer_draft": _as_customer(blob)}
    if awaiting in _KB_AWAITING and (
        blob.get("title") or blob.get("category") or blob.get("body")
    ):
        return {"kb_draft": _as_kb(blob)}
    if has_issue or awaiting in _TICKET_AWAITING:
        return {"ticket_draft": dict(blob)}
    return {}

_SKIP_PATCH_KEYS = frozenset(
    {
        "type",
        "done",
        "save",
        "confirm",
        "refresh",
        "availableMembers",
        "ticketNumber",
        "id",
    }
)

_PAGE_MODULE: dict[str, tuple[str, str]] = {
    "create ticket": ("tickets", "create"),
    "my tickets": ("tickets", "list"),
    "all tickets": ("tickets", "list"),
    "team inbox": ("tickets", "list"),
    "unassigned": ("tickets", "list"),
    "search": ("tickets", "list"),
    "work board": ("tickets", "list"),
    "teams": ("teams", "list"),
    "customers": ("customers", "list"),
    "directory": ("customers", "list"),
    "knowledge base": ("kb", "list"),
    "macros": ("macros", "list"),
    "priorities": ("admin", "priorities"),
    "analytics": ("admin", "analytics"),
    "csat reports": ("admin", "csat"),
    "audit log": ("admin", "audit"),
    "escalation directory": ("admin", "directory"),
    "org preferences": ("admin", "prefs"),
    "home": ("general", "list"),
    "support portal": ("portal", "home"),
}


def infer_module_surface(
    *,
    module: str | None = None,
    page_surface: str | None = None,
    page: str | None = None,
    channel_surface: str | None = None,
) -> tuple[str, str]:
    if channel_surface and str(channel_surface).strip().lower() == "portal":
        return ("portal", (page_surface or "home").strip().lower())
    mod = str(module or "").strip().lower()
    surf = str(page_surface or "").strip().lower()
    if mod and surf:
        return (mod, surf)
    page_key = str(page or "").strip().lower()
    inferred = _PAGE_MODULE.get(page_key)
    if inferred:
        return (mod or inferred[0], surf or inferred[1])
    if mod:
        return (mod, surf or "list")
    return ("general", surf or "list")


def _proposal(
    name: str,
    args: dict[str, Any] | None = None,
    *,
    auto: bool | None = None,
    risk: str | None = None,
) -> dict[str, Any]:
    meta = tool_meta(name) or {}
    confirm = bool(meta.get("confirm"))
    destructive = bool(meta.get("destructive"))
    if auto is None:
        auto = not confirm
    if risk is None:
        risk = "high" if (confirm or destructive) else "low"
    return {
        "name": name,
        "args": dict(args or {}),
        "risk": risk,
        "auto": bool(auto),
    }


_WRITE_TO_PROPOSE: dict[str, str] = {
    "create_ticket": "propose_create_ticket",
    "create_queue": "propose_create_team",
    "create_customer": "propose_create_customer",
    "create_kb_article": "propose_create_kb",
    "create_macro": "propose_create_macro",
    "create_priority": "propose_create_priority",
    "create_status": "propose_create_status",
    "escalate_ticket": "propose_escalate",
}

# Confirm chips emit propose_* names; chip click must run the real write tool.
_PROPOSE_TO_WRITE: dict[str, str] = {
    **{propose: write for write, propose in _WRITE_TO_PROPOSE.items()},
    "propose_delete_team": "delete_queue",
    "propose_delete_macro": "delete_macro",
    "propose_delete_priority": "delete_priority",
    "propose_delete_status": "delete_status",
    "propose_update_team": "update_queue",
}


def resolve_confirm_tool(
    name: str | None,
    args: dict[str, Any] | None = None,
) -> tuple[str, dict[str, Any]]:
    """Map Confirm-chip propose_* → executable write tool; chip click = confirmed.

    Leaves real tool names unchanged so the happy path (specialist already called
    create_ticket / create_queue / …) is unaffected when confirm_tool is unused.
    """
    raw_name = str(name or "").strip()
    out_args = dict(args) if isinstance(args, dict) else {}
    key = raw_name.lower()
    write = _PROPOSE_TO_WRITE.get(key) or _PROPOSE_TO_WRITE.get(raw_name)
    if write:
        raw_name = write
    # UI Confirm chip is explicit consent — arm the CRM write gate.
    if "confirmed" not in out_args and "auto" not in out_args:
        out_args["confirmed"] = True
    return raw_name, out_args


def _needs_confirm_proposals(
    *,
    data: dict[str, Any],
    session_memory: dict[str, Any] | None,
    patch: dict[str, Any],
) -> list[dict[str, Any]]:
    """Confirm chips only for non-guided high-risk writes (e.g. escalate).

    Guided create_* and catalog delete_* confirm in chat (natural language /
    forced armed write). Do not emit propose_create_* or propose_delete_* chips.
    """
    del patch  # reserved for delete/update chip arg merge if re-enabled
    mem = session_memory if isinstance(session_memory, dict) else {}
    outcome = (
        data.get("last_tool_outcome")
        or data.get("lastToolOutcome")
        or mem.get("lastToolOutcome")
        or mem.get("last_tool_outcome")
    )
    if not isinstance(outcome, dict):
        return []
    code = str(outcome.get("error_code") or "").strip().upper()
    kind = str(outcome.get("kind") or "").strip().lower()
    if code != "CONFIRMATION_REQUIRED" and kind != "needs_confirm":
        return []
    if outcome.get("success") is True:
        return []
    tool = str(outcome.get("tool") or outcome.get("name") or "").strip().lower()
    propose = _WRITE_TO_PROPOSE.get(tool)
    if not propose:
        # Map deletes that only exist on the propose side.
        propose = {
            "delete_queue": "propose_delete_team",
            "delete_macro": "propose_delete_macro",
            "delete_priority": "propose_delete_priority",
            "delete_status": "propose_delete_status",
        }.get(tool)
    if not propose:
        return []
    # Guided creates + catalog deletes: chat confirmation only — never chips.
    if propose.startswith("propose_create_") or propose.startswith("propose_delete_"):
        return []
    args = outcome.get("arguments") if isinstance(outcome.get("arguments"), dict) else {}
    args = dict(args)
    auto = bool(args.get("confirmed") is True or args.get("auto") is True)
    return [_proposal(propose, args, auto=auto, risk="high")]


def _clean_patch(raw: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        if key in _SKIP_PATCH_KEYS:
            continue
        if value in (None, "", [], {}):
            continue
        out[key] = value
    return out


def _merge_patch(base: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    for key, value in incoming.items():
        if value in (None, "", [], {}):
            continue
        base[key] = value
    return base


def _is_done(action: dict[str, Any]) -> bool:
    return bool(action.get("done") or action.get("refresh") or action.get("save"))


def _set_workspace(view: str, surface: str, module: str) -> dict[str, Any]:
    args: dict[str, Any] = {"view": view, "surface": surface, "module": module}
    if surface == "create":
        args["mode"] = "create"
    return _proposal("set_workspace", args, auto=True, risk="low")


def _stable_args_key(args: Any) -> str:
    try:
        return json.dumps(args if isinstance(args, dict) else {}, sort_keys=True, default=str)
    except TypeError:
        return str(args)


def _dedupe_proposals(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, ...]] = set()
    out: list[dict[str, Any]] = []
    for item in items:
        key = (
            str(item.get("name") or ""),
            _stable_args_key(item.get("args") or {}),
            bool(item.get("auto")),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def chat_result_to_agent_turn(
    result: dict[str, Any] | None,
    *,
    module: str | None = None,
    page_surface: str | None = None,
    page: str | None = None,
    channel_surface: str | None = None,
    session_memory: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Map `{reply, actions, data}` from `run_chat` to the CRM turn envelope."""
    raw = result if isinstance(result, dict) else {}
    data = dict(raw.get("data") or {}) if isinstance(raw.get("data"), dict) else {}
    actions = list(raw.get("actions") or raw.get("ui_actions") or [])
    reply = str(raw.get("reply") or "")
    channel = str(channel_surface or data.get("surface") or "").strip().lower()
    page_mod, page_surf = infer_module_surface(
        module=module,
        page_surface=page_surface,
        page=page,
        channel_surface=channel or None,
    )
    portal = page_mod == "portal" or channel == "portal"

    proposals: list[dict[str, Any]] = []
    patch: dict[str, Any] = {}
    refresh_lists: list[str] = []
    refresh_href = ""
    refresh_filename = ""

    for item in actions:
        if not isinstance(item, dict):
            continue
        typ = str(item.get("type") or "").strip().lower()
        if typ == "navigate":
            view = str(item.get("view") or "").strip()
            if not view:
                continue
            if portal:
                continue
            nav_mod, nav_surf = _NAV_WORKSPACE.get(view, (page_mod, page_surf or "list"))
            if view in _ADMIN_READ_VIEWS:
                nav_surf = "list"
            proposals.append(_set_workspace(view, nav_surf, nav_mod))
            proposals.append(_proposal("navigate", {"view": view}, auto=True, risk="low"))
            continue
        if typ == "set_filter":
            args = {
                k: item[k]
                for k in (
                    "module",
                    "query",
                    "status",
                    "priority",
                    "channel",
                    "creator",
                    "assignee",
                    "queue",
                    "range",
                )
                if k in item
            }
            proposals.append(_proposal("set_filter", args, auto=True, risk="low"))
            continue
        if typ == "clear_filters":
            proposals.append(
                _proposal(
                    "clear_filters",
                    {"module": item.get("module") or "all"},
                    auto=True,
                    risk="low",
                )
            )
            continue
        if typ == "open_kb":
            proposals.append(
                _proposal(
                    "open_entity",
                    {
                        "type": "article",
                        "id": item.get("id"),
                        "name": item.get("title") or item.get("query"),
                    },
                    auto=True,
                    risk="low",
                )
            )
            continue
        if typ == "download":
            href = str(item.get("href") or "").strip()
            filename = str(item.get("filename") or "").strip()
            proposals.append(
                _proposal(
                    "download",
                    {"href": href, "filename": filename},
                    auto=True,
                    risk="low",
                )
            )
            if href:
                refresh_href = href
                refresh_filename = filename
            continue
        if typ in _REFRESH_LISTS:
            refresh_lists.append(_REFRESH_LISTS[typ])
            continue
        if typ in _DELETE_PROPOSE:
            args = _clean_patch(item)
            if _is_done(item):
                if typ == "delete_team":
                    refresh_lists.append("teams")
                elif typ == "delete_macro":
                    refresh_lists.append("macros")
                else:
                    refresh_lists.append("priorities")
            else:
                # Catalog deletes confirm in chat (yes / natural language) —
                # keep draft patch for the progress panel, never emit Confirm chips.
                if args:
                    _merge_patch(patch, args)
            continue
        spec = _CREATE_SPECS.get(typ)
        if spec:
            draft_from_data = data.get(spec["draft_key"])
            action_patch = _clean_patch(item)
            if isinstance(draft_from_data, dict):
                action_patch = _merge_patch(_clean_patch(draft_from_data), action_patch)
            done = _is_done(item)
            view = spec["view"]
            if not portal and view and not done and view not in _ADMIN_READ_VIEWS:
                surface = "detail" if typ == "update_team" else "create"
                proposals.append(_set_workspace(view, surface, spec["module"]))
            if action_patch and not done:
                _merge_patch(patch, action_patch)
                proposals.append(
                    _proposal(spec["patch_tool"], action_patch, auto=True, risk="low")
                )
            if done:
                list_name = {
                    "tickets": "tickets",
                    "teams": "teams",
                    "kb": "kb",
                    "macros": "macros",
                    "customers": "customers",
                    "admin": "priorities",
                }.get(spec["module"])
                if list_name:
                    refresh_lists.append(list_name)
            continue

    for draft_key, patch_tool in _DRAFT_DATA_KEYS:
        blob = data.get(draft_key)
        if not isinstance(blob, dict):
            continue
        # Only fold the active workflow draft into the flat CRM patch.
        active_wf = str(data.get("workflow") or "").strip()
        expected_wf = {
            "ticket_draft": "create_ticket",
            "team_draft": "create_team",
            "kb_draft": "create_kb",
            "macro_draft": "create_macro",
            "customer_draft": "create_customer",
            "priority_draft": "create_priority",
            "status_draft": "create_status",
            "escalate_draft": "escalate",
        }.get(draft_key)
        if active_wf and expected_wf and active_wf != expected_wf:
            continue
        if not active_wf and any(
            str(p.get("name") or "").startswith("patch_") and p.get("name") != patch_tool
            for p in proposals
        ):
            # Another patch_* already owns this turn — skip sibling drafts.
            if not any(p.get("name") == patch_tool for p in proposals):
                continue
        extra = _clean_patch(blob)
        if not extra:
            continue
        _merge_patch(patch, extra)
        if not any(p.get("name") == patch_tool for p in proposals):
            proposals.append(_proposal(patch_tool, extra, auto=True, risk="low"))

    workflow = str(data.get("workflow") or "").strip() or None
    step = str(data.get("step") or "").strip() or None
    awaiting = ""
    if patch:
        awaiting = str(patch.get("awaiting") or patch.get("step") or "").strip()
    missing: list[str] = []
    if workflow:
        missing = missing_fields(workflow, patch or data.get("ticket_draft") or {})
    # Prefer schema missing SoT over stale awaiting / step UI hints.
    pending_ask = (missing[0] if missing else None) or awaiting or step or None


    slots = dict(patch)
    memory_in = session_memory if isinstance(session_memory, dict) else {}
    session_memory_patch: dict[str, Any] = {}
    if workflow:
        session_memory_patch["pendingIntent"] = workflow
    elif memory_in.get("pendingIntent"):
        session_memory_patch["pendingIntent"] = memory_in.get("pendingIntent")
    if pending_ask:
        session_memory_patch["pendingAsk"] = pending_ask
    if slots:
        session_memory_patch["slots"] = slots
    last_entity = data.get("last_entity")
    if last_entity:
        session_memory_patch["lastEntities"] = last_entity
    parked = data.get("parked_drafts") or []
    if parked:
        session_memory_patch["parkedDrafts"] = parked

    ui_refresh: dict[str, Any] | None = None
    lists = list(dict.fromkeys(refresh_lists))
    if lists or refresh_href:
        ui_refresh = {}
        if lists:
            ui_refresh["lists"] = lists
        if refresh_href:
            ui_refresh["href"] = refresh_href
        if refresh_filename:
            ui_refresh["filename"] = refresh_filename

    if portal:
        proposals = [
            p
            for p in proposals
            if p.get("name") not in {"set_workspace", "navigate"}
        ]

    if "tickets" in refresh_lists:
        proposals = [p for p in proposals if p.get("name") != "propose_escalate"]
    if "teams" in refresh_lists:
        proposals = [p for p in proposals if p.get("name") != "propose_delete_team"]
    if "macros" in refresh_lists:
        proposals = [p for p in proposals if p.get("name") != "propose_delete_macro"]
    if "priorities" in refresh_lists:
        proposals = [
            p
            for p in proposals
            if p.get("name") not in {"propose_delete_priority", "propose_delete_status"}
        ]

    proposals.extend(
        _needs_confirm_proposals(
            data=data,
            session_memory=memory_in,
            patch=patch,
        )
    )
    proposals = _dedupe_proposals(proposals)

    envelope: dict[str, Any] = {
        "assistantText": reply,
        "toolProposals": proposals,
        "patch": patch or None,
        "sessionMemoryPatch": session_memory_patch or None,
        "uiRefresh": ui_refresh,
        "reply": reply,
        "agent": str(raw.get("agent") or "general"),
        "session_id": raw.get("session_id"),
        "ui_actions": actions,
        "request_id": raw.get("request_id"),
        "schema_version": "1.0",
        "data": data,
    }
    return envelope


def run_agent_turn(
    message: str,
    *,
    page: str | None = None,
    organization_id: str | None = None,
    session_id: str | None = None,
    history: list[dict] | None = None,
    user_id: str | None = None,
    user_name: str | None = None,
    user_role: str | None = None,
    can_create_ticket: bool | None = None,
    ticket_draft: dict | None = None,
    draft: dict | None = None,
    next_step: str | None = None,
    request_id: str | None = None,
    surface: str | None = None,
    portal_customer_id: str | None = None,
    portal_auth_mode: str | None = None,
    focused_entity: dict | None = None,
    module: str | None = None,
    page_surface: str | None = None,
    session_memory: dict | None = None,
    confirm_tool: dict | None = None,
    kind: str | None = None,
) -> dict[str, Any]:
    """Run one LangGraph turn and wrap it in the CRM envelope. `/chat` is unchanged."""
    from app.graph import run_chat
    from app.tasks.phrase import phrase_reply
    from app.tools.bound import execute_tool_call
    from app.tools.express_client import ToolActor, tool_actor_scope
    from app.tools.registry import normalize_module, tool_meta, tools_for_agent
    import json

    confirm = confirm_tool if isinstance(confirm_tool, dict) else None
    confirm_name_raw = str((confirm or {}).get("name") or "").strip() if confirm else ""
    confirm_args_raw = (
        confirm.get("args") if confirm and isinstance(confirm.get("args"), dict) else {}
    )
    confirm_name, confirm_args = resolve_confirm_tool(confirm_name_raw, confirm_args_raw)

    # Confirm chips: UI click is the confirmation — execute proposed tool (RBAC only).
    if confirm_name and organization_id and user_id:
        mod, _surf = infer_module_surface(
            module=module,
            page_surface=page_surface,
            page=page,
            channel_surface=surface,
        )
        agent_by_mod = {
            "tickets": "tickets",
            "teams": "teams",
            "customers": "customers",
            "kb": "kb",
            "macros": "macros",
            "admin": "admin",
            "portal": "kb",
            "general": "general",
        }
        agent = agent_by_mod.get(normalize_module(mod), "general")
        if confirm_name not in tools_for_agent(agent):
            for candidate in (
                "tickets",
                "teams",
                "customers",
                "kb",
                "macros",
                "admin",
                "general",
            ):
                if confirm_name in tools_for_agent(candidate):
                    agent = candidate
                    break
        meta = tool_meta(confirm_name) or {}
        actor = ToolActor(
            user_id=str(user_id),
            organization_id=str(organization_id),
            user_role=user_role,
            user_name=user_name,
            request_id=request_id,
            portal_customer_id=portal_customer_id,
        )
        # Chip click arms the write (same gate as pending_delete / confirm draft).
        with tool_actor_scope(actor):
            raw = execute_tool_call(
                agent,
                confirm_name,
                confirm_args,
                role=user_role,
                last_query={"pending_delete": dict(confirm_args) or {"chip": True}},
            )
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed = {"success": False, "message": str(raw)}
        if not isinstance(parsed, dict):
            parsed = {"success": False, "message": str(parsed)}
        ok = bool(parsed.get("success"))
        reply = phrase_reply(
            module=agent if agent != "general" else mod,
            kind="done" if ok else "validation",
            fallback=(
                f"Acknowledge completing {confirm_name.replace('_', ' ')}."
                if ok
                else f"Explain that {confirm_name.replace('_', ' ')} could not complete."
            ),
            user_text=str(message or "confirm"),
            page_label=page or mod,
            context={
                "tool": confirm_name,
                "success": ok,
                "error": parsed.get("message"),
                "destructive": bool(meta.get("destructive")),
            },
        )
        refresh_map = {
            "create_ticket": "tickets",
            "delete_queue": "teams",
            "create_queue": "teams",
            "update_queue": "teams",
            "delete_macro": "macros",
            "create_macro": "macros",
            "create_kb_article": "kb",
            "create_customer": "customers",
            "create_priority": "priorities",
            "delete_priority": "priorities",
            "create_status": "priorities",
            "delete_status": "priorities",
        }
        lists: list[str] = []
        if ok and confirm_name in refresh_map:
            lists.append(refresh_map[confirm_name])
        return {
            "assistantText": reply,
            "toolProposals": [],
            "patch": None,
            "sessionMemoryPatch": None,
            "uiRefresh": {"lists": lists} if lists else None,
            "reply": reply,
            "agent": agent,
            "session_id": session_id,
            "ui_actions": ([{"type": f"refresh_{lists[0]}"}] if lists else []),
            "request_id": request_id,
            "schema_version": "1.0",
            "data": {"toolResult": parsed},
        }

    msg = str(message or "").strip()
    if str(kind or "").strip().lower() == "greeting" and not msg:
        msg = "hello"
    if not msg:
        msg = "hello"

    client_draft = ticket_draft if isinstance(ticket_draft, dict) else None
    if client_draft is None and isinstance(draft, dict):
        client_draft = draft
    resolved = resolve_client_form_drafts(
        module=module,
        page=page,
        page_surface=page_surface,
        session_memory=session_memory if isinstance(session_memory, dict) else None,
        ticket_draft=ticket_draft if isinstance(ticket_draft, dict) else None,
        draft=draft if isinstance(draft, dict) else client_draft,
    )

    result = run_chat(
        msg,
        page=page,
        organization_id=organization_id,
        session_id=session_id,
        history=history,
        user_id=user_id,
        user_name=user_name,
        user_role=user_role,
        can_create_ticket=can_create_ticket,
        ticket_draft=resolved.get("ticket_draft"),
        customer_draft=resolved.get("customer_draft"),
        kb_draft=resolved.get("kb_draft"),
        macro_draft=resolved.get("macro_draft"),
        team_draft=resolved.get("team_draft"),
        priority_draft=resolved.get("priority_draft"),
        next_step=next_step,
        request_id=request_id,
        surface=surface,
        portal_customer_id=portal_customer_id,
        portal_auth_mode=portal_auth_mode,
        focused_entity=focused_entity,
        chat_module=module,
        chat_surface=page_surface,
        session_memory=session_memory if isinstance(session_memory, dict) else None,
    )
    return chat_result_to_agent_turn(
        result,
        module=module,
        page_surface=page_surface,
        page=page,
        channel_surface=surface,
        session_memory=session_memory,
    )
