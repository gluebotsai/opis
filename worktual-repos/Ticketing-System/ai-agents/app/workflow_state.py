"""
Frozen workflow state contract for LangGraph.

Architecture (frozen):
  Express owns mutations · LangGraph owns orchestration · LLM owns language.

Orchestrator owns park / resume / route_to_agent / clarification.
Specialists own continue / start / mutations via tools.
Legacy *_draft fields stay as projections of conversation_context.
"""

from __future__ import annotations

from typing import Any

# Workflow ids (configurable policy space — not architecture)
WF_CREATE_TEAM = "create_team"
WF_ADD_TEAM_MEMBERS = "add_team_members"
WF_DELETE_TEAM = "delete_team"
WF_CREATE_MACRO = "create_macro"
WF_CREATE_KB = "create_kb"
WF_MANAGE_KB_CATEGORY = "manage_kb_category"
WF_ESCALATE = "escalate"
WF_REASSIGN = "reassign_ticket"
WF_CREATE_TICKET = "create_ticket"
WF_CREATE_PRIORITY = "create_priority"
WF_CREATE_STATUS = "create_status"
WF_CREATE_CUSTOMER = "create_customer"

_DURABLE_HISTORY_CAP = 20

ENTITY_TEAM = "team"
ENTITY_TICKET = "ticket"
ENTITY_MACRO = "macro"
ENTITY_KB = "article"
ENTITY_CUSTOMER = "customer"
ENTITY_PRIORITY = "priority"
ENTITY_STATUS = "status"

_TYPE_ALIASES: dict[str, frozenset[str]] = {
    "article": frozenset({"article", "kb"}),
    "kb": frozenset({"article", "kb"}),
    "team": frozenset({"team", "queue"}),
    "queue": frozenset({"team", "queue"}),
    "ticket": frozenset({"ticket"}),
    "macro": frozenset({"macro"}),
    "customer": frozenset({"customer"}),
    "priority": frozenset({"priority"}),
    "status": frozenset({"status"}),
}

_OP_ENTITY_TYPES: dict[str, frozenset[str]] = {
    "GET_ARTICLE": frozenset({"article", "kb"}),
    "SEARCH_KB": frozenset({"article", "kb"}),
    "UPDATE_KB": frozenset({"article", "kb"}),
    "PUBLISH_KB": frozenset({"article", "kb"}),
    "GET_TEAM": frozenset({"team", "queue"}),
    "SEARCH_TEAMS": frozenset({"team", "queue"}),
    "UPDATE_TEAM": frozenset({"team", "queue"}),
    "ADD_MEMBERS": frozenset({"team", "queue"}),
    "REMOVE_MEMBERS": frozenset({"team", "queue"}),
    "DELETE_TEAM": frozenset({"team", "queue"}),
    "GET_MACRO": frozenset({"macro"}),
    "SEARCH_MACROS": frozenset({"macro"}),
    "UPDATE_MACRO": frozenset({"macro"}),
    "DELETE_MACRO": frozenset({"macro"}),
    "GET_CUSTOMER": frozenset({"customer"}),
    "SEARCH_CUSTOMERS": frozenset({"customer"}),
    "GET_CUSTOMER_TICKETS": frozenset({"customer"}),
    "GET_TICKET": frozenset({"ticket"}),
    "GET_HISTORY": frozenset({"ticket"}),
    "UPDATE_TICKET": frozenset({"ticket"}),
}

_ACTION_ENTITY_TYPE: dict[str, str] = {
    "create_team": ENTITY_TEAM,
    "update_team": ENTITY_TEAM,
    "create_kb": ENTITY_KB,
    "open_kb": ENTITY_KB,
    "create_customer": ENTITY_CUSTOMER,
    "create_ticket": ENTITY_TICKET,
    "create_macro": ENTITY_MACRO,
    "open_macro": ENTITY_MACRO,
    "create_priority": ENTITY_PRIORITY,
    "create_status": ENTITY_STATUS,
}

# Structured service errors (response data.serviceError)
FORBIDDEN = "FORBIDDEN"
VALIDATION_ERROR = "VALIDATION_ERROR"
NOT_FOUND = "NOT_FOUND"
AMBIGUOUS_REFERENCE = "AMBIGUOUS_REFERENCE"
CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
STALE_CONVERSATION_CONTEXT = "STALE_CONVERSATION_CONTEXT"
SERVICE_ERROR = "SERVICE_ERROR"

WORKFLOW_AGENT: dict[str, str] = {
    WF_CREATE_TICKET: "tickets",
    WF_ESCALATE: "tickets",
    WF_REASSIGN: "tickets",
    WF_CREATE_CUSTOMER: "customers",
    WF_CREATE_TEAM: "teams",
    WF_ADD_TEAM_MEMBERS: "teams",
    WF_DELETE_TEAM: "teams",
    WF_CREATE_MACRO: "macros",
    WF_CREATE_KB: "kb",
    WF_MANAGE_KB_CATEGORY: "kb",
    WF_CREATE_PRIORITY: "admin",
    WF_CREATE_STATUS: "admin",
}

FLOW_TO_WORKFLOW: dict[str, str] = {
    "ticket": WF_CREATE_TICKET,
    "customer": WF_CREATE_CUSTOMER,
    "team": WF_CREATE_TEAM,
    "macro": WF_CREATE_MACRO,
    "kb": WF_CREATE_KB,
    "manage_category": WF_MANAGE_KB_CATEGORY,
    "manage_kb_category": WF_MANAGE_KB_CATEGORY,
    "escalate": WF_ESCALATE,
    "reassign": WF_REASSIGN,
    "reassign_ticket": WF_REASSIGN,
    "priority": WF_CREATE_PRIORITY,
}

WORKFLOW_TO_FLOW: dict[str, str] = {
    WF_CREATE_TICKET: "ticket",
    WF_CREATE_CUSTOMER: "customer",
    WF_CREATE_TEAM: "team",
    WF_ADD_TEAM_MEMBERS: "team",
    WF_DELETE_TEAM: "team",
    WF_CREATE_MACRO: "macro",
    WF_CREATE_KB: "kb",
    WF_MANAGE_KB_CATEGORY: "kb",
    WF_ESCALATE: "escalate",
    WF_REASSIGN: "reassign",
    WF_CREATE_PRIORITY: "priority",
    WF_CREATE_STATUS: "priority",
}

WORKFLOW_TO_DRAFT_KEY: dict[str, str] = {
    WF_CREATE_TICKET: "ticket_draft",
    WF_CREATE_CUSTOMER: "customer_draft",
    WF_CREATE_TEAM: "team_draft",
    WF_ADD_TEAM_MEMBERS: "team_draft",
    WF_DELETE_TEAM: "team_draft",
    WF_CREATE_MACRO: "macro_draft",
    WF_CREATE_KB: "kb_draft",
    WF_MANAGE_KB_CATEGORY: "kb_draft",
    WF_ESCALATE: "escalate_draft",
    WF_REASSIGN: "reassign_draft",
    WF_CREATE_PRIORITY: "priority_draft",
    WF_CREATE_STATUS: "priority_draft",
}

SPECIALIST_ROUTES = frozenset(
    {"tickets", "customers", "teams", "kb", "macros", "admin", "general"}
)


def entity(
    *,
    type: str,
    id: str = "",
    name: str = "",
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "type": (type or "").strip().lower(),
        "id": (id or "").strip(),
        "name": (name or "").strip(),
    }
    if extra:
        out.update(extra)
    return out


def _entity_types_for_request(request: dict[str, Any]) -> frozenset[str]:
    want = str(request.get("entity_type") or "").strip().lower()
    types: set[str] = set()
    if want:
        types.update(_TYPE_ALIASES.get(want, frozenset({want})))
    op = str(request.get("operation") or "").strip().upper()
    types.update(_OP_ENTITY_TYPES.get(op, frozenset()))
    return frozenset(types)


def _entity_name_from_mapping(row: dict[str, Any]) -> str:
    for key in (
        "name",
        "title",
        "displayName",
        "queueName",
        "ticketNumber",
        "ticket_number",
        "query",
    ):
        val = str(row.get(key) or "").strip()
        if val:
            return val
    return ""


def last_entity_from_actions(actions: Any) -> dict[str, Any] | None:
    """Remember the entity from a successful create/open UI action."""
    if not isinstance(actions, list):
        return None
    found: dict[str, Any] | None = None
    for act in actions:
        if not isinstance(act, dict):
            continue
        kind = str(act.get("type") or "").strip().lower()
        etype = _ACTION_ENTITY_TYPE.get(kind)
        if not etype:
            continue
        if kind.startswith("open_"):
            pass
        elif not act.get("done"):
            continue
        name = _entity_name_from_mapping(act)
        eid = str(act.get("id") or "").strip()
        if not name and not eid:
            continue
        found = entity(type=etype, id=eid, name=name)
    return found


def last_entity_from_data(data: Any) -> dict[str, Any] | None:
    if not isinstance(data, dict):
        return None
    tn = str(data.get("ticket_number") or data.get("ticketNumber") or "").strip()
    if tn:
        return entity(type=ENTITY_TICKET, name=tn.lstrip("#"))
    for key, etype, name_keys in (
        ("article", ENTITY_KB, ("title", "name")),
        ("team", ENTITY_TEAM, ("queueName", "name")),
        ("macro", ENTITY_MACRO, ("title", "name")),
        ("customer", ENTITY_CUSTOMER, ("name", "fullName")),
        ("ticket", ENTITY_TICKET, ("ticketNumber", "ticket_number", "name")),
    ):
        row = data.get(key)
        if not isinstance(row, dict):
            continue
        name = ""
        for nk in name_keys:
            name = str(row.get(nk) or "").strip()
            if name:
                break
        eid = str(row.get("id") or row.get("externalId") or "").strip()
        if name or eid:
            return entity(type=etype, id=eid, name=name)
    title = str(data.get("kb_title") or data.get("macro_title") or "").strip()
    if title and data.get("kb_title"):
        return entity(
            type=ENTITY_KB,
            id=str(data.get("kb_id") or ""),
            name=title,
        )
    if title:
        return entity(type=ENTITY_MACRO, name=title)
    return None


def remember_entity_from_result(result: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None
    return (
        normalize_last_entity(result.get("last_entity"))
        or last_entity_from_actions(result.get("actions"))
        or last_entity_from_data(result.get("data"))
    )


def _pick_referenced_entity(
    context: dict[str, Any], request: dict[str, Any]
) -> dict[str, Any] | None:
    wanted = _entity_types_for_request(request)
    last = context.get("last_entity") if isinstance(context.get("last_entity"), dict) else None
    recent = context.get("recent_entities") if isinstance(context.get("recent_entities"), list) else []
    candidates: list[dict[str, Any]] = []
    if last:
        candidates.append(last)
    for item in reversed(recent):
        if isinstance(item, dict) and item not in candidates:
            candidates.append(item)
    if wanted:
        for item in candidates:
            et = str(item.get("type") or "").strip().lower()
            aliases = _TYPE_ALIASES.get(et, frozenset({et} if et else ()))
            if aliases & wanted:
                return item
        return None
    return last


def normalize_last_entity(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    et = str(raw.get("type") or "").strip().lower()
    if not et:
        return None
    return entity(
        type=et,
        id=str(raw.get("id") or ""),
        name=str(raw.get("name") or ""),
        extra={
            k: v
            for k, v in raw.items()
            if k not in ("type", "id", "name") and v is not None
        },
    )


def agent_for_workflow(workflow_type: str | None) -> str:
    wf = str(workflow_type or "").strip().lower()
    return WORKFLOW_AGENT.get(wf, "general")


def workflow_type_from_flow(flow: str, draft: dict[str, Any] | None = None) -> str:
    awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    kind = str(flow or "").strip().lower()
    if kind == "team":
        if awaiting in ("members", "members_names", "members_team"):
            return WF_ADD_TEAM_MEMBERS
        if awaiting == "delete_confirm":
            return WF_DELETE_TEAM
        return WF_CREATE_TEAM
    if kind == "priority":
        draft_kind = str((draft or {}).get("kind") or "").strip().lower()
        return WF_CREATE_STATUS if draft_kind == "status" else WF_CREATE_PRIORITY
    if kind in {"kb", "manage_category", "manage_kb_category"}:
        draft_flow = str((draft or {}).get("flow") or "").strip().lower()
        if (
            draft_flow == "manage_category"
            or awaiting in {"manage_mode", "category_name"}
            or kind in {"manage_category", "manage_kb_category"}
        ):
            return WF_MANAGE_KB_CATEGORY
        return WF_CREATE_KB
    return FLOW_TO_WORKFLOW.get(kind, kind)


def normalize_active_workflow(raw: Any) -> dict[str, Any] | None:
    """Canonical active/parked workflow object (agent + workflow_type + data)."""
    if not isinstance(raw, dict):
        return None
    data_raw = raw.get("data") if isinstance(raw.get("data"), dict) else None
    draft_raw = raw.get("draft") if isinstance(raw.get("draft"), dict) else None
    data = dict(data_raw or draft_raw or {})
    wf_type = str(raw.get("workflow_type") or raw.get("id") or "").strip().lower()
    if not wf_type and raw.get("flow"):
        wf_type = workflow_type_from_flow(str(raw.get("flow") or ""), data)
    if not wf_type and not data:
        return None
    step = str(raw.get("step") or data.get("awaiting") or "").strip() or None
    if step and not data.get("awaiting"):
        data["awaiting"] = step
    try:
        version = int(raw.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    agent = str(raw.get("agent") or agent_for_workflow(wf_type)).strip().lower() or "general"
    out: dict[str, Any] = {
        "agent": agent,
        "workflow_type": wf_type,
        "id": wf_type,
        "step": step,
        "data": data,
        "version": max(1, version),
        "status": str(raw.get("status") or "active"),
    }
    flow = str(raw.get("flow") or WORKFLOW_TO_FLOW.get(wf_type) or "").strip().lower()
    if flow:
        out["flow"] = flow
        out["draft"] = dict(data)
    return out


def parked_item_to_draft(item: dict[str, Any]) -> dict[str, Any] | None:
    """Canonical or legacy parked item → {flow, draft} for graph state."""
    if not isinstance(item, dict):
        return None
    if item.get("flow") and isinstance(item.get("draft"), dict):
        draft = dict(item["draft"])
        if not draft.get("awaiting"):
            # Recover awaiting from schema so filled drafts are not dropped.
            from app.memory_contract import normalize_parked

            recovered = normalize_parked(
                [{"flow": str(item["flow"]).strip().lower(), "draft": draft}]
            )
            if recovered:
                return recovered[0]
            return None
        return {"flow": str(item["flow"]).strip().lower(), "draft": draft}
    wf = normalize_active_workflow(item)
    if not wf:
        return None
    flow = str(wf.get("flow") or WORKFLOW_TO_FLOW.get(str(wf.get("workflow_type") or "")) or "")
    data = dict(wf.get("data") or {})
    if flow and data:
        if not data.get("awaiting"):
            from app.memory_contract import normalize_parked

            recovered = normalize_parked([{"flow": flow, "draft": data}])
            if recovered:
                return recovered[0]
            return None
        return {"flow": flow, "draft": data}
    return None


def draft_to_parked_workflow(flow: str, draft: dict[str, Any]) -> dict[str, Any]:
    wf_type = workflow_type_from_flow(flow, draft)
    return {
        "agent": agent_for_workflow(wf_type),
        "workflow_type": wf_type,
        "id": wf_type,
        "step": str(draft.get("awaiting") or "") or None,
        "data": dict(draft),
        "version": 1,
        "status": "parked",
        "flow": str(flow or "").strip().lower(),
        "draft": dict(draft),
    }


def service_error(
    code: str, *, retryable: bool = False, extra: dict[str, Any] | None = None
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "serviceError": str(code or SERVICE_ERROR),
        "retryable": bool(retryable),
    }
    if extra:
        data.update(extra)
    return data


def confirmation_required(
    *, operation: str, preview: dict[str, Any] | None = None
) -> dict[str, Any]:
    return service_error(
        CONFIRMATION_REQUIRED,
        extra={"operation": operation, "preview": preview or {}},
    )


def propose_mutate_gate(
    *, confirmed: bool, operation: str, preview: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    """Return CONFIRMATION_REQUIRED when the user has not confirmed yet."""
    if confirmed:
        return None
    return confirmation_required(operation=operation, preview=preview)


def apply_last_entity_to_ticket(
    draft: dict[str, Any], last_entity: dict[str, Any] | None
) -> dict[str, Any]:
    """Bind last_entity customer id/name onto a ticket draft when types match."""
    out = dict(draft)
    le = normalize_last_entity(last_entity)
    if not le or le.get("type") != ENTITY_CUSTOMER:
        return out
    cid = str(le.get("id") or "").strip()
    cname = str(le.get("name") or "").strip()
    if cid:
        out["customerId"] = cid
    if cname and not str(out.get("customerName") or "").strip():
        out["customerName"] = cname
    awaiting = str(out.get("awaiting") or "").strip().lower()
    if awaiting in {"name", "contact"} and out.get("customerId"):
        from app.workflow_schemas import missing_fields

        miss = missing_fields(WF_CREATE_TICKET, out)
        step_map = {
            "customerName": "name",
            "contact": "contact",
            "issue": "issue",
            "priority": "priority",
        }
        out["awaiting"] = step_map.get(miss[0], miss[0]) if miss else "confirm"
    return out


def normalize_conversation_context(raw: Any) -> dict[str, Any]:
    """One canonical memory structure for entities, queries, and workflows."""
    data = raw if isinstance(raw, dict) else {}
    last_entity = normalize_last_entity(data.get("last_entity"))
    recent: list[dict[str, Any]] = []
    for item in data.get("recent_entities") or []:
        normalized = normalize_last_entity(item)
        if normalized:
            recent.append(normalized)
    last_query_raw = data.get("last_query")
    last_query = dict(last_query_raw) if isinstance(last_query_raw, dict) else None
    if isinstance(last_query, dict):
        last_query.pop("rows", None)
        last_query.pop("tickets", None)
    active = normalize_active_workflow(data.get("active_workflow"))
    parked = [
        wf
        for item in (data.get("parked_workflows") or [])
        if isinstance(item, dict)
        for wf in [normalize_active_workflow(item)]
        if wf
    ]
    active_agent = str(data.get("active_agent") or "").strip().lower() or None
    if not active_agent and active:
        active_agent = str(active.get("agent") or agent_for_workflow(active.get("workflow_type")))
    tm = data.get("tool_memory")
    tool_memory = dict(tm) if isinstance(tm, dict) else None
    last_user_message = (
        str(data["last_user_message"]).strip()
        if isinstance(data.get("last_user_message"), str) and data["last_user_message"].strip()
        else None
    )
    last_assistant_reply = (
        str(data["last_assistant_reply"]).strip()[:500]
        if isinstance(data.get("last_assistant_reply"), str) and data["last_assistant_reply"].strip()
        else None
    )
    # Durable conversation transcript — last 20 turns, survives restarts.
    recent_history: list[dict[str, str]] = []
    for item in data.get("recent_history") or []:
        if isinstance(item, dict) and item.get("role") and item.get("text"):
            recent_history.append(
                {"role": str(item["role"]), "text": str(item["text"])[:500]}
            )
    recent_history = recent_history[-_DURABLE_HISTORY_CAP:]
    out: dict[str, Any] = {
        "active_agent": active_agent,
        "last_entity": last_entity,
        "recent_entities": recent[-12:],
        "last_query": last_query,
        "active_workflow": active,
        "parked_workflows": parked,
        "tool_memory": tool_memory,
        "last_user_message": last_user_message,
        "last_assistant_reply": last_assistant_reply,
        "recent_history": recent_history or None,
        "last_super_agent_decision": (
            dict(data["last_super_agent_decision"])
            if isinstance(data.get("last_super_agent_decision"), dict)
            else None
        ),
    }
    # Preserve allowlisted draft / workflow projections used by native shared memory.
    for draft_key in (
        "ticket_draft",
        "team_draft",
        "kb_draft",
        "macro_draft",
        "customer_draft",
        "priority_draft",
        "status_draft",
        "escalate_draft",
        "reassign_draft",
        "parked_drafts",
        "current_workflow",
        "pending_confirm",
        "pending_resume",
        "slots",
        "pending_ask",
        "handoff_trace",
        "last_tool_outcome",
    ):
        if draft_key in data and data[draft_key] is not None and draft_key not in out:
            value = data[draft_key]
            if isinstance(value, (dict, list)):
                out[draft_key] = dict(value) if isinstance(value, dict) else list(value)
            else:
                out[draft_key] = value
    return out


def last_entity_from_state(state: dict[str, Any] | None) -> dict[str, Any] | None:
    src = state if isinstance(state, dict) else {}
    context = conversation_context_from_state(src)
    return context.get("last_entity") or normalize_last_entity(src.get("last_entity"))


def conversation_context_from_state(state: dict[str, Any]) -> dict[str, Any]:
    """Hydrate canonical context, accepting legacy fields as read-only adapters."""
    context = normalize_conversation_context(state.get("conversation_context"))
    if context["last_entity"] is None:
        context["last_entity"] = normalize_last_entity(state.get("last_entity"))
    if not context.get("recent_entities"):
        raw_recent = state.get("recent_entities")
        if isinstance(raw_recent, list):
            context["recent_entities"] = [
                item
                for item in (normalize_last_entity(x) for x in raw_recent)
                if item
            ][-12:]
    if context["active_workflow"] is None and state.get("current_workflow"):
        wf_id = str(state.get("current_workflow") or "")
        data = dict(state.get("workflow_data") or {})
        draft_key = WORKFLOW_TO_DRAFT_KEY.get(wf_id)
        if draft_key and isinstance(state.get(draft_key), dict):
            draft = dict(state.get(draft_key) or {})
            if draft:
                data = {**data, **draft}
        context["active_workflow"] = normalize_active_workflow(
            {
                "workflow_type": wf_id,
                "step": state.get("current_step"),
                "data": data,
                "status": "active",
            }
        )
        context["active_agent"] = agent_for_workflow(wf_id)
    if not context["parked_workflows"] and isinstance(state.get("parked_drafts"), list):
        context["parked_workflows"] = [
            draft_to_parked_workflow(str(item.get("flow") or ""), dict(item.get("draft") or {}))
            for item in state.get("parked_drafts") or []
            if isinstance(item, dict) and item.get("flow") and isinstance(item.get("draft"), dict)
        ]
    if not context.get("active_agent") and context.get("active_workflow"):
        context["active_agent"] = str(
            (context["active_workflow"] or {}).get("agent") or ""
        ) or None
    return context


def context_state_projection(context: dict[str, Any]) -> dict[str, Any]:
    """Project canonical context into legacy graph keys during controlled migration."""
    normalized = normalize_conversation_context(context)
    active = normalized.get("active_workflow")
    current = active if isinstance(active, dict) else {}
    wf_id = str(current.get("workflow_type") or current.get("id") or "") or None
    parked_drafts = [
        item
        for raw in (normalized.get("parked_workflows") or [])
        if isinstance(raw, dict)
        for item in [parked_item_to_draft(raw)]
        if item
    ]
    projection: dict[str, Any] = {
        "conversation_context": normalized,
        "last_entity": normalized.get("last_entity"),
        "current_workflow": wf_id,
        "current_step": current.get("step") or None,
        "workflow_data": dict(current.get("data") or {}) if current else None,
        "parked_drafts": parked_drafts,
    }
    draft_key = WORKFLOW_TO_DRAFT_KEY.get(wf_id or "")
    if draft_key and current:
        draft_data = dict(current.get("data") or {})
        draft_data["awaiting"] = (
            current.get("step") or draft_data.get("awaiting") or ""
        )
        if draft_data.get("awaiting"):
            projection[draft_key] = draft_data
    return projection


_CREATE_TEAM_AWAITING = frozenset(
    {"name", "description", "create_members", "confirm", "members"}
)


def normalize_create_team_awaiting(raw: str | None) -> str:
    step = str(raw or "").strip().lower()
    if step == "members":
        return "create_members"
    return step


def ensure_team_draft(state: dict[str, Any] | None) -> dict[str, Any] | None:
    """Rebuild create-team draft from checkpoint / conversation_context only."""
    src = state if isinstance(state, dict) else {}
    td = src.get("team_draft") if isinstance(src.get("team_draft"), dict) else None
    if td and str(td.get("awaiting") or "").strip():
        out = dict(td)
        awaiting = str(td.get("awaiting") or "").strip().lower()
        if awaiting not in {
            "members",
            "members_names",
            "members_team",
            "delete_confirm",
        }:
            out["awaiting"] = normalize_create_team_awaiting(awaiting)
        tm = out.get("tool_memory") if isinstance(out.get("tool_memory"), dict) else {}
        agents = tm.get("list_agents") if isinstance(tm.get("list_agents"), dict) else {}
        if not out.get("available_members"):
            names = agents.get("names") if isinstance(agents, dict) else None
            ents = agents.get("entities") if isinstance(agents, dict) else None
            if isinstance(names, list) and names:
                out["available_members"] = [str(n).strip() for n in names if str(n).strip()]
            elif isinstance(ents, list):
                out["available_members"] = [
                    str(e.get("name") or "").strip()
                    for e in ents
                    if isinstance(e, dict) and str(e.get("name") or "").strip()
                ]
        return out
    ctx = (
        src.get("conversation_context")
        if isinstance(src.get("conversation_context"), dict)
        else {}
    )
    active = (
        ctx.get("active_workflow")
        if isinstance(ctx.get("active_workflow"), dict)
        else {}
    )
    wf = str(
        active.get("workflow_type")
        or active.get("id")
        or src.get("current_workflow")
        or ""
    ).strip().lower()
    data = dict(active.get("data") or {})
    if not data and isinstance(src.get("workflow_data"), dict):
        data = dict(src.get("workflow_data") or {})
    awaiting = normalize_create_team_awaiting(
        str(active.get("step") or data.get("awaiting") or src.get("current_step") or "")
    )
    if wf not in {WF_CREATE_TEAM, "team"}:
        return None
    if awaiting not in _CREATE_TEAM_AWAITING:
        return None
    return {**data, "awaiting": awaiting}


def remember_last_entity(
    context: dict[str, Any] | None, entity: dict[str, Any] | None
) -> dict[str, Any]:
    """Set last_entity and append to recent_entities (shared memory)."""
    out = normalize_conversation_context(context)
    last_entity = normalize_last_entity(entity)
    if not last_entity:
        return out
    out["last_entity"] = last_entity
    recent = [
        item
        for item in out["recent_entities"]
        if not (
            item.get("type") == last_entity.get("type")
            and (item.get("id") or item.get("name"))
            == (last_entity.get("id") or last_entity.get("name"))
        )
    ]
    out["recent_entities"] = (recent + [last_entity])[-12:]
    return out


_ENTITY_NAME_KEYS = (
    "title",
    "name",
    "queueName",
    "displayName",
    "ticketNumber",
    "subject",
    "email",
)
_ENTITY_ID_KEYS = ("id", "externalId", "ticketNumber", "macroId", "customerId")


def _row_entity(row: dict[str, Any]) -> dict[str, str] | None:
    if not isinstance(row, dict):
        return None
    name = ""
    for key in _ENTITY_NAME_KEYS:
        val = str(row.get(key) or "").strip()
        if val:
            name = val
            break
    ident = ""
    for key in _ENTITY_ID_KEYS:
        val = str(row.get(key) or "").strip()
        if val:
            ident = val
            break
    if not ident and not name:
        return None
    return {"id": ident, "name": name or ident}


def _rows_from_tool_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if not isinstance(payload, dict):
        return []
    for key in (
        "data",
        "articles",
        "tickets",
        "macros",
        "customers",
        "queues",
        "items",
        "keys",
        "priorities",
        "statuses",
    ):
        raw = payload.get(key)
        if isinstance(raw, list):
            return [r for r in raw if isinstance(r, dict)]
    if payload.get("id") or payload.get("title") or payload.get("name"):
        return [payload]
    nested = payload.get("payload")
    if nested is not None and nested is not payload:
        return _rows_from_tool_payload(nested)
    return []


def compact_tool_memory(tool_name: str, result: Any) -> dict[str, Any]:
    """Compact last tool result for Super Agent / specialist context."""
    name = str(tool_name or "").strip() or "unknown"
    payload = result
    if isinstance(result, dict):
        payload = result.get("payload", result)
    rows = _rows_from_tool_payload(payload)
    if not rows and isinstance(result, dict):
        rows = _rows_from_tool_payload(result)
    entities: list[dict[str, str]] = []
    for row in rows:
        ent = _row_entity(row)
        if ent:
            entities.append(ent)
        if len(entities) >= 12:
            break
    count = len(rows) if rows else len(entities)
    out: dict[str, Any] = {
        "last_tool": name,
        name: {"count": count, "entities": entities},
        "last_result": {"items": entities},
    }
    # Persist tool outcome so super agent knows success/failure on the next turn.
    if isinstance(result, dict):
        success = result.get("success")
        if success is not None:
            outcome: dict[str, Any] = {
                "tool": name,
                "success": bool(success),
            }
            if not success:
                err_code = str(result.get("error_code") or "").strip()
                err_msg = str(result.get("message") or "").strip()
                if err_code:
                    outcome["error_code"] = err_code
                if err_msg:
                    outcome["error"] = err_msg[:200]
            out["last_tool_outcome"] = outcome
    return out


def merge_tool_memory(
    prior: dict[str, Any] | None, tool_name: str, result: Any
) -> dict[str, Any]:
    out = dict(prior) if isinstance(prior, dict) else {}
    compact = compact_tool_memory(tool_name, result)
    out.update(compact)
    return out


def attach_tool_memory_to_result(result: dict[str, Any]) -> dict[str, Any]:
    """Stamp compact tool_memory onto a specialist/handler result."""
    if not isinstance(result, dict):
        return result
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    tool = str(data.get("_tool_name") or "").strip()
    if not tool:
        return result
    prior = result.get("tool_memory") if isinstance(result.get("tool_memory"), dict) else {}
    ctx = (
        result.get("conversation_context")
        if isinstance(result.get("conversation_context"), dict)
        else {}
    )
    if not prior and isinstance(ctx.get("tool_memory"), dict):
        prior = dict(ctx.get("tool_memory") or {})
    memory = merge_tool_memory(prior, tool, data if data else result)
    out = dict(result)
    out["tool_memory"] = memory
    ctx = dict(ctx)
    ctx["tool_memory"] = memory
    out["conversation_context"] = ctx
    return out


def update_context_from_result(
    prior: dict[str, Any] | None, result: dict[str, Any]
) -> dict[str, Any]:
    """Apply graph result to canonical context after one completed turn."""
    context = normalize_conversation_context(prior)
    last_entity = remember_entity_from_result(result)
    if last_entity:
        context = remember_last_entity(context, last_entity)
    current_workflow = result.get("current_workflow")
    if current_workflow:
        wf_id = str(current_workflow)
        data = dict(result.get("workflow_data") or {})
        draft_key = WORKFLOW_TO_DRAFT_KEY.get(wf_id)
        if draft_key and isinstance(result.get(draft_key), dict):
            # Prefer the full legacy draft over a possibly stripped workflow_data
            # (e.g. escalate confirm must keep assignee / assignee_id).
            draft = dict(result.get(draft_key) or {})
            if draft:
                data = {**data, **draft}
        context["active_workflow"] = normalize_active_workflow(
            {
                "agent": agent_for_workflow(wf_id),
                "workflow_type": wf_id,
                "step": result.get("current_step"),
                "data": data,
                "status": "active",
                "version": ((context.get("active_workflow") or {}) or {}).get("version") or 1,
            }
        )
        context["active_agent"] = agent_for_workflow(wf_id)
    elif "current_workflow" in result:
        context["active_workflow"] = None
        context["active_agent"] = None
    if isinstance(result.get("parked_drafts"), list):
        parked: list[dict[str, Any]] = []
        for item in result.get("parked_drafts") or []:
            if not isinstance(item, dict):
                continue
            if item.get("flow") and isinstance(item.get("draft"), dict):
                parked.append(
                    draft_to_parked_workflow(str(item.get("flow") or ""), dict(item.get("draft") or {}))
                )
            else:
                wf = normalize_active_workflow(item)
                if wf:
                    parked.append(wf)
        context["parked_workflows"] = parked
    data = result.get("data")
    if isinstance(data, dict) and isinstance(data.get("last_query"), dict):
        last_query = dict(data["last_query"])
        last_query.pop("rows", None)
        last_query.pop("tickets", None)
        context["last_query"] = last_query
    tm = result.get("tool_memory") if isinstance(result.get("tool_memory"), dict) else None
    if not tm and isinstance(data, dict) and data.get("_tool_name"):
        tm = compact_tool_memory(str(data.get("_tool_name")), data)
    if tm:
        context["tool_memory"] = tm
    # Persist the NLU decision so subsequent turns can reference it.
    wd = result.get("workflow_decision")
    if isinstance(wd, dict) and wd:
        context["last_super_agent_decision"] = {
            k: wd[k]
            for k in ("action", "intent", "operation", "agent", "workflow")
            if wd.get(k) not in (None, "", "NONE")
        }
    # Persist user query + assistant reply for next-turn intent resolution.
    user_msg = result.get("_turn_user_message")
    if isinstance(user_msg, str) and user_msg.strip():
        context["last_user_message"] = user_msg.strip()
    assistant_reply = str(result.get("reply") or "").strip()
    if assistant_reply:
        context["last_assistant_reply"] = assistant_reply[:500]
    # Append this turn to the durable conversation transcript.
    prior_history = list(context.get("recent_history") or [])
    if isinstance(user_msg, str) and user_msg.strip():
        prior_history.append({"role": "user", "text": user_msg.strip()[:500]})
    if assistant_reply:
        prior_history.append({"role": "assistant", "text": assistant_reply[:500]})
    context["recent_history"] = prior_history[-_DURABLE_HISTORY_CAP:] or None
    return context


def resolve_query_reference(
    semantic_request: dict[str, Any], context: dict[str, Any]
) -> tuple[dict[str, Any], str | None]:
    """Resolve query/entity references from the single conversation context."""
    request = dict(semantic_request or {})
    reference = str(request.get("reference") or "").strip().upper()
    if not reference:
        return request, None
    normalized = normalize_conversation_context(context)
    if reference == "LAST_QUERY":
        previous = normalized.get("last_query")
        if not isinstance(previous, dict):
            # A complete structured filter does not depend on prior query state,
            # even if the model also supplied a redundant reference.
            if isinstance(request.get("filters"), dict) and request["filters"]:
                request["reference"] = None
                return request, None
            return request, "No previous ticket query is available."
        merged = dict(previous)
        merged.update({k: v for k, v in request.items() if v not in (None, {}, "")})
        merged["filters"] = {
            **dict(previous.get("filters") or {}),
            **dict(request.get("filters") or {}),
        }
        merged["reference"] = None
        return merged, None
    if reference == "LAST_ENTITY":
        last_entity = _pick_referenced_entity(normalized, request)
        named = (
            str(request.get("entity_name") or "").strip()
            or str((request.get("filters") or {}).get("query") or "").strip()
        )
        if not isinstance(last_entity, dict):
            if named:
                request["reference"] = None
                return request, None
            return request, "No previous entity is available."
        request["resolved_entity"] = dict(last_entity)
        request["reference"] = None
        filters = dict(request.get("filters") or {})
        if last_entity.get("name") and not filters.get("query"):
            filters["query"] = str(last_entity.get("name"))
        if last_entity.get("id") and not filters.get("id"):
            filters["id"] = str(last_entity.get("id"))
        request["filters"] = filters
        if not request.get("entity_name") and last_entity.get("name"):
            request["entity_name"] = str(last_entity.get("name"))
        return request, None
    return request, "The requested reference is not supported."


def clear_workflow() -> dict[str, Any]:
    return {
        "current_workflow": None,
        "current_step": None,
        "workflow_data": None,
    }


def workflow_snapshot(
    *,
    workflow: str | None,
    step: str | None = None,
    data: dict[str, Any] | None = None,
    last_entity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "current_workflow": (workflow or None),
        "current_step": (step or None) if workflow else None,
        "workflow_data": dict(data) if workflow and isinstance(data, dict) else (
            None if not workflow else {}
        ),
    }
    if last_entity is not None:
        out["last_entity"] = normalize_last_entity(last_entity)
    return out


def hydrate_from_legacy_drafts(
    *,
    escalate_draft: dict | None,
    reassign_draft: dict | None = None,
    macro_draft: dict | None,
    team_draft: dict | None,
    kb_draft: dict | None,
    ticket_draft: dict | None = None,
    priority_draft: dict | None = None,
    customer_draft: dict | None = None,
    next_step: str | None = None,
    current_workflow: str | None = None,
    current_step: str | None = None,
    workflow_data: dict | None = None,
    last_entity: dict | None = None,
) -> dict[str, Any]:
    """
    Prefer explicit workflow fields; else project from legacy *_draft adapters.
    Never invent entities — only copy ids/names already on drafts.
    """
    le = normalize_last_entity(last_entity)
    prefer_wf = str(current_workflow or "").strip().lower()

    td = team_draft if isinstance(team_draft, dict) else None
    if td and td.get("awaiting"):
        awaiting = str(td.get("awaiting") or "").strip().lower()
        name = str(td.get("name") or "").strip()
        qid = str(td.get("id") or "").strip()
        data = dict(td)
        data["name"] = name
        data["id"] = qid
        data["awaiting"] = awaiting
        avail = data.get("available_members")
        if isinstance(avail, list) and avail:
            data["available_members"] = [
                str(n).strip() for n in avail if str(n).strip()
            ]
        tm = data.get("tool_memory")
        if isinstance(tm, dict) and tm:
            data["tool_memory"] = tm
        elif data.get("available_members"):
            names = data["available_members"]
            data["tool_memory"] = {
                "list_agents": {
                    "names": names,
                    "count": len(names),
                    "entities": [{"id": "", "name": n} for n in names],
                }
            }
        if awaiting in ("create_members",):
            return workflow_snapshot(
                workflow=WF_CREATE_TEAM,
                step=awaiting,
                data=data,
                last_entity=le,
            )
        if awaiting in ("members", "members_names", "members_team"):
            snap = workflow_snapshot(
                workflow=WF_ADD_TEAM_MEMBERS,
                step=awaiting,
                data=data,
                last_entity=entity(type=ENTITY_TEAM, id=qid, name=name) if (qid or name) else le,
            )
            return snap
        if awaiting == "delete_confirm":
            return workflow_snapshot(
                workflow=WF_DELETE_TEAM,
                step=awaiting,
                data=data,
                last_entity=entity(type=ENTITY_TEAM, id=qid, name=name) if (qid or name) else le,
            )
        return workflow_snapshot(
            workflow=WF_CREATE_TEAM,
            step=awaiting,
            data=data,
            last_entity=le,
        )

    md = macro_draft if isinstance(macro_draft, dict) else None
    if md and md.get("awaiting"):
        awaiting = str(md.get("awaiting") or "").strip().lower()
        data = dict(md)
        data["awaiting"] = awaiting
        return workflow_snapshot(
            workflow=WF_CREATE_MACRO,
            step=awaiting,
            data=data,
            last_entity=le,
        )

    kd = kb_draft if isinstance(kb_draft, dict) else None
    if kd and kd.get("awaiting"):
        awaiting = str(kd.get("awaiting") or "").strip().lower()
        data = dict(kd)
        data["awaiting"] = awaiting
        draft_flow = str(kd.get("flow") or "").strip().lower()
        kb_wf = (
            WF_MANAGE_KB_CATEGORY
            if draft_flow == "manage_category"
            or awaiting in {"manage_mode", "category_name"}
            else WF_CREATE_KB
        )
        return workflow_snapshot(
            workflow=kb_wf,
            step=awaiting,
            data=data,
            last_entity=le,
        )

    ed = escalate_draft if isinstance(escalate_draft, dict) else None
    rd = reassign_draft if isinstance(reassign_draft, dict) else None
    # When both ticket-assign drafts are live, prefer the active workflow so a
    # stale escalate-at-confirm cannot shadow a new reassign (or the reverse).
    if (
        prefer_wf in {"reassign_ticket", "reassign"}
        and rd
        and rd.get("awaiting")
    ):
        awaiting = str(rd.get("awaiting") or "").strip().lower()
        tn = str(rd.get("ticket_number") or "").strip()
        return workflow_snapshot(
            workflow=WF_REASSIGN,
            step=awaiting,
            data=dict(rd),
            last_entity=entity(type=ENTITY_TICKET, name=tn) if tn else le,
        )
    if prefer_wf in {"escalate", "escalate_ticket"} and ed and ed.get("awaiting"):
        awaiting = str(ed.get("awaiting") or "").strip().lower()
        tn = str(ed.get("ticket_number") or "").strip()
        data = dict(ed)
        data["awaiting"] = awaiting
        return workflow_snapshot(
            workflow=WF_ESCALATE,
            step=awaiting,
            data=data,
            last_entity=entity(type=ENTITY_TICKET, name=tn) if tn else le,
        )
    if ed and ed.get("awaiting"):
        awaiting = str(ed.get("awaiting") or "").strip().lower()
        tn = str(ed.get("ticket_number") or "").strip()
        # Keep the full draft (assignee / ids / note). Stripping to ticket+candidates
        # made confirm rounds rebuild an incomplete escalate_draft, so the write
        # tool never armed and the specialist re-asked forever after "yehh"/"yes".
        data = dict(ed)
        data["awaiting"] = awaiting
        return workflow_snapshot(
            workflow=WF_ESCALATE,
            step=awaiting,
            data=data,
            last_entity=entity(type=ENTITY_TICKET, name=tn) if tn else le,
        )

    if rd and rd.get("awaiting"):
        awaiting = str(rd.get("awaiting") or "").strip().lower()
        tn = str(rd.get("ticket_number") or "").strip()
        return workflow_snapshot(
            workflow=WF_REASSIGN,
            step=awaiting,
            data=dict(rd),
            last_entity=entity(type=ENTITY_TICKET, name=tn) if tn else le,
        )

    pd = priority_draft if isinstance(priority_draft, dict) else None
    if pd and pd.get("awaiting"):
        awaiting = str(pd.get("awaiting") or "").strip().lower()
        kind = str(pd.get("kind") or "priority").strip().lower()
        return workflow_snapshot(
            workflow=WF_CREATE_STATUS if kind == "status" else WF_CREATE_PRIORITY,
            step=awaiting,
            data=dict(pd),
            last_entity=le,
        )

    cd = customer_draft if isinstance(customer_draft, dict) else None
    if cd and cd.get("awaiting"):
        awaiting = str(cd.get("awaiting") or "").strip().lower()
        return workflow_snapshot(
            workflow=WF_CREATE_CUSTOMER,
            step=awaiting or "name",
            data=dict(cd),
            last_entity=le,
        )

    tix = ticket_draft if isinstance(ticket_draft, dict) else None
    if tix and tix.get("awaiting"):
        awaiting = str(tix.get("awaiting") or "").strip().lower()
        return workflow_snapshot(
            workflow=WF_CREATE_TICKET,
            step=awaiting or "name",
            data=dict(tix),
            last_entity=le,
        )
    # Free-text next_step prompts are not a workflow. Only known awaiting tokens.
    _ticket_steps = {
        "name",
        "contact",
        "issue",
        "priority",
        "confirm",
        "kb_resolution",
        "customername",
        "collect",
    }
    step = (next_step or "").strip().lower().replace(" ", "")
    has_ticket_vals = bool(
        tix
        and any(
            str(v).strip()
            for k, v in tix.items()
            if k not in ("awaiting",) and v not in (None, "", False)
        )
    )
    if tix and (step in _ticket_steps or has_ticket_vals):
        aw = str(tix.get("awaiting") or "").strip().lower()
        if not aw:
            aw = step if step in _ticket_steps else "name"
        return workflow_snapshot(
            workflow=WF_CREATE_TICKET,
            step=aw or "name",
            data=dict(tix),
            last_entity=le,
        )

    if current_workflow:
        return {
            "current_workflow": current_workflow,
            "current_step": current_step,
            "workflow_data": dict(workflow_data) if isinstance(workflow_data, dict) else {},
            "last_entity": le,
        }

    return {
        "current_workflow": None,
        "current_step": None,
        "workflow_data": None,
        "last_entity": le,
    }


def enrich_handler_result(
    result: dict[str, Any],
    *,
    prior_last_entity: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Project legacy draft keys on a handler result into frozen workflow fields.
    Preserves last_entity after a successful create/update when draft clears.
    """
    out = dict(result)
    prior = normalize_last_entity(prior_last_entity)

    # Prefer drafts present on the result; missing keys mean "leave checkpointer".
    team = out["team_draft"] if "team_draft" in out else None
    macro = out["macro_draft"] if "macro_draft" in out else None
    kb = out["kb_draft"] if "kb_draft" in out else None
    esc = out["escalate_draft"] if "escalate_draft" in out else None
    ras = out["reassign_draft"] if "reassign_draft" in out else None
    tix = out["ticket_draft"] if "ticket_draft" in out else None
    pri = out["priority_draft"] if "priority_draft" in out else None
    cust = out["customer_draft"] if "customer_draft" in out else None

    projected = hydrate_from_legacy_drafts(
        escalate_draft=esc if isinstance(esc, dict) else None,
        reassign_draft=ras if isinstance(ras, dict) else None,
        macro_draft=macro if isinstance(macro, dict) else None,
        team_draft=team if isinstance(team, dict) else None,
        kb_draft=kb if isinstance(kb, dict) else None,
        ticket_draft=tix if isinstance(tix, dict) else None,
        priority_draft=pri if isinstance(pri, dict) else None,
        customer_draft=cust if isinstance(cust, dict) else None,
        last_entity=prior,
    )

    remembered = remember_entity_from_result(out)
    if remembered:
        projected["last_entity"] = remembered

    # Finished drafts clear the active workflow; never drop conversation memory.
    draft_cleared = False
    for key in (
        "escalate_draft",
        "reassign_draft",
        "macro_draft",
        "team_draft",
        "kb_draft",
        "ticket_draft",
        "priority_draft",
        "customer_draft",
    ):
        if key in out and out.get(key) is None:
            draft_cleared = True
            break
    if draft_cleared and not projected.get("current_workflow"):
        keep_le = projected.get("last_entity") or prior
        projected.update(clear_workflow())
        if keep_le:
            projected["last_entity"] = keep_le

    if not projected.get("last_entity") and prior:
        projected["last_entity"] = prior

    out.update(projected)
    return out


def intent_for_workflow(workflow: str | None, step: str | None = None) -> str | None:
    """Map active workflow → cheap-intent label (for draft override)."""
    wf = (workflow or "").strip().lower()
    st = (step or "").strip().lower()
    if not wf:
        return None
    if wf == WF_ESCALATE:
        return "UPDATE"
    if wf == WF_REASSIGN:
        return "UPDATE"
    if wf == WF_ADD_TEAM_MEMBERS:
        return "UPDATE"
    if wf == WF_DELETE_TEAM:
        return "UPDATE"
    if wf in (
        WF_CREATE_TEAM,
        WF_CREATE_MACRO,
        WF_CREATE_KB,
        WF_CREATE_TICKET,
        WF_CREATE_PRIORITY,
        WF_CREATE_STATUS,
        WF_CREATE_CUSTOMER,
    ):
        return "CREATE"
    if wf == WF_MANAGE_KB_CATEGORY:
        return "KB"
    if st in ("members", "members_names"):
        return "UPDATE"
    return "CREATE"
