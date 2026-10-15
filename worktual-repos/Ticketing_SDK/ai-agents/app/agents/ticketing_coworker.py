"""Native supervisor + specialist agents (LLM-owned decisions)."""

from __future__ import annotations

import json
import hashlib
import random
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from app.contracts.errors import LLMEmptyResponse
from app.contracts import ToolDefinition
from app.contracts.execution import DomainInstruction, RunBudgets, RunRequest
from app.llm import get_llm
from app.mcp.catalog import (
    ROUTE_TO_AGENT,
    catalog_by_name,
    delegate_to_executor_tool,
    route_to_domain_tool,
    tools_for_specialist,
)
from app.memory.session import SharedMemory
from app.prompts.builder import (
    SPECIALIST_PROMPT_BUILDERS,
    build_general_prompt,
    build_supervisor_prompt,
    load_agent_definition,
    open_ui_item_prompt_block,
)
from app.runtime.budgets import BudgetTracker
from app.runtime.tool_loop import looks_like_unverified_write_claim, run_tool_loop
from app.tools.express_client import ToolActor, resolve_portal_customer_id
from app.workflow_schemas import (
    GUIDED_CREATE_WRITE_TOOLS,
    GUIDED_UPDATE_WRITE_TOOLS,
    apply_guided_ready,
    armed_write_tools_from_state,
    compute_guided_ready,
    email_looks_valid,
    first_open_guided_slot,
    ground_fields_in_utterance,
    merge_skipped_fields,
    missing_fields,
    phone_looks_valid,
    schema_for_workflow,
    slot_compatible,
    snap_guided_incoming,
    task_definition_for,
    turn_start_draft_key,
    workflow_id_for_draft,
)


# Local (non-Express) draft / UI tools — update SharedMemory + ui_actions.
_DRAFT_TOOL_SPEC: dict[str, tuple[str, str, str | None]] = {
    # tool_name → (durable_key, workflow_id, navigate_view)
    "patch_ticket_draft": ("ticket_draft", "create_ticket", "create-ticket"),
    "patch_team_draft": ("team_draft", "create_team", "agent-queues"),
    "patch_kb_draft": ("kb_draft", "create_kb", "kb"),
    "patch_macro_draft": ("macro_draft", "create_macro", "macros"),
    "patch_customer_draft": ("customer_draft", "create_customer", "customers"),
    "patch_priority_draft": ("priority_draft", "create_priority", "priorities"),
    "patch_status_draft": ("status_draft", "create_status", "priorities"),
    "patch_escalate_draft": ("escalate_draft", "escalate", None),
    "patch_reassign_draft": ("reassign_draft", "reassign_ticket", None),
}

_LOCAL_TOOL_NAMES = frozenset(
    {
        "navigate",
        "open_customer_import",
        "return_to_super",
        "refuse_capability",
        *_DRAFT_TOOL_SPEC.keys(),
    }
)
_RETURN_TO_SUPER = ToolDefinition(
    name="return_to_super",
    description=(
        "Park the active task and return a different or side-quest request to "
        "the Super Agent. Use only when this utterance is a different "
        "capability than the selected Skill. Never park for a field answer, "
        "draft-or-publish choice, or write confirmation on the live draft."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "reason": {"type": "string"},
            "action": {"type": "string", "enum": ["park", "cancel"]},
        },
        "required": ["action"],
    },
    kind="route",
    risk="low",
)
_CONTINUE_ACTIVE_TASK = ToolDefinition(
    name="continue_active_task",
    description=(
        "Keep the live TaskState pin. Use only when this utterance continues "
        "the same Skill (field answer, correction, confirm of this Skill's "
        "write, or same-capability follow-up). An unsolved self-service walk "
        "on intake-self-service-deflection stays here so the Executor can ask "
        "whether to file. A problem they may solve "
        "themselves (no file-ticket ask) is route_to_domain so Domain can "
        "search_kb first — not continue ticket-create, even if awaiting=issue. Do not use when they "
        "update/rename/delete an existing row, switch create vs update vs "
        "delete, confirm a remove while pinned on a read/list Skill, or start "
        "a different module."
    ),
    input_schema={"type": "object", "properties": {}, "required": []},
    kind="route",
    risk="low",
)
_SUPER_DOMAIN_OWNERSHIP = (
    " Team/macro/KB/priority/status CRUD, and customer list or ticket history, "
    "→ catalog_administration_domain. Add, import, or edit a customer contact "
    "record is refuse_capability, not a catalog route. "
    "Every problem / enquiry / how-to (any wording, no file-ticket ask) "
    "→ intake_deflection_domain, Domain pins intake-self-service-deflection "
    "and search_kb first — even if ticket-create is live. Create only after "
    "they ask or agree to file. An unsolved walk is still deflection — "
    "Executor asks whether to file; Super does not pin create on that turn. "
    "Never refuse those as unsupported_product. Super does not invent those steps. "
    "File a new ticket (intake collect / verify) → intake_deflection_domain. "
    "A focused ticket, tickets page, or last_entity ticket does not change that: "
    "new-file is still intake. Adding a note on an existing ticket is not filing. "
    "Close, resolve, or reopen an existing ticket (including a portal customer "
    "with no ticket number yet) → resolution_lifecycle_domain / ticket-resolve-reopen. "
    "Never refuse that for a signed-in customer. Never send it to create-ticket. "
    "Reassign, change assignee or resolver, escalate, list or open tickets, "
    "or add a note on an existing ticket → resolution_lifecycle_domain "
    "(ticket-reassign for people moves, ticket-note-add for notes — "
    "never ticket-update, never catalog). Never send catalog creates or new-ticket "
    "filing to resolution."
)
_REFUSE_CAPABILITY = ToolDefinition(
    name="refuse_capability",
    description=(
        "Return a typed capability refusal when the request is unsupported, "
        "forbidden, missing trusted context, or temporarily unavailable. "
        "Do not refuse an enquiry, how-to, clarification, order/shipping "
        "help, or own-account sign-in / access recovery — "
        "route_to_domain intake_deflection_domain instead. "
        "message is the full user-facing reply: a polite, human paragraph "
        "(a few sentences). Explain the limit in everyday words and fold any "
        "next step into that paragraph. Leave alternatives empty — never a "
        "labeled list, never 'Alternatives:', never CDP/360/Skill/Domain/"
        "directory jargon. Do not invent business data or claim a mutation."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "enum": [
                    "unsupported_product",
                    "unsupported_operation",
                    "forbidden",
                    "missing_context",
                    "approval_required",
                    "temporarily_unavailable",
                ],
            },
            "message": {"type": "string"},
            "alternatives": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["code", "message"],
    },
    kind="route",
    risk="low",
)

# Portal/staff-customer Super must not use forbidden — that model habit
# refuses close/reopen even when RBAC allows ticket-resolve-reopen.
_REFUSE_CAPABILITY_CUSTOMER_SUPER = ToolDefinition(
    name="refuse_capability",
    description=(
        "Refuse only when the ask is outside Ticketing (billing, HR, other "
        "products) or context is missing. Do not refuse close/reopen, enquiry, "
        "how-to, or own-account sign-in / access recovery — "
        "route_to_domain intake_deflection_domain (or resolution for "
        "close/reopen). "
        "message is the full user-facing reply. Leave alternatives empty."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "code": {
                "type": "string",
                "enum": [
                    "unsupported_product",
                    "missing_context",
                    "temporarily_unavailable",
                ],
            },
            "message": {"type": "string"},
            "alternatives": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["code", "message"],
    },
    kind="route",
    risk="low",
)

_SUPER_CUSTOMER_REFUSE_RETRY = (
    "This signed-in role CAN close and reopen tickets they own. "
    "Re-read the latest user utterance and the conversation. "
    "If they mean close, resolve, or reopen an existing ticket, call "
    "route_to_domain with domain_id=resolution_lifecycle_domain and put "
    "their ask in query (ticket-resolve-reopen). Do not refuse. "
    "If they want a new ticket filed, route intake_deflection_domain. "
    "Call refuse_capability only for an ask outside Ticketing."
)


def _customer_can_self_serve_lifecycle(role: str | None) -> bool:
    from app.rbac import ops_role, role_can_perform_skill

    r = ops_role(role)
    return r in {"customer", "portal_customer"} and role_can_perform_skill(
        r, "ticket-resolve-reopen"
    )


def _super_refuse_tool_for_role(role: str | None) -> ToolDefinition:
    if _customer_can_self_serve_lifecycle(role):
        return _REFUSE_CAPABILITY_CUSTOMER_SUPER
    return _REFUSE_CAPABILITY


def _super_should_retry_customer_refuse(
    role: str | None, refuse_args: dict[str, Any] | None
) -> bool:
    if not _customer_can_self_serve_lifecycle(role):
        return False
    if not isinstance(refuse_args, dict):
        return False
    code = str(refuse_args.get("code") or "").strip().lower()
    if code == "unsupported_product":
        return False
    return True


def _avoided_super_domains(memory: SharedMemory | None) -> frozenset[str]:
    if memory is None:
        return frozenset()
    avoid = str(memory.durable.get("_super_avoid_domain") or "").strip()
    return frozenset({avoid} if avoid else ())


def _super_route_to_domain_tool(memory: SharedMemory | None = None) -> dict[str, Any]:
    """route_to_domain schema for this Super hop — bounce-avoided Domain omitted."""
    return route_to_domain_tool(
        exclude_domains=_avoided_super_domains(memory)
    ).to_openai_tool()


def _super_has_prior_assistant(memory: SharedMemory) -> bool:
    for row in memory.messages or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "") != "assistant":
            continue
        if str(row.get("content") or "").strip():
            return True
    for row in memory.durable.get("recent_history") or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "") not in {"assistant", "ai"}:
            continue
        if str(row.get("text") or row.get("content") or "").strip():
            return True
    return False


_CATALOG_KIND_RE = re.compile(r"\b(priorit(?:y|ies)|status(?:es)?)\b", re.I)
_DELETE_RE = re.compile(r"\b(delete|remove|drop|destroy)\b", re.I)
_UPDATE_CATALOG_RE = re.compile(
    r"\b(update|change|rename|edit|modify|disable|enable|toggle)\b", re.I
)
_TICKET_ID_RE = re.compile(
    r"(?:#\d{2,}|ticket\s+#?\d+|tkt[-\s]?\d+|\bticket\s+(?:number|no\.?|#)\s*\d+)",
    re.I,
)
_CATALOG_SIGNAL_RE = re.compile(
    r"\b(catalog|system\s+setting|settings?|priorities\s+page|statuses\s+page|"
    r"org(?:anization)?\s+(?:priority|status))\b",
    re.I,
)

_ADMIN_CATALOG_MUTATE_TOOLS = frozenset(
    {
        "list_priorities",
        "list_statuses",
        "patch_priority_draft",
        "patch_status_draft",
        "delete_priority",
        "delete_status",
        "update_priority",
        "update_status",
    }
)


def _last_query_dict(memory: SharedMemory) -> dict[str, Any]:
    lq = memory.durable.get("last_query")
    return dict(lq) if isinstance(lq, dict) else {}


def _set_last_query(memory: SharedMemory, patch: dict[str, Any]) -> None:
    lq = _last_query_dict(memory)
    lq.update(patch)
    memory.durable["last_query"] = lq


def _clear_pending_clarify(memory: SharedMemory) -> None:
    lq = _last_query_dict(memory)
    if lq.pop("pending_clarify", None) is not None:
        memory.durable["last_query"] = lq


def _query_mentions_ticket_id(query: str) -> bool:
    return bool(_TICKET_ID_RE.search(str(query or "")))


def _query_is_catalog_priority_status_op(query: str) -> bool:
    q = str(query or "")
    if not _CATALOG_KIND_RE.search(q):
        return False
    return bool(_DELETE_RE.search(q) or _UPDATE_CATALOG_RE.search(q))


def _catalog_kind_from_query(query: str) -> str:
    q = str(query or "")
    if re.search(r"\bstatus(?:es)?\b", q, re.I):
        return "status"
    return "priority"


def _open_ticket_makes_priority_ambiguous(memory: SharedMemory) -> bool:
    ent = memory.durable.get("last_entity")
    if not isinstance(ent, dict):
        return False
    return str(ent.get("type") or "").strip().lower() in {"ticket", "case"}


def _supervisor_routing_payload(
    *,
    agent_name: str,
    query: str,
    reason: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "routing": True,
        "agent_name": agent_name,
        "query": query,
    }
    if reason:
        payload["reason"] = reason
    return payload


def _supervisor_resolve_pending_clarify(
    memory: SharedMemory,
    query: str,
) -> dict[str, Any] | None:
    """After one catalog-vs-ticket clarify, the next user turn routes — never re-ask."""
    lq = _last_query_dict(memory)
    pending = lq.get("pending_clarify")
    if not isinstance(pending, dict):
        return None
    agent = str(pending.get("resolve_agent") or "admin").strip().lower() or "admin"
    original = str(pending.get("original_query") or "").strip()
    merged = (
        f"{original} — {query}".strip(" —")
        if original and original.strip().lower() != str(query or "").strip().lower()
        else str(query or "")
    )
    memory.add_message("user", query)
    _clear_pending_clarify(memory)
    if _DELETE_RE.search(merged):
        _set_last_query(
            memory,
            {
                "catalog_op": "delete_pick",
                "catalog_kind": _catalog_kind_from_query(merged),
            },
        )
    return {
        "response_type": "routing_response",
        "route_args": {"agent_name": agent, "query": merged},
        "query": merged,
        "assistant_text": None,
        "agent": "ticketing_coworker",
    }


def _supervisor_default_catalog_route(
    memory: SharedMemory,
    query: str,
) -> dict[str, Any] | None:
    """Bare delete/update priority/status without ticket id → admin (catalog default)."""
    if not _query_is_catalog_priority_status_op(query):
        return None
    if _query_mentions_ticket_id(query):
        return None
    lq = _last_query_dict(memory)
    if isinstance(lq.get("pending_clarify"), dict):
        return None
    if (
        _open_ticket_makes_priority_ambiguous(memory)
        and not _CATALOG_SIGNAL_RE.search(query)
    ):
        return None
    memory.add_message("user", query)
    patch: dict[str, Any] = {"catalog_kind": _catalog_kind_from_query(query)}
    if _DELETE_RE.search(query):
        patch["catalog_op"] = "delete_pick"
    else:
        patch["catalog_op"] = "catalog_mutate"
    _set_last_query(memory, patch)
    return {
        "response_type": "routing_response",
        "route_args": {"agent_name": "admin", "query": query},
        "query": query,
        "assistant_text": None,
        "agent": "ticketing_coworker",
    }


def _maybe_stamp_catalog_delete_op(memory: SharedMemory, query: str) -> None:
    if not _query_is_catalog_priority_status_op(query) or not _DELETE_RE.search(query):
        return
    _set_last_query(
        memory,
        {
            "catalog_op": "delete_pick",
            "catalog_kind": _catalog_kind_from_query(query),
        },
    )


def _admin_catalog_mutate_extra_tools(
    memory: SharedMemory,
    query: str,
    agent_name: str,
) -> frozenset[str]:
    if str(agent_name or "").strip().lower() != "admin":
        return frozenset()
    lq = _last_query_dict(memory)
    if lq.get("catalog_op") in {"delete_pick", "catalog_mutate"}:
        return _ADMIN_CATALOG_MUTATE_TOOLS
    if _query_is_catalog_priority_status_op(query):
        return _ADMIN_CATALOG_MUTATE_TOOLS
    for key, kind in (("priority_draft", "priority"), ("status_draft", "status")):
        blob = memory.durable.get(key)
        if not isinstance(blob, dict):
            continue
        if str(blob.get("awaiting") or "").strip().lower() == "delete_confirm":
            list_tool = "list_priorities" if kind == "priority" else "list_statuses"
            patch_tool = f"patch_{kind}_draft"
            return frozenset(
                {
                    f"delete_{kind}",
                    list_tool,
                    patch_tool,
                    f"update_{kind}",
                }
            )
    return frozenset()


def _catalog_list_rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    payload = result.get("payload")
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = (
            payload.get("data")
            or payload.get("items")
            or payload.get("rows")
            or payload.get("priorities")
            or payload.get("statuses")
            or []
        )
        if not rows and (
            payload.get("id") or payload.get("displayName") or payload.get("name")
        ):
            rows = [payload]
    out: list[dict[str, Any]] = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict):
            out.append(row)
    return out


def _text_mentions_catalog_label(text: str, label: str) -> bool:
    """True when a known DB label appears as its own token in text."""
    hay = "".join(ch.lower() if ch.isalnum() else " " for ch in str(text or ""))
    needle = "".join(ch.lower() if ch.isalnum() else " " for ch in str(label or ""))
    token = " ".join(needle.split())
    if not token:
        return False
    return f" {token} " in f" {hay} "


def _catalog_list_option_rows(last_query: dict[str, Any] | None) -> list[dict[str, Any]]:
    from app.tools.catalog_tools import catalog_row_id_usable

    lq = last_query if isinstance(last_query, dict) else {}
    options = lq.get("catalog_list_options")
    if not isinstance(options, list) or not options:
        options = lq.get("catalog_pick_options")
    out: list[dict[str, Any]] = []
    for item in options if isinstance(options, list) else []:
        if not isinstance(item, dict):
            continue
        rid = catalog_row_id_usable(item.get("id"))
        name = str(item.get("displayName") or item.get("name") or "").strip()
        if not rid or not name:
            continue
        row: dict[str, Any] = {"id": rid, "displayName": name}
        hours = item.get("resolutionHours")
        if hours is None:
            hours = item.get("resolution_hours")
        if hours is not None and str(hours).strip() != "":
            row["resolutionHours"] = hours
        out.append(row)
    return out


def _resolve_catalog_pick_id(last_query: dict[str, Any], label: str) -> str:
    want = str(label or "").strip().lower()
    if not want:
        return ""
    for item in _catalog_list_option_rows(last_query):
        name = str(item.get("displayName") or "").strip().lower()
        if name == want:
            return str(item.get("id") or "").strip()
    return ""


def _listed_catalog_ids(last_query: dict[str, Any] | None) -> set[str]:
    return {str(row.get("id") or "") for row in _catalog_list_option_rows(last_query)}


def _fill_hours_from_listed(
    out: dict[str, Any],
    listed: list[dict[str, Any]],
    row_id: str,
    *,
    kind: str,
) -> None:
    if kind != "priority":
        return
    if out.get("resolutionHours") not in (None, "") or out.get("resolution_hours") not in (
        None,
        "",
    ):
        return
    for row in listed:
        if str(row.get("id") or "") == str(row_id):
            hours = row.get("resolutionHours")
            if hours is not None:
                out["resolutionHours"] = hours
            return


def _resolve_listed_catalog_id(
    memory: SharedMemory,
    last_query: dict[str, Any],
    *,
    extra_names: list[str],
    exclude_names: set[str],
) -> str:
    from app.tools.catalog_tools import catalog_row_id_usable

    listed = _catalog_list_option_rows(last_query)
    if not listed:
        return ""
    exclude = {str(n or "").strip().lower() for n in exclude_names if str(n or "").strip()}
    for name in extra_names:
        found = catalog_row_id_usable(_resolve_catalog_pick_id(last_query, name))
        if found:
            return found
    utterances = list(_recent_user_utterances(memory))
    hits: list[str] = []
    for row in listed:
        label = str(row.get("displayName") or "").strip()
        if label.lower() in exclude:
            continue
        if any(_text_mentions_catalog_label(text, label) for text in utterances):
            rid = str(row.get("id") or "")
            if rid and rid not in hits:
                hits.append(rid)
    if len(hits) == 1:
        return hits[0]
    return ""


_UPDATE_CATALOG_SKILLS = frozenset({"priority-update", "status-update"})
_UPDATE_CATALOG_TASKS = frozenset({"priority.update", "status.update"})


def _catalog_update_task_active(memory: SharedMemory) -> bool:
    """True when the live Harness pin is a catalog rename/hours update."""
    state = memory.current_task_state()
    if state is None:
        return False
    skill = str(state.skill_name or "").strip().lower()
    task = str(state.task_id or "").strip().lower()
    return skill in _UPDATE_CATALOG_SKILLS or task in _UPDATE_CATALOG_TASKS


def _ground_catalog_update_target(
    memory: SharedMemory,
    *,
    kind: str,
    row_id: str,
    name: str,
    hours: Any = None,
) -> None:
    """Ground an update on last_entity + TaskState — never create/delete draft id."""
    id_field = "priority_id" if kind == "priority" else "status_id"
    draft_key = "priority_draft" if kind == "priority" else "status_draft"
    memory.durable["last_entity"] = {
        "type": kind,
        "id": row_id,
        "name": name,
    }
    state = memory.current_task_state()
    if state is not None:
        collected = dict(state.collected)
        collected[id_field] = row_id
        collected["id"] = row_id
        if name:
            collected["currentName"] = name
        if hours is not None:
            collected["resolutionHours"] = hours
        memory.set_task_state(state.model_copy(update={"collected": collected}))
    blob = memory.durable.get(draft_key)
    if not isinstance(blob, dict):
        return
    cleaned = dict(blob)
    cleaned.pop("id", None)
    if name:
        cleaned["currentName"] = name
    if hours is not None:
        cleaned["resolutionHours"] = hours
    if str(cleaned.get("awaiting") or "").lower() == "delete_confirm":
        cleaned["awaiting"] = "confirm"
        cleaned["step"] = "confirm"
    memory.durable[draft_key] = cleaned


def _maybe_bind_listed_catalog_target(
    memory: SharedMemory,
    query: str,
    skill_name: str | None,
) -> None:
    """Pin the listed DB row the user named so writes do not use sortOrder."""
    skill = str(skill_name or "").strip().lower()
    if skill == "priority-update":
        kind = "priority"
    elif skill == "status-update":
        kind = "status"
    else:
        return
    lq = _last_query_dict(memory)
    listed = _catalog_list_option_rows(lq)
    if not listed:
        return
    texts = [query, *_recent_user_utterances(memory)]
    hits: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in listed:
        label = str(row.get("displayName") or "").strip()
        rid = str(row.get("id") or "")
        if not rid or rid in seen:
            continue
        if any(_text_mentions_catalog_label(text, label) for text in texts):
            hits.append(row)
            seen.add(rid)
    if len(hits) != 1:
        return
    row = hits[0]
    _ground_catalog_update_target(
        memory,
        kind=kind,
        row_id=str(row["id"]),
        name=str(row["displayName"]),
        hours=row.get("resolutionHours"),
    )
    # Update is not the create/delete guided flow — keep the catalog table visible.
    if str(memory.durable.get("current_workflow") or "").strip().lower() in {
        "create_priority",
        "create_status",
    }:
        memory.durable.pop("current_workflow", None)
        memory.durable.pop("pending_ask", None)


def _stash_catalog_pick_from_list(
    memory: SharedMemory,
    tool_name: str,
    result: dict[str, Any],
) -> None:
    if tool_name not in {"list_priorities", "list_statuses", "list_queues"}:
        return
    if not isinstance(result, dict) or not result.get("success"):
        return
    from app.tools.catalog_tools import catalog_row_id_usable

    pick: list[dict[str, Any]] = []
    for row in _catalog_list_rows(result):
        rid = catalog_row_id_usable(row.get("id") or row.get("queueId"))
        name = str(
            row.get("displayName")
            or row.get("queueName")
            or row.get("name")
            or row.get("label")
            or ""
        ).strip()
        if not rid or not name:
            continue
        entry: dict[str, Any] = {"id": rid, "displayName": name}
        hours = row.get("resolutionHours")
        if hours is None:
            hours = row.get("resolution_hours")
        if hours is not None and str(hours).strip() != "":
            entry["resolutionHours"] = hours
        pick.append(entry)
    if not pick:
        return
    if tool_name == "list_queues":
        _set_last_query(memory, {"queue_list_options": pick})
        return
    kind = "priority" if tool_name == "list_priorities" else "status"
    lq = _last_query_dict(memory)
    pri = memory.durable.get("priority_draft")
    st = memory.durable.get("status_draft")
    delete_flow = lq.get("catalog_op") == "delete_pick" or (
        isinstance(pri, dict)
        and str(pri.get("awaiting") or "").strip().lower() == "delete_confirm"
    ) or (
        isinstance(st, dict)
        and str(st.get("awaiting") or "").strip().lower() == "delete_confirm"
    )
    patch: dict[str, Any] = {
        "catalog_kind": kind,
        "catalog_list_options": pick,
    }
    if delete_flow:
        patch["catalog_op"] = "delete_pick"
        patch["catalog_pick_options"] = pick
    _set_last_query(memory, patch)


def _memory_armed_state(memory: SharedMemory, context: dict[str, Any]) -> dict[str, Any]:
    """Project SharedMemory into the shape armed-write helpers expect."""
    request: RunRequest = context["request"]
    blob = dict(memory.durable)
    blob["organization_id"] = memory.organization_id
    blob["user_id"] = request.actor.user_id
    blob["user_role"] = request.actor.user_role
    blob["user_name"] = request.actor.user_name
    blob["page"] = context.get("page")
    blob["chat_module"] = context.get("module")
    blob["chat_surface"] = context.get("surface")
    return blob


def _native_workflow_decision(
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    """LLM workflow JSON at armed confirm only — not regex; native has no graph NLU."""
    state = _memory_armed_state(memory, context)
    if not armed_write_tools_from_state(state):
        return {}
    try:
        from app.agents.workflow_nlu import decide_workflow_turn

        return decide_workflow_turn(state, query) or {}
    except Exception:  # noqa: BLE001
        return {}


def _portal_confirm_force_blocked_by_field_edit(
    workflow_decision: dict[str, Any] | None,
) -> bool:
    """Do not force portal file when NLU supplied a create-field correction."""
    fields = (
        workflow_decision.get("fields")
        if isinstance(workflow_decision, dict)
        and isinstance(workflow_decision.get("fields"), dict)
        else {}
    )
    return any(
        str(fields.get(key) or "").strip()
        for key in (
            "issue",
            "customerName",
            "contact",
            "customerEmail",
            "customerPhone",
        )
    )


def _should_force_native_armed_write(
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
    *,
    workflow_decision: dict[str, Any] | None,
) -> bool:
    """Force armed write from NLU affirm — CONFIRM/CONTINUE/RESUME when armed.

    Same for every guided module (ticket/team/kb/macro/customer/…). No phrase lists
    as the meaning engine; informal save/yes only fills empty NLU via the existing
    safety gate when a write is already armed at confirm.
    """
    from app.agents.base import _should_force_armed_write
    from app.workflow_schemas import armed_write_tools_from_state

    decision = dict(workflow_decision) if isinstance(workflow_decision, dict) else {}
    action = str(decision.get("action") or "").strip().upper()
    # One-shot: resume unparked a complete confirm draft this turn.
    force_once = bool(memory.durable.get("force_armed_write"))
    if force_once:
        decision["action"] = "CONFIRM_WORKFLOW"
        action = "CONFIRM_WORKFLOW"
    state = _memory_armed_state(memory, context)
    state["workflow_decision"] = decision
    if force_once:
        state["force_armed_write"] = True
    armed = armed_write_tools_from_state(state)
    if action not in {"CONTINUE_WORKFLOW", "CONFIRM_WORKFLOW", "RESUME_WORKFLOW"}:
        return False
    if action in {"SIDE_QUEST", "NEW_TASK", "CANCEL_WORKFLOW"}:
        return False
    if action == "RESUME_WORKFLOW" and not armed:
        return False
    return _should_force_armed_write(state, query)


def _customer_not_found_message(message: str | None) -> bool:
    err = str(message or "").lower()
    return (
        "customer not found" in err
        or "add the customer" in err
        or ("cdp" in err and "not found" in err)
    )


def _flag_ticket_customer_not_found(memory: SharedMemory) -> None:
    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    draft["customer_not_found"] = True
    if not str(draft.get("awaiting") or "").strip():
        draft["awaiting"] = "confirm"
    memory.durable["ticket_draft"] = draft
    memory.durable["current_workflow"] = (
        memory.durable.get("current_workflow") or "create_ticket"
    )


def _customer_draft_from_ticket(ticket: dict[str, Any]) -> dict[str, Any]:
    """Seed add-customer slots from a (failed) create-ticket draft."""
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        customer_write_ready,
        missing_fields,
    )

    name = str(ticket.get("customerName") or ticket.get("name") or "").strip()
    email = str(ticket.get("customerEmail") or ticket.get("email") or "").strip()
    phone = str(ticket.get("customerPhone") or ticket.get("phone") or "").strip()
    draft: dict[str, Any] = {}
    if name:
        draft["name"] = name
    if email and email_looks_valid(email):
        draft["email"] = email
    if phone and phone_looks_valid(phone):
        draft["phone"] = phone
    if not draft:
        draft["awaiting"] = "name"
        draft["step"] = "name"
        return draft
    # Nested CDP miss under create-ticket: tool write needs name+(email|phone),
    # not the standalone add-customer phone slot.
    if customer_write_ready(draft):
        draft["awaiting"] = "confirm"
        draft["step"] = "confirm"
        return draft
    miss = missing_fields("create_customer", draft)
    awaiting = (
        awaiting_hint_from_missing("create_customer", draft) if miss else "confirm"
    )
    draft["awaiting"] = awaiting or "confirm"
    draft["step"] = draft["awaiting"]
    return draft


def _prepare_add_customer_from_ticket(memory: SharedMemory) -> dict[str, Any]:
    """Park ticket (canonical flow=ticket), seed customer_draft, switch workflow."""
    from app.memory_contract import normalize_parked

    ticket = memory.durable.get("ticket_draft")
    ticket = dict(ticket) if isinstance(ticket, dict) else {}
    ticket.pop("customer_not_found", None)
    if not str(ticket.get("awaiting") or "").strip():
        ticket["awaiting"] = "confirm"

    parked = normalize_parked(memory.durable.get("parked_drafts"))
    parked = [
        p
        for p in parked
        if str(p.get("flow") or "").strip().lower() not in {"ticket", "create_ticket"}
    ]
    if any(
        str(v).strip()
        for k, v in ticket.items()
        if k not in {"awaiting", "step", "customer_not_found"}
        and not isinstance(v, (dict, list))
    ):
        parked.append({"flow": "ticket", "draft": ticket})
    memory.durable["parked_drafts"] = parked
    memory.durable.pop("ticket_draft", None)

    existing = memory.durable.get("customer_draft")
    if not (
        isinstance(existing, dict)
        and (
            str(existing.get("name") or "").strip()
            or str(existing.get("email") or "").strip()
        )
    ):
        memory.durable["customer_draft"] = _customer_draft_from_ticket(ticket)
    memory.durable["current_workflow"] = "create_customer"
    memory.durable["pending_ask"] = str(
        (memory.durable.get("customer_draft") or {}).get("awaiting") or "name"
    )
    seed = memory.durable.get("customer_draft") or {}
    cname = str(seed.get("name") or ticket.get("customerName") or "").strip()
    return {
        "name": cname,
        "awaiting": str(seed.get("awaiting") or "name"),
    }


def _harness_park_ticket_create_for_catalog_customer(
    memory: SharedMemory,
    args: dict[str, Any],
    *,
    channel: str | None = None,
    mcp_parent: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Domain ownership: ticket.create CDP miss → park intake, start catalog customer.create.

    Reuses name/email/phone already collected on the ticket draft. Returns MCP bind
    info so create_customer runs under customer_directory_crud_executor.
    """
    from app.mcp.authorization import issue_mcp_token
    from app.skills.catalog import tools_for_skill
    from app.workflow_schemas import customer_write_ready, new_harness_task_state

    customer_task = task_definition_for("customer.create")
    if not customer_task:
        raise ValueError("customer.create task is not registered")

    # Merge tool args into ticket_draft before parking so contact is not lost.
    ticket = memory.durable.get("ticket_draft")
    ticket = dict(ticket) if isinstance(ticket, dict) else {}
    raw = dict(args) if isinstance(args, dict) else {}
    if str(raw.get("name") or "").strip() and not str(ticket.get("customerName") or "").strip():
        ticket["customerName"] = str(raw["name"]).strip()
    if str(raw.get("email") or "").strip() and not str(
        ticket.get("customerEmail") or ""
    ).strip():
        ticket["customerEmail"] = str(raw["email"]).strip()
    if str(raw.get("phone") or "").strip() and not str(
        ticket.get("customerPhone") or ""
    ).strip():
        ticket["customerPhone"] = str(raw["phone"]).strip()
    ticket["customer_not_found"] = True
    memory.durable["ticket_draft"] = ticket

    state = memory.current_task_state()
    if state and str(state.task_id or "") == "ticket.create":
        parked = [
            row
            for row in list(memory.durable.get("parked_tasks") or [])
            if isinstance(row, dict) and str(row.get("task_id") or "") != "ticket.create"
        ]
        parked.append(
            state.model_copy(update={"status": "parked"}).model_dump(mode="json")
        )
        memory.durable["parked_tasks"] = parked[-10:]

    _prepare_add_customer_from_ticket(memory)
    seed = dict(memory.durable.get("customer_draft") or {})
    collected: dict[str, Any] = {}
    for key in ("name", "email", "phone", "accountName", "account_name"):
        val = str(seed.get(key) or raw.get(key) or "").strip()
        if val:
            collected[key if key != "account_name" else "accountName"] = val
    if customer_write_ready(collected):
        seed["awaiting"] = "confirm"
        seed["step"] = "confirm"
        memory.durable["customer_draft"] = {**seed, **collected}
        memory.durable["pending_ask"] = "confirm"

    memory.set_task_state(
        new_harness_task_state(
            customer_task.id,
            channel=channel,
            collected=collected,
            provenance={key: "ticket_cdp_miss" for key in collected},
        )
    )
    memory.durable["active_domain"] = customer_task.domain
    memory.durable["current_workflow"] = "create_customer"
    memory.durable["_catalog_customer_from_ticket"] = True

    parent = mcp_parent if isinstance(mcp_parent, dict) else {}
    token = issue_mcp_token(
        organization_id=str(parent.get("organization_id") or memory.organization_id or ""),
        actor_id=str(parent.get("actor_id") or memory.user_id or ""),
        role=str(parent.get("role") or ""),
        module="customers",
        surface="create",
        run_id=str(parent.get("run_id") or memory.request_id or "") or None,
        allowed_tools=sorted(
            tools_for_skill(customer_task.skill_name, customer_task.executor)
        ),
        agent_id=customer_task.executor,
        task_id=customer_task.id,
        skill_name=customer_task.skill_name,
        skill_version=customer_task.version,
        route_mode="executor",
    )
    return {
        "executor": customer_task.executor,
        "skill": customer_task.skill_name,
        "task_id": customer_task.id,
        "domain": customer_task.domain,
        "module": "customers",
        "surface": "create",
        "mcp_token": token,
        "collected": collected,
        "args": {**collected, "confirmed": True}
        if customer_write_ready(collected)
        else dict(collected),
    }


def _harness_resume_ticket_create_after_customer(
    memory: SharedMemory,
    *,
    channel: str | None = None,
) -> None:
    """After catalog customer.create succeeds, restore parked intake ticket.create."""
    from app.contracts.execution import TaskState
    from app.workflow_schemas import new_harness_task_state

    parked_rows = [
        row
        for row in list(memory.durable.get("parked_tasks") or [])
        if isinstance(row, dict)
    ]
    ticket_row: dict[str, Any] | None = None
    rest: list[dict[str, Any]] = []
    for row in parked_rows:
        if str(row.get("task_id") or "") == "ticket.create" and ticket_row is None:
            ticket_row = row
        else:
            rest.append(row)
    memory.durable["parked_tasks"] = rest

    # Finish catalog task before restoring intake.
    cur = memory.current_task_state()
    if cur and str(cur.task_id or "") == "customer.create":
        memory.set_task_state(
            cur.model_copy(update={"status": "completed", "mutation_attempted": True})
        )

    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    collected = {
        key: draft[key]
        for key in (
            "customerName",
            "customerEmail",
            "customerPhone",
            "customerId",
            "customerDirectoryStatus",
            "issue",
            "subject",
            "description",
        )
        if str(draft.get(key) or "").strip()
    }
    if ticket_row:
        try:
            restored = TaskState.model_validate(ticket_row)
            merged = dict(restored.collected or {})
            merged.update(collected)
            memory.set_task_state(
                restored.model_copy(
                    update={
                        "status": "collecting",
                        "collected": merged,
                        "mutation_attempted": False,
                    }
                )
            )
        except Exception:  # noqa: BLE001
            ticket_row = None
    if not ticket_row:
        task = task_definition_for("ticket.create")
        if task:
            memory.set_task_state(
                new_harness_task_state(
                    task.id,
                    channel=channel,
                    collected=collected,
                    provenance={key: "resume_after_customer" for key in collected},
                )
            )
    memory.durable["active_domain"] = "intake_deflection_domain"
    memory.durable["current_workflow"] = "create_ticket"
    memory.durable["offer_continue_ticket_after_customer"] = True
    memory.durable.pop("_catalog_customer_from_ticket", None)


def _clear_customer_collect_for_ticket_resume(memory: SharedMemory) -> None:
    """Drop add-customer collect so parked-ticket resume is not blocked."""
    memory.durable.pop("customer_draft", None)
    if (
        str(memory.durable.get("current_workflow") or "").strip().lower()
        == "create_customer"
    ):
        memory.durable.pop("current_workflow", None)


def _bind_customer_onto_ticket_memory(
    memory: SharedMemory,
    *,
    customer_id: str,
    name: str,
    email: str = "",
    phone: str = "",
) -> None:
    """Bind new/existing customer onto parked tickets and any active ticket_draft."""
    from app.memory_contract import apply_customer_row_to_parked_tickets

    cid = str(customer_id or "").strip()
    if not cid:
        return
    memory.durable["parked_drafts"] = apply_customer_row_to_parked_tickets(
        memory.durable.get("parked_drafts"),
        customer_id=cid,
        name=name,
        email=email,
        phone=phone,
    )
    ticket = memory.durable.get("ticket_draft")
    if isinstance(ticket, dict):
        ticket = dict(ticket)
        ticket["customerId"] = cid
        if name:
            ticket["customerName"] = name
        if email:
            ticket["customerEmail"] = email
        if phone:
            ticket["customerPhone"] = phone
        ticket.pop("customer_not_found", None)
        _mark_ticket_customer_verified(ticket)
        # Keep prior issue/subject/description — never wipe filled create fields.
        if not str(ticket.get("issue") or "").strip():
            for alt in ("description", "subject"):
                alt_v = str(ticket.get(alt) or "").strip()
                if alt_v:
                    ticket["issue"] = alt_v
                    break
        memory.durable["ticket_draft"] = ticket


def _mark_ticket_customer_verified(draft: dict[str, Any]) -> None:
    """Directory/CDP satisfied — customerId is authoritative for create/enrich gates."""
    if str(draft.get("customerId") or "").strip():
        draft["customerDirectoryStatus"] = "verified"
        draft.pop("customer_not_found", None)


def _restore_parked_ticket_after_customer(
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]] | None = None,
) -> bool:
    """Unpark create-ticket after add-customer so draft + RH panel stay in sync."""
    from app.memory_contract import normalize_parked
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        draft_complete,
        missing_fields,
    )

    parked = normalize_parked(memory.durable.get("parked_drafts"))
    ticket_item: dict[str, Any] | None = None
    rest: list[dict[str, Any]] = []
    for item in parked:
        flow = str(item.get("flow") or "").strip().lower()
        if flow in {"ticket", "create_ticket"} and ticket_item is None:
            ticket_item = item
        else:
            rest.append(item)

    if ticket_item is not None:
        draft = dict(ticket_item.get("draft") or {})
    else:
        active = memory.durable.get("ticket_draft")
        draft = dict(active) if isinstance(active, dict) else {}
        if not str(draft.get("customerName") or draft.get("issue") or "").strip():
            return False

    ent = memory.durable.get("last_entity")
    if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "customer":
        cid = str(ent.get("id") or draft.get("customerId") or "").strip()
        if cid:
            draft["customerId"] = cid
        if not str(draft.get("customerName") or "").strip() and str(
            ent.get("name") or ""
        ).strip():
            draft["customerName"] = str(ent.get("name")).strip()
        if not str(draft.get("customerEmail") or "").strip() and str(
            ent.get("email") or ""
        ).strip():
            draft["customerEmail"] = str(ent.get("email")).strip()
        if not str(draft.get("customerPhone") or "").strip() and str(
            ent.get("phone") or ""
        ).strip():
            draft["customerPhone"] = str(ent.get("phone")).strip()

    _normalize_ticket_contact(draft)
    _mark_ticket_customer_verified(draft)
    if not str(draft.get("issue") or "").strip():
        for alt in ("description", "subject"):
            alt_v = str(draft.get(alt) or "").strip()
            if alt_v:
                draft["issue"] = alt_v
                break

    miss = missing_fields("create_ticket", draft)
    if not miss and draft_complete("create_ticket", draft):
        draft["awaiting"] = "confirm"
        draft["step"] = "confirm"
    else:
        hint = awaiting_hint_from_missing("create_ticket", draft) or (
            miss[0] if miss else "issue"
        )
        draft["awaiting"] = hint
        draft["step"] = hint

    memory.durable["ticket_draft"] = draft
    if ticket_item is not None:
        memory.durable["parked_drafts"] = rest
    memory.durable["current_workflow"] = "create_ticket"
    memory.durable["pending_ask"] = str(draft.get("awaiting") or "")
    memory.durable.pop("pending_resume", None)
    last_q = memory.durable.get("last_query")
    if isinstance(last_q, dict):
        last_q = dict(last_q)
        last_q.pop("pending_resume", None)
        last_q["awaiting"] = str(draft.get("awaiting") or "")
        memory.durable["last_query"] = last_q

    if ui_actions is not None:
        if not any(
            isinstance(a, dict)
            and a.get("type") == "navigate"
            and a.get("view") == "create-ticket"
            for a in ui_actions
        ):
            ui_actions.append({"type": "navigate", "view": "create-ticket"})
        ui_actions[:] = [
            a
            for a in ui_actions
            if not (
                isinstance(a, dict)
                and str(a.get("type") or "") == "create_ticket"
                and not a.get("done")
            )
        ]
        ui_actions.append(
            {
                "type": "create_ticket",
                **draft,
                "step": draft.get("awaiting"),
                "awaiting": draft.get("awaiting"),
            }
        )
    return True


def _ensure_ticket_parked_before_customers(memory: SharedMemory) -> None:
    """Super Agent → customers must park create-ticket the same as tickets handoff."""
    ticket = memory.durable.get("ticket_draft")
    if not isinstance(ticket, dict):
        return
    has_create = bool(
        ticket.get("customer_not_found")
        or str(ticket.get("customerName") or "").strip()
        or str(ticket.get("issue") or ticket.get("subject") or ticket.get("description") or "").strip()
        or str(ticket.get("awaiting") or "").strip().lower()
        in {"confirm", "issue", "contact", "name", "customername"}
    )
    if not has_create:
        return
    _prepare_add_customer_from_ticket(memory)


def _arm_native_resume_after_customer(
    memory: SharedMemory,
    *,
    user_text: str = "",
    page: str | None = None,
    ui_actions: list[dict[str, Any]] | None = None,
) -> None:
    """After create_customer binds parked tickets, restore create-ticket draft."""
    from app.memory_contract import (
        maybe_offer_resume,
        normalize_parked,
        summarize_parked_item,
    )

    _clear_customer_collect_for_ticket_resume(memory)
    ent = memory.durable.get("last_entity")
    if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "customer":
        _bind_customer_onto_ticket_memory(
            memory,
            customer_id=str(ent.get("id") or ""),
            name=str(ent.get("name") or ""),
            email=str(ent.get("email") or ""),
            phone=str(ent.get("phone") or ""),
        )
    parked = normalize_parked(memory.durable.get("parked_drafts"))
    ticket = memory.durable.get("ticket_draft")
    if isinstance(ticket, dict) and (
        str(ticket.get("customerId") or ticket.get("customer_id") or "").strip()
        or str(ticket.get("customerName") or "").strip()
        or str(ticket.get("issue") or ticket.get("subject") or ticket.get("description") or "").strip()
    ):
        if not any(
            str(p.get("flow") or "").strip().lower() in {"ticket", "create_ticket"}
            for p in parked
        ):
            _prepare_add_customer_from_ticket(memory)
            _clear_customer_collect_for_ticket_resume(memory)
            parked = normalize_parked(memory.durable.get("parked_drafts"))
    if _restore_parked_ticket_after_customer(memory, ui_actions):
        memory.durable["_customer_resume_handled"] = True
        return
    if not parked:
        memory.durable.pop("pending_resume", None)
        return
    pending: dict[str, Any] | None = None
    offer = maybe_offer_resume(
        parked,
        user_text=user_text,
        page=page,
        completed_tool="create_customer",
    )
    if isinstance(offer, dict):
        pr = offer.get("pending_resume")
        if isinstance(pr, dict) and pr:
            pending = pr
        if offer.get("parked_drafts"):
            memory.durable["parked_drafts"] = offer["parked_drafts"]
    if not pending:
        # LLM offer text is optional; still arm durable resume metadata.
        from app.memory_contract import _subject_hint

        top = parked[-1]
        summary = summarize_parked_item(top)
        flow = str(summary.get("flow") or "")
        filled = (
            summary.get("filled_fields")
            if isinstance(summary.get("filled_fields"), dict)
            else {}
        )
        pending = {
            "flow": flow,
            "workflow_id": summary.get("workflow_id"),
            "missing_fields": summary.get("missing_fields") or [],
            "filled_fields": filled,
            "subject_hint": _subject_hint(filled, flow),
            "parked_count": len(parked),
            "other_parked_flows": [
                str(p.get("flow") or "")
                for p in parked[:-1]
                if str(p.get("flow") or "")
            ],
        }
    memory.durable["pending_resume"] = pending
    memory.durable["pending_ask"] = "resume_offer"
    last_q = memory.durable.get("last_query")
    last_q = dict(last_q) if isinstance(last_q, dict) else {}
    last_q["pending_resume"] = pending
    last_q["awaiting"] = "resume_offer"
    memory.durable["last_query"] = last_q


_FLOW_ALIASES: dict[str, frozenset[str]] = {
    "ticket": frozenset({"ticket", "create_ticket"}),
    "create_ticket": frozenset({"ticket", "create_ticket"}),
    "customer": frozenset({"customer", "create_customer"}),
    "create_customer": frozenset({"customer", "create_customer"}),
    "team": frozenset({"team", "create_team", "add_team_members", "add_members"}),
    "create_team": frozenset({"team", "create_team"}),
    "add_team_members": frozenset({"team", "create_team", "add_team_members", "add_members"}),
    "macro": frozenset({"macro", "create_macro"}),
    "create_macro": frozenset({"macro", "create_macro"}),
    "kb": frozenset({"kb", "create_kb"}),
    "create_kb": frozenset({"kb", "create_kb"}),
    "priority": frozenset({"priority", "create_priority"}),
    "create_priority": frozenset({"priority", "create_priority"}),
    "status": frozenset({"status", "create_status"}),
    "create_status": frozenset({"status", "create_status"}),
    "escalate": frozenset({"escalate"}),
    "reassign": frozenset({"reassign", "reassign_ticket"}),
    "reassign_ticket": frozenset({"reassign", "reassign_ticket"}),
}


def _flows_match(hint: str, flow: str, wid: str) -> bool:
    h = str(hint or "").strip().lower()
    if not h:
        return True
    aliases = _FLOW_ALIASES.get(h, frozenset({h}))
    return h in {flow, wid} or flow in aliases or wid in aliases


def _pop_parked_flow(
    parked: list[dict[str, Any]] | None,
    *,
    flow_hint: str = "",
) -> tuple[dict[str, Any] | None, list[dict[str, Any]], str]:
    """Remove a parked draft matching flow_hint (or newest guided create)."""
    from app.memory_contract import normalize_parked, workflow_id_for_parked_flow

    items = normalize_parked(parked)
    hint = str(flow_hint or "").strip().lower()
    guided = frozenset(_FLOW_ALIASES.keys())
    # Prefer explicit flow from pending_resume; else newest item.
    order = list(range(len(items) - 1, -1, -1))
    for i in order:
        flow = str(items[i].get("flow") or "").strip().lower()
        draft = items[i].get("draft") if isinstance(items[i].get("draft"), dict) else {}
        wid = str(workflow_id_for_parked_flow(flow, draft) or "").strip().lower()
        if hint and not _flows_match(hint, flow, wid):
            continue
        if not hint and flow not in guided and wid not in guided:
            continue
        out_draft = dict(draft)
        rest = items[:i] + items[i + 1 :]
        return out_draft, rest, flow or hint
    return None, items, hint


_PARKED_FLOW_TO_AGENT: dict[str, str] = {
    "ticket": "tickets",
    "create_ticket": "tickets",
    "customer": "customers",
    "create_customer": "customers",
    "team": "teams",
    "create_team": "teams",
    "macro": "macros",
    "create_macro": "macros",
    "kb": "kb",
    "create_kb": "kb",
    "priority": "admin",
    "create_priority": "admin",
    "status": "admin",
    "create_status": "admin",
    "escalate": "tickets",
    "reassign": "tickets",
}

# Active guided workflow → durable draft key + owning specialist (state routing).
_ACTIVE_WORKFLOW_DRAFT: dict[str, tuple[str, str]] = {
    "create_customer": ("customer_draft", "customers"),
    "create_ticket": ("ticket_draft", "tickets"),
    "create_team": ("team_draft", "teams"),
    "add_team_members": ("team_draft", "teams"),
    "create_kb": ("kb_draft", "kb"),
    "create_macro": ("macro_draft", "macros"),
    "create_priority": ("priority_draft", "admin"),
    "create_status": ("status_draft", "admin"),
    "escalate": ("escalate_draft", "tickets"),
    "reassign_ticket": ("reassign_draft", "tickets"),
}

_ACTIVE_WORKFLOW_TASK: dict[str, str] = {
    "create_customer": "customer.create",
    "create_ticket": "ticket.create",
    "create_team": "team.create",
    "add_team_members": "team.members.update",
    "create_kb": "knowledge.article.create",
    "create_macro": "macro.create",
    "create_priority": "priority.create",
    "create_status": "status.create",
    "escalate": "ticket.escalate",
    "reassign_ticket": "ticket.reassign",
}

# Harness task → durable draft + workflow schema (keeps Domain supplied_fields write-ready).
_GUIDED_TASK_DRAFT: dict[str, tuple[str, str, str | None]] = {
    "priority.create": ("priority_draft", "create_priority", "priority"),
    "status.create": ("status_draft", "create_status", "status"),
    "customer.create": ("customer_draft", "create_customer", None),
    "ticket.create": ("ticket_draft", "create_ticket", None),
    "macro.create": ("macro_draft", "create_macro", None),
    "knowledge.article.create": ("kb_draft", "create_kb", None),
    "team.create": ("team_draft", "create_team", None),
    "team.members.update": ("team_draft", "add_team_members", None),
    "ticket.escalate": ("escalate_draft", "escalate", None),
    "ticket.reassign": ("reassign_draft", "reassign_ticket", None),
}

# Update pins must not keep create-collect (name/hours) stuck without a catalog id.
_UPDATE_TO_CREATE_TASK: dict[str, str] = {
    "priority.update": "priority.create",
    "status.update": "status.create",
}
_CREATE_TO_UPDATE_TASK: dict[str, str] = {
    "priority.create": "priority.update",
    "status.create": "status.update",
}
_READ_TO_DELETE_TASK: dict[str, str] = {
    "priority.read": "priority.delete",
    "status.read": "status.delete",
}
_DELETE_TOOL_TO_TASK: dict[str, str] = {
    "delete_priority": "priority.delete",
    "delete_status": "status.delete",
}


def _catalog_kind_for_task(task_id: str | None) -> str:
    tid = str(task_id or "").strip().lower()
    if tid.startswith("status."):
        return "status"
    if tid.startswith("priority."):
        return "priority"
    return ""


def _existing_catalog_update_row(
    memory: SharedMemory, *, kind: str
) -> dict[str, Any] | None:
    """Listed or focused catalog row this conversation already named (Postgres)."""
    if kind not in {"priority", "status"}:
        return None
    from app.tools.catalog_tools import catalog_row_id_usable

    listed = _catalog_list_option_rows(_last_query_dict(memory))
    listed_by_id = {str(row.get("id") or ""): row for row in listed}
    ent = memory.durable.get("last_entity")
    ent = ent if isinstance(ent, dict) else {}
    draft_key = "priority_draft" if kind == "priority" else "status_draft"
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    extra_names = [
        str(ent.get("name") or "").strip(),
        str(
            draft.get("displayName")
            or draft.get("name")
            or draft.get("currentName")
            or ""
        ).strip(),
    ]
    rid = _resolve_listed_catalog_id(
        memory,
        _last_query_dict(memory),
        extra_names=[name for name in extra_names if name],
        exclude_names=set(),
    )
    if rid and rid in listed_by_id:
        return listed_by_id[rid]

    # Stale last_entity from a finished task is not enough. The conversation
    # must still name that focused row, or this turn's list must include it.
    if str(ent.get("type") or "").strip().lower() != kind:
        return None
    rid = catalog_row_id_usable(ent.get("id"))
    if not rid:
        return None
    name = str(ent.get("name") or ent.get("displayName") or "").strip()
    draft_labels = [
        str(
            draft.get("displayName")
            or draft.get("name")
            or draft.get("currentName")
            or ""
        ).strip()
    ]
    texts = [*_recent_user_utterances(memory), *[value for value in draft_labels if value]]
    named = bool(name) and any(
        _text_mentions_catalog_label(text, name) for text in texts if text
    )
    if not named and rid not in listed_by_id:
        return None
    row = listed_by_id.get(rid)
    if row:
        return row
    if not named:
        return None
    hours = ent.get("resolutionHours")
    if hours is None:
        hours = ent.get("resolution_hours")
    found: dict[str, Any] = {"id": rid, "displayName": name}
    if hours is not None and str(hours).strip() != "":
        found["resolutionHours"] = hours
    return found


def _catalog_target_id(collected: dict[str, Any] | None) -> str:
    from app.tools.catalog_tools import catalog_row_id_usable

    src = collected if isinstance(collected, dict) else {}
    for key in (
        "id",
        "priority_id",
        "priorityId",
        "status_id",
        "statusId",
    ):
        value = catalog_row_id_usable(src.get(key))
        if value:
            return value
    return ""


def _recent_user_utterances(memory: SharedMemory, *, limit: int = 8) -> list[str]:
    out: list[str] = []
    msgs = getattr(memory, "messages", None)
    rows = msgs if isinstance(msgs, list) and msgs else memory.durable.get("recent_history")
    if not isinstance(rows, list):
        return []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("role") or "").strip().lower() != "user":
            continue
        text = str(row.get("content") or row.get("text") or "").strip()
        if text:
            out.append(text)
    return out[-limit:]


def _remount_analytics_query_for_ontology(
    memory: SharedMemory,
    *,
    context: dict[str, Any],
    actor: Any,
    request: Any,
) -> str | None:
    """Remount analytics-query → analytics-root-cause when ontology is needed.

    Sticky how-many pins leave analytics.query collecting; a follow-up why ask
    would otherwise call ask_knowledge_graph under a Skill JWT that forbids it (MCP 403).
    """
    from app.mcp.authorization import issue_mcp_token
    from app.skills.catalog import tools_for_skill
    from app.workflow_schemas import new_harness_task_state, task_definition_for

    active = memory.current_task_state()
    if not active or str(active.task_id or "").strip() != "analytics.query":
        return None
    if str(active.skill_name or "").strip() != "analytics-query":
        return None
    task = task_definition_for("analytics.root.cause")
    if not task or not task.active:
        return None
    channel = str(
        getattr(request, "channel", None) or context.get("surface") or active.channel or ""
    ).strip() or None
    state = new_harness_task_state(
        task.id,
        channel=channel,
        collected=dict(active.collected or {}),
        provenance={
            **dict(active.provenance or {}),
            "_remount": "analytics_query_to_root_cause",
        },
    )
    memory.set_task_state(state)
    memory.durable["active_domain"] = task.domain
    memory.durable.pop("pending_ask", None)
    allowed = sorted(tools_for_skill(task.skill_name, task.executor))
    context["mcp_token"] = issue_mcp_token(
        organization_id=str(actor.organization_id or ""),
        actor_id=str(actor.user_id or ""),
        role=str(actor.user_role or ""),
        module=str(context.get("module") or "") or None,
        surface=str(context.get("surface") or "") or None,
        run_id=str(memory.request_id or "") or None,
        allowed_tools=allowed,
        agent_id=task.executor,
        task_id=task.id,
        skill_name=task.skill_name,
        skill_version=task.version,
        route_mode="executor",
    )
    try:
        from app.observability.turn_log import record_route

        record_route(
            task.domain,
            task.executor,
            "remount:analytics-root-cause",
        )
    except Exception:  # noqa: BLE001
        pass
    return task.skill_name


def _align_mispinned_catalog_create(
    memory: SharedMemory, query: str
) -> None:
    """Remount create when an update pin is actually mid create-collect.

    Happens when Domain wrongly selected priority-update / status-update, then
    the executor asked for a new label + SLA hours with no catalog id.
    """
    from app.workflow_schemas import (
        bind_awaiting_value,
        new_harness_task_state,
    )

    active = memory.current_task_state()
    if not active or active.status in {
        "completed",
        "cancelled",
        "refused",
        "failed",
    }:
        return
    create_task_id = _UPDATE_TO_CREATE_TASK.get(str(active.task_id or "").strip())
    if not create_task_id:
        return
    collected = active.collected if isinstance(active.collected, dict) else {}
    if _catalog_target_id(collected):
        return

    draft_key, workflow_id, kind = _GUIDED_TASK_DRAFT[create_task_id]
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    if _catalog_target_id(draft):
        return

    # Hours/rename of a listed or focused row is a real update — do not remount
    # create just because the draft is awaiting hours without an id yet.
    existing = _existing_catalog_update_row(memory, kind=str(kind or "priority"))
    if existing:
        _ground_catalog_update_target(
            memory,
            kind=str(kind or "priority"),
            row_id=str(existing["id"]),
            name=str(existing.get("displayName") or ""),
            hours=existing.get("resolutionHours"),
        )
        return

    awaiting = str(draft.get("awaiting") or "").strip().lower()
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    has_label = bool(
        str(draft.get("displayName") or draft.get("name") or "").strip()
    )
    create_shaped = wf == workflow_id or (
        awaiting in {"name", "hours", "confirm"}
        and (has_label or awaiting == "name")
    )

    # Recover conversational create-under-update: hours answer + prior short label.
    if not create_shaped and create_task_id == "priority.create":
        hours_bind = bind_awaiting_value("create_priority", "hours", query)
        hours = hours_bind.get("resolutionHours")
        if hours is not None:
            label = ""
            for prior in reversed(_recent_user_utterances(memory)):
                if prior.strip() == str(query or "").strip():
                    continue
                # Prefer single-token catalog labels (P1, Critical) over multi-word asks.
                if len(prior.split()) > 1:
                    continue
                name_bind = bind_awaiting_value("create_priority", "name", prior)
                candidate = str(name_bind.get("displayName") or "").strip()
                if candidate:
                    label = candidate
                    break
            if label:
                draft = {
                    "displayName": label,
                    "resolutionHours": hours,
                    "awaiting": "confirm",
                    "step": "confirm",
                    "kind": "priority",
                }
                create_shaped = True

    if not create_shaped:
        return

    task = task_definition_for(create_task_id)
    if not task or not task.active:
        return
    if not draft.get("kind") and kind:
        draft["kind"] = kind
    if not str(draft.get("awaiting") or "").strip():
        draft["awaiting"] = "name" if not has_label else "hours"
        draft["step"] = draft["awaiting"]
    memory.durable[draft_key] = draft
    memory.durable["current_workflow"] = workflow_id
    memory.durable["pending_ask"] = str(draft.get("awaiting") or "")
    memory.set_task_state(
        new_harness_task_state(
            task.id,
            channel=active.channel,
            collected=dict(draft),
            provenance={key: "aligned_create" for key in draft},
        )
    )
    memory.durable["active_domain"] = task.domain


def _align_mispinned_catalog_update(
    memory: SharedMemory, query: str
) -> None:
    """Remount update when a create pin is changing a listed/focused row.

    MCP Skill JWTs are fail-closed: `priority-create` cannot call
    `update_priority`. A hours/rename answer after the executor already
    resolved an existing catalog id must stay on the update Skill.
    """
    del query  # grounding uses last_query / last_entity, not phrase maps
    from app.workflow_schemas import new_harness_task_state

    active = memory.current_task_state()
    if not active or active.status in {
        "completed",
        "cancelled",
        "refused",
        "failed",
    }:
        return
    update_task_id = _CREATE_TO_UPDATE_TASK.get(str(active.task_id or "").strip())
    if not update_task_id:
        return
    kind = _catalog_kind_for_task(update_task_id)
    existing = _existing_catalog_update_row(memory, kind=kind)
    if not existing:
        return
    task = task_definition_for(update_task_id)
    if not task or not task.active:
        return
    _ground_catalog_update_target(
        memory,
        kind=kind,
        row_id=str(existing["id"]),
        name=str(existing.get("displayName") or ""),
        hours=existing.get("resolutionHours"),
    )
    collected = dict(active.collected or {})
    collected["id"] = str(existing["id"])
    collected["priority_id" if kind == "priority" else "status_id"] = str(
        existing["id"]
    )
    if existing.get("displayName"):
        collected["currentName"] = existing.get("displayName")
    memory.set_task_state(
        new_harness_task_state(
            task.id,
            channel=active.channel,
            collected=collected,
            provenance={
                **dict(active.provenance or {}),
                "_remount": "aligned_update",
            },
        )
    )
    memory.durable["active_domain"] = task.domain
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if wf in {"create_priority", "create_status"}:
        memory.durable.pop("current_workflow", None)
        memory.durable.pop("pending_ask", None)


def _align_mispinned_catalog_delete(memory: SharedMemory, query: str) -> None:
    """Remount read → delete when the live draft is already a delete confirm.

    MCP Skill JWTs are fail-closed: `priority-read` cannot call `delete_priority`.
    """
    del query
    from app.workflow_schemas import new_harness_task_state

    active = memory.current_task_state()
    if not active or active.status in {
        "completed",
        "cancelled",
        "refused",
        "failed",
    }:
        return
    delete_task_id = _READ_TO_DELETE_TASK.get(str(active.task_id or "").strip())
    if not delete_task_id:
        return
    kind = "status" if delete_task_id.startswith("status.") else "priority"
    draft = memory.durable.get(f"{kind}_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    lq = _last_query_dict(memory)
    if awaiting != "delete_confirm" and lq.get("catalog_op") != "delete_pick":
        return
    task = task_definition_for(delete_task_id)
    if not task or not task.active:
        return
    collected = dict(active.collected or {})
    rid = _catalog_target_id(draft) or _catalog_target_id(collected)
    if rid:
        collected["id"] = str(rid)
        collected["priority_id" if kind == "priority" else "status_id"] = str(rid)
    memory.set_task_state(
        new_harness_task_state(
            task.id,
            channel=active.channel,
            collected=collected,
            provenance={
                **dict(active.provenance or {}),
                "_remount": "aligned_delete",
            },
        )
    )
    memory.durable["active_domain"] = task.domain


def _remount_catalog_delete_for_write(
    memory: SharedMemory,
    *,
    tool_name: str,
    context: dict[str, Any],
    actor: Any,
    request: Any,
) -> str | None:
    """When the LLM calls delete_* under a sibling pin, remount that delete Skill.

    The executor already chose the write. Read-skill JWTs reject it (403), which
    was being phrased as missing admin access. Align Skill + token, then dispatch.
    """
    from app.mcp.authorization import issue_mcp_token
    from app.rbac import skill_rbac_refusal
    from app.skills.catalog import tools_for_skill
    from app.workflow_schemas import new_harness_task_state

    delete_task_id = _DELETE_TOOL_TO_TASK.get(str(tool_name or "").strip())
    if not delete_task_id:
        return None
    active = memory.current_task_state()
    if not active:
        return None
    current = str(active.task_id or "").strip()
    if current == delete_task_id:
        return None
    kind = "status" if delete_task_id.startswith("status.") else "priority"
    if not current.startswith(f"{kind}."):
        return None
    task = task_definition_for(delete_task_id)
    if not task or not task.active:
        return None
    refusal = skill_rbac_refusal(str(actor.user_role or "") or None, task.skill_name)
    if refusal is not None:
        return None
    collected = dict(active.collected or {})
    memory.set_task_state(
        new_harness_task_state(
            task.id,
            channel=active.channel,
            collected=collected,
            provenance={
                **dict(active.provenance or {}),
                "_remount": "delete_write",
            },
        )
    )
    memory.durable["active_domain"] = task.domain
    allowed = sorted(tools_for_skill(task.skill_name, task.executor))
    context["mcp_token"] = issue_mcp_token(
        organization_id=str(actor.organization_id or ""),
        actor_id=str(actor.user_id or ""),
        role=str(actor.user_role or ""),
        module=str(context.get("module") or "") or None,
        surface=str(context.get("surface") or "") or None,
        run_id=str(memory.request_id or "") or None,
        allowed_tools=allowed,
        agent_id=task.executor,
        task_id=task.id,
        skill_name=task.skill_name,
        skill_version=task.version,
        route_mode="executor",
    )
    _ = request
    try:
        from app.observability.turn_log import record_route

        record_route(task.domain, task.executor, f"remount:{task.skill_name}")
    except Exception:  # noqa: BLE001
        pass
    return task.skill_name


def _catalog_field_collect_fallback(
    memory: SharedMemory,
    query: str,
    *,
    allow_phrase: bool = True,
) -> str | None:
    """Phrase next create-collect step when the LLM timed out or returned empty."""
    from app.workflow_schemas import missing_fields as _miss

    del query  # reserved for phrase context when allow_phrase is True

    for draft_key, workflow_id, module, label in (
        ("priority_draft", "create_priority", "priority", "priority"),
        ("status_draft", "create_status", "priority", "status"),
    ):
        draft = memory.durable.get(draft_key)
        if not isinstance(draft, dict):
            continue
        if _catalog_target_id(draft):
            continue
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if awaiting not in {"name", "hours", "confirm"}:
            # Also recover when workflow is create but awaiting was cleared.
            if str(memory.durable.get("current_workflow") or "").strip().lower() != workflow_id:
                continue
            miss = _miss(workflow_id, draft)
            if "displayName" in miss or "name" in miss:
                awaiting = "name"
            elif "resolutionHours" in miss:
                awaiting = "hours"
            elif draft and not miss:
                awaiting = "confirm"
            else:
                continue
        name = str(draft.get("displayName") or draft.get("name") or "").strip()
        hours = draft.get("resolutionHours") or draft.get("hours")

        def _static() -> str | None:
            if awaiting == "hours" and name:
                return f'Got "{name}". What resolution hours (SLA) should it use?'
            if awaiting == "confirm" and name:
                return (
                    f'Ready to create {label} "{name}"'
                    + (f" with {hours}h SLA" if hours is not None else "")
                    + ". Should I save it?"
                )
            if awaiting == "name":
                return f"What short name should this {label} use?"
            return None

        if not allow_phrase:
            text = _static()
            if text:
                return text
            continue
        try:
            from app.tasks.phrase import phrase_reply

            if awaiting == "name":
                reply = phrase_reply(
                    module=module,
                    kind="ask",
                    fallback=f"Ask for the {label} display name (short label).",
                    context={
                        "awaiting": "name",
                        "nextStep": f"{label} display name",
                    },
                )
            elif awaiting == "hours":
                reply = phrase_reply(
                    module=module,
                    kind="ask",
                    fallback=(
                        f'Got "{name}". What resolution hours (SLA) should it use?'
                        if name
                        else "Ask for resolution hours (SLA)."
                    ),
                    context={
                        "displayName": name,
                        "awaiting": "hours",
                        "nextStep": "resolution hours (SLA)",
                    },
                )
            else:
                reply = phrase_reply(
                    module=module,
                    kind="confirm_hint",
                    fallback=(
                        f'Summarize {label} "{name}"'
                        + (f" with {hours}h SLA" if hours is not None else "")
                        + " and ask whether to create it."
                    ),
                    context={
                        "displayName": name,
                        "resolutionHours": hours,
                        "awaiting": "confirm",
                        "nextStep": "review and confirm create",
                    },
                )
            text = str(reply or "").strip()
            if text:
                return text
        except Exception:  # noqa: BLE001
            text = _static()
            if text:
                return text
    return None


def _executor_llm_recovery_text(memory: SharedMemory, query: str) -> str | None:
    """Non-empty recovery when the tool-loop LLM fails mid collect/confirm.

    Prefer draft-grounded static catalog collect so we do not re-enter a timed-out
    LLM via phrase_reply. Ticket/confirm helpers already swallow phrase failures.
    """
    return (
        _catalog_field_collect_fallback(memory, query, allow_phrase=False)
        or _ticket_issue_collect_fallback(memory, query)
        or _confirm_fallback_text(memory)
    )


def _seed_add_members_team_from_focus(
    memory: SharedMemory, draft: dict[str, Any]
) -> None:
    """Pin add-members onto last_entity so we do not re-ask which team."""
    from app.tools.catalog_tools import catalog_row_id_usable

    ent = memory.durable.get("last_entity")
    ent = ent if isinstance(ent, dict) else {}
    etype = str(ent.get("type") or "").strip().lower()
    eid = str(ent.get("id") or "").strip()
    ename = str(ent.get("name") or ent.get("queueName") or "").strip()
    if etype not in {"team", "queue"}:
        return
    dname = str(draft.get("name") or draft.get("team") or "").strip()
    # UI focus can be a different team than this add-members task.
    if dname and ename and dname.lower() != ename.lower():
        did = catalog_row_id_usable(draft.get("id") or draft.get("queue_id"))
        if did:
            memory.durable["last_entity"] = {
                "type": "team",
                "id": did,
                "name": dname,
            }
        return
    if eid and not catalog_row_id_usable(draft.get("id") or draft.get("queue_id")):
        draft["id"] = eid
    if ename and not dname:
        draft["name"] = ename
        draft["team"] = ename
    elif str(draft.get("name") or "").strip() and not str(draft.get("team") or "").strip():
        draft["team"] = str(draft["name"]).strip()
    elif str(draft.get("team") or "").strip() and not str(draft.get("name") or "").strip():
        draft["name"] = str(draft["team"]).strip()


def _sync_guided_draft_from_task(memory: SharedMemory, task_id: str) -> None:
    """Merge TaskState.collected into the live draft so gates/hydrate see Domain fields."""
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        normalize_fields,
    )

    spec = _GUIDED_TASK_DRAFT.get(str(task_id or "").strip())
    if not spec:
        return
    draft_key, workflow_id, kind = spec
    state = memory.current_task_state()
    collected = (
        dict(state.collected)
        if state and state.task_id == task_id and isinstance(state.collected, dict)
        else {}
    )
    existing = memory.durable.get(draft_key)
    existing = dict(existing) if isinstance(existing, dict) else {}
    normalized = normalize_fields(workflow_id, {**existing, **collected})
    merged = {**existing, **normalized}
    if workflow_id in {"add_team_members", "add_members"}:
        prior_flow = str(
            existing.get("flow") or existing.get("workflow") or ""
        ).strip().lower()
        if prior_flow not in {"add_team_members", "add_members"}:
            merged.pop("members", None)
            prior_ask = str(merged.get("awaiting") or "").strip().lower()
            if prior_ask in {"name", "description", "members", "confirm", "done"}:
                merged.pop("awaiting", None)
        _seed_add_members_team_from_focus(memory, merged)
        merged["flow"] = "add_team_members"
        merged["workflow"] = "add_team_members"
    if workflow_id in {"create_macro", "macro"}:
        from app.workflow_schemas import sanitize_macro_draft_fields

        start = str(
            merged.get("_intent_start_text") or existing.get("_intent_start_text") or ""
        ).strip()
        merged = sanitize_macro_draft_fields(merged)
        if start:
            merged["_intent_start_text"] = start
    if workflow_id in {"create_priority", "priority", "create_status", "status"}:
        from app.workflow_schemas import sanitize_priority_draft_fields

        start = str(
            merged.get("_intent_start_text") or existing.get("_intent_start_text") or ""
        ).strip()
        if kind and not str(merged.get("kind") or "").strip():
            merged["kind"] = kind
        merged = sanitize_priority_draft_fields(merged)
        if start:
            merged["_intent_start_text"] = start
    if kind and not str(merged.get("kind") or "").strip():
        merged["kind"] = kind
    awaiting = str(merged.get("awaiting") or "").strip().lower()
    refresh_hint = awaiting != "delete_confirm" and (
        not str(merged.get("id") or "").strip()
        or (
            workflow_id in {"add_team_members", "add_members"}
            and awaiting not in {"confirm", "done"}
        )
    )
    if workflow_id == "create_ticket":
        if existing.get("issueReady") and merged.get("issueReady") is None:
            merged["issueReady"] = existing.get("issueReady")
        if (
            existing.get("precreate_duplicate_check")
            and not merged.get("precreate_duplicate_check")
        ):
            merged["precreate_duplicate_check"] = existing.get(
                "precreate_duplicate_check"
            )
        if str(existing.get("surface") or "").strip() and not str(
            merged.get("surface") or ""
        ).strip():
            merged["surface"] = existing.get("surface")
    if refresh_hint:
        hint = awaiting_hint_from_missing(workflow_id, merged)
        current_ask = str(merged.get("awaiting") or "").strip().lower()
        prior_ask = str(existing.get("awaiting") or "").strip().lower()
        # Keep a mid-flow correction slot (title already filled, awaiting=title).
        keep_correction = current_ask not in {
            "",
            "confirm",
            "delete_confirm",
            "done",
        } and current_ask != str(hint or "").strip().lower()
        ask = current_ask if keep_correction else hint
        # Confirm-ready ticket: do not reopen issue because normalize dropped stamps.
        if (
            workflow_id == "create_ticket"
            and prior_ask == "confirm"
            and str(hint or "").strip().lower() == "issue"
        ):
            from app.workflow_schemas import issue_looks_usable, ticket_issue_ready

            issue_text = str(
                merged.get("issue")
                or existing.get("issue")
                or merged.get("description")
                or ""
            ).strip()
            if issue_looks_usable(issue_text) and (
                ticket_issue_ready(merged) or ticket_issue_ready(existing)
            ):
                if not ticket_issue_ready(merged) and ticket_issue_ready(existing):
                    merged["issueReady"] = existing.get("issueReady")
                ask = "confirm"
        merged["awaiting"] = ask
        merged["step"] = ask
        memory.durable["current_workflow"] = workflow_id
        memory.durable["pending_ask"] = ask
    elif workflow_id in {"add_team_members", "add_members"}:
        memory.durable["current_workflow"] = workflow_id
        if awaiting:
            memory.durable["pending_ask"] = awaiting
    memory.durable[draft_key] = merged
    if state and state.task_id == task_id and normalized:
        memory.set_task_state(
            state.model_copy(
                update={"collected": {**collected, **normalized}}
            )
        )


def _stamp_macro_intent_start_if_fresh(memory: SharedMemory, query: str) -> None:
    """Remember start-create utterance; never leave it as title/body.

    Primary signal is TaskState / prior stamp (`_intent_start_text`), not a
    keyword map. Also clears Domain/LLM mistakes that copied this turn's
    utterance into title on the first collect turn.
    """
    from app.workflow_schemas import (
        mark_macro_intent_start,
        sanitize_macro_draft_fields,
        usable_macro_title,
    )

    draft = memory.durable.get("macro_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    q = str(query or "").strip()
    if not q:
        return
    start = str(draft.get("_intent_start_text") or "").strip()
    title = str(draft.get("title") or draft.get("name") or "").strip()
    body = str(draft.get("body") or draft.get("content") or "").strip()

    if not start:
        mistook_start_as_title = bool(
            title and not body and not usable_macro_title(title, start_utterance=q)
        )
        if (not title and not body) or mistook_start_as_title:
            memory.durable["macro_draft"] = mark_macro_intent_start(draft, q)
            memory.durable["current_workflow"] = "create_macro"
            memory.durable["pending_ask"] = "title"
        return

    cleaned = sanitize_macro_draft_fields(draft)
    cleaned["_intent_start_text"] = start
    memory.durable["macro_draft"] = cleaned
    memory.durable["current_workflow"] = "create_macro"
    ask = str(cleaned.get("awaiting") or "").strip()
    if ask:
        memory.durable["pending_ask"] = ask


def _stamp_kb_intent_start_if_fresh(memory: SharedMemory, query: str) -> None:
    """Remember start-create utterance; never leave it as title/body."""
    from app.workflow_schemas import (
        mark_kb_intent_start,
        sanitize_kb_draft_fields,
        usable_kb_title,
        utterance_is_kb_create_start,
    )

    draft = memory.durable.get("kb_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    q = str(query or "").strip()
    if not q:
        return
    start = str(draft.get("_intent_start_text") or "").strip()
    title = str(draft.get("title") or draft.get("name") or "").strip()
    body = str(draft.get("body") or draft.get("content") or "").strip()

    if not start:
        mistook_start_as_title = bool(
            title and not body and not usable_kb_title(title, start_utterance=q)
        )
        if (not title and not body) or mistook_start_as_title:
            if utterance_is_kb_create_start(q) or mistook_start_as_title:
                memory.durable["kb_draft"] = mark_kb_intent_start(draft, q)
                memory.durable["current_workflow"] = "create_kb"
                memory.durable["pending_ask"] = "title"
        return

    cleaned = sanitize_kb_draft_fields(draft)
    cleaned["_intent_start_text"] = start
    memory.durable["kb_draft"] = cleaned
    memory.durable["current_workflow"] = "create_kb"
    ask = str(cleaned.get("awaiting") or "").strip()
    if ask:
        memory.durable["pending_ask"] = ask


def _stamp_catalog_label_intent_start_if_fresh(
    memory: SharedMemory, query: str, task_id: str
) -> None:
    """Remember start-create utterance; never leave it as the catalog label."""
    from app.workflow_schemas import (
        mark_catalog_label_intent_start,
        sanitize_priority_draft_fields,
        usable_catalog_label,
    )

    spec = _GUIDED_TASK_DRAFT.get(str(task_id or "").strip())
    if not spec:
        return
    targets = [spec]
    if str(task_id or "").strip() == "status.create":
        pri = memory.durable.get("priority_draft")
        if isinstance(pri, dict) and str(pri.get("kind") or "").lower() in {
            "status",
            "",
        }:
            if str(pri.get("awaiting") or "").strip():
                targets.append(("priority_draft", "create_status", "status"))
    q = str(query or "").strip()
    if not q:
        return
    seen: set[str] = set()
    for draft_key, workflow_id, kind in targets:
        if draft_key in seen:
            continue
        seen.add(draft_key)
        draft = memory.durable.get(draft_key)
        draft = dict(draft) if isinstance(draft, dict) else {}
        start = str(draft.get("_intent_start_text") or "").strip()
        name = str(
            draft.get("displayName") or draft.get("name") or draft.get("label") or ""
        ).strip()
        kind_s = str(kind or draft.get("kind") or "priority").strip().lower() or "priority"
        if kind_s not in {"priority", "status"}:
            kind_s = "priority"

        if not start:
            mistook = bool(
                name
                and not usable_catalog_label(name, start_utterance=q, kind=kind_s)
            )
            if (not name) or mistook:
                memory.durable[draft_key] = mark_catalog_label_intent_start(
                    draft, q, kind=kind_s
                )
                memory.durable["current_workflow"] = workflow_id
                memory.durable["pending_ask"] = "name"
            continue

        cleaned = sanitize_priority_draft_fields(draft)
        cleaned["_intent_start_text"] = start
        memory.durable[draft_key] = cleaned
        memory.durable["current_workflow"] = workflow_id
        ask = str(cleaned.get("awaiting") or "").strip()
        if ask:
            memory.durable["pending_ask"] = ask


def _public_guided_draft(draft: dict[str, Any]) -> dict[str, Any]:
    """UI actions must not leak internal intent-start markers."""
    return {
        key: value
        for key, value in draft.items()
        if not str(key).startswith("_")
    }


def _stamp_guided_drafts_at_turn_start(memory: SharedMemory) -> None:
    """Snapshot live drafts once per user turn for update write guards."""
    import copy

    if memory.durable.get("_guided_turn_start_stamped"):
        return
    for key in (
        "ticket_draft",
        "team_draft",
        "kb_draft",
        "macro_draft",
        "customer_draft",
        "priority_draft",
        "status_draft",
        "escalate_draft",
        "reassign_draft",
    ):
        stamp_key = turn_start_draft_key(key)
        blob = memory.durable.get(key)
        if isinstance(blob, dict):
            snapshot = copy.deepcopy(blob)
            apply_guided_ready(workflow_id_for_draft(key, snapshot), snapshot)
            memory.durable[stamp_key] = snapshot
        else:
            memory.durable.pop(stamp_key, None)
    memory.durable["_guided_turn_start_stamped"] = True


def _clear_guided_turn_start_flag(memory: SharedMemory) -> None:
    memory.durable.pop("_guided_turn_start_stamped", None)


def _snap_guided_next_field(
    workflow_id: str,
    draft: dict[str, Any],
    incoming: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Schema-after-LLM snap: one open slot; reject skip-ahead-only patches."""
    cleaned, violation = snap_guided_incoming(workflow_id, draft, incoming)
    if violation:
        apply_guided_ready(workflow_id, draft)
        awaiting = first_open_guided_slot(workflow_id, draft)
        return cleaned, {
            "success": False,
            "error_code": "SEQUENCE_VIOLATION",
            "message": violation,
            "payload": {
                "awaiting": awaiting,
                "ready": bool(draft.get("ready")),
                "skippedFields": draft.get("skippedFields") or [],
                "draft": _public_guided_draft(draft),
                "guidance": violation,
            },
            "retryable": False,
        }
    return cleaned, None


_PORTAL_STAFF_ONLY_TOOLS = frozenset(
    {
        "create_ticket",
        "verify_ticket_customer",
        "enrich_ticket",
        "create_customer",
        "list_customers",
    }
)
_STAFF_PORTAL_ONLY_TOOLS = frozenset({"portal_create_ticket"})
_PORTAL_IDENTITY_AWAITING = frozenset(
    {
        "name",
        "contact",
        "customername",
        "email",
        "phone",
        "customeremail",
        "customerphone",
        "",
    }
)


def _is_portal_session(
    memory: SharedMemory | None = None,
    *,
    actor: Any = None,
    context: dict[str, Any] | None = None,
    request: Any = None,
) -> bool:
    """True for support-portal chat (role, module, or stamped ticket_draft)."""
    if memory is not None:
        draft = memory.durable.get("ticket_draft")
        if isinstance(draft, dict) and str(draft.get("surface") or "").strip().lower() == "portal":
            return True
    if request is None and isinstance(context, dict):
        request = context.get("request")
    role = ""
    module = ""
    cid = ""
    if actor is not None:
        role = str(getattr(actor, "user_role", None) or "").strip().lower()
        cid = str(getattr(actor, "portal_customer_id", None) or "").strip()
    if request is not None:
        act = getattr(request, "actor", None)
        if act is not None:
            role = role or str(getattr(act, "user_role", None) or "").strip().lower()
            cid = cid or str(getattr(act, "portal_customer_id", None) or "").strip()
        module = str(getattr(request, "module", None) or "").strip().lower()
    if isinstance(context, dict):
        module = module or str(context.get("module") or "").strip().lower()
    return role.startswith("portal") or module == "portal" or bool(cid)


def _portal_create_must_deflect_first(
    memory: SharedMemory,
    *,
    actor: Any = None,
    context: dict[str, Any] | None = None,
    active: Any = None,
) -> bool:
    """Portal ticket.create without a prior KB walk must not collect or file."""
    if memory.durable.get("_portal_create_after_self_service"):
        return False
    if not _is_portal_session(memory, actor=actor, context=context):
        return False
    if active is not None and str(getattr(active, "task_id", "") or "") != "ticket.create":
        return False
    draft = memory.durable.get("ticket_draft")
    draft = draft if isinstance(draft, dict) else {}
    if str(draft.get("awaiting") or "").strip().lower() == "confirm":
        return False
    if active is not None and str(getattr(active, "status", "") or "") == "awaiting_confirmation":
        return False
    return True


def _rewrite_staff_create_ticket_for_portal(
    name: str,
    memory: SharedMemory | None = None,
    *,
    actor: Any = None,
    context: dict[str, Any] | None = None,
    request: Any = None,
) -> str:
    """Portal roles must never hit staff POST /api/tickets (Express 403)."""
    if str(name or "").strip() != "create_ticket":
        return str(name or "").strip()
    if _is_portal_session(memory, actor=actor, context=context, request=request):
        return "portal_create_ticket"
    return "create_ticket"


def seed_portal_ticket_identity(
    memory: SharedMemory,
    request: Any,
    *,
    force: bool = False,
) -> None:
    """Bind the logged-in portal customer onto ticket_draft. Do not collect email.

    Does not start a create-ticket shell on greetings unless force=True
    (ticket-create Executor) or a draft/task is already live.
    """
    from app.workflow_schemas import apply_guided_ready, issue_looks_usable, ticket_issue_ready

    act = getattr(request, "actor", None)
    if act is None:
        return
    role = str(getattr(act, "user_role", None) or "").strip().lower()
    module = str(getattr(request, "module", None) or "").strip().lower()
    if not (role.startswith("portal") or module == "portal"):
        return
    if role == "portal_guest":
        return
    cid = str(
        getattr(act, "portal_customer_id", None) or getattr(act, "user_id", None) or ""
    ).strip()
    if not cid or cid.lower().startswith("portal-guest:"):
        return
    existing = memory.durable.get("ticket_draft")
    had = isinstance(existing, dict) and any(
        str(existing.get(key) or "").strip()
        for key in (
            "awaiting",
            "customerName",
            "issue",
            "description",
            "surface",
            "customerId",
        )
    )
    state = memory.current_task_state()
    task_create = bool(
        state and str(getattr(state, "task_id", "") or "").strip() == "ticket.create"
    )
    wf = str(memory.durable.get("current_workflow") or "").strip().lower() in {
        "create_ticket",
        "ticket",
    }
    if not force and not had and not task_create and not wf:
        return
    draft = dict(existing) if isinstance(existing, dict) else {}
    draft["surface"] = "portal"
    name = str(getattr(act, "user_name", None) or draft.get("customerName") or "").strip()
    if name:
        draft["customerName"] = name
    email = str(
        getattr(act, "user_email", None)
        or draft.get("customerEmail")
        or draft.get("email")
        or ""
    ).strip()
    phone = str(
        getattr(act, "user_phone", None)
        or draft.get("customerPhone")
        or draft.get("phone")
        or ""
    ).strip()
    if email:
        draft["customerEmail"] = email
        draft["contact"] = email
    elif phone:
        draft["customerPhone"] = phone
        if not str(draft.get("contact") or "").strip():
            draft["contact"] = phone
    draft["customerId"] = cid
    draft["customerDirectoryStatus"] = "verified"
    draft.pop("customer_not_found", None)
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    issue_ok = issue_looks_usable(
        str(draft.get("issue") or draft.get("description") or draft.get("subject") or "")
    )
    if awaiting in _PORTAL_IDENTITY_AWAITING:
        draft["awaiting"] = "confirm" if issue_ok and ticket_issue_ready(draft) else "issue"
        draft["step"] = draft["awaiting"]
    apply_guided_ready("create_ticket", draft)
    memory.durable["ticket_draft"] = draft
    if not str(memory.durable.get("current_workflow") or "").strip():
        memory.durable["current_workflow"] = "create_ticket"


def _filter_portal_vs_staff_ticket_tools(
    tools: list[Any],
    memory: SharedMemory,
    *,
    actor: Any = None,
    context: dict[str, Any] | None = None,
) -> list[Any]:
    """Portal files via portal_create_ticket; staff never uses that write."""
    if _is_portal_session(memory, actor=actor, context=context):
        hide = _PORTAL_STAFF_ONLY_TOOLS
    else:
        hide = _STAFF_PORTAL_ONLY_TOOLS
    return [t for t in tools if str(getattr(t, "name", "") or "") not in hide]


def _filter_writes_until_guided_ready(tools: list[Any], memory: SharedMemory) -> list[Any]:
    """Hide create/update writes until ready + awaiting confirm."""
    hide: set[str] = set()
    current = str(memory.durable.get("current_workflow") or "").strip().lower()
    for name, (draft_key, wid) in GUIDED_CREATE_WRITE_TOOLS.items():
        if name == "create_customer":
            ticket = memory.durable.get("ticket_draft")
            if isinstance(ticket, dict):
                from app.workflow_schemas import customer_write_ready

                if customer_write_ready(
                    {
                        "name": ticket.get("customerName") or ticket.get("name"),
                        "email": ticket.get("customerEmail") or ticket.get("email"),
                        "phone": ticket.get("customerPhone") or ticket.get("phone"),
                    }
                ):
                    continue
        blob = memory.durable.get(draft_key)
        if not isinstance(blob, dict):
            continue
        awaiting = str(blob.get("awaiting") or "").strip().lower()
        if compute_guided_ready(wid, blob) and awaiting in {
            "confirm",
            "delete_confirm",
        }:
            continue
        hide.add(name)
    for name, (draft_key, wid) in GUIDED_UPDATE_WRITE_TOOLS.items():
        stamp = memory.durable.get(turn_start_draft_key(draft_key))
        blob = stamp if isinstance(stamp, dict) else memory.durable.get(draft_key)
        if not isinstance(blob, dict):
            continue
        if current and current not in {wid, str(blob.get("flow") or "").strip().lower()}:
            if name.startswith("update_") or name.startswith("delete_"):
                if current not in {
                    "create_priority",
                    "create_status",
                    "create_team",
                    "create_macro",
                    "create_kb",
                    "add_team_members",
                    "add_members",
                }:
                    continue
        awaiting = str(blob.get("awaiting") or "").strip().lower()
        ready_wid = wid
        if name == "update_queue":
            live_wid = workflow_id_for_draft(draft_key, blob)
            if live_wid in {"add_team_members", "add_members"}:
                ready_wid = live_wid
        if compute_guided_ready(ready_wid, blob) and awaiting in {
            "confirm",
            "delete_confirm",
        }:
            continue
        hide.add(name)
    ras = memory.durable.get("reassign_draft")
    if isinstance(ras, dict) and str(ras.get("awaiting") or "").strip():
        if not (
            compute_guided_ready("reassign_ticket", ras)
            and str(ras.get("awaiting") or "").strip().lower() == "confirm"
        ):
            hide.add("update_ticket")
    if not hide:
        return tools
    return [t for t in tools if str(getattr(t, "name", "") or "") not in hide]


def _mirror_guided_draft_into_task(memory: SharedMemory) -> None:
    """After absorb/patch, keep TaskState.collected aligned with the live draft."""
    state = memory.current_task_state()
    if not state:
        return
    spec = _GUIDED_TASK_DRAFT.get(state.task_id)
    if not spec:
        return
    draft = memory.durable.get(spec[0])
    if not isinstance(draft, dict):
        return
    from app.workflow_schemas import normalize_fields

    normalized = normalize_fields(spec[1], draft)
    if not normalized:
        return
    memory.set_task_state(
        state.model_copy(
            update={"collected": {**(state.collected or {}), **normalized}}
        )
    )


def _task_id_for_active_draft(
    workflow: str,
    draft_key: str,
    draft: dict[str, Any],
) -> str | None:
    """Resolve hydrated UI state to one canonical task without user-text semantics."""
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if awaiting == "delete_confirm":
        return {
            "team_draft": "team.delete",
            "macro_draft": "macro.delete",
            "priority_draft": "priority.delete",
            "status_draft": "status.delete",
        }.get(draft_key)
    # Portal KB walkthrough is TaskState, not create-ticket collect.
    if draft_key == "ticket_draft":
        surface = str(draft.get("surface") or "").strip().lower()
        pending = (
            draft.get("pending_kb")
            if isinstance(draft.get("pending_kb"), dict)
            else None
        )
        if surface == "portal" and (
            awaiting == "kb_resolution"
            or (pending and awaiting != "confirm")
        ):
            return "intake.self.service.deflection"
    return _ACTIVE_WORKFLOW_TASK.get(workflow)


def _deterministic_supervisor_route(
    memory: SharedMemory,
    query: str,
) -> dict[str, Any] | None:
    """Route active guided drafts to their owner — avoids Super Agent answering field work."""
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    spec = _ACTIVE_WORKFLOW_DRAFT.get(wf)
    if not spec:
        return None
    draft_key, owner = spec
    draft = memory.durable.get(draft_key)
    if not isinstance(draft, dict):
        return None
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if awaiting == "done":
        return None
    # Add-customer must finish before a parked ticket resume steals the confirm turn.
    if wf == "create_customer":
        owner = "customers"
    memory.add_message("user", query)
    return {
        "response_type": "routing_response",
        "route_args": {"agent_name": owner, "query": query},
        "query": query,
        "assistant_text": None,
        "agent": "ticketing_coworker",
    }


def _active_guided_collect_blocking_resume(memory: SharedMemory) -> bool:
    """True when another guided collect is in progress (do not steal resume)."""
    from app.memory_contract import normalize_parked

    pending_ask = str(memory.durable.get("pending_ask") or "").strip().lower()
    pending = memory.durable.get("pending_resume")
    resume_open = pending_ask in {"resume_offer", "resume"} or isinstance(pending, dict)
    # After customer side-quest arms resume, leftover customer_draft / workflow
    # must not block same-turn unpark + force write.
    if resume_open:
        # After add-customer arms resume, leftover customer collect must not block
        # unpark — even if park bind has not stamped customerId yet.
        pending_flow = ""
        if isinstance(pending, dict):
            pending_flow = str(
                pending.get("flow") or pending.get("workflow_id") or ""
            ).strip().lower()
        ticket_parked = any(
            str(item.get("flow") or "").strip().lower() in {"ticket", "create_ticket"}
            for item in normalize_parked(memory.durable.get("parked_drafts"))
        )
        if pending_flow in {"ticket", "create_ticket", ""} or ticket_parked:
            for item in normalize_parked(memory.durable.get("parked_drafts")):
                flow = str(item.get("flow") or "").strip().lower()
                draft = item.get("draft") if isinstance(item.get("draft"), dict) else {}
                if flow in {"ticket", "create_ticket"} and (
                    str(draft.get("customerId") or draft.get("customer_id") or "").strip()
                    or pending_flow in {"ticket", "create_ticket"}
                ):
                    _clear_customer_collect_for_ticket_resume(memory)
                    break
            else:
                if pending_flow in {"ticket", "create_ticket"}:
                    _clear_customer_collect_for_ticket_resume(memory)

    if str(memory.durable.get("current_workflow") or "").strip():
        return True
    for key in (
        "ticket_draft",
        "customer_draft",
        "kb_draft",
        "macro_draft",
        "team_draft",
        "priority_draft",
        "status_draft",
        "escalate_draft",
    ):
        blob = memory.durable.get(key)
        if isinstance(blob, dict) and str(blob.get("awaiting") or "").strip():
            return True
    return False


def _try_native_resume_parked_workflow(
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
) -> str | None:
    """Unpark any guided flow after a resume offer; return specialist agent or None.

    Affirmation is NLU-owned (RESUME/CONFIRM/CONTINUE), not a phrase list.
    When the restored draft is already complete at confirm, arm a one-shot
    forced write for this same turn (all modules).
    """
    from app.memory_contract import normalize_parked, workflow_id_for_parked_flow
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        draft_complete,
        missing_fields,
    )

    pending = memory.durable.get("pending_resume")
    if not isinstance(pending, dict):
        last_q = memory.durable.get("last_query")
        if isinstance(last_q, dict) and isinstance(last_q.get("pending_resume"), dict):
            pending = last_q.get("pending_resume")
    parked = normalize_parked(memory.durable.get("parked_drafts"))
    if not parked:
        memory.durable.pop("pending_resume", None)
        return None
    offer_open = bool(pending) or str(
        memory.durable.get("pending_ask") or ""
    ).strip().lower() in {"resume_offer", "resume"}
    if not offer_open:
        return None
    if _active_guided_collect_blocking_resume(memory):
        return None

    state = _memory_armed_state(memory, context)
    state["current_workflow"] = ""
    state["parked_drafts"] = parked
    state["conversation_context"] = {
        "last_query": {
            "pending_resume": pending if isinstance(pending, dict) else None,
            "awaiting": "resume_offer",
        }
    }
    try:
        from app.agents.workflow_nlu import (
            decide_workflow_turn,
            ground_resume_offer_decision,
        )

        decision = decide_workflow_turn(state, query) or {}
        decision = ground_resume_offer_decision(decision, state)
    except Exception:  # noqa: BLE001
        decision = {}
    action = str(decision.get("action") or "").strip().upper()
    if action not in {"RESUME_WORKFLOW", "CONFIRM_WORKFLOW", "CONTINUE_WORKFLOW"}:
        return None

    flow_hint = ""
    if isinstance(pending, dict):
        flow_hint = str(
            pending.get("flow") or pending.get("workflow_id") or ""
        ).strip()
    draft, rest, flow = _pop_parked_flow(parked, flow_hint=flow_hint)
    if not isinstance(draft, dict) or not draft:
        return None

    from app.workflow_schemas import _WORKFLOW_DRAFT_KEY

    wid = workflow_id_for_parked_flow(flow, draft) or flow_hint or flow
    wid = str(wid or "").strip().lower()
    # Short parked flow labels → schema workflow ids (all guided modules).
    _SHORT_TO_WID = {
        "ticket": "create_ticket",
        "customer": "create_customer",
        "team": "create_team",
        "macro": "create_macro",
        "kb": "create_kb",
        "priority": "create_priority",
        "status": "create_status",
        "reassign": "reassign_ticket",
        "add_members": "add_team_members",
    }
    wid = _SHORT_TO_WID.get(wid, wid)
    draft_key = _WORKFLOW_DRAFT_KEY.get(wid)
    if not draft_key:
        return None

    draft.pop("customer_not_found", None)
    # If add-customer finished but park bind missed nested payload.customer, recover
    # from last_entity before we ask create_ticket again.
    if not str(draft.get("customerId") or draft.get("customer_id") or "").strip():
        ent = memory.durable.get("last_entity")
        if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "customer":
            cid = str(ent.get("id") or "").strip()
            if cid:
                draft["customerId"] = cid
            if not str(draft.get("customerName") or "").strip() and str(
                ent.get("name") or ""
            ).strip():
                draft["customerName"] = str(ent.get("name")).strip()
            if not str(draft.get("customerEmail") or "").strip() and str(
                ent.get("email") or ""
            ).strip():
                draft["customerEmail"] = str(ent.get("email")).strip()
            if not str(draft.get("customerPhone") or "").strip() and str(
                ent.get("phone") or ""
            ).strip():
                draft["customerPhone"] = str(ent.get("phone")).strip()
    _mark_ticket_customer_verified(draft)
    # Never drop a previously collected issue after customer side-quest.
    if not str(draft.get("issue") or "").strip():
        for alt in ("description", "subject"):
            alt_v = str(draft.get(alt) or "").strip()
            if alt_v:
                draft["issue"] = alt_v
                break
    miss = missing_fields(wid, draft)
    if not miss and draft_complete(wid, draft):
        draft["awaiting"] = "confirm"
        draft["step"] = "confirm"
    else:
        hint = awaiting_hint_from_missing(wid, draft) or (
            miss[0] if miss else "confirm"
        )
        draft["awaiting"] = hint
        draft["step"] = hint

    memory.durable[draft_key] = draft
    memory.durable["parked_drafts"] = rest
    memory.durable["current_workflow"] = wid
    memory.durable["pending_ask"] = str(draft.get("awaiting") or "confirm")
    memory.durable.pop("pending_resume", None)
    # Clear sibling drafts that would block armed write / resume.
    for other_key in (
        "ticket_draft",
        "customer_draft",
        "kb_draft",
        "macro_draft",
        "team_draft",
        "priority_draft",
        "status_draft",
        "escalate_draft",
    ):
        if other_key != draft_key:
            memory.durable.pop(other_key, None)
    last_q = memory.durable.get("last_query")
    if isinstance(last_q, dict):
        last_q = dict(last_q)
        last_q.pop("pending_resume", None)
        last_q["awaiting"] = str(draft.get("awaiting") or "confirm")
        memory.durable["last_query"] = last_q

    # Same turn: user affirmed resume and draft is ready to write — force once.
    if str(draft.get("awaiting") or "").strip().lower() == "confirm" and draft_complete(
        wid, draft
    ):
        memory.durable["force_armed_write"] = True

    agent = _PARKED_FLOW_TO_AGENT.get(flow) or _PARKED_FLOW_TO_AGENT.get(wid) or "tickets"
    return agent


_EXECUTOR_PRODUCT_PROFILE: dict[str, str] = {
    "ai_resolution_executor": "kb",
    "ticket_creation_executor": "tickets",
    "classification_priority_executor": "tickets",
    "intelligent_assignment_executor": "tickets",
    "workload_optimization_executor": "tickets",
    "root_cause_learning_executor": "admin",
    "ticket_lifecycle_executor": "tickets",
    "sla_escalation_executor": "tickets",
    "investigation_summary_executor": "tickets",
    "customer_reply_drafting_executor": "tickets",
    "autonomous_resolution_executor": "tickets",
    "resolution_quality_executor": "tickets",
    "personalized_notification_executor": "tickets",
    "insights_analytics_executor": "admin",
    "resolution_knowledge_executor": "kb",
    "similar_ticket_detection_executor": "kb",
    "team_queue_crud_executor": "teams",
    "kb_quality_crud_executor": "kb",
    "macro_crud_executor": "macros",
    "customer_directory_crud_executor": "customers",
    "priority_status_crud_executor": "admin",
    "org_settings_integrations_executor": "admin",
    "notification_inbox_executor": "admin",
    "analytics_audit_query_executor": "admin",
    "automation_rule_crud_executor": "admin",
}


def _canonical_tool_name(name: str) -> str:
    raw = str(name or "").strip()
    if not raw:
        return ""
    raw = raw.rsplit(".", 1)[-1]
    return raw.replace("-", "_").lower()


def _first_tool_call(result: dict[str, Any], name: str) -> dict[str, Any] | None:
    want = _canonical_tool_name(name)
    for call in result.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        if _canonical_tool_name(str(call.get("name") or "")) == want:
            arguments = call.get("arguments")
            return dict(arguments) if isinstance(arguments, dict) else {}
    return None


_CATALOG_FOCUS_TYPES = frozenset(
    {
        "team",
        "queue",
        "agent_queue",
        "macro",
        "article",
        "kb",
        "kb_article",
        "customer",
        "priority",
        "status",
        "notification",
    }
)
_TICKET_FOCUS_TYPES = frozenset({"ticket"})
_CATALOG_FOCUS_PAGES = frozenset(
    {
        "agent-queues",
        "teams",
        "macros",
        "kb",
        "customers",
        "priorities",
        "analytics",
        "audit",
        "csat-reports",
        "org-preferences",
        "settings",
        "knowledge-base",
        "knowledge base",
        "knowledge",
    }
)
_CATALOG_FOCUS_MODULES = frozenset(
    {"teams", "macros", "kb", "customers", "admin", "analytics"}
)
_TICKET_FOCUS_PAGES = frozenset(
    {
        "tickets-list",
        "create-ticket",
        "assigned",
        "work-board",
        "team-inbox",
        "unassigned",
        "search",
    }
)


def _request_page_module(context: dict[str, Any]) -> tuple[str, str]:
    req = context.get("request") if isinstance(context, dict) else None
    page = str(
        (getattr(req, "page", None) if req is not None else None)
        or (context or {}).get("page")
        or ""
    ).strip().lower()
    module = str(
        (getattr(req, "module", None) if req is not None else None)
        or (context or {}).get("module")
        or ""
    ).strip().lower()
    return page, module


def _domain_id_from_trusted_focus(
    memory: SharedMemory, context: dict[str, Any]
) -> str | None:
    """Map last_entity / UI page to a Domain. Not utterance keyword routing."""
    ent = memory.durable.get("last_entity")
    typ = ""
    if isinstance(ent, dict):
        typ = str(ent.get("type") or "").strip().lower()
    if typ in _CATALOG_FOCUS_TYPES:
        return "catalog_administration_domain"
    if typ in _TICKET_FOCUS_TYPES:
        return "resolution_lifecycle_domain"
    page, module = _request_page_module(context)
    if page in _CATALOG_FOCUS_PAGES or module in _CATALOG_FOCUS_MODULES:
        return "catalog_administration_domain"
    if page in _TICKET_FOCUS_PAGES or module in {"tickets"}:
        return "resolution_lifecycle_domain"
    return None


def _trusted_focus_route_args(
    memory: SharedMemory,
    context: dict[str, Any],
    query: str,
) -> dict[str, Any] | None:
    """Never skip Super. last_entity / page is Context; Super owns the Domain.

    Auto-picking resolution from a tickets page stole new-ticket filing.
    """
    del memory, context, query
    return None


def _recover_super_new_task_route(
    *,
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
    route_result: dict[str, Any],
) -> dict[str, Any] | None:
    """When Super emits continue/empty with no pin, route from trusted focus."""
    from app.runtime.supervisor import DOMAIN_AGENT_IDS

    for call in route_result.get("tool_calls") or []:
        if not isinstance(call, dict):
            continue
        args = call.get("arguments")
        args = args if isinstance(args, dict) else {}
        domain_id = str(args.get("domain_id") or "").strip()
        if domain_id in DOMAIN_AGENT_IDS:
            return {
                "domain_id": domain_id,
                "query": str(args.get("query") or query).strip() or query,
            }
    domain_id = _domain_id_from_trusted_focus(memory, context)
    # A focused ticket / tickets page must not steal new-file to Resolution.
    if not domain_id or domain_id == "resolution_lifecycle_domain":
        return None
    return {"domain_id": domain_id, "query": query}


def _resolve_ticket_number_for_assignment(
    *,
    memory: SharedMemory,
    context: dict[str, Any],
    collected: dict[str, Any],
    query: str,
) -> str:
    for key in ("ticket_number", "ticketNumber", "ticket"):
        raw = str(collected.get(key) or "").strip()
        if raw:
            return raw if raw.startswith("#") or not raw.lstrip("#").isdigit() else f"#{raw.lstrip('#')}"
    ent = memory.durable.get("last_entity")
    if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "ticket":
        for key in ("ticketNumber", "ticket_number", "id", "number"):
            raw = str(ent.get(key) or "").strip()
            if raw:
                return raw if raw.startswith("#") or not raw.lstrip("#").isdigit() else f"#{raw.lstrip('#')}"
    focused = context.get("request")
    fe = getattr(focused, "focused_entity", None) if focused is not None else None
    if isinstance(fe, dict):
        for key in ("ticketNumber", "ticket_number", "id", "number"):
            raw = str(fe.get(key) or "").strip()
            if raw:
                return raw if raw.startswith("#") or not raw.lstrip("#").isdigit() else f"#{raw.lstrip('#')}"
    match = _TICKET_ID_RE.search(str(query or ""))
    if match:
        digits = "".join(ch for ch in match.group(0) if ch.isdigit())
        if digits:
            return f"#{digits}"
    return ""


def _migrate_parked_drafts_into_tasks(
    memory: SharedMemory,
    *,
    channel: str | None = None,
) -> None:
    """Bridge legacy parked_drafts into canonical parked_tasks once."""
    from app.memory_contract import normalize_parked, workflow_id_for_parked_flow
    from app.workflow_schemas import new_harness_task_state

    parked_tasks = [
        row
        for row in list(memory.durable.get("parked_tasks") or [])
        if isinstance(row, dict) and str(row.get("task_id") or "")
    ]
    known = {str(row.get("task_id") or "") for row in parked_tasks}
    drafts = normalize_parked(memory.durable.get("parked_drafts"))
    changed = False
    for item in drafts:
        if not isinstance(item, dict):
            continue
        flow = str(item.get("flow") or item.get("workflow_id") or "").strip()
        draft = item.get("draft") if isinstance(item.get("draft"), dict) else None
        if not isinstance(draft, dict):
            continue
        wid = str(workflow_id_for_parked_flow(flow, draft) or flow).strip().lower()
        short = {
            "ticket": "create_ticket",
            "customer": "create_customer",
            "team": "create_team",
            "macro": "create_macro",
            "kb": "create_kb",
            "priority": "create_priority",
            "status": "create_status",
            "reassign": "reassign_ticket",
            "add_members": "add_team_members",
        }
        wid = short.get(wid, wid)
        task_id = _ACTIVE_WORKFLOW_TASK.get(wid)
        if not task_id or task_id in known:
            continue
        try:
            state = new_harness_task_state(
                task_id,
                channel=channel,
                collected=dict(draft),
                provenance={key: "parked_draft" for key in draft},
            ).model_copy(update={"status": "parked"})
        except Exception:  # noqa: BLE001
            continue
        parked_tasks.append(state.model_dump(mode="json"))
        known.add(task_id)
        changed = True
    if changed:
        memory.durable["parked_tasks"] = parked_tasks[-10:]


def _run_deterministic_executor(
    *,
    instruction: DomainInstruction,
    skill,
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
    actor: ToolActor,
    budgets: BudgetTracker,
) -> dict[str, Any]:
    """Deterministic Executor path (ITRA): no LLM tool selection."""
    from app.mcp.client import call_mcp_tool
    from app.proactive.itra import route_assignment

    if instruction.executor_id != "intelligent_assignment_executor":
        raise ValueError(
            f"No deterministic runner registered for {instruction.executor_id}"
        )
    request: RunRequest = context["request"]
    state = memory.current_task_state()
    collected = {
        **(dict(state.collected) if state else {}),
        **dict(instruction.supplied_fields or {}),
    }
    ticket_number = _resolve_ticket_number_for_assignment(
        memory=memory,
        context=context,
        collected=collected,
        query=query,
    )
    if not ticket_number:
        # Schema-missing input: fall back to LLM ask path under the same Skill.
        product_profile = _EXECUTOR_PRODUCT_PROFILE.get(instruction.executor_id) or "tickets"
        return _run_executor_loop(
            agent_name=product_profile,
            llm=get_llm(),
            memory=memory,
            query=query,
            context=context,
            actor=actor,
            budgets=budgets,
            module=context.get("module"),
            surface=context.get("surface"),
            page=context.get("page"),
            role=request.actor.user_role,
            harness_executor=instruction.executor_id,
            harness_skill=skill.name,
        )

    token = context.get("mcp_token") or request.mcp_token
    ticket_out = call_mcp_tool(
        "get_ticket",
        {"ticket_number": ticket_number},
        token=token,
        agent=instruction.executor_id,
        module=context.get("module"),
        surface=context.get("surface"),
    )
    ticket_payload = (
        ticket_out.get("payload")
        if isinstance(ticket_out, dict) and isinstance(ticket_out.get("payload"), dict)
        else {}
    )
    org = str(request.actor.organization_id or "")
    routed = route_assignment(
        organization_id=org,
        issue=str(
            ticket_payload.get("description")
            or ticket_payload.get("issue")
            or collected.get("issue")
            or query
            or ""
        ),
        subject=str(ticket_payload.get("subject") or collected.get("subject") or ""),
        description=str(ticket_payload.get("description") or ""),
        skill_hint=str(
            ticket_payload.get("skill")
            or ticket_payload.get("category")
            or collected.get("category")
            or ""
        ),
        queue=str(ticket_payload.get("queue") or ticket_payload.get("team") or ""),
        priority=str(ticket_payload.get("priority") or "medium"),
    )
    assignee = str(routed.get("agent") or "").strip()
    resolver = str(routed.get("resolver") or "").strip()
    current = str(ticket_payload.get("assignee") or "").strip()
    tool_name = "update_ticket"
    tool_args: dict[str, Any] = {"ticket_number": ticket_number}
    if assignee:
        tool_args["assignee"] = assignee
        if current and current not in ("", "Unassigned") and current.lower() != assignee.lower():
            tool_args["steal_assignment"] = True
    if resolver:
        tool_args["resolver"] = resolver
    if state and state.idempotency_key:
        tool_args["_idempotency_key"] = state.idempotency_key
    will_write = bool(assignee or resolver)
    if state:
        memory.set_task_state(
            state.model_copy(
                update={
                    "status": "executing",
                    "mutation_attempted": will_write,
                    "collected": {**collected, "ticket_number": ticket_number},
                }
            )
        )
    if will_write:
        write_out = call_mcp_tool(
            tool_name,
            tool_args,
            token=token,
            agent=instruction.executor_id,
            module=context.get("module"),
            surface=context.get("surface"),
        )
    else:
        # ITRA found no skill-matched L1/L2 — leave unassigned. Never fall
        # back to Express auto-assign (heuristic / code pick).
        tool_name = None
        tool_args = {"ticket_number": ticket_number}
        write_out = {
            "success": True,
            "payload": {
                "ticket_number": ticket_number,
                "assignee": current or "Unassigned",
                "resolver": ticket_payload.get("resolver"),
                "unchanged": True,
                "via": "itra-llm",
            },
        }
    memory.durable["last_tool_outcome"] = {
        "tool": tool_name,
        "arguments": tool_args,
        "success": bool(isinstance(write_out, dict) and write_out.get("success")),
        "result": write_out if isinstance(write_out, dict) else {"raw": write_out},
    }
    llm = get_llm()
    reply_messages = [
        {
            "role": "system",
            "content": (
                "You are the intelligent assignment executor. Reply briefly and "
                "naturally about the assignment outcome. Use only the structured "
                "tool result and routing payload. Never invent assignees or claim "
                "success unless success is true."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {
                    "user_query": query,
                    "ticket_number": ticket_number,
                    "routing": routed,
                    "tool": tool_name,
                    "tool_result": write_out,
                },
                ensure_ascii=False,
                default=str,
            ),
        },
    ]
    reply = llm.run(reply_messages)
    text = str(reply.get("content") or "").strip()
    if not text:
        raise LLMEmptyResponse("Deterministic assignment executor returned no reply")
    memory.add_message("user", query)
    memory.add_message("assistant", text)
    ok = bool(isinstance(write_out, dict) and write_out.get("success"))
    if state:
        memory.set_task_state(
            state.model_copy(
                update={
                    "status": "completed" if ok else "failed",
                    "last_tool_outcome": memory.durable.get("last_tool_outcome"),
                    "collected": {**collected, "ticket_number": ticket_number},
                }
            )
        )
    return {
        "response_type": "final",
        "assistant_text": text,
        "agent": instruction.executor_id,
        "data": {
            "harness": {
                "domain": "triage_routing_domain",
                "executor": instruction.executor_id,
                "task_id": instruction.task_id,
                "skill_name": skill.name,
                "skill_version": skill.version,
                "execution_mode": "deterministic",
            },
            "routing": routed,
            "tool": tool_name,
            "tool_result": write_out,
        },
    }


def _prior_interactive_confirm_ready(memory: SharedMemory, tool_name: str) -> bool:
    """True when a prior turn already proposed this write (user saw the summary).

    Guided creates must not honor confirmed=true on the same turn the last
    field was collected — that turn should summarize and ask first.
    """
    state = memory.current_task_state()
    evidence = state.confirmation if state else None
    if (
        evidence
        and str(evidence.requested_request_id or "").strip()
        and evidence.requested_request_id != (memory.request_id or None)
        and not bool(getattr(evidence, "approved", False))
    ):
        return True
    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    if str(last.get("tool") or "").strip() != str(tool_name or "").strip():
        return False
    code = str(last.get("error_code") or "").strip().upper()
    kind = str(last.get("kind") or "").strip().lower()
    return code == "CONFIRMATION_REQUIRED" or kind == "needs_confirm"


_GUIDED_CONFIRM_WRITE_TOOLS = frozenset(
    {
        "create_ticket",
        "portal_create_ticket",
        "create_customer",
        "create_priority",
        "create_status",
        "create_queue",
        "update_queue",
        "create_macro",
        "update_macro",
        "create_kb_article",
        "draft_kb_article",
        "update_kb_article",
        "update_priority",
        "update_status",
        "delete_priority",
        "delete_status",
        "delete_queue",
        "delete_macro",
    }
)
# Ticket lifecycle writes that confirm in chat (yes/ok/go ahead) — not Confirm chips.
_INTERACTIVE_LIFECYCLE_WRITE_TOOLS = frozenset(
    {
        "escalate_ticket",
        "update_ticket",
        "request_ticket_reassignment",
        "decide_ticket_reassignment",
    }
)

# Update/delete complete on the user's first affirm (LLM called the write).
# Creates still need a prior chat summary so collect turns do not save.
_UPDATE_CONFIRM_RETRY_TOOLS = frozenset(
    {
        "update_priority",
        "update_status",
        "update_queue",
        "update_macro",
        "update_kb_article",
        "update_ticket",
        "delete_priority",
        "delete_status",
        "delete_macro",
        "delete_queue",
    }
)
_CREATE_CONFIRM_RETRY_TOOLS = frozenset(
    {
        "create_macro",
        "create_status",
        "create_priority",
        "create_queue",
        "create_kb_article",
        "draft_kb_article",
        "create_customer",
    }
)
def _draft_awaiting_confirm(memory: SharedMemory, tool_name: str = "") -> bool:
    """True when the live guided draft (or pending ask) is on the confirm step."""
    pending = str(memory.durable.get("pending_ask") or "").strip().lower()
    if pending in {"confirm", "delete_confirm"}:
        return True
    state = memory.current_task_state()
    if state and state.status == "awaiting_confirmation":
        return True
    draft_keys = (
        ("priority_draft",) if tool_name == "create_priority"
        else ("status_draft",) if tool_name == "create_status"
        else ("ticket_draft",) if tool_name in {"create_ticket", "portal_create_ticket"}
        else ("customer_draft",) if tool_name == "create_customer"
        else ("team_draft",) if tool_name in {"create_queue", "update_queue", "delete_queue"}
        else ("macro_draft",) if tool_name in {"create_macro", "delete_macro"}
        else ("kb_draft",) if tool_name in {"create_kb_article", "draft_kb_article"}
        else ("escalate_draft",) if tool_name == "escalate_ticket"
        else ("reassign_draft",) if tool_name == "update_ticket"
        else (
            "ticket_draft",
            "customer_draft",
            "priority_draft",
            "status_draft",
            "team_draft",
            "macro_draft",
            "kb_draft",
            "escalate_draft",
            "reassign_draft",
        )
    )
    for key in draft_keys:
        draft = memory.durable.get(key)
        if isinstance(draft, dict):
            awaiting = str(draft.get("awaiting") or "").strip().lower()
            if awaiting in {"confirm", "delete_confirm"}:
                return True
    return False


def _catalog_draft_awaiting_confirm(memory: SharedMemory, tool_name: str) -> bool:
    """Compat alias — prefer `_draft_awaiting_confirm`."""
    return _draft_awaiting_confirm(memory, tool_name)


def _same_turn_confirm_retry_ok(
    memory: SharedMemory,
    tool_name: str,
    *,
    field_bound_this_turn: bool,
    awaiting_confirm_at_turn_start: bool = False,
) -> bool:
    """True when the LLM's write call this turn should complete (not re-ask).

    Collect turns still propose only. Creates need a prior summary or
    CONFIRMATION_REQUIRED. Updates **and deletes** complete on the first user
    affirm — the write invocation is the consent decision.
    """
    if field_bound_this_turn:
        return False
    name = str(tool_name or "").strip()
    prior = bool(
        awaiting_confirm_at_turn_start
        or _prior_interactive_confirm_ready(memory, name)
        or _draft_awaiting_confirm(memory, name)
    )
    if name in _UPDATE_CONFIRM_RETRY_TOOLS:
        return True
    if name in _CREATE_CONFIRM_RETRY_TOOLS:
        return prior
    return False


def _stamp_awaiting_confirm_after_unwritten_update(
    memory: SharedMemory,
    harness_skill: str | None,
    turn_successful_writes: list[str],
) -> None:
    """After a chat summary/hours ask, the next user turn may complete the write."""
    skill = str(harness_skill or "").strip().lower()
    if skill not in {
        "priority-update",
        "status-update",
        "macro-update",
        "knowledge-article-update",
        "team-update",
        "team-members-update",
        "priority-delete",
        "status-delete",
        "macro-delete",
        "team-delete",
        "ticket-resolve-reopen",
    }:
        return
    if turn_successful_writes:
        return
    if _draft_awaiting_confirm(memory):
        return
    state = memory.current_task_state()
    if state is None:
        return
    collected = dict(state.collected)
    ent = memory.durable.get("last_entity")
    ent = ent if isinstance(ent, dict) else {}
    kind = "priority" if "priority" in skill else "status" if "status" in skill else ""
    ticket_ent = str(ent.get("type") or "").strip().lower() == "ticket"
    row_id = str(
        collected.get("priority_id")
        or collected.get("status_id")
        or collected.get("queue_id")
        or collected.get("macro_id")
        or collected.get("article_id")
        or collected.get("ticket_number")
        or collected.get("ticketNumber")
        or collected.get("id")
        or (ent.get("id") if kind and str(ent.get("type") or "") == kind else "")
        or (
            ent.get("ticket_number")
            or ent.get("ticketNumber")
            or ent.get("id")
            if ticket_ent
            else ""
        )
        or ent.get("id")
        or ""
    ).strip()
    if not row_id:
        return
    from app.contracts.execution import ConfirmationEvidence

    memory.durable["pending_ask"] = "confirm"
    evidence = state.confirmation or ConfirmationEvidence(
        confirmation_id=str(uuid.uuid4()),
        task_version=state.task_version,
        skill_version=state.skill_version,
        argument_hash="chat_summary",
        requested_request_id=memory.request_id or None,
    )
    memory.set_task_state(
        state.model_copy(
            update={"status": "awaiting_confirmation", "confirmation": evidence}
        )
    )
    if skill == "ticket-resolve-reopen":
        last = memory.durable.get("last_tool_outcome")
        last = last if isinstance(last, dict) else {}
        last_tool = str(last.get("tool") or "").strip()
        last_code = str(last.get("error_code") or "").strip().upper()
        if last_tool != "update_ticket" or last_code != "CONFIRMATION_REQUIRED":
            memory.durable["last_tool_outcome"] = {
                "tool": "update_ticket",
                "success": False,
                "error_code": "CONFIRMATION_REQUIRED",
                "kind": "needs_confirm",
                "arguments": {"ticket_number": row_id},
            }


def _allow_guided_write_confirmed(
    memory: SharedMemory,
    tool_name: str,
    *,
    field_bound_this_turn: bool,
    awaiting_confirm_at_turn_start: bool = False,
) -> bool:
    """Consent may proceed only after a prior propose or prior chat summary ask.

    Blocked on the same turn a collect field was just bound, and blocked when
    the draft only became complete this turn (awaiting was not confirm at start).
    """
    if field_bound_this_turn:
        return False
    if _prior_interactive_confirm_ready(memory, tool_name):
        return True
    # Affirm turn: draft was already on confirm *before* this user message.
    if awaiting_confirm_at_turn_start:
        return True
    return _same_turn_confirm_retry_ok(
        memory,
        tool_name,
        field_bound_this_turn=False,
        awaiting_confirm_at_turn_start=bool(awaiting_confirm_at_turn_start),
    )


def _allow_catalog_create_confirmed(
    memory: SharedMemory,
    tool_name: str,
    *,
    field_bound_this_turn: bool,
) -> bool:
    """Consent may proceed after a prior propose or a prior chat summary ask.

    Still blocked on the same turn a collect field was just bound (hours/name).
    """
    if field_bound_this_turn:
        return False
    if _prior_interactive_confirm_ready(memory, tool_name):
        return True
    # Catalog: draft already awaiting confirm from a previous chat summary.
    return _draft_awaiting_confirm(memory, tool_name)


def _apply_guided_write_confirmed_flag(
    memory: SharedMemory,
    tool_name: str,
    args: dict[str, Any],
    *,
    field_bound_this_turn: bool,
    awaiting_confirm_at_turn_start: bool,
    chip_name: str = "",
) -> dict[str, Any]:
    """Schema flag for consent. LLM calling the write after a prior summary is consent.

    Collect turns still strip confirmed so the first write proposes. Affirm turns
    (summary already shown, or prior CONFIRMATION_REQUIRED) fill confirmed=true
    when the specialist invoked the write without the flag.
    """
    out = dict(args) if isinstance(args, dict) else {}
    if tool_name not in (_GUIDED_CONFIRM_WRITE_TOOLS | _INTERACTIVE_LIFECYCLE_WRITE_TOOLS):
        return out
    allowed = bool(chip_name and chip_name == tool_name) or _allow_guided_write_confirmed(
        memory,
        tool_name,
        field_bound_this_turn=bool(field_bound_this_turn),
        awaiting_confirm_at_turn_start=bool(awaiting_confirm_at_turn_start),
    )
    if (
        not allowed
        and tool_name in {"create_priority", "create_status"}
        and _allow_catalog_create_confirmed(
            memory,
            tool_name,
            field_bound_this_turn=bool(field_bound_this_turn),
        )
    ):
        allowed = True
    # Executor already judged consent (confirmed=true) and sent a complete
    # create_queue payload. Keep that flag — do not require awaiting=confirm
    # or a yes-phrase. Collect turns still strip via field_bound_this_turn.
    if (
        not allowed
        and tool_name == "create_queue"
        and not field_bound_this_turn
    ):
        from app.tools.registry import _truthy_flag as _flag_true
        from app.workflow_schemas import compute_guided_ready

        if _flag_true(out.get("confirmed")) or _flag_true(out.get("auto")):
            draft = memory.durable.get("team_draft")
            merged: dict[str, Any] = dict(draft) if isinstance(draft, dict) else {}
            for key, value in out.items():
                if key in {"confirmed", "auto", "_idempotency_key"}:
                    continue
                if value is None or (isinstance(value, str) and not value.strip()):
                    continue
                merged[key] = value
            if compute_guided_ready("create_team", merged):
                allowed = True
    # KB draft/publish: disposition + write in the same turn is the Skill
    # contract. Keep confirmed when the draft is schema-ready (including
    # publication_intent). Title/category/body collect still fails ready.
    if not allowed and tool_name in {"draft_kb_article", "create_kb_article"}:
        from app.workflow_schemas import compute_guided_ready

        draft = memory.durable.get("kb_draft")
        merged: dict[str, Any] = dict(draft) if isinstance(draft, dict) else {}
        for key, value in out.items():
            if key in {"confirmed", "auto", "_idempotency_key"}:
                continue
            if value is None or (isinstance(value, str) and not value.strip()):
                continue
            merged[key] = value
        if compute_guided_ready("create_kb", merged):
            allowed = True
    if not allowed:
        out.pop("confirmed", None)
        out.pop("auto", None)
        return out
    from app.tools.registry import _truthy_flag as _flag_true

    if not _flag_true(out.get("confirmed")) and not _flag_true(out.get("auto")):
        out["confirmed"] = True
    return out


def _kb_create_disposition_or_confirm(memory: SharedMemory) -> bool:
    """True when the live in-memory article create is past body collect."""
    draft = memory.durable.get("kb_draft")
    if not isinstance(draft, dict):
        return False
    if str(draft.get("flow") or "").strip().lower() == "manage_category":
        return False
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    return awaiting in {"publication_intent", "confirm"}


def _same_skill_park_blocked(
    memory: SharedMemory, *, harness_skill: str | None = None
) -> bool:
    """Park is Super-owned for a different Skill — not confirm on this pin."""
    skill = str(harness_skill or "").strip()
    if skill == "knowledge-article-create" and _kb_create_disposition_or_confirm(memory):
        return True
    pending = _pending_confirm_write_tool(memory)
    return pending in {"create_kb_article", "draft_kb_article"}


def _execute_return_to_super(
    arguments: dict[str, Any],
    *,
    memory: SharedMemory,
    harness_skill: str | None = None,
) -> dict[str, Any]:
    """Park/cancel the live pin. Schema-after-LLM: reject confirm-turn parks."""
    from app.contracts import tool_err

    action = str(arguments.get("action") or "park").strip().lower()
    side_query = str(arguments.get("query") or "").strip()
    if action == "park" and not side_query:
        return tool_err("BAD_INPUT", "parking requires the side-quest query")
    if action == "park" and _same_skill_park_blocked(
        memory, harness_skill=harness_skill
    ):
        return tool_err(
            "CONFLICT",
            "This utterance continues the live article create. "
            "Patch publication_intent if it is still unset, then call "
            "draft_kb_article or create_kb_article with confirmed=true. "
            "Do not park.",
            payload={
                "awaiting": str(
                    (memory.durable.get("kb_draft") or {}).get("awaiting") or ""
                ),
                "next_tool": _pending_confirm_write_tool(memory)
                or "create_kb_article",
            },
            retryable=False,
        )
    state = memory.current_task_state()
    parked = list(memory.durable.get("parked_tasks") or [])
    if state and action == "park":
        parked.append(state.model_dump(mode="json"))
        memory.durable["parked_tasks"] = parked[-10:]
    if state and action == "cancel":
        memory.durable["last_cancelled_task"] = state.model_copy(
            update={"status": "cancelled"}
        ).model_dump(mode="json")
    memory.set_task_state(None)
    _park_other_active_drafts(memory, keep_workflow="")
    memory.durable.pop("current_workflow", None)
    memory.durable.pop("pending_ask", None)
    if action == "park":
        memory.durable["_return_to_super_query"] = side_query
    return {
        "success": True,
        "payload": {
            "action": action,
            "task": state.task_id if state else None,
            "query": side_query,
        },
    }


def _pending_confirm_write_tool(memory: SharedMemory) -> str | None:
    """Primary write tool waiting on user affirm after CONFIRMATION_REQUIRED."""
    state = memory.current_task_state()
    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    tool = str(last.get("tool") or "").strip()
    code = str(last.get("error_code") or "").strip().upper()
    kind = str(last.get("kind") or "").strip().lower()
    awaiting = bool(
        state
        and (
            state.status == "awaiting_confirmation"
            or (
                state.confirmation
                and not bool(getattr(state.confirmation, "approved", False))
            )
        )
    )
    pending_ask = str(memory.durable.get("pending_ask") or "").strip().lower()
    mutation = False
    if tool:
        try:
            from app.mcp.catalog import catalog_by_name

            definition = catalog_by_name().get(tool)
            mutation = bool(
                definition and str(getattr(definition, "kind", "") or "") == "mutation"
            )
        except Exception:  # noqa: BLE001
            mutation = tool in {
                "update_ticket",
                "escalate_ticket",
                "create_ticket",
                "create_priority",
                "update_priority",
            }
    if mutation and (code == "CONFIRMATION_REQUIRED" or kind == "needs_confirm"):
        return tool
    if awaiting or pending_ask in {"confirm", "delete_confirm"}:
        from app.workflow_schemas import (
            armed_write_tools_from_state,
            preferred_armed_write_tool,
        )

        armed = armed_write_tools_from_state(memory.durable)
        if armed:
            preferred = preferred_armed_write_tool(memory.durable, armed)
            if preferred:
                return preferred
        if mutation:
            return tool
        skill = str(getattr(state, "skill_name", "") or "").strip()
        if skill == "ticket-resolve-reopen":
            return "update_ticket"
    return None


def _hydrate_pending_confirm_write_args(
    memory: SharedMemory,
    tool_name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    """Fill missing write args from the prior CONFIRMATION_REQUIRED propose.

    Does **not** decide consent. Consent is LLM-owned: the specialist must pass
    ``confirmed=true`` (or the confirm chip) after judging the user meant to
    proceed. Matching prior args alone only restores the propose payload.
    """
    from app.llm.tool_calls import flatten_tool_arguments

    out = flatten_tool_arguments(args if isinstance(args, dict) else {})
    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    if str(last.get("tool") or "").strip() != str(tool_name or "").strip():
        return out
    code = str(last.get("error_code") or "").strip().upper()
    kind = str(last.get("kind") or "").strip().lower()
    if code != "CONFIRMATION_REQUIRED" and kind != "needs_confirm":
        return out
    prior = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
    prior = flatten_tool_arguments(prior)
    for key, value in prior.items():
        if key in {"confirmed", "auto"}:
            continue
        if out.get(key) in (None, ""):
            out[key] = value
    return out


_GUIDED_PATCH_SEMANTICS_BLOCK = (
    "\n\n## Guided draft patch (hard)\n"
    "Runtime does not copy the user utterance into the draft or the right-hand "
    "panel. You must call the matching patch_*_draft this turn for every field "
    "add, change, or awaiting reopen. Judge the whole utterance against this "
    "live draft (meaning and context). Never decide from keyword lists such as "
    "change/rename/edit. "
    "patch_*_draft stores only real field values the user supplied this turn. "
    "Collect one schema field per turn — do not skip ahead. "
    "If they mean to correct a collected field and did not give the replacement, "
    "call patch with awaiting set to that field only — do not write the "
    "instruction sentence or null into title, name, body, category, hours, "
    "or description. "
    "Do not also patch a later field on that same correction turn. "
    "If this same utterance already includes the replacement, patch that field "
    "with the real value and keep sibling fields. "
    "Never invent a replacement name, title, hours, email, or label that is "
    "not in this utterance or already on the live draft. "
    "The next utterance while that slot is open is the replacement: patch it "
    "onto the open awaiting slot. Do not greet as a new create or restart from "
    "the first field while this live draft is still collecting. "
    "After a successful patch TOOL RESULT, reply only from that payload: quote "
    "kept values in payload.draft and ask only payload.awaiting. Do not ask the "
    "next unused schema field while that awaiting slot is open. After a failed "
    "patch, quote the tool error and ask the awaiting field. Never claim a "
    "write from a patch. "
    "Do not invent category or other catalog values they did not name. "
    "Call the write tool only after the draft is ready (complete sequence) "
    "and the Skill's confirm or publication choice is set."
)

_TICKET_FOCUS_SKILLS = frozenset(
    {
        "ticket-reassign",
        "ticket-escalate",
        "ticket-resolve-reopen",
        "ticket-update",
        "ticket-note-add",
        "ticket-read-search",
    }
)
_SKILL_TICKET_DRAFT = {
    "ticket-reassign": "reassign_draft",
    "ticket-escalate": "escalate_draft",
}


def _open_ui_prompt(memory: SharedMemory) -> str:
    return open_ui_item_prompt_block(
        memory.durable if isinstance(memory.durable, dict) else {}
    )


def _seed_ticket_number_from_open_ui(
    memory: SharedMemory, harness_skill: str | None
) -> None:
    """Fill lifecycle drafts from the open ticket — trusted UI, not utterance NLP."""
    skill = str(harness_skill or "").strip()
    if skill not in _TICKET_FOCUS_SKILLS:
        return
    ent = memory.durable.get("last_entity")
    if not isinstance(ent, dict) or str(ent.get("type") or "").lower() != "ticket":
        return
    raw = str(
        ent.get("ticketNumber") or ent.get("ticket_number") or ent.get("id") or ""
    ).strip()
    if not raw:
        return
    tn = raw if raw.startswith("#") or not raw.lstrip("#").isdigit() else f"#{raw.lstrip('#')}"
    draft_key = _SKILL_TICKET_DRAFT.get(skill)
    if not draft_key:
        return
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    if str(draft.get("ticket_number") or draft.get("ticketNumber") or "").strip():
        return
    draft["ticket_number"] = tn
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if awaiting in {"", "ticket"}:
        draft["awaiting"] = "person" if skill == "ticket-reassign" else "assignee"
        draft["step"] = draft["awaiting"]
    memory.durable[draft_key] = draft


_DB_GROUNDED_ENTITY_BLOCK = (
    "\n\n## DB-grounded entities (hard)\n"
    "Postgres via list/get TOOL RESULT is the only source for **existing** "
    "ids, names, roster rows, ticket numbers, and catalog labels. "
    "Never invent placeholders (`*_id_placeholder`, fake/dummy ids) or names "
    "that are not in TOOL RESULT or the user's own words this task. "
    "New create/rename values come only from the user. If an existing-row id "
    "is missing, call the matching list/get tool first — do not guess."
)


def _ontology_slice_block(
    *,
    memory: SharedMemory,
    runtime_agent_id: str,
    actor: ToolActor | None = None,
) -> str:
    from app.tools.catalog_tools import ontology_slice_prompt_block

    org = str(
        (actor.organization_id if actor else "")
        or memory.organization_id
        or ""
    ).strip()
    uid = str((actor.user_id if actor else "") or memory.user_id or "").strip()
    return ontology_slice_prompt_block(
        organization_id=org,
        user_id=uid,
        agent=runtime_agent_id,
    )


_CHAT_REPLY_STYLE_BLOCK = (
    "\n\n## User-visible reply style (hard)\n"
    "Speak like a helpful colleague on every module (tickets, customers, "
    "teams, macros, knowledge, priorities, analytics, notifications). "
    "Write a few complete, polite sentences with a brief why — never a "
    "single clipped bot line, never a labeled action menu. "
    "The entire user-visible reply MUST be valid HTML the UI will render. "
    "Allowed tags only: <p>, <ul><li>, <ol><li>, <strong>, <em>, <br>. "
    "Wrap every reply in one or more <p>…</p>. Emphasis is <strong>, "
    "never asterisks. Lists are <ul><li> or <ol><li>. "
    "Never markdown: no **bold**, no *italic*, no * or - bullets, no # "
    "headings, no `code`, no [links](url), no _underscore_. "
    "Wrong: All done! … being filed … under **My Tickets** with no ticket "
    "number from this turn’s create TOOL RESULT. "
    "Right (only after create TOOL RESULT success this turn): <p>Ticket "
    "#122 is open for the team. You can follow it under "
    "<strong>My Tickets</strong>.</p> "
    "Never say internals the staff would not use in conversation: draft, "
    "ticket_draft, customer_draft, patch, CDP, directory, 360, Domain, "
    "Skill, Executor, TOOL RESULT, verified, customerId, Postgres, refuse, "
    "or route names. Never say a draft still has a name or that nothing "
    "was saved. "
    "**Empty TOOL RESULT (hard — every module):** When this turn’s list/get "
    "is empty (`rows: []`, no tickets, no customers, no macros, no articles, "
    "no events, zero metric), tell them plainly that no data exists for "
    "that person or thing. Fresh wording. Do not narrate looking, searching, "
    "fetching, checking the system, empty matches, spelling checks, or "
    "trying another filter. Never invent rows. When rows exist, quote only "
    "those fields. "
    "When a field is still needed, acknowledge what they just "
    "shared, add a brief everyday why, then ask once. Never write "
    "'Alternatives:' or a semicolon list of next actions — weave help "
    "into the same paragraph (for example, offer to look someone up or "
    "file a ticket). Do not open with a titled report banner. "
    "Runtime-built HTML tables are allowed; do not invent your own heading "
    "above them. Vary wording each turn."
)

_TOOL_CALL_FORMAT_BLOCK = (
    "\n\n## Tool invocation format (hard)\n"
    "When you need to call a tool, use the bound structured tool_calls channel "
    "only — never write the invocation in assistant message text.\n"
    "- Correct: empty or brief assistant content plus a structured tool call "
    "with name and JSON arguments.\n"
    "- Forbidden in assistant text: `call:`, `<|tool_call>`, `<tool_calls>`, "
    "`call:ticketing:update_queue{...}`, pseudo-JSON tool dumps, or any "
    "tool name with `{key:value}` braces in the reply.\n"
    "- User-visible replies are natural prose after TOOL RESULT only; tool "
    "names and argument blobs must not appear in chat."
)

_CUSTOMER_CHANNEL_REPLY_BLOCK = (
    "\n\n## Customer-facing replies (hard — portal / end customer)\n"
    "You are speaking to the customer, not staff. Never mention internal "
    "systems: no directory, CDP, customer found, verified, customerId, or "
    "database lookup.\n"
    "After contact verification succeeds: use their name from the tool result "
    "in a warm, newly worded paragraph and ask what they need. Do not announce "
    "verification or a directory match. Do not mention draft or leftover form "
    "state. Do not copy a greeting template.\n"
    "Issue quality is the same as staff: if the problem is too thin to work, "
    "ask one follow-up; only after a rephrase and issueReady=true recap and file. "
    "If a file would help, you may ask once to use + in this chat; never require it."
)

_STAFF_TICKET_CREATE_REPLY_BLOCK = (
    "\n\n## Staff create-ticket replies (hard — coworker / staff surface)\n"
    "You are speaking to a **staff agent** filing a ticket on behalf of a "
    "customer — the customer is not in this chat.\n"
    "- Match Super greeting quality: a few complete, polite sentences, then "
    "one ask. Invent new wording every turn. Never a form-prompt one-liner.\n"
    "- Ask only the next missing field (name, then email or phone, then issue). "
    "Do not replay a full capability hello mid-flow.\n"
    "- After verify_ticket_customer succeeds: speak to the **agent**. Weave "
    "customerName + contact from TOOL RESULT into a new paragraph, then ask "
    "what to write up for that person. Never greet the customer as if they "
    "are in chat. Never reuse is on file / what issue should I file.\n"
    "- Never say directory, CDP, verified, customer found, or customerId.\n"
    "- Do not re-ask name/contact already in ticket_draft.\n"
    "- After they describe the problem, judge from the conversation whether a "
    "resolver could act. If not, ask one follow-up and stay on the issue — do "
    "not recap or file. If a picture or file would help, you may ask the agent "
    "once to use + in this chat; never require it and never invent URLs. "
    "When the text is complete, rephrase, patch issue plus "
    "issueReady=true, then `list_tickets` is an internal same-customer "
    "check only. Never show, narrate, or paginate that roster (no counts, no "
    "pages, no ticket table). Runtime will not paint a table on this Skill.\n"
    "- Judge same vs new from TOOL RESULT rows plus the rephrased draft issue "
    "(LLM meaning — never word lists). Same listed orderId as this draft "
    "(even if the issue text differs) or same issue, and status is not "
    "Resolved or Closed → quote that listed "
    "number, stamp "
    "`precreate_duplicate_check=duplicate`, do not create. Same issue or same "
    "orderId and status is Resolved or Closed → ask whether to reopen that "
    "listed ticket; "
    "do not create; do not stamp not_duplicate. They mean reopen → "
    "return_to_super park naming that listed number. They decline reopen but "
    "still want a new file → stamp not_duplicate then recap. No same-issue "
    "or same-orderId "
    "row → stamp `precreate_duplicate_check=not_duplicate` and recap name, "
    "contact, and the rephrased issue, then ask whether to file."
)

_NUMERIC_ENTITY_ID_TOOLS: dict[str, tuple[tuple[str, ...], str]] = {
    "update_priority": (("priority_id", "id"), "list_priorities"),
    "delete_priority": (("priority_id", "id"), "list_priorities"),
    "update_status": (("status_id", "id"), "list_statuses"),
    "delete_status": (("status_id", "id"), "list_statuses"),
    "update_queue": (("queue_id", "id"), "list_queues"),
    "delete_queue": (("queue_id", "id"), "list_queues"),
    "update_kb_article": (("article_id", "id"), "list_kb"),
    "publish_kb_article": (("article_id", "id"), "list_kb"),
    "update_macro": (("macro_id", "id"), "list_macros"),
    "delete_macro": (("macro_id", "id"), "list_macros"),
}


def _reject_ungrounded_entity_args(
    name: str,
    args: dict[str, Any],
    memory: SharedMemory | None = None,
) -> dict[str, Any] | None:
    """Block invented ids before confirm / MCP / Express."""
    from app.contracts import tool_err
    from app.tools.catalog_tools import (
        catalog_row_id_usable,
        coerce_catalog_id_values,
        entity_ref_invented,
        kb_article_id_usable,
    )

    for key in (
        "priority_id",
        "priority_ids",
        "status_id",
        "status_ids",
        "queue_id",
        "article_id",
        "macro_id",
        "customer_id",
        "ticket_number",
        "id",
    ):
        raw = args.get(key)
        items = (
            list(raw)
            if isinstance(raw, (list, tuple))
            else [raw]
            if raw not in (None, "")
            else []
        )
        for item in items:
            if entity_ref_invented(item):
                return tool_err(
                    "MISSING_CATALOG_ID",
                    f"Do not invent {key}. Use the numeric id or ticket number "
                    "from the matching list/get TOOL RESULT.",
                    payload={"field": key},
                    retryable=False,
                )
    spec = _NUMERIC_ENTITY_ID_TOOLS.get(str(name or "").strip())
    if not spec:
        return None
    keys, next_tool = spec
    values: list[Any] = []
    for key in keys:
        values.extend(coerce_catalog_id_values(args.get(key)))
    batch_key = (
        "priority_ids"
        if name == "delete_priority"
        else "status_ids"
        if name == "delete_status"
        else ""
    )
    if batch_key:
        values.extend(coerce_catalog_id_values(args.get(batch_key)))
    if not values:
        raw = ""
    else:
        raw = values[0]
    usable = catalog_row_id_usable(raw)
    if name in {"update_kb_article", "publish_kb_article", "get_kb"}:
        usable = kb_article_id_usable(raw)
    listed_ids = (
        _listed_catalog_ids(_last_query_dict(memory))
        if memory
        and name
        in {
            "update_priority",
            "delete_priority",
            "update_status",
            "delete_status",
        }
        else set()
    )
    check_values = values or ([raw] if raw not in (None, "") else [])
    if name in {"delete_priority", "delete_status"} and check_values:
        if not listed_ids:
            return tool_err(
                "MISSING_CATALOG_ID",
                f"Call {next_tool} and pass the numeric id from TOOL RESULT. "
                "Do not invent ids or use labels as ids.",
                payload={"next_tool": next_tool},
                retryable=False,
            )
        for item in check_values:
            item_id = catalog_row_id_usable(item)
            if not item_id or item_id not in listed_ids:
                return tool_err(
                    "MISSING_CATALOG_ID",
                    f"{keys[0]} must be an id from the last {next_tool} TOOL RESULT. "
                    "Do not use sortOrder or invent an id.",
                    payload={"next_tool": next_tool},
                    retryable=False,
                )
        return None
    if memory and name in {
        "update_priority",
        "update_status",
    }:
        if listed_ids and usable and usable not in listed_ids:
            return tool_err(
                "MISSING_CATALOG_ID",
                f"{keys[0]} must be an id from the last {next_tool} TOOL RESULT. "
                "Do not use sortOrder or invent an id.",
                payload={"next_tool": next_tool},
                retryable=False,
            )
    if usable:
        return None
    kb_msg = (
        f"Call {next_tool} and pass the article id from TOOL RESULT "
        "(KB-… or numeric). Do not invent ids or use titles as ids."
        if name in {"update_kb_article", "publish_kb_article", "get_kb"}
        else (
            f"Call {next_tool} and pass the numeric id from TOOL RESULT. "
            "Do not invent ids or use labels as ids."
        )
    )
    return tool_err(
        "MISSING_CATALOG_ID",
        kb_msg,
        payload={"next_tool": next_tool},
        retryable=False,
    )


def _harness_confirm_policy_block(memory: SharedMemory, skill: Any) -> str:
    """Shared confirm guidance — LLM semantic consent only (no keyword lists)."""
    policy = str(getattr(skill, "approval_policy", "") or "").strip().lower()
    interactive = policy in {
        "interactive_semantic",
        "interactive_high_risk",
        "channel_dependent",
    }
    pending_tool = _pending_confirm_write_tool(memory)
    if not interactive and not pending_tool:
        return ""
    lines = [
        "\n\n## Confirmation policy (all write Skills)",
        "- Consent is **your** semantic judgment from the full conversation "
        "(meaning proceed / save / apply / do it) — never keyword or regex lists "
        "(not yes/ok/confirm/go ahead tables).",
        "- If you judge they already consented this turn (they asked to "
        "change/delete, or they answered a summary/hours ask): call the write "
        "tool with `confirmed=true` **now**. Do **not** propose, then ask "
        "again, then wait for a second agree.",
        "- Create collect is different: after the last field is filled, "
        "summarize and ask once; on the **next** turn call create with "
        "`confirmed=true`.",
        "- If TOOL RESULT is CONFIRMATION_REQUIRED after you already judged "
        "consent, retry the **same** tool with `confirmed=true` in this turn "
        "— do not re-ask.",
        "- If they refuse, ask a question, or change a field: do **not** pass "
        "`confirmed=true`; collect the correction or cancel instead.",
        "- Never claim a mutation succeeded without a successful tool result.",
    ]
    if pending_tool:
        last = memory.durable.get("last_tool_outcome")
        last = last if isinstance(last, dict) else {}
        prior = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
        lines.extend(
            [
                "",
                "## Pending confirmation (context only — you decide consent)",
                f"- Prior write tool: `{pending_tool}`",
                f"- Prior arguments: {json.dumps(prior, ensure_ascii=False, default=str)}",
                "- If this turn means proceed → call that tool with `confirmed=true`. "
                "If not, do not execute the write.",
            ]
        )
    return "\n".join(lines)


def _run_harness_executor(
    *,
    instruction: DomainInstruction,
    llm,
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
    actor: ToolActor,
    budgets: BudgetTracker,
) -> dict[str, Any]:
    from app.skills.catalog import load_skill_definition
    from app.workflow_schemas import new_harness_task_state

    task = task_definition_for(instruction.task_id)
    if (
        not task
        or task.domain != memory.durable.get("active_domain")
        or task.executor != instruction.executor_id
        or task.skill_name != instruction.skill_name
    ):
        raise ValueError("Domain delegation does not match the registered task")
    refused = _harness_rbac_refuse(
        memory=memory,
        query=query,
        role=str(actor.user_role or "") or None,
        skill_name=instruction.skill_name,
        agent=instruction.executor_id,
    )
    if refused is not None:
        return refused
    skill = load_skill_definition(task.skill_name)
    if not skill.active:
        raise ValueError(f"Skill is inactive: {skill.name}")
    request: RunRequest = context["request"]
    from app.mcp.authorization import issue_mcp_token, verify_mcp_token
    from app.skills.catalog import tools_for_skill

    token_org = str(request.actor.organization_id or "")
    token_actor = str(request.actor.user_id or "")
    token_role = str(request.actor.user_role or "")
    token_module = str(context.get("module") or "") or None
    token_surface = str(context.get("surface") or "") or None
    token_run_id = str(context.get("request_id") or memory.request_id or "") or None
    if request.mcp_token:
        parent_claims = verify_mcp_token(request.mcp_token)
        if (
            str(parent_claims.get("organization_id") or "")
            != str(request.actor.organization_id or "")
            or str(parent_claims.get("actor_id") or "")
            != str(request.actor.user_id or "")
        ):
            raise ValueError("MCP delegation token actor/organization mismatch")
        for claim_key, expected in (
            ("agent_id", task.executor),
            ("task_id", task.id),
            ("skill_name", skill.name),
            ("skill_version", skill.version),
        ):
            pinned = str(parent_claims.get(claim_key) or "").strip()
            if pinned and pinned != expected:
                raise ValueError(f"MCP delegation token {claim_key} mismatch")
        token_org = str(parent_claims.get("organization_id") or token_org)
        token_actor = str(parent_claims.get("actor_id") or token_actor)
        token_role = str(parent_claims.get("role") or token_role)
        token_module = str(parent_claims.get("module") or token_module or "") or None
        token_surface = str(parent_claims.get("surface") or token_surface or "") or None
        token_run_id = str(parent_claims.get("run_id") or token_run_id or "") or None
    context["mcp_token"] = issue_mcp_token(
        organization_id=token_org,
        actor_id=token_actor,
        role=token_role,
        module=token_module,
        surface=token_surface,
        run_id=token_run_id,
        allowed_tools=sorted(tools_for_skill(task.skill_name, task.executor)),
        agent_id=task.executor,
        task_id=task.id,
        skill_name=skill.name,
        skill_version=skill.version,
        route_mode="executor",
    )
    supplied = (
        dict(instruction.supplied_fields)
        if isinstance(instruction.supplied_fields, dict)
        else {}
    )
    current = memory.current_task_state()
    if not current or current.task_id != task.id:
        current = new_harness_task_state(
            task.id,
            channel=str(context["request"].channel or context.get("surface") or "") or None,
            collected=supplied,
            provenance={key: "domain" for key in supplied},
        )
        memory.set_task_state(current)
    else:
        updates: dict[str, Any] = {}
        if supplied:
            updates["collected"] = {**(current.collected or {}), **supplied}
            # Preserve prior provenance (e.g. hydrated_draft); only stamp new keys.
            prov = dict(current.provenance or {})
            for key in supplied:
                if key not in prov:
                    prov[key] = "domain"
            updates["provenance"] = prov
        # Domain re-delegation after a false "completed" must reopen collection.
        if current.status in {"completed", "failed", "cancelled", "refused"}:
            last = memory.durable.get("last_tool_outcome")
            last = last if isinstance(last, dict) else {}
            from app.workflow_schemas import is_primary_task_mutation

            primary_ok = bool(last.get("success")) and is_primary_task_mutation(
                task.id, str(last.get("tool") or "")
            )
            if not primary_ok:
                updates["status"] = "collecting"
        if updates:
            memory.set_task_state(current.model_copy(update=updates))
    # Domain supplied_fields / TaskState.collected must land on the live draft
    # before absorb, hydrate, or MISSING_FIELDS gates run.
    _sync_guided_draft_from_task(memory, task.id)
    _stamp_guided_drafts_at_turn_start(memory)
    if task.id == "macro.create":
        _stamp_macro_intent_start_if_fresh(memory, query)
    elif task.id == "knowledge.article.create":
        _stamp_kb_intent_start_if_fresh(memory, query)
    elif task.id in {"priority.create", "status.create"}:
        _stamp_catalog_label_intent_start_if_fresh(memory, query, task.id)
    if isinstance(request.confirm_tool, dict) and str(
        request.confirm_tool.get("name") or ""
    ).strip():
        memory.durable["force_armed_write"] = True
    product_profile = _EXECUTOR_PRODUCT_PROFILE.get(instruction.executor_id)
    if not product_profile:
        raise ValueError(f"Executor has no product profile: {instruction.executor_id}")
    executor_manifest = load_agent_definition(instruction.executor_id)
    if str(executor_manifest.execution_mode or "").strip().lower() == "deterministic":
        result = _run_deterministic_executor(
            instruction=instruction,
            skill=skill,
            memory=memory,
            query=query,
            context=context,
            actor=actor,
            budgets=budgets,
        )
    else:
        result = _run_executor_loop(
            agent_name=product_profile,
            llm=llm,
            memory=memory,
            query=query,
            context=context,
            actor=actor,
            budgets=budgets,
            module=context.get("module"),
            surface=context.get("surface"),
            page=context.get("page"),
            role=context["request"].actor.user_role,
            harness_executor=instruction.executor_id,
            harness_skill=skill.name,
        )
    result["agent"] = instruction.executor_id
    data = dict(result.get("data") or {})
    data["harness"] = {
        "domain": task.domain,
        "executor": task.executor,
        "task_id": task.id,
        "task_version": task.version,
        "skill_name": skill.name,
        "skill_version": skill.version,
        "skill_digest": skill.content_digest,
    }
    result["data"] = data
    state = memory.current_task_state()
    if state:
        from app.workflow_schemas import is_primary_task_mutation

        pending_ask = str(memory.durable.get("pending_ask") or "").strip().lower()
        last_outcome = memory.durable.get("last_tool_outcome")
        last_outcome = last_outcome if isinstance(last_outcome, dict) else {}
        last_tool_name = str(last_outcome.get("tool") or "")
        last_tool_definition = catalog_by_name().get(last_tool_name)
        last_code = str(last_outcome.get("error_code") or "").strip().upper()
        last_kind = str(last_outcome.get("kind") or "").strip().lower()
        needs_confirm = (
            last_code == "CONFIRMATION_REQUIRED"
            or last_kind == "needs_confirm"
            or state.status == "awaiting_confirmation"
            or bool(state.confirmation and not getattr(state.confirmation, "approved", False))
        )
        # Only the task's primary write completes the harness pin. Helper mutations
        # (or an empty pending_ask) must not force Super to re-route next turn.
        # Successful analytics/list reads do complete so the next ask can remount
        # (e.g. how-many → why must leave analytics.query for analytics.root.cause).
        completed_tool = (
            bool(last_outcome.get("success"))
            and bool(last_tool_definition and last_tool_definition.kind == "mutation")
            and is_primary_task_mutation(state.task_id, last_tool_name)
        )
        turn_read_ok = bool(memory.durable.pop("_harness_turn_read_ok", None))
        task_id_now = str(state.task_id or "").strip().lower()
        analytics_read_task = task_id_now.startswith(
            ("analytics.", "dashboard.", "csat.", "audit.")
        )
        completed_read = (
            turn_read_ok
            and analytics_read_task
            and bool(last_outcome.get("success"))
            and bool(last_tool_definition and last_tool_definition.kind == "read")
            and not needs_confirm
            and pending_ask not in {"confirm", "delete_confirm"}
            and not pending_ask
        )
        if completed_tool:
            memory.set_task_state(
                state.model_copy(
                    update={
                        "status": "completed",
                        "last_tool_outcome": dict(last_outcome) or None,
                    }
                )
            )
            # Memory policy: clear working pin so Super can route the next ask.
            memory.set_task_state(None)
            patch = result.get("session_memory_patch")
            if isinstance(patch, dict):
                patch.update(_harness_session_pin_fields(memory))
                if not memory.durable.get("current_workflow"):
                    patch["pendingIntent"] = None
                    patch["pendingAsk"] = None
            return result
        if completed_read:
            status = "completed"
        elif (
            state.mutation_attempted
            and last_tool_definition
            and last_tool_definition.kind == "mutation"
            and last_outcome.get("success") is False
            and is_primary_task_mutation(state.task_id, last_tool_name)
            and not needs_confirm
        ):
            status = "failed"
        elif needs_confirm or pending_ask in {"confirm", "delete_confirm"}:
            status = "awaiting_confirmation"
            if pending_ask not in {"confirm", "delete_confirm"}:
                memory.durable["pending_ask"] = "confirm"
        else:
            status = "collecting"
        memory.set_task_state(
            state.model_copy(
                update={
                    "status": status,
                    "last_tool_outcome": dict(last_outcome) or None,
                }
            )
        )
    return result


def _primary_write_already_succeeded(
    memory: SharedMemory, task_id: str | None
) -> bool:
    """True when last_tool_outcome already completed this task's primary write."""
    from app.workflow_schemas import is_primary_task_mutation

    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    if not last.get("success"):
        return False
    return is_primary_task_mutation(task_id, str(last.get("tool") or ""))


def _release_stale_harness_pin(memory: SharedMemory) -> bool:
    """Drop a leftover pin after the primary write already succeeded.

    Client sessionMemory can keep harnessTaskId after a successful create; that
    must not skip Super on the next utterance (e.g. create macros after priority).
    """
    active = memory.current_task_state()
    if not active:
        return False
    if active.status in {"completed", "cancelled", "refused", "failed"}:
        memory.set_task_state(None)
        return True
    # Fresh collect after Super remount has mutation_attempted=False — keep it.
    # A leftover pin after the write already ran has mutation_attempted=True.
    if not (
        bool(getattr(active, "mutation_attempted", False))
        and _primary_write_already_succeeded(memory, active.task_id)
    ):
        return False
    memory.set_task_state(None)
    memory.durable.pop("current_workflow", None)
    memory.durable.pop("pending_ask", None)
    return True


def _harness_session_pin_fields(memory: SharedMemory) -> dict[str, Any]:
    """Live pin, or explicit nulls so the UI shallow-merge drops a stale pin."""
    task_state = memory.current_task_state()
    live = bool(
        task_state
        and task_state.status
        not in {"completed", "cancelled", "refused", "failed"}
    )
    if live and task_state:
        return {
            "harnessTaskId": task_state.task_id,
            "harnessFields": dict(task_state.collected or {}),
            "idempotencyKey": task_state.idempotency_key,
        }
    return {
        "harnessTaskId": None,
        "harnessFields": None,
        "idempotencyKey": None,
    }


def _skill_requires_mutation_tools(skill_name: str | None) -> bool:
    """True when the selected Skill is a registered create/update/delete capability."""
    name = str(skill_name or "").strip().lower()
    return any(
        token in name
        for token in ("create", "update", "delete", "members", "publish", "import")
    )


def _turn_committed_write(tools_called: list[str]) -> bool:
    """True when this turn invoked a create/update/delete commit tool."""
    for name in tools_called:
        n = str(name or "").strip().lower()
        if n.startswith(("create_", "update_", "delete_", "draft_", "publish_")):
            return True
    return False


def _live_in_memory_create_draft(memory: SharedMemory) -> bool:
    """True while a create collect is open and has no persisted catalog/ticket id."""
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    spec = _ACTIVE_WORKFLOW_DRAFT.get(wf)
    draft_key = spec[0] if spec else ""
    if not draft_key:
        state = memory.current_task_state()
        guided = _GUIDED_TASK_DRAFT.get(str(getattr(state, "task_id", "") or "").strip())
        if guided:
            draft_key = guided[0]
            wf = str(guided[1] or wf).strip().lower()
    if not draft_key or not wf.startswith("create_"):
        return False
    draft = memory.durable.get(draft_key)
    if not isinstance(draft, dict):
        return False
    from app.tools.catalog_tools import catalog_row_id_usable

    if catalog_row_id_usable(
        draft.get("id") or draft.get("queue_id") or draft.get("article_id")
    ):
        return False
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    return awaiting not in {"", "done"}


def _ground_unverified_mutation_reply(
    text: str | None,
    *,
    skill_name: str | None,
    tools_called: list[str],
    memory: SharedMemory | None = None,
) -> str | None:
    """Do not paint a write as done unless a commit tool ran this turn."""
    if _turn_committed_write(tools_called) or not _skill_requires_mutation_tools(
        skill_name
    ):
        return None
    # Live create collect is not an existing-row update — do not rewrite the
    # next-field ask into "which existing item".
    if memory is not None and _live_in_memory_create_draft(memory):
        return None
    raw = str(text or "").strip()
    if not looks_like_unverified_write_claim(raw):
        return None
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="admin",
            kind="ask",
            fallback=(
                "Do not claim the catalog or ticket change was saved. Ask which "
                "existing item to change, or call the list/update tool next."
            ),
            context={
                "hint": (
                    "No create/update/delete tool ran this turn. Do not say the "
                    "row was updated, created, or deleted. Ask for the target or "
                    "call the authorized tool."
                ),
                "skill": str(skill_name or ""),
            },
        )
        out = str(reply or "").strip()
        if out:
            return out
    except Exception:  # noqa: BLE001
        pass
    return (
        "I have not saved that change yet. Tell me the existing item to update "
        "and the new value, and I will apply it with the catalog tool."
    )


def _park_live_harness_task(memory: SharedMemory) -> None:
    """Park working TaskState so Super/Domain can mount a different Skill."""
    state = memory.current_task_state()
    if not state:
        return
    parked = list(memory.durable.get("parked_tasks") or [])
    parked.append(state.model_dump(mode="json"))
    memory.durable["parked_tasks"] = parked[-10:]
    memory.set_task_state(None)
    _park_other_active_drafts(memory, keep_workflow="")
    memory.durable.pop("current_workflow", None)
    memory.durable.pop("pending_ask", None)


def _guided_pin_draft(
    memory: SharedMemory, active: Any
) -> tuple[str | None, dict[str, Any]]:
    """(workflow_id, live draft) for a guided-collect pin, else (None, {})."""
    spec = _GUIDED_TASK_DRAFT.get(str(getattr(active, "task_id", "") or "").strip())
    if not spec:
        return None, {}
    draft_key, workflow_id, _kind = spec
    draft = memory.durable.get(draft_key)
    if isinstance(draft, dict):
        return workflow_id, draft
    collected = getattr(active, "collected", None)
    return workflow_id, dict(collected) if isinstance(collected, dict) else {}


_TYPED_COLLECT_SLOT_TYPES = frozenset(
    {"email", "phone", "contact", "person_name", "positive_number"}
)


def _utterance_fits_live_pin_slot(
    memory: SharedMemory, query: str, active: Any, *, typed_only: bool = False
) -> bool:
    """Schema check: utterance can fill the live create-collect slot."""
    from app.workflow_schemas import (
        CONFIRM_AWAITING,
        _awaiting_slot,
        bind_awaiting_value,
        bind_primary_missing,
        schema_for_workflow,
    )

    workflow_id, draft = _guided_pin_draft(memory, active)
    if not workflow_id:
        return False
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if awaiting in CONFIRM_AWAITING or awaiting == "members_confirm":
        return False if typed_only else True
    if not awaiting:
        return False
    if typed_only:
        schema = schema_for_workflow(workflow_id) or {}
        slot = _awaiting_slot(workflow_id, awaiting)
        slot_type = str((schema.get("slot_types") or {}).get(slot) or "").strip().lower()
        if slot_type not in _TYPED_COLLECT_SLOT_TYPES:
            return False
    if bind_awaiting_value(workflow_id, awaiting, query):
        return True
    if typed_only:
        return False
    return bool(bind_primary_missing(workflow_id, draft, query))


def _last_assistant_visible(memory: SharedMemory) -> str:
    for msg in reversed(list(getattr(memory, "messages", None) or [])):
        if not isinstance(msg, dict):
            continue
        if str(msg.get("role") or "").strip() != "assistant":
            continue
        text = str(msg.get("content") or "").strip()
        if text:
            return text
    return ""


def _visible_reply_key(text: str) -> str:
    raw = str(text or "").strip().lower()
    for tag in (
        "<p>",
        "</p>",
        "<br>",
        "<br/>",
        "<br />",
        "<strong>",
        "</strong>",
        "<em>",
        "</em>",
        "<ul>",
        "</ul>",
        "<ol>",
        "</ol>",
        "<li>",
        "</li>",
    ):
        raw = raw.replace(tag, " ")
    return " ".join(raw.split())


def _super_prose_freshness_block(memory: SharedMemory) -> str:
    prev = _last_assistant_visible(memory)
    excerpt = prev[:400] if prev else "(none)"
    return (
        "\n\n## Reply freshness\n"
        f"Token: {time.time()}-{random.randrange(10**6):06d}\n"
        "If this turn is only a greeting or thanks, invent a new opening. "
        "Never reuse a stock hello or the last assistant reply.\n"
        f"Last assistant reply (do not copy): {excerpt}\n"
    )


def _llm_turn_messages(
    system: str,
    memory: SharedMemory,
    query: str,
) -> list[dict[str, Any]]:
    """System + short-term transcript + this turn. Shared by Super, Domain, Executor."""
    locale = str((memory.durable or {}).get("reply_locale") or "").strip()
    if locale:
        system = (
            f"{system}\n\n## Reply language\n"
            f"Write the assistant reply in locale {locale}. "
            "Keep ticket numbers, status keys, and tool names unchanged."
        )
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    last_user = ""
    for msg in memory.messages:
        role = str(msg.get("role") or "").strip()
        content = str(msg.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append({"role": role, "content": content})
        if role == "user":
            last_user = content
    q = str(query or "").strip()
    if q and q != last_user:
        messages.append({"role": "user", "content": q})
    return messages


def _revalidate_live_pin_should_continue(
    *,
    llm,
    memory: SharedMemory,
    query: str,
    active: Any,
) -> bool:
    """Second Super pass before parking: keep unfinished draft corrections on the pin."""
    workflow_id, draft = _guided_pin_draft(memory, active)
    super_manifest = load_agent_definition("ticketing_super_agent")
    pin_blob = {
        "task_id": getattr(active, "task_id", None),
        "skill_name": getattr(active, "skill_name", None),
        "status": getattr(active, "status", None),
        "workflow_id": workflow_id,
        "awaiting": str((draft or {}).get("awaiting") or "").strip() or None,
        "draft": {
            key: value
            for key, value in (draft or {}).items()
            if not str(key).startswith("_")
        },
    }
    system = (
        super_manifest.prompt
        + _ontology_slice_block(
            memory=memory,
            runtime_agent_id="ticketing_super_agent",
        )
        + "\n\n## Active unfinished draft (working memory)\n"
        + json.dumps(pin_blob, ensure_ascii=False, default=str)
        + "\nRead the full conversation above. Judge the whole utterance against "
        "that unfinished draft (meaning and context), never keyword lists. "
        "If this utterance answers, replaces, or reopens any field of that "
        "draft — including a replacement value after they asked to correct a "
        "collected field — call continue_active_task. Call route_to_domain only "
        "when they mean a different Skill or a persisted catalog/ticket row, "
        "not this live draft. Empty is not a new route."
        + _open_ui_prompt(memory)
        + "\n\n"
        + memory.memory_prompt_blocks()
        + _TOOL_CALL_FORMAT_BLOCK
    )
    result = llm.run(
        _llm_turn_messages(system, memory, query),
        tools=[
            _CONTINUE_ACTIVE_TASK.to_openai_tool(),
            _super_route_to_domain_tool(memory),
        ],
    )
    if _first_tool_call(result, "continue_active_task") is not None:
        return True
    if _first_tool_call(result, "route_to_domain") is not None:
        return False
    return True


def _harness_rbac_refuse(
    *,
    memory: SharedMemory,
    query: str,
    role: str | None,
    skill_name: str | None,
    agent: str,
) -> dict[str, Any] | None:
    """Stop before field collection when the signed-in role cannot perform this Skill."""
    from app.rbac import skill_rbac_refusal

    refusal = skill_rbac_refusal(role, skill_name)
    if refusal is None:
        return None
    memory.set_task_state(None)
    content = str(refusal.get("message") or "").strip()
    alternatives = refusal.get("alternatives")
    memory.add_message("user", query)
    memory.add_message("assistant", content)
    try:
        from app.observability.turn_log import record_tool

        record_tool(
            "refuse_capability",
            {"code": "forbidden", "skill_name": skill_name},
            {"success": True},
            agent=agent,
        )
    except Exception:  # noqa: BLE001
        pass
    return {
        "response_type": "final",
        "assistant_text": content,
        "agent": agent,
        "data": {
            "refusal": {
                "code": "forbidden",
                "message": str(refusal.get("message") or content),
                "alternatives": alternatives if isinstance(alternatives, list) else [],
                "skill_name": skill_name,
            }
        },
    }


def _super_live_pin_decision(
    *,
    llm,
    memory: SharedMemory,
    query: str,
    active: Any,
    role: str | None = None,
) -> dict[str, Any]:
    """Super LLM: CONTINUE the live pin vs NEW_TASK route. Never skip Super."""
    from app.rbac import rbac_prompt_block
    from app.runtime.supervisor import DOMAIN_AGENT_IDS

    super_manifest = load_agent_definition("ticketing_super_agent")
    domain_descriptions = [
        {
            "domain_id": domain_id,
            "description": load_agent_definition(domain_id).description,
        }
        for domain_id in sorted(DOMAIN_AGENT_IDS)
    ]
    workflow_id, draft = _guided_pin_draft(memory, active)
    pin_blob = {
        "task_id": active.task_id,
        "skill_name": active.skill_name,
        "status": active.status,
        "awaiting": str((draft or {}).get("awaiting") or "").strip() or None,
        "surface": str((draft or {}).get("surface") or "").strip() or None,
        "workflow_id": workflow_id,
        "collected": dict(active.collected or {}),
        "draft": {
            key: value
            for key, value in (draft or {}).items()
            if not str(key).startswith("_")
        },
    }
    super_prompt = (
        super_manifest.prompt
        + _ontology_slice_block(
            memory=memory,
            runtime_agent_id="ticketing_super_agent",
            actor=None,
        )
        + "\n\n## Eligible Domains\n"
        + json.dumps(domain_descriptions, ensure_ascii=False)
        + "\n\n## Active task (working memory)\n"
        + json.dumps(pin_blob, ensure_ascii=False, default=str)
        + "\nRead the full conversation. Judge the whole utterance against that "
        "live Skill (meaning and context), never keyword lists such as "
        "change/rename. If this utterance continues that same Skill — a "
        "missing-field answer, a correction of any already-collected draft "
        "field, a replacement value after they asked to correct a field, "
        "confirm or refuse **of that Skill's recap**, or more of the same "
        "self-service/KB walk — call continue_active_task. On portal "
        "(draft surface=portal), every problem / enquiry (any wording, no "
        "file-ticket ask) is route_to_domain intake so Domain can pin "
        "deflection / search_kb — not continue ticket-create, even if "
        "awaiting=issue. Unsolved self-service (the walk did not help) is "
        "still that deflection Skill — `continue_active_task` so the "
        "Executor can ask whether to file. Filing a **new** "
        "ticket is not continuing `intake-self-service-deflection` / "
        "`knowledge-search`: that is `route_to_domain` intake so Domain can "
        "pin ticket-create this hop, and only after they asked or agreed to "
        "file. A live create draft field correction is "
        "still that create Skill, not an update of a persisted row. A "
        "read/list Skill has no write to confirm: consent to remove or change "
        "a listed catalog row is route_to_domain (delete or update), never "
        "continue_active_task on the read pin. Call route_to_domain only for "
        "different Ticketing work or a saved/focused entity; the live pin is "
        "parked first."
        + " If they start a CRUD action this role cannot perform, "
        "call refuse_capability with code=forbidden instead of continue or route."
        + _SUPER_DOMAIN_OWNERSHIP
        + _super_avoid_domain_block(memory)
        + rbac_prompt_block(role, layer="super")
        + _open_ui_prompt(memory)
        + "\n\n"
        + memory.memory_prompt_blocks()
        + _CHAT_REPLY_STYLE_BLOCK
        + _TOOL_CALL_FORMAT_BLOCK
    )
    messages = _llm_turn_messages(super_prompt, memory, query)
    pin_tools = [
        _CONTINUE_ACTIVE_TASK.to_openai_tool(),
        _super_route_to_domain_tool(memory),
        _super_refuse_tool_for_role(role).to_openai_tool(),
    ]
    route_result = llm.run(messages, tools=pin_tools)
    if (
        _first_tool_call(route_result, "continue_active_task") is None
        and _first_tool_call(route_result, "route_to_domain") is None
        and _first_tool_call(route_result, "refuse_capability") is None
        and not str(route_result.get("content") or "").strip()
    ):
        retry_messages = [
            *messages,
            {
                "role": "user",
                "content": (
                    "You must call continue_active_task, route_to_domain, or "
                    "refuse_capability. Do not reply empty."
                ),
            },
        ]
        route_result = llm.run(retry_messages, tools=pin_tools)
    refuse_args = _first_tool_call(route_result, "refuse_capability")
    if refuse_args is not None and _super_should_retry_customer_refuse(role, refuse_args):
        retry_lifecycle = [
            *messages,
            {
                "role": "user",
                "content": _SUPER_CUSTOMER_REFUSE_RETRY,
            },
        ]
        route_only = [
            _CONTINUE_ACTIVE_TASK.to_openai_tool(),
            _super_route_to_domain_tool(memory),
        ]
        route_result = llm.run(retry_lifecycle, tools=route_only)
        refuse_args = _first_tool_call(route_result, "refuse_capability")
        if refuse_args is not None:
            return {"mode": "route", "args": {"query": query}}
    if refuse_args is not None:
        return {"mode": "refuse", "args": refuse_args}
    if _first_tool_call(route_result, "continue_active_task") is not None:
        return {"mode": "continue"}
    route_args = _first_tool_call(route_result, "route_to_domain")
    if route_args is not None:
        return {"mode": "route", "args": route_args}
    content = str(route_result.get("content") or "").strip()
    if content:
        # Live pin: Super must continue or route. Prose is the no-pin greeting path.
        if _primary_write_already_succeeded(memory, getattr(active, "task_id", None)):
            return {"mode": "route", "args": {"query": query}}
        return {"mode": "continue"}
    # Empty Super: keep a create-collect pin only when the utterance can fill
    # the awaiting schema slot (or consent). Otherwise park via NEW_TASK route.
    if workflow_id and not _utterance_fits_live_pin_slot(memory, query, active):
        return {"mode": "route", "args": {"query": query}}
    return {"mode": "continue"}


def _super_avoid_domain_block(memory: SharedMemory) -> str:
    avoid = str(memory.durable.get("_super_avoid_domain") or "").strip()
    if not avoid:
        return ""
    return (
        f" Do not route this utterance to {avoid} — that Domain already "
        "returned it to Super. Pick the Domain that owns the capability "
        "(new ticket file → intake_deflection_domain; catalog CRUD → "
        "catalog_administration_domain; existing-ticket lifecycle/notes/list → "
        "resolution_lifecycle_domain)."
    )


def _super_rereoute_if_avoided(
    *,
    run_llm: Any,
    messages: list[dict[str, Any]],
    route_result: dict[str, Any],
    memory: SharedMemory,
) -> dict[str, Any]:
    """After LLM chose the Domain that just bounced, ask Super once more."""
    avoid = str(memory.durable.get("_super_avoid_domain") or "").strip()
    picked = _first_tool_call(route_result, "route_to_domain")
    if not avoid or not isinstance(picked, dict):
        return route_result
    if str(picked.get("domain_id") or "").strip() != avoid:
        return route_result
    retry = [
        *messages,
        {
            "role": "user",
            "content": (
                f"{avoid} already returned this utterance. Do not call "
                "route_to_domain with that domain_id again. Choose the Domain "
                "that owns the capability."
            ),
        },
    ]
    retried = run_llm(retry)
    picked_again = _first_tool_call(retried, "route_to_domain")
    if (
        isinstance(picked_again, dict)
        and str(picked_again.get("domain_id") or "").strip() == avoid
    ):
        return {"content": str(retried.get("content") or ""), "tool_calls": []}
    return retried


def _rerun_super_after_domain_return(
    *,
    llm: Any,
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
    actor: ToolActor,
    budgets: BudgetTracker,
    domain_id: str,
    bounce_args: dict[str, Any],
) -> dict[str, Any] | None:
    """Park and re-route when Domain cannot own the utterance."""
    if memory.durable.get("_domain_return_bounce"):
        return None
    action = str(bounce_args.get("action") or "park").strip().lower() or "park"
    side_query = str(bounce_args.get("query") or query or "").strip()
    if action == "park" and not side_query:
        return None
    state = memory.current_task_state()
    parked = list(memory.durable.get("parked_tasks") or [])
    if state and action == "park":
        parked.append(state.model_dump(mode="json"))
        memory.durable["parked_tasks"] = parked[-10:]
    if state and action == "cancel":
        memory.durable["last_cancelled_task"] = state.model_copy(
            update={"status": "cancelled"}
        ).model_dump(mode="json")
    memory.set_task_state(None)
    _park_other_active_drafts(memory, keep_workflow="")
    memory.durable.pop("current_workflow", None)
    memory.durable.pop("pending_ask", None)
    if action != "park":
        return None
    memory.durable["_domain_return_bounce"] = True
    memory.durable["_super_avoid_domain"] = domain_id
    try:
        return _run_harness_supervisor(
            llm=llm,
            memory=memory,
            query=side_query,
            context=context,
            actor=actor,
            budgets=budgets,
        )
    finally:
        memory.durable.pop("_domain_return_bounce", None)
        memory.durable.pop("_super_avoid_domain", None)


def _run_harness_supervisor(
    *,
    llm,
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
    actor: ToolActor,
    budgets: BudgetTracker,
) -> dict[str, Any]:
    """Super route + Domain delegation; active tasks reuse their pinned Skill."""
    from app.rbac import rbac_prompt_block
    from app.runtime.supervisor import DOMAIN_AGENT_IDS, executors_for_domain
    from app.skills.catalog import skills_for_executor

    request: RunRequest = context["request"]
    _migrate_parked_drafts_into_tasks(
        memory,
        channel=str(request.channel or context.get("surface") or "") or None,
    )

    # Partner buttons pin one registered Skill. Super must not re-route them.
    from app.sdk_tasks import sdk_named_task_instruction

    sdk_pin = sdk_named_task_instruction(memory, request)
    if sdk_pin is not None:
        from app.sdk_tasks import sdk_context_block

        if sdk_context_block(sdk_pin.task_id):
            return {
                "response_type": "final",
                "assistant_text": "This answer is temporarily unavailable.",
                "agent": sdk_pin.executor_id,
                "data": {"code": "temporarily_unavailable"},
            }
        return _run_harness_executor(
            instruction=sdk_pin,
            llm=llm,
            memory=memory,
            query=query,
            context=context,
            actor=actor,
            budgets=budgets,
        )

    # UI confirm chips are authoritative confirmation for a pending mutation.
    # Prefer the active TaskState; otherwise pin the Skill that owns the tool.
    chip = request.confirm_tool if isinstance(request.confirm_tool, dict) else None
    if chip and not (memory.current_task_state()):
        from app.agent_turn import resolve_confirm_tool
        from app.skills.catalog import discover_skills
        from app.workflow_schemas import new_harness_task_state

        chip_name, chip_args = resolve_confirm_tool(
            str(chip.get("name") or ""),
            chip.get("args") if isinstance(chip.get("args"), dict) else {},
        )
        if chip_name:
            for skill_def in discover_skills().values():
                if chip_name not in skill_def.allowed_tools or not skill_def.task_ids:
                    continue
                task = task_definition_for(skill_def.task_ids[0])
                if not task or not task.active:
                    continue
                state = new_harness_task_state(
                    task.id,
                    channel=str(request.channel or context.get("surface") or "") or None,
                    collected=dict(chip_args),
                    provenance={key: "confirm_chip" for key in chip_args},
                )
                memory.set_task_state(state)
                memory.durable["active_domain"] = task.domain
                memory.durable["force_armed_write"] = True
                break

    _release_stale_harness_pin(memory)

    # Hydrate leftover in-progress drafts into TaskState so Super can decide
    # CONTINUE vs NEW_TASK. Never remount a finished primary write.
    workflow = str(memory.durable.get("current_workflow") or "").strip().lower()
    draft_task_id = _ACTIVE_WORKFLOW_TASK.get(workflow)
    draft_spec = _ACTIVE_WORKFLOW_DRAFT.get(workflow)
    leftover_draft = (
        memory.durable.get(draft_spec[0]) if draft_spec else None
    )
    if draft_task_id and _primary_write_already_succeeded(memory, draft_task_id):
        memory.durable.pop("current_workflow", None)
        workflow = ""
        draft_spec = None
        leftover_draft = None
    if draft_spec and not memory.current_task_state():
        draft = leftover_draft
        task_id = (
            _task_id_for_active_draft(workflow, draft_spec[0], draft)
            if isinstance(draft, dict)
            else None
        )
        task = task_definition_for(task_id)
        if isinstance(draft, dict) and task:
            skip_portal_create = (
                task.id == "ticket.create"
                and _portal_create_must_deflect_first(
                    memory, actor=actor, context=context
                )
            )
            if not skip_portal_create:
                from app.workflow_schemas import new_harness_task_state

                memory.set_task_state(
                    new_harness_task_state(
                        task.id,
                        channel=str(
                            context["request"].channel or context.get("surface") or ""
                        )
                        or None,
                        collected=dict(draft),
                        provenance={key: "hydrated_draft" for key in draft},
                    )
                )
                memory.durable["active_domain"] = task.domain

    active = memory.current_task_state()
    if active and active.status not in {"completed", "cancelled", "refused", "failed"}:
        # Ground a listed/focused row before create-vs-update remount.
        _maybe_bind_listed_catalog_target(memory, query, active.skill_name)
        # Wrong update pin mid create-collect → remount create before continue.
        _align_mispinned_catalog_create(memory, query)
        # Create pin + existing listed/focused row → remount update (MCP JWT).
        _align_mispinned_catalog_update(memory, query)
        # Read pin + delete confirm draft → remount delete (MCP JWT).
        _align_mispinned_catalog_delete(memory, query)
        active = memory.current_task_state() or active
        chip_present = bool(
            isinstance(chip, dict) and str(chip.get("name") or "").strip()
        )
        awaiting_confirm_pin = str(active.status or "").strip() == "awaiting_confirmation"
        # Confirm chips and awaiting_confirmation pins are structural — skip Super NLU.
        if not chip_present and not awaiting_confirm_pin:
            try:
                from app.observability.turn_log import record_attending_agent

                record_attending_agent("ticketing_super_agent")
            except Exception:  # noqa: BLE001
                pass
            pin_decision = _super_live_pin_decision(
                llm=llm,
                memory=memory,
                query=query,
                active=active,
                role=str(actor.user_role or "") or None,
            )
            if pin_decision.get("mode") == "refuse":
                refuse_args = pin_decision.get("args") or {}
                content = str(refuse_args.get("message") or "").strip()
                if not content:
                    raise LLMEmptyResponse("Super Agent refused without a message")
                memory.add_message("user", query)
                memory.add_message("assistant", content)
                return {
                    "response_type": "final",
                    "assistant_text": content,
                    "agent": "ticketing_super_agent",
                }
            if pin_decision.get("mode") == "prose":
                content = str(pin_decision.get("text") or "").strip()
                memory.add_message("user", query)
                memory.add_message("assistant", content)
                return {
                    "response_type": "final",
                    "assistant_text": content,
                    "agent": "ticketing_super_agent",
                }
            if pin_decision.get("mode") == "route":
                # Guided collect: typed slots (email/phone/name) may keep a
                # create pin. Free-text issue/orderId is Super intent — honor
                # route so enquiry parks create. Other guided Skills still
                # revalidate. Deflection has no collect slot.
                guided_wf, _guided_draft = _guided_pin_draft(memory, active)
                ticket_create_pin = guided_wf in {"create_ticket", "ticket"}
                keep_collect_pin = bool(guided_wf) and (
                    _utterance_fits_live_pin_slot(
                        memory, query, active, typed_only=ticket_create_pin
                    )
                    or (
                        not ticket_create_pin
                        and _revalidate_live_pin_should_continue(
                            llm=llm, memory=memory, query=query, active=active
                        )
                    )
                )
                if keep_collect_pin:
                    pin_decision = {"mode": "continue"}
                else:
                    prior_skill = str(getattr(active, "skill_name", "") or "").strip()
                    _park_live_harness_task(memory)
                    if prior_skill in {
                        "intake-self-service-deflection",
                        "knowledge-search",
                    } and _is_portal_session(
                        memory, actor=actor, context=context
                    ):
                        memory.durable["_portal_create_after_self_service"] = True
                    route_args = pin_decision.get("args") if isinstance(
                        pin_decision.get("args"), dict
                    ) else {}
                    next_query = str((route_args or {}).get("query") or query).strip() or query
                    return _run_harness_supervisor(
                        llm=llm,
                        memory=memory,
                        query=next_query,
                        context=context,
                        actor=actor,
                        budgets=budgets,
                    )
        if _portal_create_must_deflect_first(
            memory, actor=actor, context=context, active=active
        ):
            # Leftover portal create is not a live file — Super continue
            # would skip Domain/search_kb. Park and route as a new problem.
            _park_live_harness_task(memory)
            return _run_harness_supervisor(
                llm=llm,
                memory=memory,
                query=query,
                context=context,
                actor=actor,
                budgets=budgets,
            )
        memory.durable["active_domain"] = active.domain
        try:
            from app.observability.turn_log import record_attending_agent, record_route

            record_route(
                "ticketing_super_agent",
                active.domain,
                f"continue:{active.task_id}",
            )
            record_route(active.domain, active.executor, f"pinned:{active.skill_name}")
            record_attending_agent(active.executor)
        except Exception:  # noqa: BLE001
            pass
        refused = _harness_rbac_refuse(
            memory=memory,
            query=query,
            role=str(actor.user_role or "") or None,
            skill_name=active.skill_name,
            agent=str(active.executor or "ticketing_super_agent"),
        )
        if refused is not None:
            return refused
        return _run_harness_executor(
            instruction=DomainInstruction(
                executor_id=active.executor,
                task_id=active.task_id,
                skill_name=active.skill_name,
                version=active.task_version,
                objective=f"Continue active task {active.task_id}",
            ),
            llm=llm,
            memory=memory,
            query=query,
            context=context,
            actor=actor,
            budgets=budgets,
        )

    focus_route_args = _trusted_focus_route_args(memory, context, query)

    super_manifest = load_agent_definition("ticketing_super_agent")
    domain_descriptions = [
        {
            "domain_id": domain_id,
            "description": load_agent_definition(domain_id).description,
        }
        for domain_id in sorted(DOMAIN_AGENT_IDS)
    ]
    # Skill prompt order: agent.md → runtime/handoff context → four-layer memory
    # (working → ST → LT → soft → hard) → tools listed separately below.
    super_prompt = (
        super_manifest.prompt
        + _ontology_slice_block(
            memory=memory,
            runtime_agent_id="ticketing_super_agent",
            actor=actor,
        )
        + "\n\n## Eligible Domains\n"
        + json.dumps(domain_descriptions, ensure_ascii=False)
        + "\nSelect route_to_domain for registered Ticketing work this role can perform. "
        "Never refuse because Ticketing owns the capability. Do refuse with "
        "refuse_capability code=forbidden when this signed-in role cannot perform "
        "that CRUD — do not route and do not collect fields. "
        "How-many / count / CSAT / SLA % metric asks → "
        "catalog_administration_domain (analytics-query + ask_semantic_layer); "
        "do not route those to resolution_lifecycle_domain ticket list-search. "
        "KB article create/update/publish → catalog_administration_domain; "
        "KB recommend/similar for a ticket → knowledge_domain. "
        + _SUPER_DOMAIN_OWNERSHIP
        + _super_avoid_domain_block(memory)
        + " For greetings or thanks only, answer naturally without a tool "
        "when there is no last_entity and no last_tool_outcome. "
        "There is no live TaskState pin this turn. Never call "
        "continue_active_task. last_entity / a focused team is Context for "
        "the Domain, not a pin — call route_to_domain for Ticketing work. "
        "After a Domain write (or any last_tool_outcome) with last_entity "
        "still in working memory, this utterance is a follow-up: "
        "route_to_domain. Never answer that you are not sure what they want."
        + rbac_prompt_block(str(actor.user_role or "") or None, layer="super")
        + _open_ui_prompt(memory)
        + "\n\n"
        + memory.memory_prompt_blocks()
        + _DB_GROUNDED_ENTITY_BLOCK
        + _CHAT_REPLY_STYLE_BLOCK
        + _super_prose_freshness_block(memory)
        + _TOOL_CALL_FORMAT_BLOCK
    )
    messages = _llm_turn_messages(super_prompt, memory, query)
    parked_rows = [
        row
        for row in list(memory.durable.get("parked_tasks") or [])
        if isinstance(row, dict) and str(row.get("task_id") or "")
    ]
    if parked_rows:
        messages[0]["content"] += (
            "\n\n## Parked tasks\n"
            + json.dumps(
                [
                    {
                        "task_id": row.get("task_id"),
                        "skill_name": row.get("skill_name"),
                        "status": row.get("status"),
                        "collected": row.get("collected"),
                    }
                    for row in parked_rows
                ],
                ensure_ascii=False,
                default=str,
            )
        )
    supervisor_tools = [
        _super_route_to_domain_tool(memory),
        _super_refuse_tool_for_role(str(actor.user_role or "") or None).to_openai_tool(),
    ]
    if parked_rows:
        supervisor_tools.append(
            ToolDefinition(
                name="resume_task",
                description=(
                    "Resume a parked canonical task only when the user "
                    "semantically asks to continue it."
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "task_id": {
                            "type": "string",
                            "enum": sorted(
                                {str(row["task_id"]) for row in parked_rows}
                            ),
                        }
                    },
                    "required": ["task_id"],
                },
                kind="route",
                risk="low",
            ).to_openai_tool()
        )

    def _super_route_llm(
        msgs: list[dict[str, Any]],
        temperature: float | None = None,
    ) -> dict[str, Any]:
        try:
            if temperature is None:
                return llm.run(msgs, tools=supervisor_tools)
            return llm.run(msgs, tools=supervisor_tools, temperature=temperature)
        except LLMEmptyResponse:
            return {"content": "", "tool_calls": []}

    if focus_route_args:
        route_result: dict[str, Any] = {
            "content": "",
            "tool_calls": [
                {
                    "id": "call_focus_route",
                    "name": "route_to_domain",
                    "arguments": focus_route_args,
                }
            ],
        }
    else:
        try:
            from app.observability.turn_log import record_attending_agent

            record_attending_agent("ticketing_super_agent")
        except Exception:  # noqa: BLE001
            pass
        route_result = _super_route_llm(messages)
        if (
            _first_tool_call(route_result, "route_to_domain") is None
            and _first_tool_call(route_result, "refuse_capability") is None
            and _first_tool_call(route_result, "resume_task") is None
            and not str(route_result.get("content") or "").strip()
        ):
            retry_messages = [
                *messages,
                {
                    "role": "user",
                    "content": (
                        "There is no live TaskState pin. Do not call "
                        "continue_active_task. last_entity is focus context only. "
                        "You must call route_to_domain, resume_task, or "
                        "refuse_capability. Do not reply empty."
                    ),
                },
            ]
            route_result = _super_route_llm(retry_messages)
        route_result = _super_rereoute_if_avoided(
            run_llm=_super_route_llm,
            messages=messages,
            route_result=route_result,
            memory=memory,
        )
        if (
            _first_tool_call(route_result, "route_to_domain") is None
            and _first_tool_call(route_result, "refuse_capability") is None
            and _first_tool_call(route_result, "resume_task") is None
        ):
            cur = str(route_result.get("content") or "").strip()
            prev = _last_assistant_visible(memory)
            if cur and prev and _visible_reply_key(cur) == _visible_reply_key(prev):
                retried = _super_route_llm(
                    [
                        *messages,
                        {
                            "role": "user",
                            "content": (
                                "The previous assistant wording was reused. "
                                "Write a different greeting or thanks. "
                                "Do not copy that reply."
                            ),
                        },
                    ],
                    temperature=1.0,
                )
                if str(retried.get("content") or "").strip() or _first_tool_call(
                    retried, "route_to_domain"
                ):
                    route_result = retried
    refuse_args = _first_tool_call(route_result, "refuse_capability")
    role_l = str(actor.user_role or "") or None
    if refuse_args is not None and _super_should_retry_customer_refuse(role_l, refuse_args):
        retry_lifecycle = [
            *messages,
            {
                "role": "user",
                "content": _SUPER_CUSTOMER_REFUSE_RETRY,
            },
        ]
        route_only = [_super_route_to_domain_tool(memory)]
        if parked_rows:
            route_only.append(supervisor_tools[-1])
        try:
            route_result = llm.run(retry_lifecycle, tools=route_only)
        except LLMEmptyResponse:
            route_result = {"content": "", "tool_calls": []}
        refuse_args = _first_tool_call(route_result, "refuse_capability")
    if refuse_args is not None:
        content = str(refuse_args.get("message") or "").strip()
        alternatives = refuse_args.get("alternatives")
        if not content:
            raise LLMEmptyResponse("Super Agent refused without a message")
        memory.add_message("user", query)
        memory.add_message("assistant", content)
        return {
            "response_type": "final",
            "assistant_text": content,
            "agent": "ticketing_super_agent",
            "data": {
                "refusal": {
                    "code": str(refuse_args.get("code") or "unsupported_operation"),
                    "message": str(refuse_args.get("message") or ""),
                    "alternatives": alternatives
                    if isinstance(alternatives, list)
                    else [],
                }
            },
        }
    resume_args = _first_tool_call(route_result, "resume_task")
    if resume_args is not None:
        from app.contracts.execution import TaskState

        selected_task = str(resume_args.get("task_id") or "").strip()
        selected = next(
            (
                row
                for row in parked_rows
                if str(row.get("task_id") or "") == selected_task
            ),
            None,
        )
        if selected is None:
            raise ValueError("Super selected an unknown parked task")
        state = TaskState.model_validate(selected).model_copy(
            update={"status": "collecting"}
        )
        memory.durable["parked_tasks"] = [
            row
            for row in parked_rows
            if str(row.get("task_id") or "") != selected_task
        ]
        memory.set_task_state(state)
        memory.durable["active_domain"] = state.domain
        try:
            from app.observability.turn_log import record_attending_agent

            record_attending_agent(state.executor)
        except Exception:  # noqa: BLE001
            pass
        return _run_harness_executor(
            instruction=DomainInstruction(
                executor_id=state.executor,
                task_id=state.task_id,
                skill_name=state.skill_name,
                version=state.task_version,
                objective=f"Resume parked task {state.task_id}",
                supplied_fields=dict(state.collected),
            ),
            llm=llm,
            memory=memory,
            query=query,
            context=context,
            actor=actor,
            budgets=budgets,
        )
    route_args = _first_tool_call(route_result, "route_to_domain")
    if route_args is None:
        content = str(route_result.get("content") or "").strip()
        last_outcome = memory.durable.get("last_tool_outcome")
        follow_up = isinstance(last_outcome, dict) and bool(
            str(last_outcome.get("tool") or "").strip()
        )
        # Empty Super, or Super prose after a tool this session: route from
        # last_entity. Standalone greetings with no last_tool stay on Super.
        recovered = (
            _recover_super_new_task_route(
                memory=memory,
                query=query,
                context=context,
                route_result=route_result,
            )
            if (not content or follow_up)
            else None
        )
        if recovered:
            route_args = recovered
        elif not content:
            raise LLMEmptyResponse("Super Agent returned no route or response")
        elif _customer_can_self_serve_lifecycle(role_l) and _super_has_prior_assistant(
            memory
        ):
            # Super answered in prose after a live turn — re-ask for a Domain
            # pick. Do not inject a Domain id.
            must_route = _super_route_llm(
                [
                    *messages,
                    {
                        "role": "user",
                        "content": (
                            "There is already conversation context. Call "
                            "route_to_domain for this utterance. Do not answer "
                            "Ticketing work in Super prose."
                        ),
                    },
                ]
            )
            must_route = _super_rereoute_if_avoided(
                run_llm=_super_route_llm,
                messages=messages,
                route_result=must_route,
                memory=memory,
            )
            route_args = _first_tool_call(must_route, "route_to_domain")
            if route_args is None:
                memory.add_message("user", query)
                memory.add_message("assistant", content)
                return {
                    "response_type": "final",
                    "assistant_text": content,
                    "agent": "ticketing_super_agent",
                }
        else:
            memory.add_message("user", query)
            memory.add_message("assistant", content)
            return {
                "response_type": "final",
                "assistant_text": content,
                "agent": "ticketing_super_agent",
            }
    domain_id = str(route_args.get("domain_id") or "").strip()
    if domain_id not in DOMAIN_AGENT_IDS:
        raise ValueError(f"Super selected unknown Domain: {domain_id}")
    try:
        from app.observability.turn_log import (
            record_attending_agent,
            record_route,
            record_tool,
        )

        record_tool(
            "route_to_domain",
            route_args if isinstance(route_args, dict) else {},
            {"success": True, "domain_id": domain_id},
            agent="ticketing_super_agent",
        )
        record_route(
            "ticketing_super_agent",
            domain_id,
            str(route_args.get("query") or query),
        )
        record_attending_agent(domain_id)
    except Exception:  # noqa: BLE001
        pass

    executor_rows: list[dict[str, Any]] = []
    for executor_id in executors_for_domain(domain_id):
        for skill in skills_for_executor(executor_id):
            executor_rows.append(
                {
                    "executor_id": executor_id,
                    "skill_name": skill.name,
                    "description": skill.description,
                    "task_ids": skill.task_ids,
                }
            )
    domain_manifest = load_agent_definition(domain_id)
    # Skill prompt order: agent.md → skill/executor catalog → four-layer memory.
    domain_prompt = (
        domain_manifest.prompt
        + _ontology_slice_block(
            memory=memory,
            runtime_agent_id=domain_id,
            actor=actor,
        )
        + "\n\n## Eligible Executor and Skill summaries\n"
        + json.dumps(executor_rows, ensure_ascii=False)
        + "\nCall delegate_to_executor exactly once for supported work this role can perform. "
        "The executor, task and Skill must come from the same row."
        " Do not answer business work in prose without delegating."
        " Do not refuse for missing ticket/context fields — delegate and let"
        " the Executor collect them."
        " Read the full conversation. An unfinished create draft in working "
        "memory stays on that create Skill when they correct a collected field; "
        "do not switch to update unless they mean a persisted row."
        " If this Domain does not own the capability, call return_to_super "
        "with action=park and query set to the user message — do not answer "
        "that you cannot help, and do not collect fields in Domain prose."
        " Always delegate_to_executor for work this Domain owns."
        " On support portal, if Super's query/objective already means they "
        "asked or agreed to file a new ticket, delegate "
        "ticket_creation_executor / ticket-create this hop — do not stay on "
        "intake-self-service-deflection because pending_kb is still in Context. "
        "An unsolved walk without that agreement stays on deflection."
        " If this role cannot perform the CRUD they asked for, call "
        "refuse_capability with code=forbidden immediately — do not delegate collection."
        + rbac_prompt_block(str(actor.user_role or "") or None, layer="domain")
        + _open_ui_prompt(memory)
        + "\n\n"
        + memory.memory_prompt_blocks()
        + _CHAT_REPLY_STYLE_BLOCK
        + _TOOL_CALL_FORMAT_BLOCK
    )
    domain_messages = _llm_turn_messages(
        domain_prompt,
        memory,
        str(route_args.get("query") or query),
    )
    domain_tools = [
        delegate_to_executor_tool(domain_id).to_openai_tool(),
        _RETURN_TO_SUPER.to_openai_tool(),
        _REFUSE_CAPABILITY.to_openai_tool(),
    ]
    delegate_result = llm.run(domain_messages, tools=domain_tools)
    refuse_domain = _first_tool_call(delegate_result, "refuse_capability")
    refuse_code = (
        str((refuse_domain or {}).get("code") or "").strip().lower()
        if refuse_domain is not None
        else ""
    )
    delegate_args = _first_tool_call(delegate_result, "delegate_to_executor")
    bounce_args = _first_tool_call(delegate_result, "return_to_super")
    if bounce_args is not None and delegate_args is None:
        bounced = _rerun_super_after_domain_return(
            llm=llm,
            memory=memory,
            query=str(route_args.get("query") or query),
            context=context,
            actor=actor,
            budgets=budgets,
            domain_id=domain_id,
            bounce_args=bounce_args if isinstance(bounce_args, dict) else {},
        )
        if bounced is not None:
            return bounced
    # Soft refuse / prose without delegate: retry once so Executors collect fields.
    needs_retry = delegate_args is None and bounce_args is None and (
        refuse_code in {"missing_context", "incomplete", "need_more_info", ""}
        or refuse_domain is None
    )
    if needs_retry and refuse_code not in {"unsupported_operation", "forbidden"}:
        retry_messages = [
            *domain_messages,
            {
                "role": "assistant",
                "content": str(delegate_result.get("content") or "")
                or str((refuse_domain or {}).get("message") or "Need more context."),
            },
            {
                "role": "user",
                "content": (
                    "Call delegate_to_executor now for the matching Executor/Skill/task "
                    "from the eligible rows. Do not refuse for missing ticket or field "
                    "details — the Executor will collect them. Do not ask for fields "
                    "in Domain prose. If this Domain does not own the request, call "
                    "return_to_super with action=park and query set to the user message. "
                    "Use refuse_capability with code=forbidden when this signed-in role "
                    "cannot perform that CRUD. Use refuse_capability with "
                    "code=unsupported_product only when this Domain truly cannot own "
                    "the request and return_to_super is wrong."
                ),
            },
        ]
        delegate_result = llm.run(retry_messages, tools=domain_tools)
        refuse_domain = _first_tool_call(delegate_result, "refuse_capability")
        delegate_args = _first_tool_call(delegate_result, "delegate_to_executor")
        bounce_args = _first_tool_call(delegate_result, "return_to_super")
        if bounce_args is not None and delegate_args is None:
            bounced = _rerun_super_after_domain_return(
                llm=llm,
                memory=memory,
                query=str(route_args.get("query") or query),
                context=context,
                actor=actor,
                budgets=budgets,
                domain_id=domain_id,
                bounce_args=bounce_args if isinstance(bounce_args, dict) else {},
            )
            if bounced is not None:
                return bounced
    if (
        refuse_domain is not None
        and delegate_args is None
        and domain_id == "resolution_lifecycle_domain"
        and _super_should_retry_customer_refuse(
            str(actor.user_role or "") or None, refuse_domain
        )
    ):
        delegate_args = {
            "executor_id": "ticket_lifecycle_executor",
            "task_id": "ticket.resolve.reopen",
            "skill_name": "ticket-resolve-reopen",
            "objective": str(route_args.get("query") or query),
        }
        refuse_domain = None
    if refuse_domain is not None and delegate_args is None:
        content = str(refuse_domain.get("message") or "").strip()
        if not content:
            raise LLMEmptyResponse("Domain Agent refused without a message")
        memory.add_message("user", query)
        memory.add_message("assistant", content)
        try:
            from app.observability.turn_log import record_tool

            record_tool(
                "refuse_capability",
                refuse_domain if isinstance(refuse_domain, dict) else {},
                {"success": True},
                agent=domain_id,
            )
        except Exception:  # noqa: BLE001
            pass
        return {
            "response_type": "final",
            "assistant_text": content,
            "agent": domain_id,
            "data": {
                "refusal": {
                    "code": str(refuse_domain.get("code") or "unsupported_operation"),
                    "message": content,
                }
            },
        }
    if delegate_args is None:
        # Catalog (or any Domain) with no Skill for this ask often returns
        # empty instead of return_to_super. Bounce Super once so the owning
        # Domain can delegate — do not 502 the staff chat.
        bounced = _rerun_super_after_domain_return(
            llm=llm,
            memory=memory,
            query=str(route_args.get("query") or query),
            context=context,
            actor=actor,
            budgets=budgets,
            domain_id=domain_id,
            bounce_args={
                "action": "park",
                "query": str(route_args.get("query") or query),
            },
        )
        if bounced is not None:
            return bounced
        content = str(delegate_result.get("content") or "").strip()
        if not content:
            raise LLMEmptyResponse("Domain Agent returned no delegation or response")
        memory.add_message("user", query)
        memory.add_message("assistant", content)
        return {
            "response_type": "final",
            "assistant_text": content,
            "agent": domain_id,
        }
    try:
        from app.observability.turn_log import (
            record_attending_agent,
            record_route,
            record_tool,
        )

        executor_name = str(delegate_args.get("executor_id") or "").strip()
        record_tool(
            "delegate_to_executor",
            delegate_args if isinstance(delegate_args, dict) else {},
            {"success": True, "executor_id": executor_name},
            agent=domain_id,
        )
        if executor_name:
            record_route(
                domain_id,
                executor_name,
                str(delegate_args.get("objective") or query),
            )
            record_attending_agent(executor_name)
    except Exception:  # noqa: BLE001
        pass
    selected_skill = str(delegate_args.get("skill_name") or "").strip()
    selected_task = task_definition_for(str(delegate_args.get("task_id") or "").strip())
    if selected_task is None:
        candidates = [
            row["task_ids"][0]
            for row in executor_rows
            if row["executor_id"] == delegate_args.get("executor_id")
            and row["skill_name"] == selected_skill
            and row["task_ids"]
        ]
        if len(candidates) == 1:
            selected_task = task_definition_for(candidates[0])
    if (
        not selected_task
        or selected_task.domain != domain_id
        or selected_task.executor != str(delegate_args.get("executor_id") or "")
        or selected_task.skill_name != selected_skill
    ):
        raise ValueError("Domain selected an unregistered Executor/task/Skill combination")
    refused = _harness_rbac_refuse(
        memory=memory,
        query=query,
        role=str(actor.user_role or "") or None,
        skill_name=selected_skill,
        agent=domain_id,
    )
    if refused is not None:
        return refused
    memory.durable["active_domain"] = domain_id
    instruction = DomainInstruction(
        executor_id=selected_task.executor,
        task_id=selected_task.id,
        skill_name=selected_task.skill_name,
        version=selected_task.version,
        objective=str(delegate_args.get("objective") or query),
        supplied_fields=(
            dict(delegate_args.get("supplied_fields") or {})
            if isinstance(delegate_args.get("supplied_fields"), dict)
            else {}
        ),
    )
    return _run_harness_executor(
        instruction=instruction,
        llm=llm,
        memory=memory,
        query=query,
        context=context,
        actor=actor,
        budgets=budgets,
    )


def run_coworker_agent(
    *,
    agent_name: str,
    memory: SharedMemory,
    query: str,
    context: dict[str, Any],
) -> dict[str, Any]:
    request: RunRequest = context["request"]
    module = context.get("module")
    surface = context.get("surface")
    page = context.get("page")
    role = request.actor.user_role
    llm = get_llm()
    budgets = BudgetTracker(request.budgets if isinstance(request.budgets, RunBudgets) else RunBudgets())

    actor = ToolActor(
        user_id=str(request.actor.user_id or ""),
        organization_id=str(request.actor.organization_id or ""),
        user_role=role,
        user_name=request.actor.user_name,
        request_id=context.get("request_id"),
        portal_customer_id=resolve_portal_customer_id(
            role=role,
            actor_id=str(request.actor.user_id or ""),
            portal_customer_id=request.actor.portal_customer_id,
        ),
    )
    seed_portal_ticket_identity(memory, request)

    resumed = _try_native_resume_parked_workflow(memory, query, context)
    if resumed:
        # Legacy parked_drafts resume still hydrates the draft; bridge into
        # canonical TaskState so Super/Executor Skill pinning owns the turn.
        agent_name = resumed
        _migrate_parked_drafts_into_tasks(
            memory,
            channel=str(request.channel or surface or "") or None,
        )

    # Super Agent often routes to customers for "add them" without the tickets
    # specialist's park handoff — park the create-ticket draft first.
    if agent_name == "customers":
        try:
            _ensure_ticket_parked_before_customers(memory)
        except Exception:  # noqa: BLE001
            pass

    try:
        from app.observability.turn_log import record_attending_agent

        record_attending_agent(agent_name)
    except Exception:  # noqa: BLE001
        pass

    # Legacy specialist IDs are compatibility aliases only; they may not enter
    # a business tool loop without canonical Domain/Executor/Skill selection.
    return _run_harness_supervisor(
        llm=llm,
        memory=memory,
        query=query,
        context=context,
        actor=actor,
        budgets=budgets,
    )


def _run_supervisor(*, llm, memory, query, context, actor, budgets) -> dict[str, Any]:
    """Deprecated legacy specialist handoff.

    Interactive chat must not use keyword catalog routes or `route_to_agent`.
    Always enter the Three-Layer Harness (Super → Domain → Executor → Skill).
    """
    return _run_harness_supervisor(
        llm=llm,
        memory=memory,
        query=query,
        context=context,
        actor=actor,
        budgets=budgets,
    )


def _ui_type_for_workflow(workflow_id: str) -> str | None:
    """UI action type for the guided progress panel (create_* / update_team / escalate)."""
    return {
        "create_ticket": "create_ticket",
        "create_team": "create_team",
        "add_team_members": "update_team",
        "add_members": "update_team",
        "create_kb": "create_kb",
        "create_macro": "create_macro",
        "create_customer": "create_customer",
        "create_priority": "create_priority",
        "create_status": "create_status",
        "escalate": "escalate",
        "reassign_ticket": "reassign",
        "reassign": "reassign",
    }.get(str(workflow_id or "").strip().lower())


def _create_type_for_workflow(workflow_id: str) -> str | None:
    return _ui_type_for_workflow(workflow_id)


def _guided_spec_for_agent(
    memory: SharedMemory, agent_name: str
) -> tuple[str, str, str] | None:
    """Resolve (draft_key, workflow_id, ui_type) for the active guided collect."""
    from app.workflow_schemas import workflow_id_for_draft

    current = str(memory.durable.get("current_workflow") or "").strip().lower()
    agent = str(agent_name or "").strip().lower()

    # Prefer durable current_workflow so corrections/side quests stay on the right draft.
    by_wf = {
        "create_ticket": ("ticket_draft", "create_ticket", "create_ticket"),
        "create_customer": ("customer_draft", "create_customer", "create_customer"),
        "create_team": ("team_draft", "create_team", "create_team"),
        "add_team_members": ("team_draft", "add_team_members", "update_team"),
        "add_members": ("team_draft", "add_team_members", "update_team"),
        "create_macro": ("macro_draft", "create_macro", "create_macro"),
        "create_kb": ("kb_draft", "create_kb", "create_kb"),
        "create_priority": ("priority_draft", "create_priority", "create_priority"),
        "create_status": ("status_draft", "create_status", "create_status"),
        "escalate": ("escalate_draft", "escalate", "escalate"),
        "reassign_ticket": ("reassign_draft", "reassign_ticket", "reassign"),
        "reassign": ("reassign_draft", "reassign_ticket", "reassign"),
    }
    if current in by_wf:
        return by_wf[current]

    # Harness TaskState owns create collect for executor agents (not legacy "admin").
    state = memory.current_task_state()
    if state:
        by_task = {
            "priority.create": ("priority_draft", "create_priority", "create_priority"),
            "status.create": ("status_draft", "create_status", "create_status"),
            "ticket.create": ("ticket_draft", "create_ticket", "create_ticket"),
            "ticket.create.interactive": (
                "ticket_draft",
                "create_ticket",
                "create_ticket",
            ),
            "customer.create": ("customer_draft", "create_customer", "create_customer"),
            "team.create": ("team_draft", "create_team", "create_team"),
            "team.members.update": (
                "team_draft",
                "add_team_members",
                "update_team",
            ),
            "macro.create": ("macro_draft", "create_macro", "create_macro"),
            "knowledge.article.create": ("kb_draft", "create_kb", "create_kb"),
        }
        hit = by_task.get(str(state.task_id or "").strip())
        if hit:
            return hit

    if agent == "tickets":
        ras = memory.durable.get("reassign_draft")
        if isinstance(ras, dict) and str(ras.get("awaiting") or "").strip() not in {
            "",
            "done",
        }:
            return ("reassign_draft", "reassign_ticket", "reassign")
        esc = memory.durable.get("escalate_draft")
        if isinstance(esc, dict) and str(esc.get("awaiting") or "").strip():
            return ("escalate_draft", "escalate", "escalate")
        return ("ticket_draft", "create_ticket", "create_ticket")
    if agent == "customers":
        return ("customer_draft", "create_customer", "create_customer")
    if agent == "teams":
        team = memory.durable.get("team_draft")
        team = team if isinstance(team, dict) else {}
        wid = workflow_id_for_draft("team_draft", team) or "create_team"
        ui = _ui_type_for_workflow(wid) or "create_team"
        return ("team_draft", wid, ui)
    if agent == "macros":
        return ("macro_draft", "create_macro", "create_macro")
    if agent == "kb":
        return ("kb_draft", "create_kb", "create_kb")
    if agent in {"admin", "priority_status_crud_executor"}:
        for key, wid, ui in (
            ("priority_draft", "create_priority", "create_priority"),
            ("status_draft", "create_status", "create_status"),
        ):
            blob = memory.durable.get(key)
            if isinstance(blob, dict) and str(blob.get("awaiting") or "").strip():
                return (key, wid, ui)
    return None


def _absorb_guided_field_utterance(
    memory: SharedMemory,
    query: str,
    agent_name: str,
    ui_actions: list[dict[str, Any]],
    *,
    allow_open_description: bool = True,
) -> bool:
    """Bind a typed field answer into the active draft. True when a field was stored."""
    from app.workflow_schemas import (
        awaiting_hint_from_missing,
        bind_awaiting_value,
        bind_primary_missing,
        draft_complete,
        mark_kb_intent_start,
        mark_macro_intent_start,
        looks_like_field_edit_instruction,
        members_from_user_text,
        normalize_fields,
        sanitize_kb_draft_fields,
        sanitize_macro_draft_fields,
        sanitize_priority_draft_fields,
        usable_catalog_label,
        usable_kb_title,
        usable_macro_title,
    )

    spec = _guided_spec_for_agent(memory, agent_name)
    if not spec:
        return False
    draft_key, workflow_id, create_type = spec
    lq = _last_query_dict(memory)
    if lq.get("catalog_op") == "delete_pick" and workflow_id in {
        "create_priority",
        "create_status",
    }:
        return False
    draft = memory.durable.get(draft_key)
    if not isinstance(draft, dict):
        return False
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if not awaiting or awaiting in {"confirm", "delete_confirm", "done", "members_confirm"}:
        return False
    raw = str(query or "").strip()
    if not raw or raw.endswith("?"):
        return False
    # Schema-after-LLM: do not store an unusable payload in the open slot.
    # Super/Executor still own whether this turn is a correction (LLM tools).
    if looks_like_field_edit_instruction(raw):
        return False
    # Typed absorb of the open description slot (schema-after-LLM). Field-edit
    # sentences already returned above; start/pin overlays are not the value.
    # Pre-LLM absorb must not fill description: Super/Executor may reopen name
    # (or another slot) this turn. Post-tool absorb passes allow_open_description.
    if workflow_id in {"create_team", "team"} and awaiting == "description":
        if not allow_open_description:
            return False
        start = str(draft.get("_intent_start_text") or "").strip()
        if start and raw == start:
            return False
        if raw.lower() in {"continue:team.create", "pinned:team-create"} or raw.lower().startswith(
            ("continue:", "pinned:", "resume:")
        ):
            return False
    if (
        workflow_id in {"create_ticket", "ticket"}
        and str(draft.get("surface") or "").strip().lower() == "portal"
        and awaiting in _PORTAL_IDENTITY_AWAITING
    ):
        from app.workflow_schemas import issue_looks_usable

        if issue_looks_usable(
            str(draft.get("issue") or draft.get("description") or draft.get("subject") or "")
        ):
            return False
        if issue_looks_usable(raw):
            awaiting = "issue"
        else:
            return False
    # Filled macro body must not be clobbered by short save/confirm utterances;
    # consent stays on the specialist LLM + write tool (skill: no keyword confirm).
    if workflow_id in {"create_macro", "macro"} and awaiting == "body":
        existing_body = str(draft.get("body") or draft.get("content") or "").strip()
        if existing_body and len(existing_body) >= 8 and len(raw) <= 24:
            return False

    def _emit_panel(merged_draft: dict[str, Any]) -> None:
        memory.durable[draft_key] = merged_draft
        memory.durable["current_workflow"] = workflow_id
        memory.durable["pending_ask"] = str(merged_draft.get("awaiting") or "")
        public = _public_guided_draft(merged_draft)
        ui_actions[:] = [
            a
            for a in ui_actions
            if not (
                isinstance(a, dict)
                and str(a.get("type") or "")
                in {
                    create_type,
                    "create_team",
                    "update_team",
                    "create_ticket",
                    "create_customer",
                    "create_macro",
                    "create_kb",
                    "create_priority",
                    "create_status",
                    "escalate",
                    "reassign",
                }
                and not a.get("done")
            )
        ]
        ui_actions.append(
            {
                "type": create_type,
                **public,
                "step": merged_draft.get("awaiting"),
                "awaiting": merged_draft.get("awaiting"),
            }
        )

    # Create-article start is not a title. Stamp start once; titled extract is LLM.
    if workflow_id in {"create_kb", "kb"} and awaiting == "title":
        start = str(draft.get("_intent_start_text") or "").strip()
        fresh = not str(draft.get("title") or draft.get("name") or "").strip() and not str(
            draft.get("body") or draft.get("content") or ""
        ).strip()
        if fresh and not start:
            from app.workflow_schemas import utterance_is_kb_create_start

            if utterance_is_kb_create_start(raw):
                _emit_panel(mark_kb_intent_start(dict(draft), raw))
                return True
        titled = usable_kb_title(raw, start_utterance=start)
        if not titled:
            merged = sanitize_kb_draft_fields(dict(draft))
            if start:
                merged["_intent_start_text"] = start
            merged["awaiting"] = "title"
            merged["step"] = "title"
            _emit_panel(merged)
            return True
        raw = titled

    # Create-macro start intent is not a title. Stamp start utterance once; later
    # turns bind only real titles (LLM/task intent — not keyword maps).
    if workflow_id in {"create_macro", "macro"} and awaiting == "title":
        start = str(draft.get("_intent_start_text") or "").strip()
        fresh = not str(draft.get("title") or draft.get("name") or "").strip() and not str(
            draft.get("body") or draft.get("content") or ""
        ).strip()
        if fresh and not start:
            _emit_panel(mark_macro_intent_start(dict(draft), raw))
            return True
        titled = usable_macro_title(raw, start_utterance=start)
        if not titled:
            merged = sanitize_macro_draft_fields(dict(draft))
            if start:
                merged["_intent_start_text"] = start
            merged["awaiting"] = "title"
            merged["step"] = "title"
            _emit_panel(merged)
            return True
        raw = titled

    # Create-priority/status start intent is not a catalog label. Start is
    # stamped on Super/Domain/harness start; this turn only binds a real name.
    if (
        workflow_id in {"create_priority", "priority", "create_status", "status"}
        and awaiting == "name"
    ):
        start = str(draft.get("_intent_start_text") or "").strip()
        kind_s = str(draft.get("kind") or "").strip().lower()
        if workflow_id in {"create_status", "status"}:
            kind_s = "status"
        elif kind_s != "status":
            kind_s = "priority"
        labeled = usable_catalog_label(raw, start_utterance=start, kind=kind_s)
        if not labeled:
            merged = sanitize_priority_draft_fields(dict(draft))
            if start:
                merged["_intent_start_text"] = start
            merged["awaiting"] = "name"
            merged["step"] = "name"
            _emit_panel(merged)
            return True
        raw = labeled

    # Prefer the active awaiting slot so corrections ("change email to …" after
    # patch reset awaiting) update the panel; else bind the first missing field.
    # Add-members: bind only roster hits so start/proceed utterances stay unbound.
    patch: dict[str, Any] = {}
    if workflow_id in {"add_team_members", "add_members"} and awaiting in {
        "members_team",
        "team",
    }:
        # Team id/name come from last_entity or list_queues + patch — never bind
        # a start sentence ("add one more member") as the team label.
        return False
    if workflow_id in {"add_team_members", "add_members", "create_team", "team"} and awaiting in {
        "members_names",
        "members",
        "create_members",
    }:
        roster_raw = draft.get("available_members") or draft.get("availableMembers")
        roster = (
            [str(n).strip() for n in roster_raw if str(n).strip()]
            if isinstance(roster_raw, list)
            else []
        )
        hits = members_from_user_text(raw, roster) if roster else []
        if not hits:
            return False
        prior = draft.get("members")
        prior_names = (
            [str(m).strip() for m in prior if str(m).strip()]
            if isinstance(prior, list)
            else []
        )
        patch = {"members": list(dict.fromkeys([*prior_names, *hits]))}
    else:
        patch = bind_awaiting_value(workflow_id, awaiting, raw)
        if (
            not patch
            and workflow_id == "create_ticket"
            and str(draft.get("surface") or "").strip().lower() != "portal"
            and not _ticket_has_valid_directory_contact(draft)
            and (email_looks_valid(raw) or phone_looks_valid(raw))
        ):
            patch = bind_awaiting_value(workflow_id, "contact", raw)
        if not patch:
            patch = bind_primary_missing(workflow_id, draft, raw)
        if not patch:
            return False
    merged = dict(draft)
    merged.update(normalize_fields(workflow_id, patch) or patch)
    if workflow_id in {"create_kb", "kb"}:
        start = str(
            merged.get("_intent_start_text") or draft.get("_intent_start_text") or ""
        ).strip()
        if start:
            merged["_intent_start_text"] = start
        merged = sanitize_kb_draft_fields(merged)
        if start:
            merged["_intent_start_text"] = start
    if workflow_id == "create_ticket":
        _normalize_ticket_contact(merged)
        if str(merged.get("surface") or draft.get("surface") or "").strip().lower() != "portal":
            if _ticket_contact_changed(dict(draft), merged):
                merged.pop("customerDirectoryStatus", None)
                merged.pop("customerId", None)
                merged.pop("customer_not_found", None)
    if workflow_id in {"create_macro", "macro"}:
        if not str(merged.get("title") or "").strip() and str(merged.get("name") or "").strip():
            merged["title"] = str(merged["name"]).strip()
        if not str(merged.get("body") or "").strip():
            alt = str(merged.get("content") or merged.get("reply") or "").strip()
            if alt:
                merged["body"] = alt
        start = str(merged.get("_intent_start_text") or draft.get("_intent_start_text") or "").strip()
        if start:
            merged["_intent_start_text"] = start
        merged = sanitize_macro_draft_fields(merged)
        if start:
            merged["_intent_start_text"] = start
    if workflow_id in {"create_priority", "priority"}:
        if not str(merged.get("displayName") or "").strip() and str(
            merged.get("name") or ""
        ).strip():
            merged["displayName"] = str(merged["name"]).strip()
        if merged.get("resolutionHours") is None and merged.get("hours") is not None:
            merged["resolutionHours"] = merged.get("hours")
        start = str(
            merged.get("_intent_start_text") or draft.get("_intent_start_text") or ""
        ).strip()
        if start:
            merged["_intent_start_text"] = start
        merged = sanitize_priority_draft_fields(merged)
        if start:
            merged["_intent_start_text"] = start
    if workflow_id in {"create_status", "status"}:
        if not str(merged.get("displayName") or "").strip() and str(
            merged.get("name") or ""
        ).strip():
            merged["displayName"] = str(merged["name"]).strip()
        start = str(
            merged.get("_intent_start_text") or draft.get("_intent_start_text") or ""
        ).strip()
        if start:
            merged["_intent_start_text"] = start
        merged = sanitize_priority_draft_fields(merged)
        if start:
            merged["_intent_start_text"] = start
    if workflow_id in {"reassign_ticket", "reassign"}:
        from app.workflow_schemas import person_from_user_text

        roster = [
            str(n).strip()
            for n in (merged.get("available_members") or [])
            if str(n).strip()
        ]
        role_by_name = merged.get("roster_roles")
        role_by_name = role_by_name if isinstance(role_by_name, dict) else {}
        person_raw = str(merged.get("person") or merged.get("person_name") or "").strip()
        if person_raw and roster:
            canonical = person_from_user_text(
                person_raw,
                roster,
                allow_fuzzy=True,
                allow_substring=True,
            )
            if canonical:
                merged["person"] = canonical
        from app.workflow_schemas import enforce_reassign_draft_roles

        merged = enforce_reassign_draft_roles(merged)
        # Focused ticket / last_entity can fill ticket_number when user said "this ticket".
        if not str(merged.get("ticket_number") or merged.get("ticketNumber") or "").strip():
            ent = memory.durable.get("last_entity")
            if isinstance(ent, dict) and str(ent.get("type") or "").lower() in {
                "ticket",
                "",
            }:
                tn = str(
                    ent.get("ticket_number")
                    or ent.get("ticketNumber")
                    or ent.get("id")
                    or ""
                ).strip()
                if tn:
                    merged["ticket_number"] = tn
    miss = missing_fields(workflow_id, merged)
    if not miss and draft_complete(workflow_id, merged):
        merged["awaiting"] = "confirm"
        merged["step"] = "confirm"
    else:
        hint = awaiting_hint_from_missing(workflow_id, merged) or (
            miss[0] if miss else "confirm"
        )
        if (
            workflow_id == "create_ticket"
            and hint == "issue"
            and not _ticket_directory_verified(merged)
        ):
            hint = "contact"
        merged["awaiting"] = hint
        merged["step"] = hint
    if workflow_id in {"create_kb", "kb"} and str(
        merged.get("awaiting") or ""
    ).lower() == "category":
        _ensure_kb_categories_on_draft(merged)
    if workflow_id in {"add_team_members", "add_members"}:
        merged["flow"] = "add_team_members"
        merged["workflow"] = "add_team_members"
    memory.durable[draft_key] = merged
    memory.durable["current_workflow"] = workflow_id
    memory.durable["pending_ask"] = str(merged.get("awaiting") or "")
    # Replace any live create/update panel action with the latest draft snapshot.
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and str(a.get("type") or "")
            in {
                create_type,
                "create_team",
                "update_team",
                "create_ticket",
                "create_customer",
                "create_macro",
                "create_kb",
                "create_priority",
                "create_status",
                "escalate",
                "reassign",
            }
            and not a.get("done")
        )
    ]
    ui_actions.append(
        {
            "type": create_type,
            **_public_guided_draft(merged),
            "step": merged.get("awaiting"),
            "awaiting": merged.get("awaiting"),
        }
    )
    return True


def _absorb_team_description_after_tools(
    memory: SharedMemory,
    query: str,
    agent_name: str,
    ui_actions: list[dict[str, Any]],
    tools_called: list[str],
) -> bool:
    """Bind a real description only when the executor did not patch the draft.

    Pre-LLM absorb must not fill description: a correction turn can reopen name
    via patch_team_draft. If the LLM only listed staff, bind the open slot now.
    """
    if any(str(name or "").strip() == "patch_team_draft" for name in tools_called):
        return False
    spec = _guided_spec_for_agent(memory, agent_name)
    if not spec:
        return False
    draft_key, workflow_id, _create_type = spec
    if workflow_id not in {"create_team", "team"}:
        return False
    draft = memory.durable.get(draft_key)
    if not isinstance(draft, dict):
        return False
    if str(draft.get("awaiting") or "").strip().lower() != "description":
        return False
    bound = _absorb_guided_field_utterance(
        memory,
        query,
        agent_name,
        ui_actions,
        allow_open_description=True,
    )
    if bound:
        _mirror_guided_draft_into_task(memory)
    return bound


def _promote_complete_guided_drafts(memory: SharedMemory) -> None:
    """If required fields are filled but awaiting lagged, arm confirm for force-write."""
    from app.workflow_schemas import draft_complete

    pairs = (
        ("ticket_draft", "create_ticket"),
        ("customer_draft", "create_customer"),
        ("team_draft", "create_team"),
        ("macro_draft", "create_macro"),
        ("kb_draft", "create_kb"),
        ("priority_draft", "create_priority"),
        ("status_draft", "create_status"),
        ("escalate_draft", "escalate"),
        ("reassign_draft", "reassign_ticket"),
    )
    for draft_key, wid in pairs:
        draft = memory.durable.get(draft_key)
        if not isinstance(draft, dict):
            continue
        awaiting = str(draft.get("awaiting") or "").strip().lower()
        if awaiting in {"confirm", "delete_confirm", "done"}:
            continue
        if not awaiting and not any(
            str(draft.get(k) or "").strip()
            for k in ("title", "name", "body", "content", "customerName", "issue")
        ):
            continue
        fixed = dict(draft)
        if wid == "create_macro":
            from app.workflow_schemas import sanitize_macro_draft_fields

            if not str(fixed.get("title") or "").strip() and str(fixed.get("name") or "").strip():
                fixed["title"] = str(fixed["name"]).strip()
            if not str(fixed.get("body") or "").strip():
                alt = str(fixed.get("content") or fixed.get("reply") or "").strip()
                if alt:
                    fixed["body"] = alt
            start = str(fixed.get("_intent_start_text") or "").strip()
            fixed = sanitize_macro_draft_fields(fixed)
            if start:
                fixed["_intent_start_text"] = start
        if wid in {"create_priority", "create_status"}:
            from app.workflow_schemas import sanitize_priority_draft_fields

            start = str(fixed.get("_intent_start_text") or "").strip()
            fixed = sanitize_priority_draft_fields(fixed)
            if start:
                fixed["_intent_start_text"] = start
        if not draft_complete(wid, fixed):
            if fixed is not draft:
                memory.durable[draft_key] = fixed
            continue
        fixed["awaiting"] = "confirm"
        fixed["step"] = "confirm"
        memory.durable[draft_key] = fixed
        if not str(memory.durable.get("current_workflow") or "").strip():
            memory.durable["current_workflow"] = wid
        if not str(memory.durable.get("pending_ask") or "").strip():
            memory.durable["pending_ask"] = "confirm"


def _run_executor_loop(
    *,
    agent_name: str,
    llm,
    memory,
    query,
    context,
    actor,
    budgets,
    module,
    surface,
    page,
    role,
    harness_executor: str | None = None,
    harness_skill: str | None = None,
) -> dict[str, Any]:
    from app.tools.express_client import runtime_agent_scope, tool_actor_scope

    with tool_actor_scope(actor):
        with runtime_agent_scope(harness_executor or agent_name):
            return _run_executor_loop_body(
                agent_name=agent_name,
                llm=llm,
                memory=memory,
                query=query,
                context=context,
                actor=actor,
                budgets=budgets,
                module=module,
                surface=surface,
                page=page,
                role=role,
                harness_executor=harness_executor,
                harness_skill=harness_skill,
            )


def _run_executor_loop_body(
    *,
    agent_name: str,
    llm,
    memory,
    query,
    context,
    actor,
    budgets,
    module,
    surface,
    page,
    role,
    harness_executor: str | None = None,
    harness_skill: str | None = None,
) -> dict[str, Any]:
    from app.rbac import rbac_prompt_block

    request: RunRequest = context["request"]
    if agent_name == "admin" and not harness_skill:
        _maybe_stamp_catalog_delete_op(memory, query)
    builder = SPECIALIST_PROMPT_BUILDERS.get(agent_name) or build_general_prompt
    system = builder(
        module=module,
        surface=surface,
        memory_snapshot=memory.snapshot(),
        actor_role=role,
        page=page,
    )
    if harness_executor and harness_skill:
        from app.skills.catalog import load_skill_definition

        executor_manifest = load_agent_definition(harness_executor)
        selected_skill = load_skill_definition(harness_skill)
        dependency_instructions = [
            {
                "name": dependency.name,
                "version": dependency.version,
                "instructions": load_skill_definition(dependency.name).body,
            }
            for dependency in selected_skill.dependencies
        ]
        trusted_context = {
            "actor_role": role,
            "channel": request.channel,
            "module": module,
            "surface": surface,
            "page": page,
            "now_iso": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        }
        # Skill prompt order: agent.md → skill → runtime → memory layers
        # (working → short-term → long-term → soft → hard) → tools/handoffs follow.
        _seed_ticket_number_from_open_ui(memory, harness_skill)
        system = (
            executor_manifest.prompt
            + _ontology_slice_block(
                memory=memory,
                runtime_agent_id=harness_executor,
                actor=actor,
            )
            + "\n\n## Selected Skill\n"
            + str(selected_skill.body or "")
            + "\n\n## Skill dependencies\n"
            + json.dumps(dependency_instructions, ensure_ascii=False, default=str)
            + "\n\n## Trusted runtime context\n"
            + json.dumps(trusted_context, ensure_ascii=False, default=str)
            + rbac_prompt_block(role, layer="executor")
            + _open_ui_prompt(memory)
            + "\n\n"
            + memory.memory_prompt_blocks()
        )
        system += _harness_confirm_policy_block(memory, selected_skill)
        if memory.durable.get("offer_continue_ticket_after_customer"):
            system += (
                "\n\n## Continue ticket after customer\n"
                "A customer was just saved and create-ticket memory was restored. "
                "Confirm the save briefly, ask whether to continue filing the ticket, "
                "and on consent ask only the next missing ticket field from ticket_draft. "
                "Never re-ask customer name or contact already in the draft."
            )
    system += _GUIDED_PATCH_SEMANTICS_BLOCK
    system += _DB_GROUNDED_ENTITY_BLOCK
    system += _CHAT_REPLY_STYLE_BLOCK
    system += _TOOL_CALL_FORMAT_BLOCK
    role_lc = str(role or "").strip().lower()
    mod_lc = str(module or "").strip().lower()
    is_portal = mod_lc == "portal" or role_lc.startswith("portal")
    if is_portal:
        system += _CUSTOMER_CHANNEL_REPLY_BLOCK
    elif str(harness_skill or "") in {"ticket-create", "customer-verify"}:
        system += _STAFF_TICKET_CREATE_REPLY_BLOCK
    if str(harness_skill or "") == "customer-read-360":
        cursor = memory.durable.get("customer_list_cursor")
        c360_cand = memory.durable.get("customer_360_candidate")
        last_list = (
            str(cursor.get("lastTool") or "list_customers").strip()
            if isinstance(cursor, dict)
            else "list_customers"
        )
        system += (
            "\n\n## Customer directory list (hard)\n"
            "- Staff list/search: call `ask_sql_layer` first "
            "(`instruction` + `entityHint=wt:Customer`). "
            "If that TOOL RESULT is success, stop — including empty rows. "
            "Call `list_customers` only when SQL fails "
            "(success false, transport, timeout, 5xx).\n"
            "- Every directory table MUST come from that successful list "
            "TOOL RESULT this turn. Never invent names, emails, or ticket counts.\n"
            "- Do not write markdown or HTML tables yourself — runtime builds the table.\n"
            "- Never output `<table>` tags or `coworker-data-table` markup in chat.\n"
            "- Reply with one short intro sentence; optional one-line follow-up question.\n"
        )
        if isinstance(cursor, dict) and cursor.get("hasMore"):
            system += (
                f"- Pagination: totalRows={cursor.get('totalRows')}, next offset="
                f"{cursor.get('offset')}, pageSize={cursor.get('pageSize')}. "
                "More of the same listing: call the same list tool that succeeded "
                f"({last_list}) with offset={cursor.get('offset')} and "
                f"limit={cursor.get('pageSize')} before replying. "
                "Never invent the next page.\n"
            )
        if isinstance(c360_cand, dict) and c360_cand.get("awaiting_consent"):
            em = str(c360_cand.get("email") or "").strip()
            nm = str(c360_cand.get("name") or "").strip()
            if em:
                system += (
                    "\n\n## Customer 360 consent (hard)\n"
                    f"- Resolved directory customer from TOOL RESULT: "
                    f"{nm or 'Customer'} <{em}>.\n"
                    "- If the user wants a 360 / ticket-history / details view, you MUST "
                    f'call `get_customer_360` with email="{em}" in this turn before replying.\n'
                    "- Never describe ticket history, CSAT, or ticket rows without a "
                    "successful `get_customer_360` tool result in this turn.\n"
                    "- On tool failure, quote the structured error — do not invent records.\n"
                )
    if str(harness_skill or "") == "knowledge-read":
        kb_cursor = memory.durable.get("kb_list_cursor")
        system += (
            "\n\n## Knowledge article list (hard)\n"
            "- A page is 10 articles. Call `list_kb` with limit=10. "
            "A new list uses offset=0. Quote `totalRows` for how many exist.\n"
            "- List only the titles and categories in this turn's TOOL RESULT. "
            "Do not repeat an earlier page.\n"
        )
        if isinstance(kb_cursor, dict) and (
            kb_cursor.get("hasMore") or kb_cursor.get("pendingPage")
        ):
            system += (
                f"- More of this same list: call `list_kb` with "
                f"offset={kb_cursor.get('offset')} and limit=10 before replying. "
                "Do not call it with an empty offset.\n"
            )
    if str(harness_skill or "") == "team-read":
        system += (
            "\n\n## Team list (hard)\n"
            "- Every team roster table MUST come from a successful `list_queues` "
            "tool result in this turn. Never invent team names, members, open "
            "ticket counts, or SLA status.\n"
            "- Do not write markdown or HTML tables yourself — runtime builds the table.\n"
            "- Never output `<table>` tags or `coworker-data-table` markup in chat.\n"
            "- Reply with one short intro sentence; optional one-line follow-up question.\n"
            "- Org-wide staff / who can be assigned → `list_agents` (names from TOOL RESULT).\n"
            "- Members of one team → `list_queues` with `query` set to that team's name. "
            "The table shows every row this call returns.\n"
            "- Every team → `list_queues` with `list_all` true and no query.\n"
        )
    if str(harness_skill or "") == "ticket-read-search":
        _ensure_ticket_list_cursor(memory)
        tcursor = memory.durable.get("ticket_list_cursor")
        if _is_portal_session(memory, actor=actor, context=context):
            system += (
                "\n\n## Support portal ticket list (hard)\n"
                "- This signed-in customer is asking about tickets they created "
                "or the status of those tickets. This turn you MUST call "
                "`portal_list_tickets`. First page: no extra args (10 tickets). "
                "More of the same listing: same tool with `offset`/`limit` from "
                "the live list cursor. Do **not** call `ask_sql_layer` or staff "
                "`list_tickets` for this ask — those are staff/org browse tools "
                "and can look empty even when the customer has tickets.\n"
                "- Ground the reply on that TOOL RESULT only. Show the tickets "
                "from that page (number and status). Runtime may append the table.\n"
                "- Say they have no tickets only when that TOOL RESULT is "
                "success and has no rows. Never invent tickets. Never offer to "
                "file a new ticket for a status/list ask.\n"
                "- Open one ticket they named → `get_ticket` after the list "
                "(or when Context already has that id). Do not start create-ticket.\n"
            )
        else:
            system += (
                "\n\n## Ticket list (hard)\n"
                "- List/search this Skill: call `ask_sql_layer` first "
                "(`instruction` + `entityHint=wt:Ticket`). "
                "Put their filters on the call. In Progress → "
                "`filters` status In Progress (never open). "
                "If that TOOL RESULT is success, stop. `rows: []` or "
                "`status=not_applicable` means **0** matching tickets — say so. "
                "Do **not** call `list_tickets` after a successful SQL read.\n"
                "- Call `list_tickets` only when `ask_sql_layer` failed "
                "(success false, transport, timeout, 5xx). Then use a supported "
                "`created_range` when they asked for a period. Presets: today, "
                "yesterday, this_week, last_week, this_month, last_month, last_24h, "
                "last_7d, last_30d. \"Past month / past one month\" → "
                "`created_range=last_30d` (or ISO `YYYY-MM-DD/YYYY-MM-DD` from "
                "trusted `now_iso`).\n"
                "- Use `limit` (default 12) and `offset` for pages. Never invent "
                "ticket rows or the next page. Speak TOOL RESULT `totalRows` first "
                "(the real matching count — not 12 unless totalRows is 12). Then "
                "the first page. If `hasMore` is true, ask if they want the next "
                "12. Never say the page is the full list when hasMore is true. "
                "Reply with one short intro only — runtime builds the table from "
                "this turn’s successful list TOOL RESULT (`ask_sql_layer` rows, "
                "or `list_tickets` only after SQL failed).\n"
                "- More of the **same** listing is a tool call this turn, not "
                "prose. Call the **same** list tool that already succeeded for "
                "that ask. Last success `ask_sql_layer` → `ask_sql_layer` again "
                "with that same period and filters written into `instruction`. "
                "Last success `list_tickets` (SQL had failed) → `list_tickets` "
                "with those same filters, never empty args. Cursor offset/limit "
                "are page context only. Open one ticket → `get_ticket`. New "
                "filters or period → `ask_sql_layer` from offset 0.\n"
            )
        if isinstance(tcursor, dict) and (
            tcursor.get("hasMore") or tcursor.get("pendingPage")
        ):
            system += (
                f"- Live list cursor (page context, not a tool choice): "
                f"totalRows={tcursor.get('totalRows')}, "
                f"next offset={tcursor.get('offset')}, "
                f"pageSize={tcursor.get('pageSize')}, "
                f"filters={json.dumps(tcursor.get('filters') or {}, ensure_ascii=False, default=str)}. "
                "If this utterance still wants that listing, pick the list tool "
                "from the last successful list in this conversation and keep "
                "that meaning in the call. Do not invent rows.\n"
            )
    if str(harness_skill or "") == "ticket-resolve-reopen":
        roster = memory.durable.get("last_customer_360_tickets")
        ent = memory.durable.get("last_entity")
        system += (
            "\n\n## Ticket resolve / reopen (hard)\n"
            "- Close vs resolve is the meaning of this utterance, not a phrase list. "
            "They mean close the ticket → `update_ticket` with status **Closed**. "
            "They mean resolve / work done → `update_ticket` with status **Resolved** "
            "(staff only). Never write Resolved when they meant close. "
            "Portal customer close is **Closed** only from Resolved; never Resolved. "
            "Reopen → `update_ticket` with status **Reopened** "
            "(staff: from Resolved or Closed; portal customer: only from Closed).\n"
            "- Ticket numbers and current status must come from `get_ticket`, "
            "`list_tickets`, `portal_list_tickets`, or `last_customer_360_tickets` / "
            "last_entity — never invent ids.\n"
            "- No ticket id in focus: this turn call `portal_list_tickets` (portal) "
            "or `list_tickets` (staff). For reopen, staff quote Resolved/closed rows; "
            "portal customers quote Closed rows from that TOOL RESULT. "
            "Never refuse a signed-in customer. Never create a ticket.\n"
            "- When last_entity / UI focus already includes ticket id and status, "
            "call `update_ticket` directly — do **not** call `get_ticket` first.\n"
            "- Call `get_ticket` only when status is missing from context, then "
            "`update_ticket` in the same turn before claiming success.\n"
            "- Do not claim the ticket was reopened, resolved, or closed without a "
            "successful `update_ticket` tool result this turn.\n"
            "- After a proceed ask, the next utterance that means consent must "
            "call `update_ticket` with flat `ticket_number`, `status`, and "
            "`confirmed=true`. Do not nest args. Do not ask again.\n"
        )
        if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "ticket":
            focus_status = str(ent.get("status") or "").strip()
            focus_id = str(
                ent.get("id")
                or ent.get("ticketNumber")
                or ent.get("ticket_number")
                or ent.get("name")
                or ""
            ).strip()
            if focus_id and focus_status:
                system += (
                    "\n## Focused ticket (UI — authoritative; skip get_ticket)\n"
                    + json.dumps(
                        {
                            "id": focus_id,
                            "status": focus_status,
                            "subject": str(ent.get("subject") or ent.get("name") or ""),
                        },
                        ensure_ascii=False,
                        default=str,
                    )
                    + "\n"
                )
        ctx_rows: list[dict[str, Any]] = []
        if isinstance(roster, list):
            ctx_rows.extend(r for r in roster if isinstance(r, dict))
        if isinstance(ent, dict) and str(ent.get("type") or "") == "ticket":
            ctx_rows.append(
                {
                    "id": ent.get("id"),
                    "status": ent.get("status"),
                    "name": ent.get("name"),
                }
            )
        if ctx_rows:
            system += (
                "\n## Recent customer 360 tickets (authoritative ids)\n"
                + json.dumps(ctx_rows[:25], ensure_ascii=False, default=str)
                + "\nUse only these ticket ids for reopen/resolve.\n"
            )
    listed_rows = _catalog_list_option_rows(_last_query_dict(memory))
    if listed_rows and str(harness_skill or "") in {
        "priority-update",
        "status-update",
        "priority-delete",
        "status-delete",
    }:
        system += (
            "\n\n## Listed catalog rows (authoritative Postgres ids)\n"
            + json.dumps(listed_rows, ensure_ascii=False, default=str)
            + "\nUse only these `id` values on write tools. Never pass sortOrder "
            "or invent an id. Keep listed resolutionHours unless the user "
            "asked to change hours."
        )
    # Keep module=portal so ("portal","home") intersects list_kb / portal_create_ticket.
    surf = surface
    if str(module or "").strip().lower() == "portal" and str(surf or "").strip().lower() in {
        "",
        "portal",
    }:
        surf = "home"
    if harness_executor and harness_skill:
        from app.mcp.client import list_mcp_tools
        from app.skills.catalog import load_skill_definition, tools_for_skill
        from app.tools.registry import tools_for_agent

        selected_skill = load_skill_definition(harness_skill)
        declared_remote = set(tools_for_skill(harness_skill, harness_executor))
        discovered_rows = list_mcp_tools(
            token=str(context.get("mcp_token") or ""),
            agent=harness_executor,
            module=module,
            surface=surface,
        )
        discovered = {
            str(row.get("name") or ""): ToolDefinition(
                name=str(row.get("name") or ""),
                description=str(row.get("description") or ""),
                input_schema=(
                    dict(row.get("input_schema") or {})
                    if isinstance(row.get("input_schema"), dict)
                    else {"type": "object", "properties": {}}
                ),
                kind=str(row.get("kind") or "read"),
                requires_confirm=bool(row.get("requires_confirm")),
                risk=str(row.get("risk") or "low"),
            )
            for row in discovered_rows
            if str(row.get("name") or "")
        }
        effective_remote = declared_remote & set(discovered)
        local_names = (
            set(selected_skill.local_controls)
            & set(executor_manifest.local_controls)
            & set(tools_for_agent(harness_executor))
        )
        runtime_controls = set(executor_manifest.local_controls) & {
            "return_to_super",
            "refuse_capability",
        }
        available = {
            **catalog_by_name(),
            **discovered,
            "return_to_super": _RETURN_TO_SUPER,
            "refuse_capability": _REFUSE_CAPABILITY,
        }
        tools = [
            available[name]
            for name in sorted(effective_remote | local_names | runtime_controls)
            if name in available
        ]
    else:
        tools = tools_for_specialist(
            agent_name,
            module=module,
            surface=surf,
            include_route=True,
        )
    extra = (
        _admin_catalog_mutate_extra_tools(memory, query, agent_name)
        if not harness_skill
        else set()
    )
    if extra:
        catalog = catalog_by_name()
        have = {t.name for t in tools}
        for tool_name in sorted(extra):
            if tool_name not in have and tool_name in catalog:
                tools.append(catalog[tool_name])
                have.add(tool_name)
    seed_portal_ticket_identity(
        memory, request, force=str(harness_skill or "") == "ticket-create"
    )
    _stamp_guided_drafts_at_turn_start(memory)
    tools = _filter_writes_until_guided_ready(tools, memory)
    tools = _filter_portal_vs_staff_ticket_tools(
        tools, memory, actor=actor, context=context
    )
    turn_ui_actions: list[dict[str, Any]] = []
    turn_successful_writes: list[str] = []
    turn_failed_writes: list[str] = []
    turn_tools_called: list[str] = []
    turn_export_analytics: dict[str, Any] | None = None
    turn_customer_list_payload: dict[str, Any] | None = None
    turn_customer_list_args: dict[str, Any] = {}
    turn_customer_360_payload: dict[str, Any] | None = None
    turn_customer_360_error: dict[str, Any] | None = None
    turn_ticket_list_payload: dict[str, Any] | None = None
    turn_team_list_payload: dict[str, Any] | None = None
    team_read_scope_requested = False
    kb_list_scope_requested = False
    turn_write_outcome: dict[str, Any] | None = None
    memory.durable["active_agent"] = agent_name
    memory.durable.pop("_skip_next_absorb", None)
    if harness_skill:
        _maybe_bind_listed_catalog_target(memory, query, harness_skill)
    # Guided collect: only patch_*_draft (executor LLM) writes fields / UI.
    field_bound = False
    awaiting_confirm_at_turn_start = _draft_awaiting_confirm(memory)
    spec_now = _guided_spec_for_agent(memory, agent_name)
    if spec_now:
        live = memory.durable.get(spec_now[0])
        if isinstance(live, dict) and any(
            str(live.get(k) or "").strip()
            for k in (
                "displayName",
                "name",
                "title",
                "body",
                "awaiting",
                "resolutionHours",
            )
        ):
            add_members_hint = ""
            kb_category_hint = ""
            portal_hint = ""
            if spec_now[1] in {"add_team_members", "add_members"}:
                add_members_hint = (
                    " For team-members-update: judge add vs remove vs replace from "
                    "meaning. This turn must call list_queues and list_agents when "
                    "the roster is not already in this turn's TOOL RESULT. Naming "
                    "a person is not a write. Add: patch pending names, then "
                    "update_queue add_members=true. Remove/replace: patch the "
                    "complete remaining roster, then update_queue add_members=false. "
                    "Do not re-ask which person when this utterance already named "
                    "them. Never claim members changed unless update_queue succeeded."
                )
            if spec_now[1] in {"create_kb", "kb"} and str(
                live.get("awaiting") or ""
            ).strip().lower() == "category":
                cats = _prefetch_kb_categories_for_collect(
                    memory, turn_tools_called=turn_tools_called
                )
                live = memory.durable.get(spec_now[0])
                live = dict(live) if isinstance(live, dict) else {}
                kb_category_hint = _kb_create_category_turn_hint(query, cats)
            if str(live.get("surface") or "").strip().lower() == "portal" or _is_portal_session(
                memory, actor=actor, context=context
            ):
                portal_hint = (
                    " Portal session: the customer is already signed in "
                    f"({str(actor.user_name or live.get('customerName') or 'the customer')}). "
                    "Do not ask for name or email. Collect only the issue. "
                    "File with portal_create_ticket (never create_ticket)."
                )
            system += (
                "\n\n## Live guided draft (authoritative this turn)\n"
                + json.dumps(_public_guided_draft(live), ensure_ascii=False, default=str)
                + "\nDo not re-ask fields that already have values. If they want "
                "to change a filled field but gave no replacement, patch awaiting "
                "only and ask for the new value. If awaiting "
                "is confirm, summarize and ask for the Skill's required choice "
                "or confirmation — or call the matching write tool with "
                "confirmed=true when they already consented. "
                "Runtime will not copy this utterance into the draft; patch this turn."
                + add_members_hint
                + kb_category_hint
                + portal_hint
            )
    handoff = str(memory.durable.pop("pending_agent_handoff", None) or "").strip()
    if handoff == "customers" and agent_name == "tickets":
        from app.workflow_schemas import new_harness_task_state

        customer_task = task_definition_for("customer.create")
        if not customer_task:
            raise ValueError("customer.create task is not registered")
        draft = memory.durable.get("customer_draft")
        collected = dict(draft) if isinstance(draft, dict) else {}
        memory.set_task_state(
            new_harness_task_state(
                customer_task.id,
                channel=str(request.channel or surface or "") or None,
                collected=collected,
                provenance={key: "ticket_handoff" for key in collected},
            )
        )
        memory.durable["active_domain"] = customer_task.domain
        memory.durable["current_workflow"] = "create_customer"
        return _run_harness_executor(
            instruction=DomainInstruction(
                executor_id=customer_task.executor,
                task_id=customer_task.id,
                skill_name=customer_task.skill_name,
                version=customer_task.version,
                objective="Create the missing customer then resume the parked ticket",
                supplied_fields=collected,
            ),
            llm=llm,
            memory=memory,
            query=query,
            context={**context, "module": "customers", "page": "Customers"},
            actor=actor,
            budgets=budgets,
        )
    _promote_complete_guided_drafts(memory)
    _mirror_guided_draft_into_task(memory)
    # Reassign: naming the teammate completes the draft — write this turn (no
    # confirm chip / extra "yes"). Same pattern as complete create_macro arming.
    reassign_ready_same_turn = False
    ras_now = memory.durable.get("reassign_draft")
    if isinstance(ras_now, dict):
        from app.workflow_schemas import draft_complete

        if (
            field_bound
            and str(ras_now.get("awaiting") or "").strip().lower() == "confirm"
            and draft_complete("reassign_ticket", ras_now)
        ):
            memory.durable["force_armed_write"] = True
            memory.durable["current_workflow"] = "reassign_ticket"
            reassign_ready_same_turn = True

    def execute(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        nonlocal harness_skill, turn_export_analytics, turn_customer_list_payload, turn_customer_list_args, turn_customer_360_payload, turn_customer_360_error, turn_ticket_list_payload, turn_team_list_payload, team_read_scope_requested, kb_list_scope_requested, turn_write_outcome
        name = _rewrite_staff_create_ticket_for_portal(
            name, memory, actor=actor, context=context, request=request
        )
        turn_tools_called.append(str(name or "").strip())
        if name in {"delete_priority", "delete_status"}:
            remounted = _remount_catalog_delete_for_write(
                memory,
                tool_name=name,
                context=context,
                actor=actor,
                request=request,
            )
            if remounted:
                harness_skill = remounted
        if name == "return_to_super":
            return _execute_return_to_super(
                arguments,
                memory=memory,
                harness_skill=harness_skill,
            )
        if name == "refuse_capability":
            state = memory.current_task_state()
            if state:
                memory.set_task_state(
                    state.model_copy(update={"status": "refused"})
                )
            return {
                "success": True,
                "payload": {
                    "code": str(arguments.get("code") or "unsupported_operation"),
                    "message": str(arguments.get("message") or ""),
                    "alternatives": arguments.get("alternatives")
                    if isinstance(arguments.get("alternatives"), list)
                    else [],
                },
            }
        if name == "route_to_agent":
            from app.runtime.supervisor import resolve_route_target

            target = resolve_route_target(
                arguments if isinstance(arguments, dict) else {}
            )
            # Ticket resume is restored in memory after create_customer — no same-turn ping-pong.
            if (
                target == "tickets"
                and agent_name == "customers"
                and memory.durable.pop("_customer_resume_handled", None)
            ):
                return {
                    "success": True,
                    "payload": {
                        "resume_already_handled": True,
                        "message": (
                            "Parked ticket draft is already active in memory. "
                            "Confirm the customer save and offer to continue filing "
                            "the ticket — do not route_to_agent again this turn."
                        ),
                    },
                }
            # LLM handoff to customers mid create-ticket (CDP miss or explicit add).
            if target == "customers" and agent_name == "tickets":
                ticket = memory.durable.get("ticket_draft")
                if isinstance(ticket, dict) and (
                    ticket.get("customer_not_found")
                    or str(ticket.get("customerName") or "").strip()
                ):
                    _prepare_add_customer_from_ticket(memory)
                    cust = dict(memory.durable.get("customer_draft") or {})
                    if cust:
                        if not any(
                            isinstance(a, dict)
                            and a.get("type") == "navigate"
                            and a.get("view") == "customers"
                            for a in turn_ui_actions
                        ):
                            turn_ui_actions.append(
                                {"type": "navigate", "view": "customers"}
                            )
                        turn_ui_actions.append(
                            {
                                "type": "create_customer",
                                **cust,
                                "step": cust.get("awaiting"),
                                "awaiting": cust.get("awaiting"),
                            }
                        )
            return {
                "success": True,
                "payload": {
                    "routing": True,
                    "agent_name": arguments.get("agent_name"),
                    "query": arguments.get("query") or query,
                },
            }
        if name in _LOCAL_TOOL_NAMES:
            return _execute_local_ui_tool(
                name,
                arguments if isinstance(arguments, dict) else {},
                memory=memory,
                ui_actions=turn_ui_actions,
            )
        args = dict(arguments) if isinstance(arguments, dict) else {}
        from app.llm.tool_calls import flatten_tool_arguments

        args = flatten_tool_arguments(args)
        # Resume a proposed write after CONFIRMATION_REQUIRED: fill missing args from
        # the prior propose and arm confirmed when TaskState is awaiting confirmation
        # on a new user turn (LLM chose the write again = semantic affirm).
        if harness_skill:
            args = _hydrate_pending_confirm_write_args(memory, name, args)
        if name == "verify_ticket_customer":
            args = _hydrate_verify_ticket_customer_args(memory, args)
        if name == "get_customer_order":
            args = _hydrate_get_customer_order_args(memory, args, query=query)
        if name == "enrich_ticket":
            args = _hydrate_enrich_args(memory, args)
            draft_for_enrich = dict(memory.durable.get("ticket_draft") or {})
            if not _ticket_directory_verified(draft_for_enrich):
                from app.contracts import tool_err

                return tool_err(
                    "CUSTOMER_NOT_VERIFIED",
                    "Call verify_ticket_customer after email/phone before enrich_ticket.",
                    payload={
                        "missing": ["customerDirectoryStatus"],
                        "awaiting": "contact",
                        "next_tool": "verify_ticket_customer",
                    },
                )
            if not _issue_ready_for_enrich(draft_for_enrich, args):
                from app.contracts import tool_err

                return tool_err(
                    "MISSING_FIELDS",
                    "Collect the customer issue before enrich_ticket — "
                    "ITRA assignee/resolver routing needs the issue text.",
                    payload={"missing": ["issue"], "awaiting": "issue"},
                )
        if name == "create_ticket":
            args = _hydrate_create_ticket_args(memory, args)
            draft_for_create = dict(memory.durable.get("ticket_draft") or {})
            if not _ticket_directory_verified(draft_for_create):
                from app.contracts import tool_err

                return tool_err(
                    "CUSTOMER_NOT_VERIFIED",
                    "Call verify_ticket_customer before create_ticket — customer must exist in the directory.",
                    payload={"next_tool": "verify_ticket_customer"},
                )
            from app.tools.bound import set_ticket_create_pin_draft
            from app.tools.ticket_write import precreate_duplicate_blocked

            set_ticket_create_pin_draft(draft_for_create)
            blocked = precreate_duplicate_blocked(draft_for_create)
            if blocked:
                return blocked
        if name == "portal_create_ticket":
            args = _hydrate_portal_create_ticket_args(memory, args)
            portal_draft = dict(memory.durable.get("ticket_draft") or {})
            from app.tools.bound import set_ticket_create_pin_draft
            from app.tools.ticket_write import precreate_duplicate_blocked

            set_ticket_create_pin_draft(portal_draft)
            blocked = precreate_duplicate_blocked(portal_draft)
            if blocked:
                return blocked
        if name == "create_queue":
            args = _hydrate_create_queue_args(memory, args)
        if name == "update_queue":
            args = _hydrate_update_queue_args(memory, args)
        if name == "create_customer":
            args = _hydrate_create_customer_args(memory, args)
        if name == "create_macro":
            args = _hydrate_create_macro_args(memory, args)
        if name in {"create_kb_article", "draft_kb_article"}:
            args = _hydrate_create_kb_args(memory, args)
        if name in {"publish_kb_article", "update_kb_article", "get_kb"}:
            args = _hydrate_kb_article_id_args(memory, args)
        if name in ("create_priority", "create_status"):
            args = _hydrate_catalog_create_args(memory, args, name)
        if name == "delete_priority":
            args = _hydrate_delete_catalog_args(memory, args, "priority_draft", "priority_id")
        if name == "delete_status":
            args = _hydrate_delete_catalog_args(memory, args, "status_draft", "status_id")
        if name == "update_priority":
            args = _hydrate_update_catalog_args(memory, args, kind="priority")
        if name == "update_status":
            args = _hydrate_update_catalog_args(memory, args, kind="status")
        if name in (
            "update_ticket",
            "escalate_ticket",
            "request_ticket_reassignment",
        ):
            args = _hydrate_reassign_write_args(memory, args, name)
        blocked = _reject_reassign_role_mismatch(memory, name, args)
        if blocked:
            return blocked
        blocked = _reject_ungrounded_entity_args(name, args, memory=memory)
        if blocked:
            return blocked
        # Hard gates: do not invent SLA hours or KB category.
        if name == "create_priority":
            from app.contracts import tool_err
            from app.workflow_schemas import missing_fields as _miss_fields

            state = memory.current_task_state()
            if state and state.task_id == "priority.create":
                _sync_guided_draft_from_task(memory, "priority.create")
            pri = memory.durable.get("priority_draft")
            pri = dict(pri) if isinstance(pri, dict) else {}
            if "resolutionHours" in _miss_fields("create_priority", pri):
                return tool_err(
                    "MISSING_FIELDS",
                    "Ask for resolution hours (SLA) next; do not invent hours "
                    "or call create_priority until hours are in the draft.",
                    payload={
                        "missing": ["resolutionHours"],
                        "displayName": pri.get("displayName") or pri.get("name"),
                        "awaiting": "hours",
                    },
                )
        if name in {"create_kb_article", "draft_kb_article"}:
            from app.contracts import tool_err
            from app.workflow_schemas import missing_fields as _miss_fields

            kb = memory.durable.get("kb_draft")
            kb = dict(kb) if isinstance(kb, dict) else {}
            miss_kb = _miss_fields("create_kb", kb)
            if "title" in miss_kb:
                return tool_err(
                    "MISSING_FIELDS",
                    "Ask for the article title next. Do not invent a title "
                    "or call an article create tool until title is in the draft.",
                    payload={
                        "missing": miss_kb,
                        "awaiting": "title",
                    },
                )
            if "category" in miss_kb:
                cats = _ensure_kb_categories_on_draft(kb)
                memory.durable["kb_draft"] = kb
                return tool_err(
                    "MISSING_FIELDS",
                    "List available categories and ask the user to choose one "
                    "before creating the article. Do not invent General.",
                    payload={
                        "missing": miss_kb,
                        "available_categories": cats,
                        "awaiting": "category",
                    },
                )
            if "body" in miss_kb:
                return tool_err(
                    "MISSING_FIELDS",
                    "Ask for the article content before asking whether to save a "
                    "draft or publish.",
                    payload={
                        "missing": miss_kb,
                        "awaiting": "body",
                    },
                )
            publication_intent = str(
                kb.get("publication_intent") or ""
            ).strip().lower()
            if publication_intent not in {"draft", "publish"}:
                return tool_err(
                    "MISSING_PUBLICATION_INTENT",
                    "The article fields are complete. Summarize them and ask whether "
                    "to save a staff-only draft or publish. Do not default or write yet.",
                    payload={
                        "missing": ["publication_intent"],
                        "awaiting": "publication_intent",
                        "choices": ["draft", "publish"],
                    },
                )
            expected_tool = (
                "draft_kb_article"
                if publication_intent == "draft"
                else "create_kb_article"
            )
            if name != expected_tool:
                return tool_err(
                    "PUBLICATION_INTENT_MISMATCH",
                    "The selected article tool does not match the LLM-written "
                    "publication intent. Call the matching tool without changing "
                    "the user's choice.",
                    payload={
                        "publication_intent": publication_intent,
                        "expected_tool": expected_tool,
                    },
                )
        if name == "ask_semantic_layer":
            if not args.get("organization_id") and actor.organization_id:
                args["organization_id"] = actor.organization_id
            if not args.get("user_id") and actor.user_id:
                args["user_id"] = actor.user_id
            if not args.get("agent") and harness_executor:
                args["agent"] = harness_executor
            from app.tools.catalog_tools import _context_layer_base

            if not _context_layer_base() and not args.get("query"):
                args["query"] = query
        if name == "ask_knowledge_graph":
            remounted = _remount_analytics_query_for_ontology(
                memory,
                context=context,
                actor=actor,
                request=request,
            )
            if remounted:
                harness_skill = remounted
            if not args.get("session_id") and request.session_id:
                args["session_id"] = request.session_id
            if not args.get("organization_id") and actor.organization_id:
                args["organization_id"] = actor.organization_id
            if not args.get("query"):
                args["query"] = query
        if name == "ask_hub":
            if not args.get("organization_id") and actor.organization_id:
                args["organization_id"] = actor.organization_id
            if not args.get("channel"):
                ch = str(
                    getattr(request, "channel", None)
                    or memory.durable.get("hub_channel")
                    or "chat"
                ).strip().lower()
                args["channel"] = ch if ch in ("chat", "email") else "chat"
            if not args.get("cdp_id"):
                ent = memory.durable.get("last_entity") or {}
                if isinstance(ent, dict):
                    cdp = str(
                        ent.get("cdp_id") or ent.get("cdpId") or ""
                    ).strip()
                    if cdp:
                        args["cdp_id"] = cdp
            if not args.get("query"):
                args["query"] = query
        draft_key, workflow_id, draft_blob = _draft_context_for_tool(memory, name)
        if draft_blob is not None:
            from app.workflow_schemas import arm_confirmed_for_write_tool

            args = arm_confirmed_for_write_tool(
                args=args,
                draft=draft_blob,
                workflow_id=workflow_id,
                draft_key=draft_key,
            )
        # Guided writes: never skip the summary confirm on a collect turn.
        # After a prior summary / propose, the write call itself is consent —
        # fill confirmed=true if the specialist omitted the schema flag.
        if harness_skill and name in (
            _GUIDED_CONFIRM_WRITE_TOOLS | _INTERACTIVE_LIFECYCLE_WRITE_TOOLS
        ):
            chip_early = (
                request.confirm_tool
                if isinstance(request.confirm_tool, dict)
                else None
            )
            chip_early_name = ""
            if chip_early:
                from app.agent_turn import resolve_confirm_tool as _resolve_chip

                chip_early_name, _ = _resolve_chip(
                    str(chip_early.get("name") or ""),
                    chip_early.get("args")
                    if isinstance(chip_early.get("args"), dict)
                    else {},
                )
            args = _apply_guided_write_confirmed_flag(
                memory,
                name,
                args,
                field_bound_this_turn=bool(field_bound),
                awaiting_confirm_at_turn_start=bool(awaiting_confirm_at_turn_start),
                chip_name=chip_early_name,
            )
        if harness_skill:
            from app.contracts import tool_err
            from app.contracts.execution import ConfirmationEvidence
            from app.skills.catalog import load_skill_definition

            skill_definition = load_skill_definition(harness_skill)
            tool_definition = catalog_by_name().get(name)
            interactive_approval = skill_definition.approval_policy in {
                "interactive_semantic",
                "interactive_high_risk",
                "channel_dependent",
            }
            if bool((request.session_memory or {}).get("trustedStructured")):
                interactive_approval = False
            if name == "portal_create_ticket":
                interactive_approval = False
            from app.workflow_schemas import is_primary_task_mutation

            state_for_primary = memory.current_task_state()
            primary_mutation = is_primary_task_mutation(
                state_for_primary.task_id if state_for_primary else None,
                name,
            )
            if (
                interactive_approval
                and tool_definition
                and tool_definition.kind == "mutation"
                and primary_mutation
            ):
                from app.agent_turn import resolve_confirm_tool

                chip = (
                    request.confirm_tool
                    if isinstance(request.confirm_tool, dict)
                    else None
                )
                chip_name = ""
                chip_args: dict[str, Any] = {}
                if chip:
                    chip_name, chip_args = resolve_confirm_tool(
                        str(chip.get("name") or ""),
                        chip.get("args") if isinstance(chip.get("args"), dict) else {},
                    )
                if chip_name and chip_name == name:
                    for key, value in chip_args.items():
                        if key not in {"confirmed", "auto"}:
                            args[key] = value
                state = memory.current_task_state()
                if state and state.mutation_attempted:
                    return tool_err(
                        "BAD_INPUT",
                        "This task already attempted its mutation; it will not be retried.",
                        retryable=False,
                    )
                stable_args = {
                    key: value
                    for key, value in args.items()
                    if key not in {"confirmed", "auto"}
                }
                argument_hash = hashlib.sha256(
                    json.dumps(
                        stable_args,
                        sort_keys=True,
                        separators=(",", ":"),
                        default=str,
                    ).encode("utf-8")
                ).hexdigest()
                evidence = state.confirmation if state else None
                evidence_matches = bool(
                    state
                    and evidence
                    and evidence.argument_hash == argument_hash
                    and evidence.task_version == state.task_version
                    and evidence.skill_version == state.skill_version
                )
                # UI confirm chip is a trusted cross-turn confirmation source.
                chip_confirms = bool(chip_name and chip_name == name)
                # CRM consent turn: specialist already called the write with
                # confirmed=true because the LLM judged the user consented
                # (or hydrate armed after that tool call on a complete draft).
                # Deterministic gates only — never scan user text for yes/yehh.
                from app.tools.registry import _truthy_flag as _flag_true

                user_affirmed_write = _flag_true(args.get("confirmed")) or _flag_true(
                    args.get("auto")
                )
                if (chip_confirms or user_affirmed_write) and state:
                    evidence = ConfirmationEvidence(
                        confirmation_id=(
                            evidence.confirmation_id
                            if evidence
                            else str(uuid.uuid4())
                        ),
                        task_version=state.task_version,
                        skill_version=state.skill_version,
                        argument_hash=argument_hash,
                        requested_request_id=(
                            "ui_confirm_chip"
                            if chip_confirms
                            else "user_affirmed_write"
                        ),
                    )
                    evidence_matches = True
                if not evidence_matches:
                    if state:
                        evidence = ConfirmationEvidence(
                            confirmation_id=str(uuid.uuid4()),
                            task_version=state.task_version,
                            skill_version=state.skill_version,
                            argument_hash=argument_hash,
                            requested_request_id=memory.request_id or None,
                        )
                        memory.set_task_state(
                            state.model_copy(
                                update={
                                    "status": "awaiting_confirmation",
                                    "confirmation": evidence,
                                }
                            )
                        )
                    err = tool_err(
                        "CONFIRMATION_REQUIRED",
                        "Present the exact proposed action and ask for confirmation.",
                        payload={
                            "confirmation_id": (
                                evidence.confirmation_id if evidence else None
                            ),
                            "task_id": state.task_id if state else None,
                        },
                        retryable=False,
                    )
                    err["kind"] = "needs_confirm"
                    return err
                if (
                    evidence
                    and evidence.requested_request_id == memory.request_id
                    and not chip_confirms
                    and not user_affirmed_write
                ):
                    err = tool_err(
                        "CONFIRMATION_REQUIRED",
                        "Wait for a new user turn before executing the proposed action.",
                        payload={"confirmation_id": evidence.confirmation_id},
                        retryable=False,
                    )
                    err["kind"] = "needs_confirm"
                    return err
                if state and evidence:
                    approved = evidence.model_copy(update={"approved": True})
                    memory.set_task_state(
                        state.model_copy(
                            update={
                                "status": "executing",
                                "confirmation": approved,
                                # Do NOT set mutation_attempted until the write succeeds —
                                # otherwise a failed MCP confirm gate sticks the task.
                                "executed_confirmation_ids": [
                                    *state.executed_confirmation_ids,
                                    approved.confirmation_id,
                                ],
                            }
                        )
                    )
                    # Compatibility flag for the existing low-level gate. The
                    # trusted, version/hash-bound evidence above is authoritative.
                    args["confirmed"] = True
                    context["_harness_trusted_write"] = True
            elif tool_definition and tool_definition.kind == "mutation":
                state = memory.current_task_state()
                # Only the primary task write is once-only; helpers (create_customer
                # during ticket.create) must not be blocked by that flag.
                if (
                    state
                    and state.mutation_attempted
                    and primary_mutation
                ):
                    return tool_err(
                        "BAD_INPUT",
                        "This task already attempted its mutation; it will not be retried.",
                        retryable=False,
                    )
                if state:
                    memory.set_task_state(
                        state.model_copy(
                            update={
                                "status": "executing",
                            }
                        )
                    )
            state = memory.current_task_state()
            if (
                state
                and state.idempotency_key
                and tool_definition
                and tool_definition.kind == "mutation"
            ):
                args["_idempotency_key"] = state.idempotency_key
        # Skill hard-preference gate (deterministic; outside agent keyword routing).
        if name not in {
            "verify_hard_preferences",
            "get_user_preferences",
            "update_user_preference",
            "store_long_term_memory",
            "search_long_term_memory",
        }:
            tool_definition = catalog_by_name().get(name)
            if tool_definition and tool_definition.kind == "mutation":
                from app.contracts import tool_err as _pref_err
                from app.memory.durable_store import verify_hard_preference_action

                try:
                    verdict = verify_hard_preference_action(
                        organization_id=str(actor.organization_id or ""),
                        user_id=str(actor.user_id or ""),
                        tool_name=name,
                        arguments=args if isinstance(args, dict) else {},
                        channel=str(
                            getattr(request, "channel", None)
                            or context.get("surface")
                            or ""
                        ),
                    )
                except Exception:  # noqa: BLE001
                    verdict = {"decision": "allow", "reasons": []}
                decision = str(verdict.get("decision") or "allow").strip().lower()
                if decision == "block":
                    return _pref_err(
                        "HARD_PREFERENCE_BLOCKED",
                        "; ".join(verdict.get("reasons") or [])
                        or "Blocked by hard preference.",
                        payload=verdict,
                        retryable=False,
                    )
                if decision == "approval_required":
                    from app.tools.registry import _truthy_flag as _pref_flag

                    if not (
                        _pref_flag(args.get("confirmed"))
                        or _pref_flag(args.get("auto"))
                    ):
                        return _pref_err(
                            "HARD_PREFERENCE_APPROVAL_REQUIRED",
                            "; ".join(verdict.get("reasons") or [])
                            or "Hard preference requires explicit confirmation.",
                            payload=verdict,
                            retryable=False,
                        )
        try:
            from app.mcp.client import call_mcp_tool

            harness_trusted = bool(context.get("_harness_trusted_write"))
            call_agent = harness_executor or agent_name
            call_module = module
            call_surface = surface
            call_token = context.get("mcp_token") or request.mcp_token
            # Domain ownership: create_customer mid ticket.create belongs to catalog.
            if name == "create_customer":
                state_now = memory.current_task_state()
                if state_now and str(state_now.task_id or "") == "ticket.create":
                    from app.mcp.authorization import verify_mcp_token

                    parent_claims: dict[str, Any] = {}
                    try:
                        if call_token:
                            parent_claims = verify_mcp_token(str(call_token))
                    except Exception:  # noqa: BLE001
                        parent_claims = {
                            "organization_id": actor.organization_id,
                            "actor_id": actor.user_id,
                            "role": actor.user_role,
                            "run_id": memory.request_id,
                        }
                    switched = _harness_park_ticket_create_for_catalog_customer(
                        memory,
                        args,
                        channel=str(request.channel or surface or "") or None,
                        mcp_parent=parent_claims,
                    )
                    args = dict(switched.get("args") or args)
                    call_agent = str(switched["executor"])
                    call_module = str(switched["module"])
                    call_surface = str(switched["surface"])
                    call_token = switched["mcp_token"]
                    context["mcp_token"] = call_token
                    draft_key, workflow_id, draft_blob = _draft_context_for_tool(
                        memory, name
                    )
                    try:
                        from app.observability.turn_log import record_attending_agent, record_route

                        record_route(
                            "intake_deflection_domain",
                            str(switched["domain"]),
                            "cdp_miss:customer.create",
                        )
                        record_route(
                            str(switched["domain"]),
                            call_agent,
                            "pinned:customer-create",
                        )
                        record_attending_agent(call_agent)
                    except Exception:  # noqa: BLE001
                        pass
                from app.workflow_schemas import customer_write_ready

                if customer_write_ready(args):
                    args["confirmed"] = True
            if name == "list_kb" and str(harness_skill or "") == "knowledge-read":
                kb_cursor = memory.durable.get("kb_list_cursor")
                page_error, args = _kb_list_page_args(
                    args,
                    cursor=kb_cursor if isinstance(kb_cursor, dict) else None,
                    scope_already_requested=kb_list_scope_requested,
                )
                if page_error is not None:
                    kb_list_scope_requested = True
                    return page_error
            if name == "list_queues" and str(harness_skill or "") == "team-read":
                scope_error, args = _team_read_list_queues_args(
                    args,
                    scope_already_requested=team_read_scope_requested,
                )
                if scope_error is not None:
                    team_read_scope_requested = True
                    return scope_error
            result = call_mcp_tool(
                name,
                args,
                token=call_token,
                agent=call_agent,
                module=call_module,
                surface=call_surface,
                draft=draft_blob if isinstance(draft_blob, dict) else None,
                workflow_id=workflow_id,
                draft_key=draft_key,
                trusted_approval="trusted_structured" if harness_trusted else None,
            )
            # One auto-retry if a stale gate still asked for phone / confirm while
            # args are write-ready — never leave the LLM to restart from name.
            if (
                name == "create_customer"
                and isinstance(result, dict)
                and result.get("success") is False
                and str(result.get("error_code") or "").upper() == "CONFIRMATION_REQUIRED"
                and customer_write_ready(args)
            ):
                args = dict(args)
                args["confirmed"] = True
                result = call_mcp_tool(
                    name,
                    args,
                    token=call_token,
                    agent=call_agent,
                    module=call_module,
                    surface=call_surface,
                    draft=draft_blob if isinstance(draft_blob, dict) else None,
                    workflow_id=workflow_id,
                    draft_key=draft_key,
                    trusted_approval="trusted_structured",
                )
            elif (
                _same_turn_confirm_retry_ok(
                    memory,
                    name,
                    field_bound_this_turn=bool(field_bound),
                    awaiting_confirm_at_turn_start=bool(awaiting_confirm_at_turn_start),
                )
                and isinstance(result, dict)
                and result.get("success") is False
                and str(result.get("error_code") or "").upper() == "CONFIRMATION_REQUIRED"
            ):
                args = dict(args)
                args["confirmed"] = True
                result = call_mcp_tool(
                    name,
                    args,
                    token=call_token,
                    agent=call_agent,
                    module=call_module,
                    surface=call_surface,
                    draft=draft_blob if isinstance(draft_blob, dict) else None,
                    workflow_id=workflow_id,
                    draft_key=draft_key,
                    trusted_approval="trusted_structured",
                )
        except Exception as tool_exc:
            # Never abort the whole portal/staff turn on MCP/auth/schema errors —
            # return a structured tool failure so the LLM can reply instead of 503.
            from app.contracts import tool_err
            from app.contracts.errors import NativeAIError, ToolNotAllowed

            if isinstance(tool_exc, (ToolNotAllowed, NativeAIError)):
                return tool_err(
                    getattr(tool_exc, "code", None) or "TOOL_NOT_ALLOWED",
                    str(getattr(tool_exc, "message", None) or tool_exc),
                    payload={"details": getattr(tool_exc, "details", None) or {}},
                )
            raise
        if name == "portal_list_tickets" and isinstance(result, dict) and result.get("success"):
            payload = _project_portal_ticket_list_payload(result.get("payload"))
            result["payload"] = payload
            if isinstance(payload, list):
                turn_ticket_list_payload = {"data": payload, "totalRows": len(payload)}
            elif isinstance(payload, dict):
                turn_ticket_list_payload = dict(payload)
            if turn_ticket_list_payload and not _hide_ticket_list_table(harness_skill):
                _stash_ticket_list_cursor(
                    memory, turn_ticket_list_payload, arguments or {}
                )
            if _hide_ticket_list_table(harness_skill):
                turn_ticket_list_payload = None
        if name == "list_tickets" and isinstance(result, dict) and result.get("success"):
            payload = result.get("payload")
            if isinstance(payload, list):
                turn_ticket_list_payload = {"data": payload, "totalRows": len(payload)}
            elif isinstance(payload, dict):
                turn_ticket_list_payload = dict(payload)
                turn_ticket_list_payload.setdefault("totalKnown", True)
            if turn_ticket_list_payload and not _hide_ticket_list_table(harness_skill):
                _stash_ticket_list_cursor(
                    memory, turn_ticket_list_payload, arguments or {}
                )
            if _hide_ticket_list_table(harness_skill):
                turn_ticket_list_payload = None
        if name == "ask_sql_layer" and isinstance(result, dict) and result.get("success"):
            payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
            if str(payload.get("error_code") or "").lower() != "kpi_not_allowed":
                sql_list = _ticket_list_payload_from_sql(payload, arguments or {})
                if (
                    sql_list is not None
                    and str(harness_skill or "") == "customer-read-360"
                ):
                    turn_customer_list_payload = dict(sql_list)
                    turn_customer_list_args = dict(arguments or {})
                    _stash_customer_list_cursor(memory, sql_list, arguments or {})
                    _stash_customer_360_candidate(memory, sql_list)
                elif sql_list is not None and not _hide_ticket_list_table(harness_skill):
                    turn_ticket_list_payload = sql_list
                    _stash_ticket_list_cursor(
                        memory,
                        turn_ticket_list_payload,
                        {
                            **(arguments or {}),
                            **_express_filters_from_sql_list(arguments or {}, []),
                        },
                    )
        if name == "export_analytics" and isinstance(result, dict) and result.get("success"):
            payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
            if payload:
                turn_export_analytics = dict(payload)
            _append_export_analytics_download(result, turn_ui_actions)
        if name == "get_customer_360" and isinstance(result, dict):
            if result.get("success"):
                payload = (
                    result.get("payload") if isinstance(result.get("payload"), dict) else {}
                )
                if payload:
                    turn_customer_360_payload = dict(payload)
                    _stash_customer_360_ticket_roster(memory, payload)
                _mark_customer_360_resolved(memory, success=True)
                cursor = memory.durable.get("customer_list_cursor")
                if isinstance(cursor, dict):
                    cursor = dict(cursor)
                    cursor["pendingPage"] = False
                    memory.durable["customer_list_cursor"] = cursor
            else:
                _mark_customer_360_resolved(memory, success=False)
        if name == "list_customers" and isinstance(result, dict) and result.get("success"):
            payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
            if payload:
                turn_customer_list_payload = dict(payload)
                turn_customer_list_args = dict(arguments or {})
                _stash_customer_list_cursor(memory, payload, arguments or {})
                _stash_customer_360_candidate(memory, payload)
        if name == "enrich_ticket" and isinstance(result, dict) and result.get("success"):
            _merge_enrich_into_draft(memory, result, turn_ui_actions)
        if (
            name == "verify_ticket_customer"
            and isinstance(result, dict)
            and result.get("success")
        ):
            _merge_verify_into_ticket_draft(memory, result, turn_ui_actions)
        if name == "get_customer_order" and isinstance(result, dict):
            _merge_order_lookup_into_ticket_draft(memory, result)
        if name == "list_agents" and isinstance(result, dict) and result.get("success"):
            _stash_team_roster_from_list_agents(memory, result)
        if (
            name == "list_kb"
            and str(harness_skill or "") == "knowledge-read"
            and isinstance(result, dict)
            and result.get("success")
        ):
            payload = result.get("payload") if isinstance(result.get("payload"), dict) else None
            if isinstance(payload, dict) and payload.get("totalRows") is not None:
                _stash_kb_list_cursor(memory, payload, args)
        if name == "list_kb_categories" and isinstance(result, dict) and result.get("success"):
            _stash_kb_categories_from_list(memory, result)
        if name == "list_queues" and isinstance(result, dict) and result.get("success"):
            _stash_current_team_members_from_list_queues(memory, result)
            _stash_catalog_pick_from_list(memory, name, result)
            payload = result.get("payload")
            rows = _queue_list_rows(payload)
            team_query = str(args.get("query") or "").strip()
            if rows or team_query:
                turn_team_list_payload = {"data": rows, "totalRows": len(rows)}
                if team_query:
                    turn_team_list_payload["query"] = team_query
        if name in {"list_priorities", "list_statuses"} and isinstance(result, dict):
            _stash_catalog_pick_from_list(memory, name, result)
            _maybe_bind_listed_catalog_target(memory, query, harness_skill)
        if name == "resolve_ticket_person" and isinstance(result, dict) and result.get("success"):
            _stash_reassign_from_resolve_person(memory, result, query=query)
            if str(harness_skill or "") == "ticket-reassign":
                from app.workflow_schemas import draft_complete as _reassign_ready

                ras = memory.durable.get("reassign_draft")
                if isinstance(ras, dict) and _reassign_ready("reassign_ticket", ras):
                    memory.durable["force_armed_write"] = True
                    memory.durable["current_workflow"] = "reassign_ticket"
                    return execute("update_ticket", {"confirmed": True})
        if (
            name == "update_queue"
            and isinstance(result, dict)
            and result.get("success")
            and not _update_queue_roster_applied(args, result)
        ):
            payload = _tool_payload_dict(result)
            listed = _member_names_from_value(payload.get("members"))
            result = {
                "success": False,
                "error_code": "ROSTER_NOT_APPLIED",
                "kind": "write_failed",
                "message": (
                    "update_queue returned success but the roster did not match "
                    "the requested members. Current members: "
                    + (", ".join(listed) if listed else "(none)")
                    + ". Do not claim anyone was removed or added."
                ),
                "payload": result.get("payload"),
                "retryable": True,
            }
        if harness_skill and isinstance(result, dict) and result.get("success"):
            root_skill = load_skill_definition(harness_skill)
            for dependency in root_skill.dependencies:
                dependency_skill = load_skill_definition(dependency.name)
                if name not in dependency_skill.allowed_tools:
                    continue
                state = memory.current_task_state()
                if state and dependency.name not in state.dependency_results:
                    dependency_results = dict(state.dependency_results)
                    dependency_results[dependency.name] = {
                        "version": dependency_skill.version,
                        "tool": name,
                        "outcome": {
                            "success": True,
                            "payload": result.get("payload"),
                        },
                    }
                    memory.set_task_state(
                        state.model_copy(
                            update={"dependency_results": dependency_results}
                        )
                    )
        if isinstance(result, dict) and result.get("success"):
            tool_definition = catalog_by_name().get(name)
            if tool_definition and tool_definition.kind == "read":
                memory.durable["_harness_turn_read_ok"] = name
            if name in (
                "create_ticket",
                "portal_create_ticket",
                "create_customer",
                "create_queue",
                "update_queue",
                "create_macro",
                "create_kb_article",
                "draft_kb_article",
                "publish_kb_article",
                "create_priority",
                "create_status",
                "update_priority",
                "update_status",
                "escalate_ticket",
                "update_ticket",
                "delete_priority",
                "delete_status",
                "delete_queue",
                "delete_macro",
            ):
                turn_successful_writes.append(name)
                turn_write_outcome = {
                    "tool": name,
                    "payload": _tool_payload_dict(result),
                }
                state = memory.current_task_state()
                if state and harness_skill:
                    from app.mcp.catalog import catalog_by_name as _cat
                    from app.workflow_schemas import is_primary_task_mutation

                    tool_def = _cat().get(name)
                    if (
                        tool_def
                        and tool_def.kind == "mutation"
                        and is_primary_task_mutation(state.task_id, name)
                    ):
                        memory.set_task_state(
                            state.model_copy(
                                update={
                                    "mutation_attempted": True,
                                    "status": "completed",
                                }
                            )
                        )
            if name in ("delete_priority", "delete_status"):
                _clear_draft_after_delete(name, memory, turn_ui_actions, result=result)
            else:
                _clear_draft_after_write(name, memory, turn_ui_actions, result=result)
        elif isinstance(result, dict) and result.get("success") is False:
            # Policy-driven: every confirm write gets a durable failure outcome.
            # (record_tool also writes last_tool_outcome; keep this for execute-path
            # consumers before the loop records.)
            from app.contracts.tool_results import write_failure_retryable
            from app.tools.registry import TOOL_META

            if "retryable" not in result:
                result = {
                    **result,
                    "retryable": write_failure_retryable(result),
                }
            if (
                (TOOL_META.get(name) or {}).get("confirm")
                or name
                in {
                    "update_ticket",
                    "escalate_ticket",
                    "auto_assign_ticket",
                    *GUIDED_CREATE_WRITE_TOOLS,
                    *GUIDED_UPDATE_WRITE_TOOLS,
                }
                or str(result.get("error_code") or "").upper() == "CONFIRMATION_REQUIRED"
                or str(result.get("kind") or "").lower() == "needs_confirm"
            ):
                turn_failed_writes.append(name)
                memory.durable["last_tool_outcome"] = {
                    "tool": name,
                    "success": False,
                    "error_code": result.get("error_code"),
                    "kind": result.get("kind"),
                    "message": result.get("message"),
                    "retryable": bool(result.get("retryable")),
                    "arguments": args,
                }
                if (
                    str(result.get("error_code") or "").upper() == "CONFIRMATION_REQUIRED"
                    or str(result.get("kind") or "").lower() == "needs_confirm"
                ):
                    memory.durable["pending_ask"] = "confirm"
            if name == "create_ticket" and _customer_not_found_message(
                str(result.get("message") or "")
            ):
                _flag_ticket_customer_not_found(memory)
            if name == "create_customer":
                from app.tasks.catalog_commands import _directory_row_from_tool

                row = _directory_row_from_tool(result) or {}
                draft = memory.durable.get("customer_draft")
                draft = dict(draft) if isinstance(draft, dict) else {}
                cid = str(row.get("id") or "").strip()
                cname = str(row.get("name") or draft.get("name") or "").strip()
                err = str(result.get("message") or "").lower()
                code = str(result.get("error_code") or "").upper()
                already = bool(cid and cname) and (
                    code in {"CONFLICT", "ALREADY_EXISTS"}
                    or "already" in err
                    or "exist" in err
                )
                if already or (result.get("success") and cid):
                    memory.durable["last_entity"] = {
                        "type": "customer",
                        "id": cid,
                        "name": cname,
                        "email": str(row.get("email") or draft.get("email") or ""),
                        "phone": str(row.get("phone") or draft.get("phone") or ""),
                    }
                    _bind_customer_onto_ticket_memory(
                        memory,
                        customer_id=cid,
                        name=cname,
                        email=str(row.get("email") or draft.get("email") or ""),
                        phone=str(row.get("phone") or draft.get("phone") or ""),
                    )
                    _arm_native_resume_after_customer(
                        memory,
                        user_text=query,
                        page=str(context.get("page") or "") or None,
                        ui_actions=turn_ui_actions,
                    )
        return result

    pending_confirm_tool = _pending_confirm_write_tool(memory)
    start_ticket = memory.durable.get("ticket_draft")
    start_ticket = dict(start_ticket) if isinstance(start_ticket, dict) else {}
    start_awaiting = str(start_ticket.get("awaiting") or "").strip().lower()
    start_pending_kb = (
        start_ticket.get("pending_kb")
        if isinstance(start_ticket.get("pending_kb"), dict)
        else None
    )
    if (
        str(harness_skill or "") == "ticket-create"
        and _is_portal_session(memory, actor=actor, context=context)
        and (
            start_awaiting == "kb_resolution"
            or (start_pending_kb and start_awaiting != "confirm")
        )
    ):
        memory.durable["_portal_create_after_self_service"] = True
    portal_create_after_self_service = bool(
        memory.durable.get("_portal_create_after_self_service")
        and str(harness_skill or "") == "ticket-create"
        and _is_portal_session(memory, actor=actor, context=context)
    )
    portal_file_confirm = bool(
        str(harness_skill or "") == "ticket-create"
        and awaiting_confirm_at_turn_start
        and not field_bound
        and _is_portal_session(memory, actor=actor, context=context)
        and _ticket_create_issue_absorbed_ready_to_confirm(memory)
    )
    if portal_file_confirm:
        system += (
            "\n\n## Portal file-confirm (hard)\n"
            "- The recap was already shown. Live draft is confirm-ready.\n"
            "- If this utterance means file/save/proceed (meaning, not a word list), "
            "call `portal_create_ticket` once this turn with `confirmed=true`. "
            "Use issue and `/uploads/` already on the live draft.\n"
            "- Reply only from that TOOL RESULT (ticket number on success).\n"
            "- Never say filing failed, hit a snag, or ask them to retry unless "
            "that TOOL RESULT `success` is false.\n"
            "- If they refuse or want a field changed, patch or ask — do not file.\n"
        )
    if portal_create_after_self_service:
        system += (
            "\n\n## Portal file after self-service (hard)\n"
            "- They already asked or agreed to file. Super parked deflection "
            "so this Skill can collect and recap.\n"
            "- If the recap has not been shown yet, patch the issue from "
            "this conversation, then recap name, contact, and issue in "
            "simple HTML and ask whether to file. Do not call "
            "`portal_create_ticket` on that first ready turn.\n"
            "- Call `portal_create_ticket` with `confirmed=true` only after "
            "they confirm filing (this utterance or an earlier turn after "
            "that recap — meaning, not a word list).\n"
            "- If the issue is still incomplete, patch and ask one follow-up "
            "— still do not invent a filed ticket.\n"
        )
    if (
        harness_skill
        and awaiting_confirm_at_turn_start
        and pending_confirm_tool
    ):
        confirm_names = {
            pending_confirm_tool,
            "return_to_super",
            "refuse_capability",
        }
        tools = [t for t in tools if str(getattr(t, "name", "") or "") in confirm_names]
        last = memory.durable.get("last_tool_outcome")
        last = last if isinstance(last, dict) else {}
        prior_args = (
            last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
        )
        system += (
            "\n\n## Confirm turn (hard)\n"
            f"- Prior write tool: `{pending_confirm_tool}`\n"
            f"- Prior arguments: {json.dumps(prior_args, ensure_ascii=False, default=str)}\n"
            "- If this turn means proceed, call that tool **once** with "
            "`confirmed=true` and the same arguments — then one brief reply from "
            "the tool result. If they refuse or change the action, do not write.\n"
        )
    if _same_skill_park_blocked(memory, harness_skill=harness_skill):
        tools = [
            t
            for t in tools
            if str(getattr(t, "name", "") or "").strip() != "return_to_super"
        ]
        system += (
            "\n\n## Live article disposition (hard)\n"
            "- Super already continued this Skill. This utterance is the "
            "draft-or-publish choice or write consent for the live kb_draft.\n"
            "- Call patch_kb_draft with publication_intent if TOOL RESULT "
            "still lacks it, then draft_kb_article or create_kb_article "
            "with confirmed=true this turn. Do not park. Do not re-ask title.\n"
        )

    armed_state = _memory_armed_state(memory, context)
    armed_tools = armed_write_tools_from_state(armed_state)
    if pending_confirm_tool and awaiting_confirm_at_turn_start:
        armed_tools = frozenset(set(armed_tools or ()) | {pending_confirm_tool})
    # Pending CONFIRMATION_REQUIRED is context for the LLM only — do not force a
    # write. Consent is semantic (specialist passes confirmed=true).
    if harness_skill and isinstance(request.confirm_tool, dict):
        from app.agent_turn import resolve_confirm_tool

        chip_name, _chip_args = resolve_confirm_tool(
            str(request.confirm_tool.get("name") or ""),
            request.confirm_tool.get("args")
            if isinstance(request.confirm_tool.get("args"), dict)
            else {},
        )
        if chip_name:
            armed_tools = frozenset(armed_tools or ()) | frozenset({chip_name})
            memory.durable["force_armed_write"] = True
    armed_confirm_turn = bool(
        armed_tools
        and (
            awaiting_confirm_at_turn_start
            or pending_confirm_tool
        )
    )
    workflow_decision = (
        _native_workflow_decision(memory, query, context)
        if armed_tools
        and (not harness_skill or portal_file_confirm or armed_confirm_turn)
        else {}
    )

    def _should_force_armed() -> bool:
        if portal_file_confirm and _portal_confirm_force_blocked_by_field_edit(
            workflow_decision
        ):
            return False
        return _should_force_native_armed_write(
            memory,
            query,
            context,
            workflow_decision=workflow_decision,
        )

    # Snapshot before the loop (force_armed_write is cleared in finally).
    # Never force-write on the same turn we just bound a collect field — ask
    # confirm first; the next affirm turn owns the write.
    # Also never force guided creates until the draft was already awaiting
    # confirm at turn start (summary shown) or a prior CONFIRMATION_REQUIRED.
    # Exception: reassign person-pick completes the draft — write immediately
    # (no confirm chip in chat).
    guided_force_blocked = bool(
        armed_tools
        and (frozenset(armed_tools) & _GUIDED_CONFIRM_WRITE_TOOLS)
        and not awaiting_confirm_at_turn_start
        and not any(_prior_interactive_confirm_ready(memory, t) for t in armed_tools)
        and not reassign_ready_same_turn
    )
    block_force_for_collect = (
        (field_bound and not reassign_ready_same_turn) or guided_force_blocked
    )
    write_was_owed = (
        bool(armed_tools) and (not block_force_for_collect) and _should_force_armed()
    )

    # Create-ticket Skill: after this-turn absorb filled issue and the draft is
    # confirm-ready, do not enter the Executor tool-loop LLM (that hop hung 90s
    # on Gemma). Super already classified CONTINUE; Domain pin stays. Phrase the
    # recap — never file on the same turn the issue was first saved.
    skip_ticket_issue_tool_loop = bool(
        field_bound
        and not awaiting_confirm_at_turn_start
        and _ticket_create_issue_absorbed_ready_to_confirm(memory)
        and not portal_create_after_self_service
    )

    if str(harness_skill or "") == "ticket-create":
        pre_dup = _prefetch_precreate_customer_tickets(memory)
        if pre_dup:
            system += (
                "\n\n## Same-customer tickets (authoritative Postgres — do not show this list)\n"
                + json.dumps(pre_dup, ensure_ascii=False, default=str)
                + "\nAnalyze only (LLM meaning — never word lists). Same listed "
                "orderId as this draft (even if the issue text differs) or "
                "same issue, and status is not "
                "Resolved or Closed: quote that listed "
                "number, stamp precreate_duplicate_check=duplicate, do not "
                "create. Same issue or same orderId and status is Resolved or "
                "Closed: ask "
                "whether to reopen that listed ticket; do not create; do not "
                "stamp not_duplicate. They mean reopen: return_to_super park "
                "with that listed number. They decline reopen but still want "
                "a new file: stamp not_duplicate then recap. If none match, "
                "patch_ticket_draft precreate_duplicate_check=not_duplicate, then "
                "recap and ask to file. Never describe these rows as a table or page.\n"
            )

    if (
        str(harness_skill or "") == "ticket-read-search"
        and "list_tickets" not in turn_tools_called
        and _ticket_list_page_pending(memory)
    ):
        pre_tickets = _prefetch_ticket_list_page(
            memory, turn_tools_called=turn_tools_called
        )
        if pre_tickets:
            turn_ticket_list_payload = dict(pre_tickets)
            system += (
                "\n\n## Ticket list tool result (authoritative Postgres — quote only this)\n"
                + json.dumps(
                    {
                        "totalRows": pre_tickets.get("totalRows"),
                        "offset": pre_tickets.get("offset"),
                        "limit": pre_tickets.get("limit"),
                        "hasMore": pre_tickets.get("hasMore"),
                        "createdRange": pre_tickets.get("createdRange"),
                        "rowCount": len(_ticket_list_rows(pre_tickets)),
                    },
                    ensure_ascii=False,
                    default=str,
                )
                + "\nThis snapshot is the listing only when it matches what they "
                "asked for (same period and filters as the last successful list). "
                "If it does not, ignore it and call that same list tool this turn. "
                "Reply with one short intro only; runtime appends the table. "
                "Do not invent ticket ids or rows.\n"
            )
    if _customer_360_consent_pending(memory) and "get_customer_360" not in turn_tools_called:
        prefetch_payload, prefetch_err = _prefetch_customer_360_on_consent(
            memory,
            turn_tools_called=turn_tools_called,
        )
        if prefetch_payload:
            turn_customer_360_payload = dict(prefetch_payload)
            _stash_customer_360_ticket_roster(memory, prefetch_payload)
            system += (
                "\n\n## Customer 360 tool result (authoritative Postgres — quote only this)\n"
                + json.dumps(
                    _customer_360_prompt_snapshot(prefetch_payload),
                    ensure_ascii=False,
                    default=str,
                )
                + "\nReply with one short intro only; runtime appends the ticket table. "
                "Do not invent ticket rows or claim auth/transport errors.\n"
            )
        elif prefetch_err:
            turn_customer_360_error = dict(prefetch_err)
            system += (
                "\n\n## Customer 360 tool result (failed)\n"
                + json.dumps(
                    {
                        "success": False,
                        "error_code": prefetch_err.get("error_code"),
                        "message": prefetch_err.get("message"),
                    },
                    ensure_ascii=False,
                    default=str,
                )
                + "\nExplain using this structured error only; do not invent ticket history.\n"
            )

    try:
        phrased_confirm = (
            _confirm_fallback_text(memory) if skip_ticket_issue_tool_loop else None
        )
        if skip_ticket_issue_tool_loop and phrased_confirm:
            memory.add_message("user", query)
            memory.add_message("assistant", phrased_confirm)
            text = phrased_confirm
        else:
            text = run_tool_loop(
                llm=llm,
                system_prompt=system,
                memory=memory,
                tools=tools,
                execute_tool=execute,
                budgets=budgets,
                user_message=query,
                armed_write_tools=armed_tools or None,
                should_force_armed_write=(
                    _should_force_armed
                    if (armed_tools and not block_force_for_collect)
                    else None
                ),
                empty_tools_retry_hint=(
                    (
                        "\n\nTOOL REQUIRED: this Skill mutates catalog or ticket data. "
                        "You must call a tool this turn (list, patch, write, or "
                        "return_to_super) via structured tool_calls — never as "
                        "`call:tool{...}` text in the reply. Never claim a row was "
                        "created, updated, renamed, or deleted in prose without a "
                        "successful structured tool result."
                        + (
                            " For team-members-update, call list_queues and "
                            "list_agents this turn, then patch_team_draft "
                            "(remaining roster when they mean remove)."
                            if "members" in str(harness_skill or "").lower()
                            else (
                                _kb_create_category_turn_hint(
                                    query,
                                    _kb_draft_category_names(
                                        memory.durable.get("kb_draft")
                                        if isinstance(
                                            memory.durable.get("kb_draft"), dict
                                        )
                                        else {}
                                    ),
                                )
                                if "knowledge-article-create"
                                in str(harness_skill or "")
                                and str(
                                    (memory.durable.get("kb_draft") or {}).get(
                                        "awaiting"
                                    )
                                    or ""
                                )
                                .strip()
                                .lower()
                                == "category"
                                else ""
                            )
                        )
                    )
                    if _skill_requires_mutation_tools(harness_skill)
                    else None
                ),
            )
    except Exception as exc:
        from app.contracts.errors import LLMEmptyResponse, LLMUnavailable, NativeAIError

        if isinstance(exc, (LLMEmptyResponse, LLMUnavailable, NativeAIError)):
            recovered = _executor_llm_recovery_text(memory, query)
            if recovered:
                text = recovered
            else:
                raise
        else:
            raise
    finally:
        # One-shot same-turn resume→write; never leave it for later turns.
        memory.durable.pop("force_armed_write", None)
        wrote_ticket = (
            "portal_create_ticket" in turn_successful_writes
            or "create_ticket" in turn_successful_writes
        )
        if wrote_ticket:
            memory.durable.pop("_portal_create_after_self_service", None)
        _clear_guided_turn_start_flag(memory)

    side_query = str(memory.durable.pop("_return_to_super_query", "") or "").strip()
    if side_query:
        return _run_harness_supervisor(
            llm=llm,
            memory=memory,
            query=side_query,
            context=context,
            actor=actor,
            budgets=budgets,
        )

    # If the last tool was route_to_agent, convert to handoff
    last = (memory.durable.get("last_tool_outcome") or {})
    if last.get("tool") == "route_to_agent" and last.get("success"):
        args = last.get("arguments") or {}
        # Leaving this specialist for another create/task — park local drafts so
        # create-priority is not pinned under create-ticket memory.
        from app.runtime.supervisor import resolve_route_target

        target = resolve_route_target(args if isinstance(args, dict) else {})
        if target and target != agent_name:
            # Customers handoff already parked ticket + seeded customer_draft.
            if target == "customers" and memory.durable.get("customer_draft"):
                keep = "create_customer"
            else:
                keep = ""
            _park_other_active_drafts(memory, keep_workflow=keep)
            if keep != "create_customer":
                memory.durable.pop("current_workflow", None)
                memory.durable.pop("pending_ask", None)
        return {
            "response_type": "routing_response",
            "route_args": args,
            "query": str(args.get("query") or query),
            "assistant_text": None,
            "agent": agent_name,
        }

    _stamp_awaiting_confirm_after_unwritten_update(
        memory,
        harness_skill,
        turn_successful_writes,
    )
    _sanitize_active_kb_collect(memory)
    _auto_advance_customer_draft_to_confirm(memory)
    data = _draft_data_from_memory(memory)
    ui_actions = _ensure_guided_ui_actions(memory, turn_ui_actions)
    from app.tasks.phrase import strip_llm_thought_preamble

    text = strip_llm_thought_preamble((text or "").strip())
    if not text:
        text = _executor_llm_recovery_text(memory, query) or text
    grounded_unverified = _ground_unverified_mutation_reply(
        text,
        skill_name=harness_skill,
        tools_called=turn_tools_called,
        memory=memory,
    )
    if grounded_unverified:
        text = grounded_unverified
    text = _ground_write_outcome_reply(
        memory,
        text,
        ui_actions,
        turn_writes=turn_successful_writes,
        turn_failed_writes=turn_failed_writes,
        write_was_owed=write_was_owed,
        armed_tools=armed_tools,
    ) or text
    text = _sanitize_team_confirm_reply(memory, text) or text
    catalog_turn = any(
        isinstance(a, dict)
        and str(a.get("type") or "") in ("create_priority", "create_status")
        for a in ui_actions
    )
    last_outcome = memory.durable.get("last_tool_outcome") or {}
    last_tool = str(last_outcome.get("tool") or "") if isinstance(last_outcome, dict) else ""
    created_catalog = bool(
        {"create_priority", "create_status"} & set(turn_successful_writes)
    )
    if catalog_turn or last_tool in ("create_priority", "create_status") or created_catalog:
        text = _catalog_create_reply_text(memory, text) or text
    if created_catalog and _looks_like_idle_greeting(text):
        # Never leave an idle greeting after a successful catalog write.
        args = (
            last_outcome.get("arguments")
            if isinstance(last_outcome, dict)
            and isinstance(last_outcome.get("arguments"), dict)
            else {}
        )
        name = str(
            args.get("displayName") or args.get("display_name") or args.get("name") or ""
        ).strip()
        hours = args.get("resolutionHours") or args.get("resolution_hours")
        if "create_priority" in turn_successful_writes:
            text = (
                f"Created priority {name}" + (f" with {hours}h SLA." if hours else ".")
                if name
                else "Created the priority."
            )
        else:
            text = f"Created status {name}." if name else "Created the status."
    # After catalog phrasing: if SLA hours still missing, never leave ghost success.
    text = _ground_priority_hours_reply(
        memory, text, turn_writes=turn_successful_writes
    ) or text
    if not turn_write_outcome:
        text = _ground_kb_title_reply(memory, text) or text
        text = (
            _ground_guided_collect_reply(
                memory, text, turn_tools_called=turn_tools_called
            )
            or text
        )
    if turn_write_outcome:
        committed_text = _ground_successful_write_reply(
            turn_write_outcome,
            text=text,
            query=query,
            page=str(context.get("page") or "") or None,
        )
        if committed_text:
            _replace_last_assistant_message(memory, text, committed_text)
            text = committed_text
    text = (
        _ground_export_analytics_reply(
            text,
            export_payload=turn_export_analytics,
            query=query,
            page=str(context.get("page") or "") or None,
        )
        or text
    )
    text = (
        _ground_ticket_list_reply(
            text,
            list_payload=turn_ticket_list_payload,
            turn_tools_called=turn_tools_called,
            memory=memory,
            ui_actions=ui_actions,
            harness_skill=harness_skill,
            query=query,
            page=str(context.get("page") or "") or None,
        )
        or text
    )
    text = (
        _ground_customer_list_reply(
            text,
            list_payload=turn_customer_list_payload,
            turn_tools_called=turn_tools_called,
            memory=memory,
            harness_skill=harness_skill,
            query=query,
            page=str(context.get("page") or "") or None,
            ui_actions=ui_actions,
        )
        or text
    )
    text = (
        _ground_team_list_reply(
            text,
            list_payload=turn_team_list_payload,
            turn_tools_called=turn_tools_called,
            harness_skill=harness_skill,
            query=query,
            page=str(context.get("page") or "") or None,
        )
        or text
    )
    text = (
        _ground_customer_360_reply(
            text,
            c360_payload=turn_customer_360_payload,
            c360_error=turn_customer_360_error,
            turn_tools_called=turn_tools_called,
            memory=memory,
            harness_skill=harness_skill,
            query=query,
            page=str(context.get("page") or "") or None,
            ui_actions=ui_actions,
        )
        or text
    )
    ui_actions = _ensure_guided_ui_actions(memory, ui_actions)
    # One-shot: after we reply on the post-add-customer turn, clear so the next
    # consent ("yes") is not still prompted to "ask whether to continue".
    if text and memory.durable.get("offer_continue_ticket_after_customer"):
        memory.durable.pop("offer_continue_ticket_after_customer", None)
    harness_patch = _harness_session_pin_fields(memory)
    return {
        "response_type": "final",
        "assistant_text": text,
        "agent": agent_name,
        "data": data,
        "patch": data.get("patch"),
        "ui_actions": ui_actions,
        "session_memory_patch": {
            "slots": dict(memory.durable.get("slots") or {}),
            "pendingAsk": memory.durable.get("pending_ask"),
            "lastEntity": memory.durable.get("last_entity"),
            "lastToolOutcome": memory.durable.get("last_tool_outcome"),
            "pendingIntent": memory.durable.get("current_workflow"),
            **harness_patch,
        },
    }


def _draft_context_for_tool(
    memory: SharedMemory, tool_name: str
) -> tuple[str | None, str | None, dict[str, Any] | None]:
    """Map write tools → durable draft so confirm-armed gate can pass."""
    mapping = {
        "create_ticket": ("ticket_draft", "create_ticket"),
        "enrich_ticket": ("ticket_draft", "create_ticket"),
        "escalate_ticket": ("escalate_draft", "escalate"),
        "update_ticket": ("reassign_draft", "reassign_ticket"),
        "create_queue": ("team_draft", "create_team"),
        "update_queue": ("team_draft", "create_team"),
        "delete_queue": ("team_draft", "create_team"),
        "create_customer": ("customer_draft", "create_customer"),
        "create_kb_article": ("kb_draft", "create_kb"),
        "draft_kb_article": ("kb_draft", "create_kb"),
        "create_macro": ("macro_draft", "create_macro"),
        "delete_macro": ("macro_draft", "create_macro"),
        "create_priority": ("priority_draft", "create_priority"),
        "delete_priority": ("priority_draft", "create_priority"),
        "create_status": ("status_draft", "create_status"),
        "delete_status": ("status_draft", "create_status"),
    }
    spec = mapping.get(tool_name)
    if not spec:
        return None, None, None
    draft_key, workflow_id = spec
    # Reassign owns escalate_ticket when target_role=resolver (or person set).
    if tool_name == "escalate_ticket":
        ras = memory.durable.get("reassign_draft")
        if isinstance(ras, dict) and (
            str(ras.get("target_role") or "").strip().lower() == "resolver"
            or str(ras.get("person") or ras.get("person_name") or "").strip()
        ):
            draft_key, workflow_id = "reassign_draft", "reassign_ticket"
    if tool_name == "update_ticket":
        ras = memory.durable.get("reassign_draft")
        if not (isinstance(ras, dict) and str(ras.get("awaiting") or "").strip()):
            return None, None, None
    blob = memory.durable.get(draft_key)
    draft = dict(blob) if isinstance(blob, dict) else None
    # Nested CDP miss under create-ticket: contact lives on ticket_draft only.
    if tool_name == "create_customer" and (
        draft is None
        or not (
            str(draft.get("name") or draft.get("customerName") or "").strip()
            and (
                str(draft.get("email") or draft.get("customerEmail") or "").strip()
                or str(draft.get("phone") or draft.get("customerPhone") or "").strip()
            )
        )
    ):
        ticket = memory.durable.get("ticket_draft")
        if isinstance(ticket, dict):
            synth: dict[str, Any] = dict(draft or {})
            if not str(synth.get("name") or "").strip():
                n = str(ticket.get("customerName") or "").strip()
                if n:
                    synth["name"] = n
            if not str(synth.get("email") or "").strip():
                em = str(ticket.get("customerEmail") or "").strip()
                if em:
                    synth["email"] = em
            if not str(synth.get("phone") or "").strip():
                ph = str(ticket.get("customerPhone") or "").strip()
                if ph:
                    synth["phone"] = ph
            if synth.get("name") and (synth.get("email") or synth.get("phone")):
                draft = synth
    if draft_key == "team_draft" and draft:
        from app.workflow_schemas import workflow_id_for_draft

        resolved = workflow_id_for_draft(draft_key, draft)
        if resolved:
            workflow_id = resolved
    return draft_key, workflow_id, draft


def _hydrate_create_ticket_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill create_ticket from enriched draft so the LLM need not re-list every field."""
    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    # Recover customer bind after add-customer when nested payload left park without id.
    if not str(draft.get("customerId") or draft.get("customer_id") or "").strip():
        ent = memory.durable.get("last_entity")
        if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "customer":
            cid = str(ent.get("id") or "").strip()
            if cid:
                draft["customerId"] = cid
            for src, dst in (
                ("name", "customerName"),
                ("email", "customerEmail"),
                ("phone", "customerPhone"),
            ):
                if not str(draft.get(dst) or "").strip() and str(ent.get(src) or "").strip():
                    draft[dst] = str(ent.get(src)).strip()
            draft.pop("customer_not_found", None)
            memory.durable["ticket_draft"] = draft
    out = dict(args)
    field_map = {
        "customerName": ("customerName", "customer_name"),
        "customerEmail": ("customerEmail", "customer_email"),
        "customerPhone": ("customerPhone", "customer_phone"),
        "customerId": ("customerId", "customer_id"),
        "subject": ("subject",),
        "description": ("description", "issue"),
        "priority": ("priority",),
        "queue": ("queue",),
        "category": ("category",),
        "skill": ("skill",),
        "assignee": ("assignee",),
        "assigneeId": ("assigneeId", "assignee_id"),
        "resolver": ("resolver",),
        "resolverId": ("resolverId", "resolver_id"),
        "channel": ("channel",),
        "rationale": ("rationale",),
    }
    for canon, keys in field_map.items():
        if str(out.get(canon) or "").strip():
            continue
        for k in keys:
            if str(out.get(k) or "").strip():
                out[canon] = out[k]
                break
            if str(draft.get(k) or "").strip():
                out[canon] = draft[k]
                break
        if not str(out.get(canon) or "").strip() and str(draft.get(canon) or "").strip():
            out[canon] = draft[canon]
    if not str(out.get("description") or "").strip() and str(draft.get("issue") or "").strip():
        out["description"] = draft["issue"]
    # Gate + create_ticket require issue; keep it aligned with description/subject.
    if not str(out.get("issue") or "").strip():
        for src in (
            out.get("description"),
            draft.get("issue"),
            draft.get("description"),
            out.get("subject"),
            draft.get("subject"),
        ):
            text = str(src or "").strip()
            if text:
                out["issue"] = text
                break
    if str(out.get("issue") or "").strip() and not str(draft.get("issue") or "").strip():
        draft["issue"] = str(out["issue"]).strip()
        memory.durable["ticket_draft"] = draft
    if not str(out.get("channel") or "").strip():
        out["channel"] = str(draft.get("channel") or "Web")
    atts = draft.get("attachments")
    if isinstance(atts, list) and atts and not out.get("attachments"):
        urls = [
            str(item).strip()
            for item in atts
            if str(item).strip().startswith("/uploads/")
            and ".." not in str(item)
            and "\\" not in str(item)
        ]
        if urls:
            out["attachments"] = urls
    verified_order = str(draft.get("orderId") or draft.get("order_id") or "").strip()
    if verified_order and (
        draft.get("orderVerified") is True
        or str(draft.get("orderVerified") or "").strip().lower() in {"true", "1", "yes"}
    ):
        out["orderId"] = verified_order
    verified_product = str(draft.get("productId") or draft.get("product_id") or "").strip()
    if verified_product:
        out["productId"] = verified_product
    # Lean file: only customer + issue text. Post-insert Domain owns subject /
    # priority / queue / assignees — do not POST stale enrich preview fields.
    issue_text = str(
        out.get("description") or out.get("issue") or draft.get("issue") or ""
    ).strip()
    if issue_text:
        out["description"] = issue_text
        out["issue"] = issue_text
        if not str(draft.get("issue") or "").strip():
            draft["issue"] = issue_text
            memory.durable["ticket_draft"] = draft
        out.pop("subject", None)
        out.pop("priority", None)
        out.pop("queue", None)
        out.pop("category", None)
        out.pop("skill", None)
        out.pop("assignee", None)
        out.pop("assigneeId", None)
        out.pop("assignee_id", None)
        out.pop("resolver", None)
        out.pop("resolverId", None)
        out.pop("resolver_id", None)
        out.pop("rationale", None)
    # CRM chat: do not invent consent from draft completeness. The confirm gate
    # + `_allow_guided_write_confirmed` require a prior summary ask or propose.
    # Never auto-set confirmed=true here.
    return out


def _hydrate_create_queue_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill create_queue from team_draft so proceed sends name/description/members."""
    draft = memory.durable.get("team_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    out = dict(args)
    if not str(out.get("name") or out.get("queueName") or "").strip():
        if str(draft.get("name") or "").strip():
            out["name"] = draft["name"]
    if not str(out.get("description") or "").strip():
        if str(draft.get("description") or "").strip():
            out["description"] = draft["description"]
    existing = out.get("members")
    have_members = (
        isinstance(existing, list) and any(str(m).strip() for m in existing)
    ) or bool(str(existing or "").strip())
    if not have_members:
        draft_members = draft.get("members")
        if isinstance(draft_members, list):
            names = [str(m).strip() for m in draft_members if str(m).strip()]
            if names:
                out["members"] = names
    # Do not invent consent from draft completeness.
    return out


def _listed_queue_option_rows(memory: SharedMemory) -> list[dict[str, str]]:
    """Numeric team ids + names from this-turn list_queues TOOL RESULT / stash."""
    from app.tools.catalog_tools import catalog_row_id_usable

    rows: list[dict[str, str]] = []
    seen: set[str] = set()

    def _add(rid: str, name: str) -> None:
        usable = catalog_row_id_usable(rid)
        label = str(name or "").strip()
        if not usable or not label or usable in seen:
            return
        seen.add(usable)
        rows.append({"id": usable, "name": label})

    lq = _last_query_dict(memory)
    for item in lq.get("queue_list_options") or []:
        if isinstance(item, dict):
            _add(
                str(item.get("id") or ""),
                str(item.get("displayName") or item.get("name") or ""),
            )
    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    if str(last.get("tool") or "").strip() == "list_queues" and last.get("success"):
        result = last.get("result") if isinstance(last.get("result"), dict) else last
        for row in _catalog_list_rows(result if isinstance(result, dict) else {}):
            _add(
                str(row.get("id") or row.get("queueId") or ""),
                str(row.get("queueName") or row.get("name") or row.get("displayName") or ""),
            )
    return rows


def _pin_add_members_team_row(
    memory: SharedMemory, draft: dict[str, Any], row: dict[str, Any]
) -> None:
    """Ground draft + last_entity on a list_queues row (Postgres)."""
    from app.tools.catalog_tools import catalog_row_id_usable

    mid = catalog_row_id_usable(row.get("id") or row.get("queueId"))
    mname = str(row.get("queueName") or row.get("name") or row.get("displayName") or "").strip()
    if mid:
        draft["id"] = mid
    if mname:
        draft["name"] = mname
        draft["team"] = mname
    if mid or mname:
        memory.durable["last_entity"] = {
            "type": "team",
            "id": mid or str(row.get("id") or "").strip(),
            "name": mname,
        }


def _grounded_update_queue_id(
    memory: SharedMemory,
    *,
    draft: dict[str, Any],
    entity: dict[str, Any],
) -> str:
    """Team id for this add/update from list_queues / draft name — not a guessed id."""
    from app.tools.catalog_tools import catalog_row_id_usable

    listed = _listed_queue_option_rows(memory)
    labels: list[str] = []
    for cand in (
        draft.get("name"),
        draft.get("team"),
        entity.get("name") if str(entity.get("type") or "").strip().lower() in {"team", "queue"} else "",
        entity.get("queueName"),
    ):
        text = str(cand or "").strip()
        if text and not catalog_row_id_usable(text):
            low = text.lower()
            if low not in {x.lower() for x in labels}:
                labels.append(text)
    for lab in labels:
        want = lab.lower()
        for row in listed:
            if str(row.get("name") or "").strip().lower() == want:
                return str(row.get("id") or "")
    if len(listed) == 1:
        return str(listed[0].get("id") or "")
    listed_ids = {str(row.get("id") or "") for row in listed if row.get("id")}
    for cand in (draft.get("id"), draft.get("queue_id")):
        usable = catalog_row_id_usable(cand)
        if usable and (not listed_ids or usable in listed_ids):
            return usable
    etype = str(entity.get("type") or "").strip().lower()
    eid = catalog_row_id_usable(entity.get("id") if etype in {"team", "queue"} else "")
    ename = str(entity.get("name") or entity.get("queueName") or "").strip()
    dname = str(draft.get("name") or draft.get("team") or "").strip()
    if eid and listed_ids and eid in listed_ids:
        if not dname or not ename or dname.lower() == ename.lower():
            return eid
    if eid and not listed_ids and (not dname or not ename or dname.lower() == ename.lower()):
        return eid
    return ""


def _resolve_update_queue_id(
    memory: SharedMemory,
    *,
    provided: str,
    draft: dict[str, Any],
    entity: dict[str, Any],
) -> str:
    """Numeric list/get id for the task team. Drop LLM ids that are not that row."""
    from app.tools.catalog_tools import catalog_row_id_usable

    grounded = _grounded_update_queue_id(memory, draft=draft, entity=entity)
    listed = _listed_queue_option_rows(memory)
    listed_ids = {str(row.get("id") or "") for row in listed if row.get("id")}
    provided_usable = catalog_row_id_usable(provided)
    # Task team from list_queues / draft name wins over any other numeric id
    # the LLM copied (UI focus, another listed team).
    if grounded:
        return grounded
    if provided_usable and (not listed_ids or provided_usable in listed_ids):
        return provided_usable
    labels: list[str] = []
    for cand in (provided, draft.get("id"), draft.get("queue_id"), draft.get("name"), draft.get("team")):
        text = str(cand or "").strip()
        if text and not catalog_row_id_usable(text):
            labels.append(text)
    for lab in labels:
        want = lab.lower()
        for row in listed:
            if str(row.get("name") or "").strip().lower() == want:
                return str(row.get("id") or "")
    etype = str(entity.get("type") or "").strip().lower()
    ename = str(entity.get("name") or entity.get("queueName") or "").strip()
    eid = catalog_row_id_usable(entity.get("id") if etype in {"team", "queue"} else "")
    if eid and labels and ename and any(ename.lower() == lab.lower() for lab in labels):
        return eid
    for cand in (provided, draft.get("id"), draft.get("queue_id")):
        text = str(cand or "").strip()
        if text:
            return text
    if etype in {"team", "queue"}:
        leftover = str(entity.get("id") or "").strip()
        if leftover:
            return leftover
    return provided.strip()


def _hydrate_update_queue_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill update_queue from team_draft / last_entity so add-members actually writes."""
    from app.tools.catalog_tools import catalog_row_id_usable
    from app.workflow_schemas import workflow_id_for_draft

    draft = memory.durable.get("team_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    entity = memory.durable.get("last_entity")
    entity = dict(entity) if isinstance(entity, dict) else {}
    out = dict(args)
    wid = workflow_id_for_draft("team_draft", draft) or str(
        memory.durable.get("current_workflow") or ""
    ).strip().lower()
    provided = str(out.get("queue_id") or out.get("id") or "").strip()
    qid = _resolve_update_queue_id(
        memory, provided=provided, draft=draft, entity=entity
    )
    if qid:
        out["queue_id"] = qid
        usable = catalog_row_id_usable(qid)
        if usable:
            draft["id"] = usable
            memory.durable["team_draft"] = draft
    existing = out.get("members")
    have_members = (
        isinstance(existing, list) and any(str(m).strip() for m in existing)
    ) or bool(str(existing or "").strip())
    if not have_members:
        draft_members = draft.get("members")
        if isinstance(draft_members, list):
            names = [str(m).strip() for m in draft_members if str(m).strip()]
            if names:
                out["members"] = names
        elif str(draft_members or "").strip():
            out["members"] = [str(draft_members).strip()]
    add_flow = wid in {"add_team_members", "add_members"} or str(
        draft.get("flow") or draft.get("workflow") or ""
    ).strip().lower() in {"add_team_members", "add_members"}
    # Honor an explicit replace/remove (add_members=false). Default add-only
    # only when the Executor omitted the flag.
    explicit_false = out.get("add_members") is False or out.get("addMembers") is False
    pending_names = (
        [str(m).strip() for m in (out.get("members") or []) if str(m).strip()]
        if isinstance(out.get("members"), list)
        else []
    )
    if not pending_names:
        draft_members = draft.get("members")
        if isinstance(draft_members, list):
            pending_names = [str(m).strip() for m in draft_members if str(m).strip()]
        elif str(draft_members or "").strip():
            pending_names = [str(draft_members).strip()]
    if pending_names:
        out["members"] = pending_names
        # Draft names are the people the user named. LLM member_ids often
        # belong to a different listed teammate — drop them so Express
        # resolves identity from the names.
        out.pop("member_ids", None)
        out.pop("memberIds", None)
    else:
        incoming_ids = out.get("member_ids") or out.get("memberIds")
        roster_ids = {
            str(x).strip()
            for x in (draft.get("available_member_ids") or [])
            if str(x).strip()
        }
        if isinstance(incoming_ids, list) and incoming_ids and roster_ids:
            kept = [
                str(x).strip() for x in incoming_ids if str(x).strip() in roster_ids
            ]
            if kept:
                out["member_ids"] = kept
            else:
                out.pop("member_ids", None)
                out.pop("memberIds", None)
    if add_flow:
        draft_false = draft.get("add_members") is False or draft.get("addMembers") is False
        if explicit_false or (draft_false and not (
            out.get("add_members") is True or out.get("addMembers") is True
        )):
            out["add_members"] = False
        elif out.get("add_members") is not False and out.get("addMembers") is not False:
            out["add_members"] = True
    # Do not invent consent from draft completeness.
    return out


def _member_names_from_value(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    text = str(raw or "").strip()
    return [text] if text else []


def _update_queue_roster_applied(
    args: dict[str, Any] | None, result: dict[str, Any] | None
) -> bool:
    """True when update_queue payload members match the requested write.

    Replace (add_members is not True): requested set must equal payload set.
    Append (add_members True): every requested name must be in the payload.
    No requested names → cannot verify, treat as applied.
    """
    blob = args if isinstance(args, dict) else {}
    requested = {
        name.lower()
        for name in _member_names_from_value(blob.get("members"))
    }
    if not requested:
        return True
    payload = _tool_payload_dict(result)
    actual = {
        name.lower()
        for name in _member_names_from_value(payload.get("members"))
    }
    append = blob.get("add_members") is True or blob.get("addMembers") is True
    if append:
        return requested <= actual
    return requested == actual


def _hydrate_create_customer_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill create_customer from customer_draft / ticket draft."""
    draft = memory.durable.get("customer_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    ticket = memory.durable.get("ticket_draft")
    ticket = dict(ticket) if isinstance(ticket, dict) else {}
    out = dict(args)
    if not str(out.get("name") or "").strip():
        n = str(
            draft.get("name")
            or draft.get("customerName")
            or ticket.get("customerName")
            or ""
        ).strip()
        if n:
            out["name"] = n
    if not str(out.get("email") or "").strip():
        em = str(
            draft.get("email")
            or draft.get("customerEmail")
            or ticket.get("customerEmail")
            or ""
        ).strip()
        if em:
            out["email"] = em
    if not str(out.get("phone") or "").strip():
        ph = str(
            draft.get("phone")
            or draft.get("customerPhone")
            or ticket.get("customerPhone")
            or ""
        ).strip()
        if ph:
            out["phone"] = ph
    if not str(out.get("account_name") or out.get("accountName") or "").strip():
        acc = str(draft.get("accountName") or draft.get("account_name") or "").strip()
        if acc:
            out["accountName"] = acc
    # Do not invent consent from write-ready fields — confirm strip / gate owns that.
    return out


def _hydrate_create_macro_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    draft = memory.durable.get("macro_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    out = dict(args)
    if not str(out.get("title") or "").strip():
        t = str(draft.get("title") or draft.get("name") or "").strip()
        if t:
            out["title"] = t
    if not str(out.get("body") or "").strip():
        b = str(
            draft.get("body") or draft.get("content") or draft.get("reply") or ""
        ).strip()
        if b:
            out["body"] = b
    # Do not invent consent from draft completeness.
    return out


def _hydrate_create_kb_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    draft = memory.durable.get("kb_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    # Gate checks draft.body; UI/LLM often store content — keep both in sync.
    content = str(draft.get("content") or "").strip()
    body = str(draft.get("body") or "").strip()
    if content and not body:
        draft["body"] = content
        memory.durable["kb_draft"] = draft
    elif body and not content:
        draft["content"] = body
        memory.durable["kb_draft"] = draft
    out = dict(args)
    if not str(out.get("title") or "").strip() and str(draft.get("title") or "").strip():
        out["title"] = draft["title"]
    body_out = str(out.get("content") or out.get("body") or "").strip()
    if not body_out:
        dbody = str(draft.get("body") or draft.get("content") or "").strip()
        if dbody:
            out["content"] = dbody
            out["body"] = dbody
    else:
        out["content"] = body_out
        out["body"] = body_out
    # Category must come from the draft (user pick) — do not invent General.
    draft_cat = str(draft.get("category") or "").strip()
    if draft_cat:
        out["category"] = draft_cat
    else:
        out.pop("category", None)
    # Do not invent consent from draft completeness.
    return out


def _hydrate_kb_article_id_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill article_id from focus / last write / draft — never invent a KB id."""
    from app.tools.catalog_tools import kb_article_id_usable

    out = dict(args)
    current = kb_article_id_usable(out.get("article_id") or out.get("id"))
    if current:
        out["article_id"] = current
        return out
    candidates: list[Any] = []
    ent = memory.durable.get("last_entity")
    if isinstance(ent, dict) and str(ent.get("type") or "").strip().lower() in {
        "article",
        "kb",
    }:
        candidates.append(ent.get("id"))
    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    last_tool = str(last.get("tool") or "").strip()
    if last_tool in {
        "draft_kb_article",
        "create_kb_article",
        "list_kb",
        "get_kb",
        "update_kb_article",
        "publish_kb_article",
    }:
        payload = last.get("payload") if isinstance(last.get("payload"), dict) else {}
        candidates.append(payload.get("id") or payload.get("article_id"))
        prior = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
        candidates.append(prior.get("article_id") or prior.get("id"))
    kb = memory.durable.get("kb_draft")
    if isinstance(kb, dict):
        candidates.append(kb.get("id") or kb.get("article_id"))
    for cand in candidates:
        usable = kb_article_id_usable(cand)
        if usable:
            out["article_id"] = usable
            break
    return out


def _hydrate_catalog_create_args(
    memory: SharedMemory, args: dict[str, Any], tool_name: str
) -> dict[str, Any]:
    """Fill create_priority/create_status from the live draft.

    Does not invent consent — confirmed stays LLM-owned after a real confirm ask.
    """
    from app.workflow_schemas import normalize_fields

    workflow = "create_priority" if tool_name == "create_priority" else "create_status"
    draft_key = "priority_draft" if workflow == "create_priority" else "status_draft"
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    # TaskState.collected (Domain supplied_fields) is authoritative with the draft.
    state = memory.current_task_state()
    collected = (
        dict(state.collected)
        if state
        and isinstance(state.collected, dict)
        and (
            (tool_name == "create_priority" and state.task_id == "priority.create")
            or (tool_name == "create_status" and state.task_id == "status.create")
        )
        else {}
    )
    if collected:
        draft = {**draft, **normalize_fields(workflow, {**draft, **collected})}
        memory.durable[draft_key] = draft
    out = dict(args)
    if not str(
        out.get("display_name")
        or out.get("displayName")
        or out.get("name")
        or out.get("label")
        or ""
    ).strip():
        for key in ("displayName", "display_name", "name", "label"):
            if str(draft.get(key) or "").strip():
                out["displayName"] = draft[key]
                break
    if tool_name == "create_priority":
        # Hours must be user-collected on the draft/collected — never invent from LLM args alone.
        draft_hours = draft.get("resolutionHours")
        if draft_hours is None:
            draft_hours = draft.get("resolution_hours")
        if draft_hours is None:
            draft_hours = draft.get("hours")
        try:
            hours_ok = float(draft_hours) > 0
        except (TypeError, ValueError):
            hours_ok = False
        if hours_ok:
            out["resolutionHours"] = draft_hours
        else:
            out.pop("resolutionHours", None)
            out.pop("resolution_hours", None)
            out.pop("hours", None)
            out.pop("confirmed", None)
            out.pop("auto", None)
            return out
    # Never auto-arm confirmed here — catalog create must summarize + ask first.
    return out


def _hydrate_delete_catalog_args(
    memory: SharedMemory,
    args: dict[str, Any],
    draft_key: str,
    id_field: str,
) -> dict[str, Any]:
    """Merge delete target id from the live catalog draft."""
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    out = dict(args)
    if not str(out.get(id_field) or out.get("id") or "").strip():
        for key in ("id", id_field, "priority_id", "status_id"):
            if str(draft.get(key) or "").strip():
                out[id_field] = draft[key]
                break
    if "confirmed" not in out and "auto" not in out:
        if str(draft.get("awaiting") or "").lower() == "delete_confirm" and draft.get("id"):
            out["confirmed"] = True
    return out


def _hydrate_update_catalog_args(
    memory: SharedMemory,
    args: dict[str, Any],
    *,
    kind: str,
) -> dict[str, Any]:
    """Replace invented or sortOrder ids with the listed Postgres row id."""
    from app.tools.catalog_tools import catalog_row_id_usable

    id_field = "priority_id" if kind == "priority" else "status_id"
    draft_key = "priority_draft" if kind == "priority" else "status_draft"
    out = dict(args)
    lq = _last_query_dict(memory)
    listed = _catalog_list_option_rows(lq)
    listed_ids = {str(row.get("id") or "") for row in listed}
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    state = memory.current_task_state()
    collected = dict(state.collected) if state else {}
    ent = memory.durable.get("last_entity")
    grounded: list[str] = []
    for cand in (
        collected.get("id"),
        collected.get(id_field),
        draft.get("id"),
        draft.get(id_field),
        _catalog_target_id(collected),
        _catalog_target_id(draft),
    ):
        usable = catalog_row_id_usable(cand)
        if usable and usable not in grounded:
            if not listed_ids or usable in listed_ids:
                grounded.append(usable)
    if isinstance(ent, dict) and str(ent.get("type") or "").strip().lower() == kind:
        usable = catalog_row_id_usable(ent.get("id"))
        if usable and usable not in grounded:
            if not listed_ids or usable in listed_ids:
                grounded.append(usable)

    provided = catalog_row_id_usable(out.get(id_field) or out.get("id"))
    if provided and listed_ids and provided in listed_ids:
        out[id_field] = provided
        _fill_hours_from_listed(out, listed, provided, kind=kind)
        return out
    if provided and not listed_ids and provided in grounded:
        out[id_field] = provided
        return out
    out.pop(id_field, None)
    if catalog_row_id_usable(out.get("id")) not in (listed_ids or grounded):
        out.pop("id", None)
    if grounded:
        out[id_field] = grounded[0]
        _fill_hours_from_listed(out, listed, grounded[0], kind=kind)
        return out
    names: list[str] = []
    for key in (
        "currentName",
        "current_name",
        "fromName",
        "from_name",
        "existingName",
        "target_name",
        "name",
        "label",
    ):
        value = str(collected.get(key) or draft.get(key) or "").strip()
        if value:
            names.append(value)
    if isinstance(ent, dict) and str(ent.get("type") or "").strip().lower() == kind:
        value = str(ent.get("name") or ent.get("displayName") or "").strip()
        if value:
            names.append(value)
    exclude = {
        str(out.get("displayName") or out.get("display_name") or "").strip().lower()
    }
    found = _resolve_listed_catalog_id(
        memory,
        lq,
        extra_names=names,
        exclude_names=exclude,
    )
    if found:
        out[id_field] = found
        _fill_hours_from_listed(out, listed, found, kind=kind)
    return out


def _reject_reassign_role_mismatch(
    memory: SharedMemory,
    tool_name: str,
    args: dict[str, Any],
) -> dict[str, Any] | None:
    if tool_name not in {"update_ticket", "escalate_ticket"}:
        return None
    draft = memory.durable.get("reassign_draft")
    if not isinstance(draft, dict) or not draft:
        return None
    from app.contracts import tool_err
    from app.workflow_schemas import reassign_write_role_error

    message = reassign_write_role_error(dict(draft), args)
    if not message:
        return None
    draft = dict(draft) if isinstance(draft, dict) else {}
    return tool_err(
        "VALIDATION_ERROR",
        message,
        payload={
            "code": "ROLE_SLOT_MISMATCH",
            "person": draft.get("person"),
            "target_role": draft.get("target_role"),
            "roster_roles": draft.get("roster_roles"),
        },
        retryable=True,
    )


def _usable_reassign_name(*values: Any) -> str:
    """First real staff name; skip LLM sentinels like the string 'null'."""
    from app.tools.catalog_tools import entity_ref_invented

    for raw in values:
        text = str(raw or "").strip()
        if not text or entity_ref_invented(text):
            continue
        return text
    return ""


def _hydrate_reassign_write_args(
    memory: SharedMemory, args: dict[str, Any], tool_name: str
) -> dict[str, Any]:
    """Fill update_ticket / escalate_ticket from reassign_draft; arm confirmed."""
    from app.workflow_schemas import draft_complete

    from app.workflow_schemas import enforce_reassign_draft_roles
    from app.llm.tool_calls import flatten_tool_arguments

    draft = memory.durable.get("reassign_draft")
    draft = enforce_reassign_draft_roles(dict(draft) if isinstance(draft, dict) else {})
    out = flatten_tool_arguments(args)
    tn = str(
        out.get("ticket_number")
        or out.get("ticketNumber")
        or draft.get("ticket_number")
        or draft.get("ticketNumber")
        or ""
    ).strip()
    if not tn:
        ent = memory.durable.get("last_entity")
        if isinstance(ent, dict) and str(ent.get("type") or "").lower() == "ticket":
            tn = str(
                ent.get("ticket_number")
                or ent.get("ticketNumber")
                or ent.get("id")
                or ""
            ).strip()
    if tn and not str(out.get("ticket_number") or "").strip():
        out["ticket_number"] = tn
    roster_ids = (
        draft.get("roster_ids") if isinstance(draft.get("roster_ids"), dict) else {}
    )

    def _roster_name(raw: Any) -> str:
        text = _usable_reassign_name(raw)
        if not text:
            return ""
        mapped = str(roster_ids.get(text) or roster_ids.get(str(text).strip()) or "").strip()
        return mapped or text

    person = _roster_name(
        _usable_reassign_name(
            out.get("person"),
            out.get("person_name"),
            draft.get("person"),
            draft.get("person_name"),
            out.get("resolver")
            if str(draft.get("target_role") or "").strip().lower() == "resolver"
            else None,
            out.get("assignee")
            if str(draft.get("target_role") or "").strip().lower() != "resolver"
            else None,
        )
    )
    person_id = _usable_reassign_name(
        out.get("assignee_id"),
        out.get("assigneeId"),
        draft.get("person_id"),
        draft.get("personId"),
    )
    role = str(draft.get("target_role") or out.get("target_role") or "").strip().lower()
    if tool_name == "request_ticket_reassignment":
        if person:
            out["person"] = person
            out["resolver"] = person
        why = str(
            out.get("reason") or draft.get("reason") or draft.get("note") or ""
        ).strip()
        if why:
            out["reason"] = why
        if "confirmed" not in out:
            out["confirmed"] = True
        return out
    if tool_name == "escalate_ticket":
        if person and not _usable_reassign_name(out.get("assignee")):
            out["assignee"] = person
        if person_id and not _usable_reassign_name(
            out.get("assignee_id") or out.get("assigneeId")
        ):
            out["assignee_id"] = person_id
        note = str(
            out.get("rationale") or out.get("note") or draft.get("note") or ""
        ).strip()
        if note and not str(out.get("rationale") or "").strip():
            out["rationale"] = note
    elif role == "resolver":
        for key in ("assignee", "assignee_id", "assigneeId"):
            out.pop(key, None)
        if person:
            out["resolver"] = person
    else:
        for key in ("resolver", "resolver_id", "resolverId"):
            out.pop(key, None)
        if person:
            out["assignee"] = person
    if "confirmed" not in out and "auto" not in out:
        if draft and draft_complete("reassign_ticket", draft):
            out["confirmed"] = True
        elif (
            tool_name == "update_ticket"
            and str(out.get("status") or "").strip()
            and str(out.get("ticket_number") or "").strip()
            and not str(draft.get("awaiting") or "").strip()
        ):
            out["confirmed"] = True
    return out


def _clear_draft_after_delete(
    tool_name: str,
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]],
    *,
    result: dict[str, Any] | None = None,
) -> None:
    """After successful delete_*: clear draft and tell UI the row is gone."""
    draft_key = "status_draft" if tool_name == "delete_status" else "priority_draft"
    kind = "status" if tool_name == "delete_status" else "priority"
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    target_id = str(draft.get("id") or "").strip()
    target_name = str(
        draft.get("displayName") or draft.get("name") or draft.get("label") or ""
    ).strip()
    payload = result.get("payload") if isinstance(result, dict) else None
    payload = payload if isinstance(payload, dict) else {}
    deleted_rows = payload.get("deleted")
    deleted_rows = deleted_rows if isinstance(deleted_rows, list) else []
    memory.durable.pop(draft_key, None)
    memory.durable.pop("current_workflow", None)
    memory.durable.pop("pending_ask", None)
    memory.durable["slots"] = {}
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and str(a.get("type") or "") in (tool_name, f"create_{kind}")
        )
    ]
    rows = deleted_rows or [
        {"id": target_id or payload.get("id"), kind: target_name or payload.get(kind)}
    ]
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_id = str(row.get("id") or "").strip() or None
        row_name = str(
            row.get(kind) or row.get("displayName") or row.get("name") or ""
        ).strip() or None
        ui_actions.append(
            {
                "type": tool_name,
                "done": True,
                "refresh": True,
                "kind": kind,
                "id": row_id,
                "displayName": row_name,
                "name": row_name,
            }
        )
    ui_actions.append({"type": "refresh_priorities"})


def _looks_like_idle_greeting(text: str | None) -> bool:
    """True when model/phrase text is an idle coworker greeting, not a write outcome."""
    raw = str(text or "").strip().lower()
    if not raw:
        return False
    if "how can i help" in raw:
        return True
    if "co-worker" in raw and ("assist" in raw or "help you today" in raw):
        return True
    if raw.startswith("hello!") and "worktual" in raw:
        return True
    return False


def _catalog_create_reply_text(memory: SharedMemory, current: str) -> str | None:
    """Phrase catalog/create outcomes from tool results — never chat fiction."""
    last = memory.durable.get("last_tool_outcome") or {}
    if not isinstance(last, dict):
        return None
    tool = str(last.get("tool") or "").strip().lower()
    if tool not in ("create_priority", "create_status", "create_queue"):
        return None
    if not last.get("success"):
        err = str(last.get("error") or last.get("message") or "").strip()
        code = str(last.get("error_code") or "").strip().upper()
        if tool == "create_queue":
            name = ""
            draft = memory.durable.get("team_draft")
            if isinstance(draft, dict):
                name = str(draft.get("conflict_name") or draft.get("name") or "").strip()
            args = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
            if not name:
                name = str(args.get("name") or "").strip()
            if code == "CONFLICT" or "already exists" in err.lower():
                label = name or "that name"
                memory.durable.pop("last_tool_outcome", None)
                if isinstance(draft, dict):
                    draft = dict(draft)
                    draft["awaiting"] = "name"
                    memory.durable["team_draft"] = draft
                return (
                    f'A team named "{label}" already exists. Choose a different name.'
                    if name
                    else err
                )
            try:
                from app.tasks.phrase import phrase_reply

                reply = phrase_reply(
                    module="team",
                    kind="validation",
                    fallback=err or "I could not create that team. Please try again.",
                    context={"tool": tool, "error": err, "errorCode": last.get("error_code")},
                )
                text = str(reply or "").strip()
                if text and not _looks_like_idle_greeting(text):
                    memory.durable.pop("last_tool_outcome", None)
                    return text
                if err:
                    memory.durable.pop("last_tool_outcome", None)
                return err or current
            except Exception:  # noqa: BLE001
                if err:
                    memory.durable.pop("last_tool_outcome", None)
                return err or current
        if err and not current:
            memory.durable.pop("last_tool_outcome", None)
            return err
        try:
            from app.tasks.phrase import phrase_reply

            reply = phrase_reply(
                module="priority",
                kind="validation",
                fallback=err or "I could not save that catalog entry. Please try again.",
                context={"tool": tool, "error": err, "errorCode": last.get("error_code")},
            )
            text = str(reply or "").strip()
            if text and not _looks_like_idle_greeting(text):
                memory.durable.pop("last_tool_outcome", None)
                return text
            if err:
                memory.durable.pop("last_tool_outcome", None)
            return err or current
        except Exception:  # noqa: BLE001
            if err:
                memory.durable.pop("last_tool_outcome", None)
            return err or current

    if tool == "create_queue":
        if _looks_like_idle_greeting(current):
            return None
        return current or None

    summary = (memory.durable.get("tool_memory") or {}).get("last") or {}
    payload_hint = str(summary.get("summary") or "")
    entity = memory.durable.get("last_entity")
    entity = dict(entity) if isinstance(entity, dict) else {}
    args = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
    payload = last.get("payload") if isinstance(last.get("payload"), dict) else {}
    name = str(
        entity.get("name")
        or payload.get("displayName")
        or args.get("displayName")
        or args.get("display_name")
        or args.get("name")
        or args.get("label")
        or ""
    ).strip()
    hours = (
        args.get("resolutionHours")
        or args.get("resolution_hours")
        or args.get("hours")
        or payload.get("resolutionHours")
    )
    grounded = (
        f"Created priority {name}" + (f" with {hours}h SLA." if hours else ".")
        if tool == "create_priority" and name
        else f"Created status {name}."
        if tool == "create_status" and name
        else f"Created {name or 'the entry'}."
    )
    try:
        from app.tasks.phrase import phrase_reply

        kind = "priority_created" if tool == "create_priority" else "status_created"
        reply = phrase_reply(
            module="admin",
            kind=kind,
            fallback=grounded,
            context={
                "displayName": name,
                "resolutionHours": hours,
                "toolSummary": payload_hint,
                "created": True,
                "success": True,
            },
        )
        text = str(reply or "").strip()
        if text and not _looks_like_idle_greeting(text):
            memory.durable.pop("last_tool_outcome", None)
            return text
        memory.durable.pop("last_tool_outcome", None)
        return grounded
    except Exception:  # noqa: BLE001
        memory.durable.pop("last_tool_outcome", None)
        return grounded


def _successful_write_tools_this_turn(
    _memory: SharedMemory,
    ui_actions: list[dict[str, Any]] | None,
    *,
    turn_writes: list[str] | None = None,
) -> frozenset[str]:
    """Tools that actually committed a write on this specialist turn only."""
    found: set[str] = {str(n).strip() for n in (turn_writes or []) if str(n).strip()}
    ui_type_to_tool = {
        "create_ticket": "create_ticket",
        "create_customer": "create_customer",
        "create_team": "create_queue",
        "create_queue": "create_queue",
        "update_team": "update_queue",
        "update_queue": "update_queue",
        "create_macro": "create_macro",
        "create_kb": "create_kb_article",
        "create_kb_article": "create_kb_article",
        "draft_kb_article": "draft_kb_article",
        "create_priority": "create_priority",
        "create_status": "create_status",
    }
    for act in ui_actions or []:
        if not isinstance(act, dict) or not act.get("done"):
            continue
        kind = str(act.get("type") or "").strip()
        tool = ui_type_to_tool.get(kind)
        if kind == "create_kb" and str(act.get("status") or "").strip().lower() == "draft":
            tool = "draft_kb_article"
        if tool:
            found.add(tool)
    if "portal_create_ticket" in found:
        found.add("create_ticket")
    return frozenset(found)


def _claim_tools_for_write_name(tool_name: str | None) -> frozenset[str]:
    name = str(tool_name or "").strip().lower()
    if name in {"create_ticket", "portal_create_ticket"}:
        return frozenset({"create_ticket", "portal_create_ticket"})
    if name == "create_customer":
        return frozenset({"create_customer"})
    if name == "create_queue":
        return frozenset({"create_queue"})
    if name == "update_queue":
        return frozenset({"update_queue"})
    if name in {"create_kb_article", "draft_kb_article"}:
        return frozenset({name})
    if name == "create_macro":
        return frozenset({"create_macro"})
    if name:
        return frozenset({name})
    return frozenset()


def _phrase_write_not_committed(
    memory: SharedMemory,
    *,
    write_tools: frozenset[str],
) -> str | None:
    """LLM phrase when a write was owed/attempted but did not commit — no regex."""
    from app.tasks.phrase import phrase_reply

    last = memory.durable.get("last_tool_outcome")
    last = dict(last) if isinstance(last, dict) else {}
    last_tool = str(last.get("tool") or "").strip()
    last_failed = bool(last_tool) and last.get("success") is False
    err = str(last.get("message") or last.get("error_code") or "").strip()
    miss_label = ""

    if write_tools & {"create_ticket", "portal_create_ticket"}:
        draft = memory.durable.get("ticket_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        parked = memory.durable.get("parked_drafts")
        pending = memory.durable.get("pending_resume")
        if draft:
            miss = missing_fields("create_ticket", draft)
            if miss:
                miss_label = str(miss[0])
        if miss_label:
            hint = (
                "Do not claim the ticket was filed. Draft is incomplete — "
                f"ask only for missing field: {miss_label}."
            )
            kind = "validation"
        elif isinstance(pending, dict) or (isinstance(parked, list) and parked):
            hint = (
                "Do not claim the ticket was filed — it was not saved yet. "
                "Say filing did not complete and ask whether to resume or save now."
            )
            kind = "validation"
        elif draft and str(draft.get("awaiting") or "").lower() == "confirm":
            hint = (
                "Do not claim the ticket was filed — create_ticket did not succeed. "
                "Summarize the draft and ask whether to save it now."
            )
            kind = "confirm_hint"
        elif last_failed and last_tool in {"create_ticket", "portal_create_ticket"}:
            hint = (
                "Do not claim the ticket was filed. Explain the save failed"
                + (f" ({err})" if err else "")
                + " and ask what to change or whether to retry."
            )
            kind = "validation"
        else:
            hint = (
                "Do not claim the ticket was filed — no successful create_ticket "
                "this turn. Say it is not filed yet and offer to try again."
            )
            kind = "validation"
        try:
            reply = phrase_reply(
                module="tickets",
                kind=kind,
                fallback=hint,
                context={
                    "awaiting": draft.get("awaiting") or (miss_label or "confirm"),
                    "customerName": draft.get("customerName"),
                    "subject": draft.get("subject") or draft.get("issue"),
                    "missing": miss_label or None,
                    "filed": False,
                    "success": False,
                    "toolError": err or None,
                    "pending_resume": bool(pending),
                },
                ticket_draft=draft or None,
            )
            out = str(reply or "").strip()
            return out or hint
        except Exception:  # noqa: BLE001
            return hint

    if write_tools & {"create_customer"}:
        draft = memory.durable.get("customer_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        miss = missing_fields("create_customer", draft) if draft else ["name"]
        hint = (
            "Do not claim the customer was added — create_customer did not succeed. "
            + (
                f"Ask only for the next missing field: {miss[0]}."
                if miss
                else "Ask whether to save them now."
            )
        )
        try:
            reply = phrase_reply(
                module="customers",
                kind="validation" if miss else "confirm_hint",
                fallback=hint,
                context={
                    "awaiting": draft.get("awaiting") or (miss[0] if miss else "confirm"),
                    "name": draft.get("name"),
                    "email": draft.get("email"),
                    "phone": draft.get("phone"),
                    "missing": miss,
                    "filed": False,
                    "success": False,
                    "toolError": err or None,
                },
            )
            return str(reply or "").strip() or None
        except Exception:  # noqa: BLE001
            return None

    if write_tools & {"create_queue"}:
        draft = memory.durable.get("team_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        name = str(draft.get("name") or "").strip()
        try:
            reply = phrase_reply(
                module="teams",
                kind="confirm_hint",
                fallback=(
                    "Do not claim the team was created — it was not saved. "
                    f"Ask whether to create {name or 'this team'} now."
                ),
                context={"name": name, "awaiting": "confirm", "filed": False},
            )
            return str(reply or "").strip() or None
        except Exception:  # noqa: BLE001
            return None

    if write_tools & {"update_queue"}:
        draft = memory.durable.get("team_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        name = str(draft.get("name") or draft.get("team") or "").strip()
        members = draft.get("members")
        payload = last.get("payload") if isinstance(last.get("payload"), dict) else {}
        current = _member_names_from_value(
            payload.get("members") or payload.get("data")
        )
        hint = (
            "Do not claim the roster changed. The update_queue TOOL RESULT "
            "did not apply"
            + (f" ({err})" if err else "")
            + ". Current members: "
            + (", ".join(current) if current else "(none)")
            + f". Ask whether to retry the same change on {name or 'this team'}."
        )
        try:
            reply = phrase_reply(
                module="teams",
                kind="validation",
                fallback=hint,
                context={
                    "name": name,
                    "members": members or current,
                    "currentMembers": current,
                    "awaiting": "confirm",
                    "filed": False,
                    "success": False,
                    "toolError": err or None,
                    "hint": hint,
                },
            )
            return str(reply or "").strip() or hint
        except Exception:  # noqa: BLE001
            return hint

    if write_tools & {"create_kb_article", "draft_kb_article"}:
        draft = memory.durable.get("kb_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        try:
            reply = phrase_reply(
                module="kb",
                kind="confirm_hint",
                fallback=(
                    "Do not claim the article was saved or published — the requested "
                    "article write did not succeed. Ask whether to try that action now."
                ),
                context={
                    "title": draft.get("title"),
                    "awaiting": draft.get("awaiting") or "confirm",
                    "filed": False,
                },
            )
            return str(reply or "").strip() or None
        except Exception:  # noqa: BLE001
            return None

    if write_tools & {"update_ticket", "escalate_ticket", "auto_assign_ticket"}:
        draft = memory.durable.get("reassign_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        person = str(draft.get("person") or draft.get("person_name") or "").strip()
        hint = (
            "Do not claim the ticket was reassigned. The write TOOL RESULT failed"
            + (f" ({err})" if err else "")
            + ". Quote that error and ask whether to pick another person from the "
            "last resolve_ticket_person TOOL RESULT."
        )
        try:
            reply = phrase_reply(
                module="ticket",
                kind="validation",
                fallback=hint,
                context={
                    "awaiting": draft.get("awaiting") or "person",
                    "person": person,
                    "ticket_number": draft.get("ticket_number"),
                    "filed": False,
                    "success": False,
                    "toolError": err or None,
                    "hint": hint,
                },
            )
            return str(reply or "").strip() or hint
        except Exception:  # noqa: BLE001
            return hint

    if write_tools & {"create_macro"}:
        draft = memory.durable.get("macro_draft")
        draft = dict(draft) if isinstance(draft, dict) else {}
        try:
            reply = phrase_reply(
                module="macro",
                kind="confirm_hint",
                fallback=(
                    "Do not claim the macro was saved — it was not. "
                    "Ask whether to save it now."
                ),
                context={
                    "title": draft.get("title"),
                    "awaiting": draft.get("awaiting") or "confirm",
                    "filed": False,
                },
            )
            return str(reply or "").strip() or None
        except Exception:  # noqa: BLE001
            return None
    return None


def _replace_last_assistant_message(
    memory: SharedMemory,
    prior: str,
    replacement: str,
) -> None:
    """Keep transcript and durable history on the grounded reply, not the draft."""
    old = str(prior or "").strip()
    new = str(replacement or "").strip()
    if not new or old == new:
        return
    for message in reversed(memory.messages):
        if (
            str(message.get("role") or "") == "assistant"
            and str(message.get("content") or "").strip() == old
        ):
            message["content"] = new
            break
    history = list(memory.durable.get("recent_history") or [])
    for item in reversed(history):
        if (
            isinstance(item, dict)
            and str(item.get("role") or "") == "assistant"
            and str(item.get("text") or "").strip() == old
        ):
            item["text"] = new
            memory.durable["recent_history"] = history
            break


# Successful write tool → guided phrase module. Catalog creates keep their own
# grounded rewriter (`_catalog_create_reply_text`) and are absent on purpose.
_WRITE_REPLY_MODULE: dict[str, str] = {
    "create_ticket": "ticket",
    "portal_create_ticket": "ticket",
    "escalate_ticket": "ticket",
    "update_ticket": "ticket",
    "create_customer": "customer",
    "create_queue": "team",
    "update_queue": "team",
    "delete_queue": "team",
    "create_macro": "macro",
    "delete_macro": "macro",
    "create_kb_article": "kb",
    "draft_kb_article": "kb",
    "update_kb_article": "kb",
    "publish_kb_article": "kb",
}

_PATCH_REPLY_MODULE: dict[str, str] = {
    "patch_ticket_draft": "ticket",
    "patch_team_draft": "team",
    "patch_kb_draft": "kb",
    "patch_macro_draft": "macro",
    "patch_customer_draft": "customer",
    "patch_priority_draft": "priority",
    "patch_status_draft": "status",
    "patch_escalate_draft": "ticket",
    "patch_reassign_draft": "ticket",
}

_GUIDED_IDENTITY_KEYS: tuple[str, ...] = (
    "customerName",
    "name",
    "displayName",
    "title",
    "email",
    "customerEmail",
    "phone",
    "customerPhone",
    "issue",
    "description",
    "body",
    "category",
    "ticket_number",
    "ticketNumber",
)


_AWAITING_ASK_LABEL = {
    "name": "new name",
    "displayname": "new name",
    "display_name": "new name",
    "label": "new name",
    "title": "new title",
    "description": "description",
    "contact": "email or phone",
    "email": "email",
    "phone": "phone",
    "hours": "resolution hours",
    "resolutionhours": "resolution hours",
    "category": "category",
    "body": "article text",
    "publication_intent": "whether to save it for staff only or publish it live",
    "issue": "issue",
    "members": "members",
    "ticket_number": "ticket number",
    "assignee": "assignee",
    "target_role": "role",
    "person": "person",
}


def _awaiting_ask_label(awaiting: str) -> str:
    key = str(awaiting or "").strip().lower()
    return _AWAITING_ASK_LABEL.get(key, key or "next field")


def _guided_collect_ask_fallback(awaiting: str, draft: dict[str, Any]) -> str:
    if str(awaiting or "").strip().lower() == "publication_intent":
        return (
            "I have the title, category, and article text. "
            "Should I save this for staff only, or publish it live?"
        )
    label = _awaiting_ask_label(awaiting)
    name = str(
        draft.get("name")
        or draft.get("displayName")
        or draft.get("title")
        or draft.get("customerName")
        or draft.get("subject")
        or ""
    ).strip()
    if name and str(awaiting or "").strip().lower() in {
        "name",
        "displayname",
        "display_name",
        "label",
        "title",
    }:
        return f"What should the {label} be?"
    if name:
        return f"What is the {label}?"
    return f"What is the {label}?"


def _patch_followup_message(
    awaiting: str, draft: dict[str, Any]
) -> str:
    label = _awaiting_ask_label(awaiting)
    extra = ""
    if str(awaiting or "").strip().lower() == "category":
        cats = _kb_draft_category_names(draft)
        if cats:
            extra = (
                " list_kb_categories TOOL RESULT (Postgres), one name per line "
                "in the user-visible reply — not a comma list, no invented Other:\n"
                + "\n".join(cats)
                + "\nThen ask them to pick a line or type a new short name."
            )
        else:
            extra = (
                " list_kb_categories returned no names. Say none are on file yet. "
                "Do not invent Other or General. Ask them to type a new short name."
            )
    if str(awaiting or "").strip().lower() == "publication_intent":
        return (
            "No ticket or catalog row was written this turn. "
            "Reply as a colleague in everyday words: recap title, category, and "
            "what the article covers, then ask whether to keep it for the team "
            "only or publish so customers can read it — a brief why for each. Never say "
            "publication_intent, awaiting, or tool names. Do not claim the "
            "article was saved, all set, or waiting on a go-ahead."
        )
    intent = str((draft or {}).get("publication_intent") or "").strip().lower()
    if str(awaiting or "").strip().lower() == "confirm" and intent in {
        "draft",
        "publish",
    }:
        write = "draft_kb_article" if intent == "draft" else "create_kb_article"
        return (
            "This patch did not persist a knowledge-base row. Title, category, "
            "body, and publication_intent are on the draft. Call "
            f"{write} with confirmed=true now. Reply only from that write "
            "TOOL RESULT (title + staff-only vs live). Do not claim the "
            "article was drafted or published until that write succeeds."
        )
    kind = str((draft or {}).get("kind") or "").strip().lower()
    if str(awaiting or "").strip().lower() == "confirm" and kind == "priority":
        name = str(
            (draft or {}).get("displayName") or (draft or {}).get("name") or ""
        ).strip()
        hours = (draft or {}).get("resolutionHours")
        hours_bit = f"{hours} hour SLA" if hours not in (None, "") else "the hours on this draft"
        label_bit = name or "this draft's label"
        return (
            "No catalog row was written this turn. Recap only this priority: "
            f"{label_bit} and {hours_bit}. Ask whether to create this priority. "
            "Do not recap a team, queue, members, description, or last_entity "
            "from another Skill. Do not claim the priority was saved."
        )
    return (
        f"No ticket or catalog row was written this turn. "
        f"Reply as a colleague: acknowledge what they just gave, a brief why "
        f"you need the {label} next, then one natural ask.{extra} "
        "Never stamp 'is set' / 'category set to' / form labels. "
        "Do not mention draft, ticket_draft, saved, or that nothing was saved. "
        "Do not claim the item was filed. Do not mention the right-hand list."
    )


def _phrase_guided_collect_ask(
    *,
    module: str,
    awaiting: str,
    draft: dict[str, Any],
    hint: str,
    fallback: str,
) -> str:
    from app.runtime.tool_loop import looks_like_unverified_write_claim

    try:
        from app.tasks.phrase import phrase_reply

        ask_kind = "ask"
        cats = _kb_draft_category_names(draft)
        if (
            module == "kb"
            and str(awaiting or "").strip().lower() == "category"
            and str(draft.get("title") or "").strip()
        ):
            ask_kind = "got_title"
        ctx: dict[str, Any] = {
            "awaiting": awaiting,
            "nextStep": _awaiting_ask_label(awaiting),
            "hint": hint,
            "draft": {
                key: draft.get(key)
                for key in _GUIDED_IDENTITY_KEYS
                if draft.get(key) not in (None, "")
            },
        }
        if str(awaiting or "").strip().lower() == "category":
            ctx["available_categories"] = cats
            if cats:
                ctx["categoryChoices"] = "\n".join(cats)
        reply = phrase_reply(
            module=module,
            kind=ask_kind,
            fallback=fallback,
            context=ctx,
        )
        out = str(reply or "").strip()
        if out and not looks_like_unverified_write_claim(out):
            return out
    except Exception:  # noqa: BLE001
        pass
    return fallback


def _guided_draft_identity_values(draft: dict[str, Any] | None) -> list[str]:
    blob = draft if isinstance(draft, dict) else {}
    values: list[str] = []
    for key in _GUIDED_IDENTITY_KEYS:
        raw = str(blob.get(key) or "").strip()
        if len(raw) >= 2 and raw.lower() not in {item.lower() for item in values}:
            values.append(raw)
    return values


def _ground_guided_collect_reply(
    memory: SharedMemory,
    text: str | None,
    *,
    turn_tools_called: list[str] | None = None,
) -> str | None:
    """Re-phrase collect replies that ignore patch TOOL RESULT identities.

    Does not classify the user utterance or scan replies for field-name
    keywords. Same rule as write grounding: quote values from this turn's
    tool/draft payload, or ask the LLM to phrase from that payload.
    """
    last = memory.durable.get("last_tool_outcome")
    last = last if isinstance(last, dict) else {}
    tool = str(last.get("tool") or "").strip()
    called = {
        str(name or "").strip() for name in (turn_tools_called or []) if str(name or "").strip()
    }
    from app.runtime.tool_loop import looks_like_unverified_write_claim

    committed = any(
        name.startswith(("create_", "update_", "delete_", "draft_", "publish_"))
        for name in called
    )
    if looks_like_unverified_write_claim(text) and not committed:
        live = None
        for draft_key in (
            "team_draft",
            "priority_draft",
            "status_draft",
            "macro_draft",
            "kb_draft",
            "customer_draft",
            "ticket_draft",
        ):
            blob = memory.durable.get(draft_key)
            if not isinstance(blob, dict):
                continue
            ask = str(blob.get("awaiting") or "").strip().lower()
            if ask and ask not in {"confirm", "delete_confirm", "done"}:
                live = (draft_key, blob, ask)
                break
        if live:
            _draft_key, draft, ask = live
            module = {
                "team_draft": "team",
                "priority_draft": "priority",
                "status_draft": "priority",
                "macro_draft": "macro",
                "kb_draft": "kb",
                "customer_draft": "customers",
                "ticket_draft": "tickets",
            }.get(_draft_key, "admin")
            fallback = _guided_collect_ask_fallback(ask, draft)
            return _phrase_guided_collect_ask(
                module=module,
                awaiting=ask,
                draft=draft,
                hint=(
                    "No create/update/delete tool succeeded this turn. "
                    "Do not claim the row was saved or that the list updated. "
                    f"Ask for the {_awaiting_ask_label(ask)} in a polite "
                    "paragraph. Never mention draft or that nothing was saved."
                ),
                fallback=fallback,
            )
    if turn_tools_called is not None:
        if tool not in called:
            return text
    module = _PATCH_REPLY_MODULE.get(tool)
    if not module:
        return text
    spec = _DRAFT_TOOL_SPEC.get(tool)
    if not spec:
        return text
    draft_key, _workflow_id, _nav = spec
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    payload = last.get("payload") if isinstance(last.get("payload"), dict) else {}
    awaiting = str(
        payload.get("awaiting") or draft.get("awaiting") or ""
    ).strip().lower()
    if awaiting in {"confirm", "delete_confirm", "done"}:
        return text
    raw = str(text or "").strip()
    identities = _guided_draft_identity_values(draft)
    reply_l = raw.lower()
    mentions_value = any(value.lower() in reply_l for value in identities)
    first_open = str(first_open_guided_slot(_workflow_id, draft) or "").strip().lower()
    correction_slot = bool(
        awaiting
        and awaiting not in {"confirm", "delete_confirm", "done"}
        and awaiting != first_open
    )
    cats = _kb_draft_category_names(draft) if awaiting == "category" else []
    listed_categories = bool(
        cats and any(str(name).strip().lower() in reply_l for name in cats)
    )
    if (
        last.get("success")
        and raw
        and mentions_value
        and not correction_slot
        and (awaiting != "category" or listed_categories or not cats)
    ):
        return text
    if last.get("success") and not identities and not correction_slot:
        return text
    next_step = str(payload.get("awaiting") or draft.get("awaiting") or "").strip() or (
        "next field"
    )
    fallback = _guided_collect_ask_fallback(next_step, draft)
    hint = (
        "Reply from the patch TOOL RESULT only. Quote kept draft values and ask "
        f"only for the {_awaiting_ask_label(next_step)}. Do not restart collect "
        "or claim a write."
    )
    if last.get("success") is False:
        err = str(last.get("message") or last.get("error") or "").strip()
        hint = (
            f"The patch failed ({err or 'invalid field'}). Ask only for the "
            f"{_awaiting_ask_label(next_step)} using the current draft values. "
            "Do not invent a new create."
        )
        fallback = (
            f"That field change did not apply. What is the "
            f"{_awaiting_ask_label(next_step)}?"
        )
    return _phrase_guided_collect_ask(
        module=module,
        awaiting=next_step,
        draft=draft,
        hint=hint,
        fallback=fallback,
    )


def _write_result_identity_values(payload: dict[str, Any]) -> list[str]:
    """Identifying values the reply must quote for a committed write."""
    values: list[str] = []
    for key in ("title", "name", "queueName", "ticketNumber", "ticket_number", "id"):
        raw = str(payload.get(key) or "").strip()
        if len(raw) >= 2:
            values.append(raw)
            if raw.startswith("#"):
                values.append(raw.lstrip("#"))
    return values


def _ground_successful_write_reply(
    outcome: dict[str, Any] | None,
    *,
    text: str = "",
    query: str,
    page: str | None,
) -> str:
    """Re-phrase from a committed write's TOOL RESULT when the reply ignored it.

    A finished write is fully described by its payload. If the assistant text
    quotes none of those persisted values it is not grounded in the write, so
    report the outcome instead of resuming the collect that just completed.
    Replies that already quote the saved row are left untouched.
    """
    if not isinstance(outcome, dict):
        return ""
    tool = str(outcome.get("tool") or "").strip()
    module = _WRITE_REPLY_MODULE.get(tool)
    if not module:
        return ""
    payload = outcome.get("payload")
    payload = dict(payload) if isinstance(payload, dict) else {}
    args = (
        outcome.get("arguments")
        if isinstance(outcome.get("arguments"), dict)
        else {}
    )
    if (
        tool == "update_queue"
        and args
        and not _update_queue_roster_applied(args, {"payload": payload})
    ):
        listed = _member_names_from_value(payload.get("members"))
        from app.tasks.phrase import phrase_reply

        hint = (
            "Do not claim the roster changed. Current members: "
            + (", ".join(listed) if listed else "(none)")
            + ". Ask whether to retry the same change."
        )
        try:
            return str(
                phrase_reply(
                    module="team",
                    kind="validation",
                    fallback=hint,
                    user_text=query,
                    page_label=page,
                    context={
                        "filed": False,
                        "success": False,
                        "members": listed,
                        "queueName": payload.get("queueName"),
                    },
                )
                or hint
            ).strip()
        except Exception:  # noqa: BLE001
            return hint
    identities = _write_result_identity_values(payload)
    if not identities:
        return ""
    reply = str(text or "").strip().lower()
    if reply and any(value.lower() in reply for value in identities):
        return ""
    facts = {
        key: payload.get(key)
        for key in (
            "id",
            "ticketNumber",
            "title",
            "name",
            "queueName",
            "category",
            "status",
            "author",
            "assignee",
            "resolver",
        )
        if payload.get(key) not in (None, "")
    }
    from app.tasks.phrase import phrase_reply

    ctx = {
        "filed": True,
        "success": True,
        "result": facts,
        **facts,
    }

    def _phrase_created(fallback: str) -> str:
        try:
            return str(
                phrase_reply(
                    module=module,
                    kind="created",
                    fallback=fallback,
                    user_text=query,
                    page_label=page,
                    context=ctx,
                )
                or ""
            ).strip()
        except Exception:  # noqa: BLE001
            return ""

    out = _phrase_created(
        "The write already committed. Confirm exactly what Context.result "
        "reports, including its status, and do not ask for any field of the "
        "finished flow again."
    )
    if out and any(value.lower() in out.lower() for value in identities):
        return out
    return _phrase_created(
        "Repeat the committed write using Context.title or Context.name and "
        "Context.status. Do not ask for a title or start a new collect."
    )


def _ground_write_outcome_reply(
    memory: SharedMemory,
    text: str | None,
    ui_actions: list[dict[str, Any]] | None,
    *,
    turn_writes: list[str] | None = None,
    turn_failed_writes: list[str] | None = None,
    write_was_owed: bool = False,
    armed_tools: frozenset[str] | None = None,
) -> str | None:
    """Replace model text when a confirm write was owed/attempted but did not commit.

    Outcome-based only — no regex scanning of assistant prose for 'filed'/'created'.
    """
    raw = str(text or "").strip()
    succeeded = _successful_write_tools_this_turn(
        memory, ui_actions, turn_writes=turn_writes
    )
    armed = frozenset(str(t).strip() for t in (armed_tools or ()) if str(t).strip())
    failed = [str(t).strip() for t in (turn_failed_writes or []) if str(t).strip()]

    owed_tools = armed
    if write_was_owed and owed_tools and not (succeeded & owed_tools):
        try:
            from app.workflow_schemas import preferred_armed_write_tool

            preferred = preferred_armed_write_tool(memory.durable, owed_tools)
        except Exception:  # noqa: BLE001
            preferred = None
        tool = preferred or next(iter(sorted(owed_tools)))
        rewritten = _phrase_write_not_committed(
            memory, write_tools=_claim_tools_for_write_name(tool)
        )
        return rewritten or raw

    if failed:
        # Last failed confirm write this turn — never leave ghost success prose.
        for name in reversed(failed):
            if name in succeeded:
                continue
            rewritten = _phrase_write_not_committed(
                memory, write_tools=_claim_tools_for_write_name(name)
            )
            if rewritten:
                return rewritten

    # Ghost-customer guard: if active workflow is create_customer and the LLM prose
    # claims the customer was added/created but create_customer was never called this
    # turn, rewrite to prevent false confirmation.
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if wf == "create_customer" and "create_customer" not in succeeded:
        import re as _re
        ghost_pat = _re.compile(
            r"\b(i('ve| have)|successfully|just|already|now|customer has been|"
            r"has been)\b.{0,60}\b(add(ed)?|creat(ed)?|register(ed)?|sav(ed)?)\b",
            _re.I,
        )
        if ghost_pat.search(raw):
            rewritten = _phrase_write_not_committed(
                memory, write_tools=frozenset({"create_customer"})
            )
            if rewritten:
                return rewritten

    return raw or None


def _sanitize_team_confirm_reply(memory: SharedMemory, text: str | None) -> str | None:
    """Replace priority hallucinations on team-confirm turns with a team ask."""
    raw = str(text or "").strip()
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    draft = memory.durable.get("team_draft")
    if wf not in {"create_team", "add_team_members"} and not (
        isinstance(draft, dict) and str(draft.get("awaiting") or "").lower() == "confirm"
    ):
        return raw or None
    if not raw:
        return None
    if "priority" not in raw.lower():
        return raw
    name = ""
    if isinstance(draft, dict):
        name = str(draft.get("name") or "").strip()
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="team",
            kind="confirm",
            fallback=(
                f"Should I create team {name} now?"
                if name
                else "Should I create this team now?"
            ),
            context={"name": name, "awaiting": "confirm"},
        )
        out = str(reply or "").strip()
        if out and "priority" not in out.lower():
            return out
        return out or None
    except Exception:  # noqa: BLE001
        return None


def _ground_priority_hours_reply(
    memory: SharedMemory,
    text: str | None,
    *,
    turn_writes: list[str] | None = None,
) -> str | None:
    """When SLA hours are still missing, never leave a ghost 'created with Nh' reply."""
    raw = str(text or "").strip()
    draft = memory.durable.get("priority_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    if not draft:
        return raw or None
    kind = str(draft.get("kind") or "").strip().lower()
    if kind == "status":
        return raw or None
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    # Delete/update of an existing catalog row is not create — never force SLA collect.
    if awaiting == "delete_confirm" or str(draft.get("id") or "").strip():
        return raw or None
    lq = _last_query_dict(memory)
    if lq.get("catalog_op") == "delete_pick":
        return raw or None
    name = str(draft.get("displayName") or draft.get("name") or "").strip()
    from app.workflow_schemas import (
        sanitize_priority_draft_fields,
        usable_priority_label,
    )

    start = str(draft.get("_intent_start_text") or "").strip()
    # Recover when a create-intent / start utterance was wrongly stored as the label.
    if not usable_priority_label(name, start_utterance=start):
        draft = sanitize_priority_draft_fields(draft)
        draft.pop("displayName", None)
        draft.pop("name", None)
        draft["awaiting"] = "name"
        draft["step"] = "name"
        draft["kind"] = "priority"
        if start:
            draft["_intent_start_text"] = start
        memory.durable["priority_draft"] = draft
        memory.durable["current_workflow"] = "create_priority"
        memory.durable["pending_ask"] = "name"
        try:
            from app.tasks.phrase import phrase_reply

            reply = phrase_reply(
                module="priority",
                kind="ask",
                fallback="Ask for the priority display name (short label).",
                context={
                    "nextStep": "priority display name",
                    "awaiting": "name",
                    "missing": ["displayName"],
                    "hint": (
                        "The prior utterance was a create request, not a catalog "
                        "label. Ask only for a short priority name next."
                    ),
                },
            )
            return str(reply or "").strip() or (
                "What short name should this priority use (for example Critical or P1)?"
            )
        except Exception:  # noqa: BLE001
            return (
                "What short name should this priority use (for example Critical or P1)?"
            )
    miss = missing_fields("create_priority", draft)
    if "resolutionHours" not in miss:
        return raw or None
    succeeded = {str(t).strip() for t in (turn_writes or []) if str(t).strip()}
    if "create_priority" in succeeded:
        return raw or None
    draft["awaiting"] = "hours"
    draft["step"] = "hours"
    draft["kind"] = "priority"
    memory.durable["priority_draft"] = draft
    memory.durable["current_workflow"] = "create_priority"
    memory.durable["pending_ask"] = "hours"
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="priority",
            kind="ask",
            fallback=(
                f'Got the name "{name}". What resolution hours (SLA) should it use?'
            ),
            context={
                "displayName": name,
                "nextStep": "resolution hours (SLA)",
                "awaiting": "hours",
                "missing": ["resolutionHours"],
                "hint": (
                    "Do not invent hours and do not claim the priority was created. "
                    "Ask only for resolution hours next."
                ),
            },
        )
        return str(reply or "").strip() or (
            f'Got "{name}". What resolution hours (SLA) should it use?'
        )
    except Exception:  # noqa: BLE001
        return f'Got "{name}". What resolution hours (SLA) should it use?'


def _auto_advance_customer_draft_to_confirm(memory: SharedMemory) -> None:
    """If create_customer is active and draft has all required fields but awaiting != confirm,
    advance it so the next affirm turn fires create_customer instead of generating ghost prose."""
    from app.workflow_schemas import draft_complete, missing_fields

    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if wf != "create_customer":
        return
    draft = memory.durable.get("customer_draft")
    if not isinstance(draft, dict):
        return
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if awaiting in {"confirm", "delete_confirm"}:
        return  # already armed
    miss = missing_fields("create_customer", draft)
    if not miss and draft_complete("create_customer", draft):
        return  # draft_complete already requires awaiting==confirm
    if not miss:
        # All fields present but awaiting not yet set to confirm — advance it now.
        draft = dict(draft)
        draft["awaiting"] = "confirm"
        draft["step"] = "confirm"
        memory.durable["customer_draft"] = draft


def _sanitize_active_kb_collect(memory: SharedMemory) -> None:
    """Keep create-article on title until a real title exists."""
    from app.workflow_schemas import sanitize_kb_draft_fields, usable_kb_title

    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if wf not in {"create_kb", "kb"}:
        return
    draft = memory.durable.get("kb_draft")
    if not isinstance(draft, dict):
        return
    if str(draft.get("flow") or "").strip().lower() == "manage_category":
        return
    cleaned = sanitize_kb_draft_fields(draft)
    start = str(cleaned.get("_intent_start_text") or "").strip()
    if not usable_kb_title(str(cleaned.get("title") or ""), start_utterance=start):
        cleaned["awaiting"] = "title"
        cleaned["step"] = "title"
        memory.durable["pending_ask"] = "title"
    memory.durable["kb_draft"] = cleaned


def _ground_kb_title_reply(memory: SharedMemory, text: str | None) -> str | None:
    """When title is still missing, never skip ahead to category/body."""
    from app.workflow_schemas import usable_kb_title

    raw = str(text or "").strip()
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if wf not in {"create_kb", "kb"}:
        return raw or None
    draft = memory.durable.get("kb_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    if not draft:
        return raw or None
    if str(draft.get("flow") or "").strip().lower() == "manage_category":
        return raw or None
    if usable_kb_title(
        str(draft.get("title") or ""),
        start_utterance=str(draft.get("_intent_start_text") or "").strip(),
    ):
        return raw or None
    draft.pop("title", None)
    draft["awaiting"] = "title"
    draft["step"] = "title"
    memory.durable["kb_draft"] = draft
    memory.durable["current_workflow"] = "create_kb"
    memory.durable["pending_ask"] = "title"
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="kb",
            kind="start",
            fallback="Ask for the article title next. Do not invent a title.",
            context={
                "nextStep": "article title",
                "awaiting": "title",
                "missing": ["title"],
                "hint": (
                    "create article is only the start command. Ask one field: "
                    "the article title. Do not list categories yet."
                ),
            },
        )
        return str(reply or "").strip() or raw
    except Exception:  # noqa: BLE001
        return raw or None


def _tool_payload_dict(result: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(result, dict):
        return {}
    pl = result.get("payload")
    if isinstance(pl, dict):
        data = pl.get("data") if isinstance(pl.get("data"), dict) else pl
        return data if isinstance(data, dict) else pl
    return {}


def _clear_draft_after_write(
    tool_name: str,
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]],
    *,
    result: dict[str, Any] | None = None,
) -> None:
    """After a successful create write: clear guided draft, emit done + open entity."""
    if tool_name == "publish_kb_article":
        payload = _tool_payload_dict(result)
        focused = memory.durable.get("last_entity")
        focused = dict(focused) if isinstance(focused, dict) else {}
        entity_id = str(payload.get("id") or focused.get("id") or "").strip()
        title = str(
            payload.get("title")
            or payload.get("name")
            or focused.get("title")
            or focused.get("name")
            or ""
        ).strip()
        memory.durable["last_entity"] = {
            "type": "article",
            "id": entity_id,
            "name": title or entity_id,
            "title": title or None,
            "status": str(payload.get("status") or "Published"),
        }
        ui_actions.append({"type": "navigate", "view": "kb"})
        ui_actions.append({"type": "refresh_kb"})
        if entity_id or title:
            ui_actions.append(
                {
                    "type": "open_kb",
                    "id": entity_id or None,
                    "title": title or None,
                }
            )
        return

    specs: dict[str, dict[str, Any]] = {
        "create_ticket": {
            "draft_key": "ticket_draft",
            "workflow": "create_ticket",
            "create_type": "create_ticket",
            "refresh": "refresh_tickets",
            "navigate": "assigned",
            "open": "ticket",
        },
        "portal_create_ticket": {
            "draft_key": "ticket_draft",
            "workflow": "create_ticket",
            "create_type": "create_ticket",
            "refresh": None,
            "navigate": None,
            "open": "ticket",
        },
        "create_macro": {
            "draft_key": "macro_draft",
            "workflow": "create_macro",
            "create_type": "create_macro",
            "refresh": "refresh_macros",
            "navigate": "macros",
            "open": "macro",
        },
        "create_queue": {
            "draft_key": "team_draft",
            "workflow": "create_team",
            "create_type": "create_team",
            "refresh": "refresh_teams",
            "navigate": "agent-queues",
            "open": "team",
        },
        "update_queue": {
            "draft_key": "team_draft",
            "workflow": "add_team_members",
            "create_type": "update_team",
            "refresh": "refresh_teams",
            "navigate": "agent-queues",
            "open": "team",
        },
        "create_kb_article": {
            "draft_key": "kb_draft",
            "workflow": "create_kb",
            "create_type": "create_kb",
            "refresh": "refresh_kb",
            "navigate": "kb",
            "open": "kb",
            "extra_done": {"save": True},
        },
        "draft_kb_article": {
            "draft_key": "kb_draft",
            "workflow": "create_kb",
            "create_type": "create_kb",
            "refresh": "refresh_kb",
            "navigate": "kb",
            "open": "kb",
            "extra_done": {"save": True, "status": "Draft"},
        },
        "create_customer": {
            "draft_key": "customer_draft",
            "workflow": "create_customer",
            "create_type": "create_customer",
            "refresh": "refresh_customers",
            # When a parked ticket is restored, navigate is overridden to create-ticket.
            "navigate": "customers",
            "open": "customer",
        },
        "create_priority": {
            "draft_key": "priority_draft",
            "workflow": "create_priority",
            "create_type": "create_priority",
            "refresh": "refresh_priorities",
            "navigate": "priorities",
            "open": "priority",
        },
        "create_status": {
            "draft_key": "status_draft",
            "workflow": "create_status",
            "create_type": "create_status",
            "refresh": "refresh_priorities",
            "navigate": "priorities",
            "open": "status",
        },
        "update_priority": {
            "draft_key": "priority_draft",
            "workflow": "create_priority",
            "create_type": "update_priority",
            "refresh": "refresh_priorities",
            "navigate": "priorities",
            "open": "priority",
            "drop_live": (
                "create_priority",
                "delete_priority",
                "update_priority",
            ),
        },
        "update_status": {
            "draft_key": "status_draft",
            "workflow": "create_status",
            "create_type": "update_status",
            "refresh": "refresh_priorities",
            "navigate": "priorities",
            "open": "status",
            "drop_live": (
                "create_status",
                "delete_status",
                "update_status",
            ),
        },
        "update_ticket": {
            "draft_key": "reassign_draft",
            "workflow": "reassign_ticket",
            "create_type": "reassign",
            "refresh": "refresh_tickets",
            "navigate": None,
            "open": "ticket",
        },
        "escalate_ticket": {
            "draft_key": "reassign_draft",
            "workflow": "reassign_ticket",
            "create_type": "reassign",
            "refresh": "refresh_tickets",
            "navigate": None,
            "open": "ticket",
            "also_clear": ("escalate_draft",),
        },
        "request_ticket_reassignment": {
            "draft_key": "reassign_draft",
            "workflow": "reassign_ticket",
            "create_type": "reassign",
            "refresh": "refresh_tickets",
            "navigate": None,
            "open": "ticket",
        },
    }
    spec = specs.get(tool_name)
    if not spec:
        return

    draft_key = str(spec["draft_key"])
    workflow = str(spec["workflow"])
    create_type = str(spec["create_type"])
    draft = memory.durable.get(draft_key)
    draft = dict(draft) if isinstance(draft, dict) else {}
    # escalate_ticket may be a classic escalate (escalate_draft) or reassign-resolver.
    if tool_name == "escalate_ticket":
        esc = memory.durable.get("escalate_draft")
        ras = memory.durable.get("reassign_draft")
        if isinstance(esc, dict) and str(esc.get("awaiting") or "").strip() and not (
            isinstance(ras, dict) and str(ras.get("person") or "").strip()
        ):
            draft_key = "escalate_draft"
            workflow = "escalate"
            create_type = "escalate"
            draft = dict(esc)
    memory.durable.pop(draft_key, None)
    for extra_key in spec.get("also_clear") or ():
        memory.durable.pop(str(extra_key), None)
    # Always drop reassign after a successful ticket owner write.
    if tool_name in {"update_ticket", "escalate_ticket"}:
        memory.durable.pop("reassign_draft", None)
        memory.durable.pop("escalate_draft", None)
    wf_now = str(memory.durable.get("current_workflow") or "").strip().lower()
    wf_aliases = {
        "add_team_members": {"add_team_members", "add_members"},
        "create_team": {"create_team"},
        "reassign_ticket": {"reassign_ticket", "reassign"},
        "escalate": {"escalate"},
    }
    if wf_now == workflow or wf_now in wf_aliases.get(workflow, set()):
        memory.durable.pop("current_workflow", None)
    memory.durable.pop("pending_ask", None)
    memory.durable["slots"] = {}

    payload = _tool_payload_dict(result)
    entity_id = str(
        payload.get("id")
        or payload.get("macroId")
        or payload.get("queueId")
        or payload.get("customerId")
        or payload.get("ticketNumber")
        or payload.get("ticket_number")
        or draft.get("ticket_number")
        or draft.get("ticketNumber")
        or ""
    ).strip()
    title = str(
        payload.get("title")
        or payload.get("name")
        or payload.get("queueName")
        or draft.get("title")
        or draft.get("name")
        or draft.get("queueName")
        or draft.get("displayName")
        or draft.get("person")
        or ""
    ).strip()

    # Drop live (non-done) create_* for this flow from the turn.
    drop_live = {create_type, *(spec.get("drop_live") or ())}
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and str(a.get("type") or "") in drop_live
            and not a.get("done")
        )
    ]

    done_action: dict[str, Any] = {
        "type": create_type,
        "done": True,
        "refresh": True,
        "progressComplete": True,
        "step": "confirm",
        "awaiting": "done",
        "id": entity_id or None,
        "title": title or None,
        "name": title or None,
        **(spec.get("extra_done") or {}),
    }
    # Carry draft fields useful for UI banners / seeds.
    for k in (
        "title",
        "body",
        "name",
        "queueName",
        "description",
        "category",
        "customerName",
        "customerEmail",
        "customerPhone",
        "issue",
        "subject",
        "priority",
        "assignee",
        "resolver",
        "queue",
        "displayName",
        "resolutionHours",
    ):
        if draft.get(k) is not None and k not in done_action:
            done_action[k] = draft.get(k)
        elif payload.get(k) is not None and k not in done_action:
            done_action[k] = payload.get(k)

    if tool_name == "create_ticket":
        tn = str(
            payload.get("ticketNumber")
            or payload.get("ticket_number")
            or payload.get("id")
            or ""
        ).strip()
        if tn and not tn.startswith("#") and tn.lstrip("#").isdigit():
            tn = f"#{tn.lstrip('#')}"
        done_action["ticketNumber"] = tn or None
        done_action["id"] = tn or payload.get("id")
        entity_id = tn or entity_id

    if tool_name == "create_customer":
        from app.tasks.catalog_commands import _directory_row_from_tool

        # Express nests the row under payload.customer — do not require top-level id.
        row = _directory_row_from_tool(result if isinstance(result, dict) else None) or {}
        cid = str(
            row.get("id")
            or entity_id
            or payload.get("id")
            or payload.get("customerId")
            or ""
        ).strip()
        cname = str(
            row.get("name") or draft.get("name") or title or ""
        ).strip()
        if cid and cname:
            entity_id = cid
            memory.durable["last_entity"] = {
                "type": "customer",
                "id": cid,
                "name": cname,
                "email": str(row.get("email") or draft.get("email") or ""),
                "phone": str(row.get("phone") or draft.get("phone") or ""),
            }
            _bind_customer_onto_ticket_memory(
                memory,
                customer_id=cid,
                name=cname,
                email=str(row.get("email") or draft.get("email") or ""),
                phone=str(row.get("phone") or draft.get("phone") or ""),
            )
            from_ticket_cdp = bool(memory.durable.get("_catalog_customer_from_ticket"))
            _arm_native_resume_after_customer(memory, ui_actions=ui_actions)
            if from_ticket_cdp:
                _harness_resume_ticket_create_after_customer(memory)

    if tool_name in (
        "create_priority",
        "create_status",
        "update_priority",
        "update_status",
    ):
        kind = "status" if tool_name in {"create_status", "update_status"} else "priority"
        done_action["kind"] = kind
    ui_actions.append(done_action)
    refresh = str(spec.get("refresh") or "").strip()
    if refresh:
        ui_actions.append({"type": refresh})
    nav = str(spec.get("navigate") or "").strip()
    # After add-customer, if create-ticket was restored, stay on that panel — do not
    # bounce back to the customers directory (that drops the RH progress draft).
    if (
        tool_name == "create_customer"
        and isinstance(memory.durable.get("ticket_draft"), dict)
        and str(memory.durable.get("current_workflow") or "").strip().lower()
        in {"create_ticket", "ticket"}
    ):
        nav = "create-ticket"
        # Drop a stale navigate:customers from earlier in this turn.
        ui_actions[:] = [
            a
            for a in ui_actions
            if not (
                isinstance(a, dict)
                and a.get("type") == "navigate"
                and str(a.get("view") or "") == "customers"
            )
        ]
        # Ensure a live create_ticket panel action exists for CreateTicketView seed.
        if not any(
            isinstance(a, dict)
            and str(a.get("type") or "") == "create_ticket"
            and not a.get("done")
            for a in ui_actions
        ):
            td = dict(memory.durable.get("ticket_draft") or {})
            ui_actions.append(
                {
                    "type": "create_ticket",
                    **td,
                    "step": td.get("awaiting"),
                    "awaiting": td.get("awaiting"),
                }
            )
    if nav and not any(
        isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == nav
        for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": nav})

    open_kind = spec.get("open")
    if open_kind == "ticket" and entity_id:
        ui_actions.append(
            {
                "type": "open_ticket",
                "id": entity_id,
                "ticketNumber": entity_id,
                "name": entity_id,
            }
        )
        memory.durable["last_entity"] = {
            "type": "ticket",
            "id": entity_id,
            "name": entity_id.lstrip("#"),
            "subject": draft.get("subject") or payload.get("subject"),
            "priority": draft.get("priority") or payload.get("priority"),
            "assignee": draft.get("assignee") or payload.get("assignee"),
            "resolver": draft.get("resolver") or payload.get("resolver"),
        }
    elif open_kind == "macro" and (entity_id or title):
        ui_actions.append(
            {
                "type": "open_macro",
                "id": entity_id or None,
                "title": title or None,
                "name": title or None,
            }
        )
        memory.durable["last_entity"] = {
            "type": "macro",
            "id": entity_id or title,
            "name": title or entity_id,
            "title": title or None,
        }
    elif open_kind == "kb" and (entity_id or title):
        ui_actions.append(
            {
                "type": "open_kb",
                "id": entity_id or None,
                "title": title or None,
            }
        )
        memory.durable["last_entity"] = {
            "type": "article",
            "id": entity_id or title,
            "name": title or entity_id,
            "title": title or None,
        }
    elif open_kind == "team" and (entity_id or title):
        ui_actions.append(
            {
                "type": "open_team",
                "id": entity_id or None,
                "name": title or None,
                "queueName": title or None,
            }
        )
        memory.durable["last_entity"] = {
            "type": "team",
            "id": entity_id or title,
            "name": title or entity_id,
        }
    elif open_kind == "customer" and (entity_id or title):
        cust_row = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
        cust_email = str(
            draft.get("email")
            or draft.get("customerEmail")
            or cust_row.get("email")
            or payload.get("email")
            or ""
        ).strip()
        cust_phone = str(
            draft.get("phone")
            or draft.get("customerPhone")
            or cust_row.get("phone")
            or payload.get("phone")
            or ""
        ).strip()
        cust_name = str(
            title
            or draft.get("name")
            or cust_row.get("name")
            or payload.get("name")
            or ""
        ).strip()
        ui_actions.append(
            {
                "type": "open_customer",
                "id": entity_id or None,
                "name": cust_name or None,
                "email": cust_email or None,
            }
        )
        memory.durable["last_entity"] = {
            "type": "customer",
            "id": entity_id or title,
            "name": cust_name or entity_id,
            "email": cust_email,
            "phone": cust_phone,
        }
    elif open_kind == "priority" and entity_id:
        ui_actions.append(
            {
                "type": "open_priority",
                "id": entity_id,
                "displayName": title or None,
                "name": title or None,
            }
        )
        memory.durable["last_entity"] = {
            "type": "priority",
            "id": entity_id,
            "name": title or entity_id,
        }
    elif open_kind == "status" and entity_id:
        ui_actions.append(
            {
                "type": "open_status",
                "id": entity_id,
                "displayName": title or None,
                "name": title or None,
            }
        )
        memory.durable["last_entity"] = {
            "type": "status",
            "id": entity_id,
            "name": title or entity_id,
        }


def _clear_ticket_draft_after_create(
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]],
    *,
    result: dict[str, Any] | None = None,
) -> None:
    """Compat alias — prefer `_clear_draft_after_write`."""
    _clear_draft_after_write(
        "create_ticket", memory, ui_actions, result=result
    )


def _ticket_issue_collect_fallback(
    memory: SharedMemory,
    query: str,
) -> str | None:
    """Phrase ask for issue when verify succeeded and draft awaits issue."""
    draft = memory.durable.get("ticket_draft")
    if not isinstance(draft, dict):
        return None
    if str(draft.get("awaiting") or "").strip().lower() != "issue":
        return None
    if str(draft.get("issue") or draft.get("description") or "").strip():
        return None
    if not _ticket_directory_verified(draft):
        return None
    try:
        from app.tasks.phrase import phrase_reply

        cname = str(draft.get("customerName") or "").strip()
        reply = phrase_reply(
            module="tickets",
            kind="collect",
            fallback=(
                f"{'Customer ' + cname + ' is' if cname else 'They are'} in the directory. "
                "Ask for a short description of the customer's issue in fresh wording."
            ),
            context={
                "customerName": cname,
                "customerEmail": draft.get("customerEmail"),
                "awaiting": "issue",
                "nextStep": "a short description of the customer's issue",
                "userMessage": str(query or "").strip(),
            },
            ticket_draft=draft,
        )
        text = str(reply or "").strip()
        return text or None
    except Exception:  # noqa: BLE001
        return None


def _confirm_fallback_text(memory: SharedMemory) -> str | None:
    """LLM phrase when the tool loop ends empty on an armed confirm/delete turn."""
    last = memory.durable.get("last_tool_outcome") or {}
    if isinstance(last, dict) and last.get("success"):
        tool = str(last.get("tool") or "").strip().lower()
        if tool in ("delete_priority", "delete_status"):
            kind = "status" if tool == "delete_status" else "priority"
            args = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
            name = str(
                args.get("displayName")
                or args.get("display_name")
                or args.get("name")
                or ""
            ).strip()
            try:
                from app.tasks.phrase import phrase_reply

                reply = phrase_reply(
                    module="admin",
                    kind="priority_deleted" if kind == "priority" else "status_deleted",
                    fallback=f"Acknowledge that the {kind} was deleted.",
                    context={"displayName": name, "kind": kind, "deleted": True},
                )
                text = str(reply or "").strip()
                if text:
                    memory.durable.pop("last_tool_outcome", None)
                    return text
            except Exception:  # noqa: BLE001
                return None
        catalog_reply = _catalog_create_reply_text(memory, "")
        if catalog_reply:
            return catalog_reply

    # Ticket portal keeps a dedicated phrasing path (surface=portal).
    draft = memory.durable.get("ticket_draft")
    if isinstance(draft, dict):
        awaiting = str(draft.get("awaiting") or memory.durable.get("pending_ask") or "").strip()
        surface = str(draft.get("surface") or "").strip().lower()
        enriched = bool(draft.get("enriched") or draft.get("enrichedByAi"))
        if surface == "portal" and (enriched or awaiting.lower() == "confirm"):
            try:
                from app.tasks.phrase import phrase_reply

                subject = str(draft.get("subject") or draft.get("issue") or "").strip()
                reply = phrase_reply(
                    module="portal",
                    kind="portal_confirm_fallback",
                    fallback=(
                        "Customer affirmed filing a support ticket after self-service. "
                        "Acknowledge and confirm the ticket was filed (or ask them to retry). "
                        f"Issue: {subject or 'their issue'}."
                    ),
                    context={
                        "subject": subject,
                        "customerName": draft.get("customerName"),
                        "awaiting": "confirm",
                        "surface": "portal",
                    },
                    ticket_draft=draft,
                )
                text = str(reply or "").strip()
                return text or None
            except Exception:  # noqa: BLE001
                return None

    # Schema-driven confirm fallback for every guided module draft.
    for draft_key, module, label in (
        ("ticket_draft", "tickets", "ticket"),
        ("team_draft", "teams", "team"),
        ("kb_draft", "kb", "article"),
        ("macro_draft", "macro", "macro"),
        ("customer_draft", "customers", "customer"),
        ("escalate_draft", "tickets", "escalation"),
        ("priority_draft", "priority", "priority"),
        ("status_draft", "priority", "status"),
    ):
        blob = memory.durable.get(draft_key)
        if not isinstance(blob, dict):
            continue
        awaiting = str(blob.get("awaiting") or "").strip().lower()
        if awaiting not in {"confirm", "delete_confirm"} and not (
            draft_key == "ticket_draft"
            and (blob.get("enriched") or blob.get("enrichedByAi"))
        ):
            continue
        name = str(
            blob.get("displayName")
            or blob.get("name")
            or blob.get("title")
            or blob.get("label")
            or blob.get("subject")
            or blob.get("issue")
            or ""
        ).strip()
        try:
            from app.tasks.phrase import phrase_reply

            if awaiting == "delete_confirm":
                reply = phrase_reply(
                    module=module,
                    kind="validation",
                    fallback=f"Acknowledge delete of {label} {name or 'entry'}.",
                    context={
                        "displayName": name,
                        "deleting": True,
                        "deleted": True,
                        "nextStep": "whether to proceed with the delete",
                    },
                )
            else:
                reply = phrase_reply(
                    module=module,
                    kind="confirm_hint",
                    fallback=f"Summarize and ask to save {label} {name or 'entry'}.",
                    context={
                        "displayName": name,
                        "name": name,
                        "title": name,
                        "subject": blob.get("subject") or name,
                        "priority": blob.get("priority"),
                        "queue": blob.get("queue"),
                        "customerName": blob.get("customerName") or blob.get("name"),
                        "awaiting": "confirm",
                        "nextStep": "review and tell me to save it",
                    },
                    ticket_draft=blob if draft_key == "ticket_draft" else None,
                )
            text = str(reply or "").strip()
            return text or None
        except Exception:  # noqa: BLE001
            return None
    return None


def _hydrate_portal_create_ticket_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill portal_create_ticket from ticket_draft so affirm turns do not omit issue."""
    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    out = dict(args)
    issue = str(
        out.get("issue")
        or out.get("description")
        or draft.get("issue")
        or draft.get("description")
        or ""
    ).strip()
    subject = str(out.get("subject") or draft.get("subject") or issue[:120] or "").strip()
    description = str(
        out.get("description") or draft.get("description") or issue or ""
    ).strip()
    if issue:
        out["issue"] = issue
    if subject:
        out["subject"] = subject
    if description:
        out["description"] = description
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    # Skip inbound DSSA re-gate after they already walked KB / Super routed file.
    if awaiting == "confirm" and (
        draft.get("kb_offered")
        or memory.durable.get("_portal_create_after_self_service")
    ):
        out["force_create"] = True
    atts = draft.get("attachments")
    if isinstance(atts, list) and atts and not out.get("attachments"):
        urls = [
            str(item).strip()
            for item in atts
            if str(item).strip().startswith("/uploads/")
            and ".." not in str(item)
            and "\\" not in str(item)
        ]
        if urls:
            out["attachments"] = urls
    verified_order = str(draft.get("orderId") or draft.get("order_id") or "").strip()
    if verified_order and (
        draft.get("orderVerified") is True
        or str(draft.get("orderVerified") or "").strip().lower() in {"true", "1", "yes"}
    ):
        out["orderId"] = verified_order
    verified_product = str(draft.get("productId") or draft.get("product_id") or "").strip()
    if verified_product:
        out["productId"] = verified_product
    return out


def _hydrate_enrich_args(memory: SharedMemory, args: dict[str, Any]) -> dict[str, Any]:
    """Fill enrich_ticket args from the live ticket draft when the LLM omits fields."""
    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    out = dict(args)
    for key in (
        "customerName",
        "customerEmail",
        "customerPhone",
        "contact",
        "issue",
    ):
        if not str(out.get(key) or "").strip() and str(draft.get(key) or "").strip():
            out[key] = draft[key]
    if not str(out.get("customerEmail") or "").strip() and not str(
        out.get("customerPhone") or ""
    ).strip():
        contact = str(out.get("contact") or draft.get("contact") or "").strip()
        if contact:
            out["contact"] = contact
    return out


def _order_id_from_open_slot(memory: SharedMemory, query: str) -> str:
    """Typed bind of this turn into the open orderId slot. Empty if that slot is not open."""
    from app.workflow_schemas import bind_awaiting_value

    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if awaiting not in {"orderid", "order_id", "order"}:
        return ""
    raw = str(query or "").strip()
    if not raw:
        return ""
    low = raw.lower()
    if low.startswith(("continue:", "pinned:", "resume:")):
        return ""
    bound = bind_awaiting_value("create_ticket", "orderId", raw)
    return str(bound.get("orderId") or bound.get("order_id") or "").strip()


def _hydrate_get_customer_order_args(
    memory: SharedMemory,
    args: dict[str, Any],
    query: str = "",
) -> dict[str, Any]:
    """Fill get_customer_order from args, the open orderId slot, then draft. Never invent ids."""
    out = dict(args or {})
    draft = dict(memory.durable.get("ticket_draft") or {})
    if not str(out.get("order_id") or out.get("orderId") or "").strip():
        slot_oid = _order_id_from_open_slot(memory, query)
        if slot_oid:
            out["order_id"] = slot_oid
            draft["orderId"] = slot_oid
            memory.durable["ticket_draft"] = draft
        else:
            oid = str(draft.get("orderId") or draft.get("order_id") or "").strip()
            if oid:
                out["order_id"] = oid
    if not str(out.get("customer_id") or out.get("customerId") or "").strip():
        cid = str(draft.get("customerId") or draft.get("customer_id") or "").strip()
        if cid:
            out["customer_id"] = cid
    return out


def _merge_order_lookup_into_ticket_draft(
    memory: SharedMemory,
    result: dict[str, Any],
) -> None:
    """Stamp orderVerified from TOOL RESULT only."""
    draft = dict(memory.durable.get("ticket_draft") or {})
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    if result.get("success") and (
        payload.get("exists") is True or payload.get("orderId") or payload.get("order_id")
    ):
        oid = str(
            payload.get("orderNumber")
            or payload.get("orderId")
            or payload.get("order_id")
            or draft.get("orderId")
            or ""
        ).strip()
        if oid:
            draft["orderId"] = oid
        draft["orderVerified"] = True
        draft["needsOrderCheck"] = True
        items = payload.get("items") if isinstance(payload.get("items"), list) else []
        draft["orderItemCount"] = len(items)
        if items and not str(draft.get("productId") or draft.get("product_id") or "").strip():
            draft["awaiting"] = "productId"
            draft["step"] = "productId"
        elif not str(draft.get("issue") or "").strip():
            draft["awaiting"] = "issue"
            draft["step"] = "issue"
        else:
            draft["awaiting"] = "confirm"
            draft["step"] = "confirm"
    else:
        draft["orderVerified"] = False
        draft["awaiting"] = "orderId"
        draft["step"] = "orderId"
    memory.durable["ticket_draft"] = draft


def _hydrate_verify_ticket_customer_args(
    memory: SharedMemory, args: dict[str, Any]
) -> dict[str, Any]:
    """Fill verify_ticket_customer from ticket_draft when the LLM omits fields."""
    draft = memory.durable.get("ticket_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    out = dict(args)
    for key in ("customerName", "customerEmail", "customerPhone", "contact"):
        if not str(out.get(key) or "").strip() and str(draft.get(key) or "").strip():
            out[key] = draft[key]
    if not str(out.get("customerEmail") or "").strip() and not str(
        out.get("customerPhone") or ""
    ).strip():
        contact = str(out.get("contact") or draft.get("contact") or "").strip()
        if contact:
            out["contact"] = contact
    return out


def _merge_verify_into_ticket_draft(
    memory: SharedMemory,
    result: dict[str, Any],
    ui_actions: list[dict[str, Any]],
) -> None:
    """Apply verify_ticket_customer payload into ticket_draft + progress panel."""
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    if not payload:
        return
    draft = dict(memory.durable.get("ticket_draft") or {})
    for key in (
        "customerId",
        "customerName",
        "customerEmail",
        "customerPhone",
        "customerDirectoryStatus",
    ):
        if payload.get(key) not in (None, ""):
            draft[key] = payload[key]
    if payload.get("exists") is True:
        draft.pop("customer_not_found", None)
        _mark_ticket_customer_verified(draft)
        from app.tools.ticket_write import _truthy_draft_flag

        if _truthy_draft_flag(draft.get("needsOrderCheck")) and not _truthy_draft_flag(
            draft.get("orderVerified")
        ):
            draft["awaiting"] = "orderId"
            draft["step"] = "orderId"
        else:
            draft["awaiting"] = "issue"
            draft["step"] = "issue"
    elif payload.get("exists") is False and not payload.get("ambiguous"):
        draft["customer_not_found"] = True
        draft["customerDirectoryStatus"] = "missing"
        draft["awaiting"] = "contact"
        draft["step"] = "contact"
    memory.durable["ticket_draft"] = draft
    memory.durable["current_workflow"] = "create_ticket"
    memory.durable["pending_ask"] = str(draft.get("awaiting") or "")
    slots = dict(memory.durable.get("slots") or {})
    slots.update({k: v for k, v in draft.items() if k not in {"awaiting", "step"}})
    memory.durable["slots"] = slots
    if not any(
        isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == "create-ticket"
        for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": "create-ticket"})
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and str(a.get("type") or "") == "create_ticket"
            and not a.get("done")
        )
    ]
    ui_actions.append(
        {
            "type": "create_ticket",
            **draft,
            "step": draft.get("awaiting"),
            "awaiting": draft.get("awaiting"),
        }
    )


def _looks_like_tabular_reply(text: str | None) -> bool:
    if not text:
        return False
    rows = [
        line
        for line in str(text).splitlines()
        if line.strip().startswith("|") and line.count("|") >= 2
    ]
    return len(rows) >= 2


def _looks_like_html_table_reply(text: str | None) -> bool:
    import re

    return bool(re.search(r"<table[\s>]", str(text or ""), re.I))


def _llm_invented_list_table(text: str | None) -> bool:
    """True when the model pasted a table — only runtime may emit list tables."""
    body = str(text or "")
    if _looks_like_tabular_reply(body):
        return True
    if _looks_like_html_table_reply(body):
        return True
    if "coworker-data-table" in body:
        return True
    return False


def _strip_markdown_table_lines(text: str | None) -> str:
    kept: list[str] = []
    for line in str(text or "").splitlines():
        stripped = line.strip()
        if stripped.startswith("|") and stripped.count("|") >= 2:
            continue
        kept.append(line)
    return "\n".join(kept).strip()


def _strip_html_table_from_text(text: str | None) -> str:
    import re

    t = str(text or "")
    t = re.sub(r"(?is)<table[\s\S]*?</table>", "", t)
    t = re.sub(r"(?is)<p>\s*<em>Showing[\s\S]*?</em>\s*</p>", "", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def _customer_row_field(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key not in row:
            continue
        raw = row.get(key)
        if raw is None:
            continue
        if str(raw).strip() == "":
            continue
        return raw
    return None


def _build_customer_list_html_table(rows: list[dict[str, Any]]) -> str:
    import html as html_module

    def _cell(raw: Any) -> str:
        text = str(raw or "").strip()
        return html_module.escape(text if text else "—")

    head = (
        "<thead><tr>"
        "<th>Name</th><th>Email</th><th>Phone</th>"
        "<th>Total Tickets</th><th>Status</th><th>Created At</th>"
        "</tr></thead>"
    )
    body_rows: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        body_rows.append(
            "<tr>"
            f"<td>{_cell(_customer_row_field(row, 'name', 'customer_name', 'customerName'))}</td>"
            f"<td>{_cell(_customer_row_field(row, 'email', 'customer_email', 'customerEmail'))}</td>"
            f"<td>{_cell(_customer_row_field(row, 'phone', 'customer_phone', 'customerPhone'))}</td>"
            f"<td>{_cell(_customer_row_field(row, 'totalTickets', 'total_tickets'))}</td>"
            f"<td>{_cell(_customer_row_field(row, 'status'))}</td>"
            f"<td>{_cell(_customer_row_field(row, 'createdAt', 'created_at'))}</td>"
            "</tr>"
        )
    if not body_rows:
        return ""
    return (
        '<table class="coworker-data-table">'
        f"{head}<tbody>{''.join(body_rows)}</tbody></table>"
    )


def _customer_list_page_note(payload: dict[str, Any]) -> str:
    total = int(payload.get("totalRows") or 0)
    off = int(payload.get("offset") or 0)
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    shown = len(rows)
    if total <= 0 or shown <= 0:
        return ""
    end = off + shown
    if bool(payload.get("hasMore")):
        return f"<p><em>Showing {off + 1}–{end} of {total} records.</em></p>"
    if off > 0:
        return f"<p><em>Showing {off + 1}–{end} of {total} records.</em></p>"
    if total > shown:
        return f"<p><em>Showing {shown} of {total} records.</em></p>"
    return ""


def _stash_customer_list_cursor(
    memory: SharedMemory,
    payload: dict[str, Any],
    invoke_args: dict[str, Any],
) -> None:
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    off = int(payload.get("offset") or 0)
    lim = int(payload.get("limit") or len(rows) or 12)
    has_more = bool(payload.get("hasMore"))
    memory.durable["customer_list_cursor"] = {
        "offset": off + len(rows),
        "pageSize": lim,
        "totalRows": int(payload.get("totalRows") or len(rows)),
        "hasMore": has_more,
        "pendingPage": has_more,
        "lastTool": (
            "ask_sql_layer"
            if str(payload.get("source") or "") == "ask_sql_layer"
            else "list_customers"
        ),
        "filters": {
            k: invoke_args.get(k)
            for k in ("query", "status", "exact_email", "exact_phone", "instruction")
            if invoke_args.get(k) not in (None, "")
        },
    }


def _memory_tool_actor_scope(memory: SharedMemory):
    """Use the live ToolActor, or reconstruct one from session memory."""
    from contextlib import nullcontext

    from app.tools.express_client import ToolActor, get_tool_actor, tool_actor_scope

    current = get_tool_actor()
    if current and current.user_id and current.organization_id:
        return nullcontext()
    org = str(getattr(memory, "organization_id", None) or "").strip()
    uid = str(getattr(memory, "user_id", None) or "").strip()
    if not org or not uid or uid.lower() == "anonymous":
        return nullcontext()
    return tool_actor_scope(ToolActor(user_id=uid, organization_id=org))


def _append_open_customer_profile(
    ui_actions: list[dict[str, Any]] | None,
    memory: SharedMemory,
    *,
    customer_id: str | None = None,
    name: str | None = None,
    email: str | None = None,
) -> None:
    """Open the CRM customer profile from directory / 360 tool fields only."""
    if ui_actions is None:
        return
    cid = str(customer_id or "").strip()
    em = str(email or "").strip()
    nm = str(name or "").strip()
    if not cid and not em and not nm:
        return
    if not any(
        isinstance(a, dict)
        and a.get("type") == "navigate"
        and a.get("view") == "customers"
        for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": "customers"})
    if not any(
        isinstance(a, dict) and a.get("type") == "open_customer" for a in ui_actions
    ):
        ui_actions.append(
            {
                "type": "open_customer",
                "id": cid or None,
                "name": nm or None,
                "email": em or None,
            }
        )
    memory.durable["last_entity"] = {
        "type": "customer",
        "id": cid or em or nm,
        "name": nm or cid,
        "email": em,
    }


def _fetch_customer_list_page(
    memory: SharedMemory,
    *,
    offset: int,
    limit: int,
) -> dict[str, Any] | None:
    from app.tools.catalog_tools import list_customers

    cursor = memory.durable.get("customer_list_cursor")
    filters = (
        dict(cursor.get("filters") or {})
        if isinstance(cursor, dict)
        else {}
    )
    with _memory_tool_actor_scope(memory):
        result = list_customers(
            query=filters.get("query"),
            status=filters.get("status"),
            exact_email=filters.get("exact_email"),
            exact_phone=filters.get("exact_phone"),
            limit=limit,
            offset=offset,
        )
    if not isinstance(result, dict) or not result.get("success"):
        return None
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else None
    if not payload:
        return None
    _stash_customer_list_cursor(memory, payload, {**filters, "limit": limit, "offset": offset})
    memory.durable["last_tool_outcome"] = {
        "tool": "list_customers",
        "success": True,
        "payload": payload,
    }
    return payload


def _compose_customer_list_reply_html(
    intro: str,
    payload: dict[str, Any],
) -> str:
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    table = _build_customer_list_html_table([r for r in rows if isinstance(r, dict)])
    if not table:
        return intro.strip()
    parts = [p for p in [intro.strip(), table, _customer_list_page_note(payload)] if p]
    return "\n".join(parts)


def _ground_customer_list_reply(
    text: str | None,
    *,
    list_payload: dict[str, Any] | None,
    turn_tools_called: list[str],
    memory: SharedMemory,
    harness_skill: str | None,
    query: str,
    page: str | None,
    ui_actions: list[dict[str, Any]] | None = None,
) -> str | None:
    """Build customer directory tables only from this turn's list TOOL RESULT."""
    if str(harness_skill or "") != "customer-read-360":
        return None

    payload = dict(list_payload) if isinstance(list_payload, dict) else None
    cursor = memory.durable.get("customer_list_cursor")
    listed = (
        "list_customers" in turn_tools_called or "ask_sql_layer" in turn_tools_called
    )
    invented_table = not listed and _llm_invented_list_table(text)
    needs_next_page = (
        not listed
        and isinstance(cursor, dict)
        and cursor.get("hasMore")
        and cursor.get("pendingPage")
    )

    if not payload and (invented_table or needs_next_page):
        if isinstance(cursor, dict):
            off = int(cursor.get("offset") or 0)
            lim = int(cursor.get("pageSize") or 12)
            if cursor.get("hasMore"):
                payload = _fetch_customer_list_page(memory, offset=off, limit=lim)
            elif invented_table:
                payload = _fetch_customer_list_page(memory, offset=0, limit=lim)

    if not payload:
        if invented_table:
            intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
            return (
                intro
                or "I couldn't verify those directory rows against the database. "
                "Try asking again and I'll reload from the customer directory."
            )
        return None

    intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
    if not intro:
        total = int(payload.get("totalRows") or 0)
        off = int(payload.get("offset") or 0)
        if off > 0:
            intro = "Here are the next customer records from the directory:"
        elif total:
            intro = "Here are the customer records found in the directory:"
        else:
            intro = "No customers matched that request in the directory."

    try:
        from app.tasks.phrase import phrase_reply

        rows = payload.get("data") if isinstance(payload.get("data"), list) else []
        reply = phrase_reply(
            module="customer",
            kind="filter",
            fallback="Introduce the directory rows briefly; do not paste a table.",
            user_text=query,
            page_label=page or "Customers",
            context={
                "customerCount": len(rows),
                "totalRows": payload.get("totalRows"),
                "offset": payload.get("offset"),
                "hasMore": payload.get("hasMore"),
            },
        )
        intro = _strip_html_table_from_text(
            _strip_markdown_table_lines(str(reply or "").strip())
        ) or intro
    except Exception:  # noqa: BLE001
        pass

    _stash_customer_360_candidate(memory, payload)
    _append_list_filter_ui_actions(
        ui_actions,
        module="customers",
        filters=_customer_list_ui_filters(payload, memory),
        navigate_view="customers",
    )
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    if len(rows) == 1 and isinstance(rows[0], dict):
        hit = rows[0]
        _append_open_customer_profile(
            ui_actions,
            memory,
            customer_id=str(
                hit.get("id") or hit.get("customerId") or hit.get("customer_id") or ""
            ),
            name=str(
                _customer_row_field(hit, "name", "customer_name", "customerName") or ""
            ),
            email=str(
                _customer_row_field(hit, "email", "customer_email", "customerEmail")
                or ""
            ),
        )
    return _compose_customer_list_reply_html(intro, payload)


def _ticket_list_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw = payload.get("data")
    if not isinstance(raw, list):
        raw = payload.get("rows") if isinstance(payload.get("rows"), list) else []
    return [r for r in raw if isinstance(r, dict)]


# Portal status/list only — staff list_tickets / SQL keep all row keys.
_PORTAL_TICKET_LIST_FIELDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("id", ("id", "ticketNumber", "ticket_number")),
    ("subject", ("subject",)),
    ("description", ("description",)),
    ("customerName", ("customerName", "customer_name")),
    ("customerEmail", ("customerEmail", "customer_email", "email")),
    ("customerPhone", ("customerPhone", "customer_phone", "phone")),
    ("channel", ("channel",)),
    ("status", ("status",)),
    ("updatedAt", ("updatedAt", "updated_at")),
    ("createdAt", ("createdAt", "created_at")),
)


def _project_portal_ticket_list_row(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for dest, keys in _PORTAL_TICKET_LIST_FIELDS:
        value = None
        for key in keys:
            if key not in row:
                continue
            raw = row.get(key)
            if raw is None:
                continue
            if str(raw).strip() == "":
                continue
            value = raw
            break
        out[dest] = value
    return out


def _project_portal_ticket_list_payload(payload: Any) -> Any:
    if isinstance(payload, list):
        return [
            _project_portal_ticket_list_row(r) for r in payload if isinstance(r, dict)
        ]
    if not isinstance(payload, dict):
        return payload
    out = dict(payload)
    raw = out.get("data")
    if not isinstance(raw, list):
        raw = out.get("rows") if isinstance(out.get("rows"), list) else None
    if not isinstance(raw, list):
        return out
    projected = [_project_portal_ticket_list_row(r) for r in raw if isinstance(r, dict)]
    if "data" in out:
        out["data"] = projected
    if "rows" in out:
        out["rows"] = projected
    return out


def _sql_list_rows_are_tickets(
    rows: list[dict[str, Any]],
    invoke_args: dict[str, Any] | None = None,
) -> bool:
    hint = str(
        (invoke_args or {}).get("entity_hint")
        or (invoke_args or {}).get("entityHint")
        or ""
    ).lower()
    if "customer" in hint:
        return False
    if not rows:
        return True
    sample = rows[0]
    if sample.get("ticket_number") or sample.get("subject"):
        return True
    if sample.get("customer_email") or sample.get("customer_name"):
        return False
    return False


def _uniform_ticket_field(rows: list[dict[str, Any]], *keys: str) -> str | None:
    found: set[str] = set()
    for row in rows:
        for key in keys:
            val = str(row.get(key) or "").strip()
            if val:
                found.add(val)
                break
    if len(found) == 1:
        return next(iter(found))
    return None


def _express_filters_from_sql_list(
    args: dict[str, Any],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Map structured SQL/list args (and uniform TOOL RESULT fields) to Express."""
    out: dict[str, Any] = {}
    direct = {
        "scope": "scope",
        "status": "status",
        "priority": "priority",
        "channel": "channel",
        "queue": "queue",
        "customer": "customer",
        "due": "due",
        "created_range": "created_range",
        "updated_range": "updated_range",
        "assigned_to": "assigned_to",
        "created_by": "created_by",
        "query": "query",
        "sort": "sort",
    }
    for src, dest in direct.items():
        val = args.get(src)
        if val not in (None, ""):
            out[dest] = val
    raw_filters = args.get("filters")
    if isinstance(raw_filters, list):
        dim_map = {
            "status": "status",
            "ticket_status": "status",
            "priority": "priority",
            "channel": "channel",
            "queue": "queue",
            "queue_name": "queue",
            "customer": "customer",
            "customer_name": "customer",
            "customer_email": "customer",
            "assignee": "assigned_to",
            "assignee_name": "assigned_to",
            "assigned_to": "assigned_to",
            "created_range": "created_range",
            "updated_range": "updated_range",
        }
        for spec in raw_filters:
            if not isinstance(spec, dict):
                continue
            dim = str(spec.get("dimension") or spec.get("field") or "").strip().lower()
            dest = dim_map.get(dim)
            if not dest or dest in out:
                continue
            if dim == "is_overdue":
                flag = spec.get("value")
                if flag in (True, "true", "1", 1, "yes"):
                    out["due"] = "overdue"
                continue
            val = spec.get("value")
            if val in (None, "") and isinstance(spec.get("values"), list) and spec["values"]:
                val = spec["values"][0]
            if val not in (None, ""):
                out[dest] = val
    if "status" not in out:
        status = _uniform_ticket_field(rows, "status")
        if status:
            out["status"] = status
    if "priority" not in out:
        priority = _uniform_ticket_field(rows, "priority")
        if priority:
            out["priority"] = priority
    return out


def _express_ticket_list_total(filters: dict[str, Any]) -> int | None:
    """Postgres total via Express includeTotal — not the SQL page length."""
    try:
        from app.tools.ticket_read import list_tickets

        result = list_tickets(
            **{k: v for k, v in filters.items() if v not in (None, "")},
            limit=1,
            offset=0,
        )
    except Exception:
        return None
    if not isinstance(result, dict) or not result.get("success"):
        return None
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    try:
        return int(payload.get("totalRows"))
    except (TypeError, ValueError):
        return None


def _ticket_list_payload_from_sql(
    payload: dict[str, Any],
    invoke_args: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Successful ask_sql_layer list body — keep TOOL RESULT row keys as-is."""
    raw = payload.get("rows")
    if not isinstance(raw, list):
        raw = payload.get("data") if isinstance(payload.get("data"), list) else None
    if raw is None:
        return None
    rows = [dict(row) for row in raw if isinstance(row, dict)]
    args = invoke_args if isinstance(invoke_args, dict) else {}
    try:
        limit = int(args.get("limit") or payload.get("limit") or len(rows) or 12)
    except (TypeError, ValueError):
        limit = len(rows) or 12
    try:
        offset = int(
            args.get("offset")
            if args.get("offset") is not None
            else payload.get("offset")
            or 0
        )
    except (TypeError, ValueError):
        offset = 0
    total: int | None = None
    for key in ("totalRows", "total_rows", "total", "rowCount", "count"):
        raw_total = payload.get(key)
        if raw_total in (None, ""):
            continue
        try:
            total = int(raw_total)
            break
        except (TypeError, ValueError):
            continue
    express_filters: dict[str, Any] = {}
    if _sql_list_rows_are_tickets(rows, args):
        express_filters = _express_filters_from_sql_list(args, rows)
        if rows or express_filters:
            counted = _express_ticket_list_total(express_filters)
            if counted is not None:
                total = counted
    if total is None:
        # Do not treat a full page as the org total.
        if len(rows) < limit:
            total = offset + len(rows)
        else:
            total = None
    has_more = bool(payload.get("hasMore") or payload.get("truncated"))
    if total is not None:
        has_more = offset + len(rows) < total
    elif len(rows) >= limit:
        has_more = True
    return {
        "data": rows,
        "totalRows": total if total is not None else offset + len(rows),
        "totalKnown": total is not None,
        "offset": offset,
        "limit": limit,
        "hasMore": has_more,
        "source": "ask_sql_layer",
        "filters": express_filters,
    }


def _ticket_list_table_columns(rows: list[dict[str, Any]]) -> list[str]:
    columns: list[str] = []
    seen: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            name = str(key)
            if name in seen:
                continue
            if isinstance(row.get(key), (dict, list)):
                continue
            seen.add(name)
            columns.append(name)
    return columns


def _build_ticket_list_html_table(rows: list[dict[str, Any]]) -> str:
    import html as html_module

    def _cell(raw: Any) -> str:
        if raw is None:
            return "—"
        text = str(raw).strip()
        return html_module.escape(text if text else "—")

    columns = _ticket_list_table_columns(rows)
    if not columns:
        return ""
    head = "<thead><tr>" + "".join(
        f"<th>{html_module.escape(name)}</th>" for name in columns
    ) + "</tr></thead>"
    body_rows: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        cells = "".join(f"<td>{_cell(row.get(name))}</td>" for name in columns)
        body_rows.append(f"<tr>{cells}</tr>")
    if not body_rows:
        return ""
    return (
        '<table class="coworker-data-table">'
        f"{head}<tbody>{''.join(body_rows)}</tbody></table>"
    )


def _ticket_list_page_note(payload: dict[str, Any]) -> str:
    rows = _ticket_list_rows(payload)
    shown = len(rows)
    total = int(payload.get("totalRows") or shown)
    off = int(payload.get("offset") or 0)
    if shown <= 0:
        return ""
    start = off + 1
    end = off + shown
    known = payload.get("totalKnown")
    if known is None:
        known = total >= end and not (
            payload.get("hasMore") and total == shown and off == 0
        )
    if known:
        bits = [f"Showing {start}–{end} of {total} tickets"]
    else:
        bits = [f"Showing {start}–{end} tickets"]
    rng = str(payload.get("createdRange") or payload.get("updatedRange") or "").strip()
    if rng:
        bits.append(f"for {rng.replace('_', ' ')}")
    if payload.get("hasMore"):
        bits.append("say if you want the next 12")
    return f"<p><em>{html_escape_note(', '.join(bits))}.</em></p>"


def html_escape_note(text: str) -> str:
    import html as html_module

    return html_module.escape(text)


def _compose_ticket_list_reply_html(intro: str, payload: dict[str, Any]) -> str:
    table = _build_ticket_list_html_table(_ticket_list_rows(payload))
    if not table:
        return intro.strip()
    parts = [p for p in [intro.strip(), table, _ticket_list_page_note(payload)] if p]
    return "\n".join(parts)


def _queue_list_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        if payload.get("id") or payload.get("queueName") or payload.get("name"):
            return [payload]
        for key in ("data", "queues", "teams", "items", "rows"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
    return []


def _team_member_cell(row: dict[str, Any]) -> str:
    import html as html_module

    names = _member_names_from_rows(row.get("members") or row.get("memberNames"))
    if not names and isinstance(row.get("memberDetails"), list):
        names = _member_names_from_rows(row.get("memberDetails"))
    if not names:
        return "—"
    return "<br />".join(html_module.escape(n) for n in names)


def _build_team_list_html_table(rows: list[dict[str, Any]]) -> str:
    import html as html_module

    def _cell(raw: Any) -> str:
        text = str(raw or "").strip()
        return html_module.escape(text if text else "—")

    head = (
        "<thead><tr>"
        "<th>Team</th><th>Members</th><th>Open Tickets</th><th>SLA Status</th>"
        "</tr></thead>"
    )
    body_rows: list[str] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        team = str(
            row.get("queueName") or row.get("name") or row.get("queue_name") or ""
        ).strip()
        open_tickets = row.get("openTickets")
        if open_tickets is None:
            open_tickets = row.get("open_tickets")
        sla = str(row.get("slaStatus") or row.get("sla_status") or "").strip() or "—"
        if sla.lower() == "at risk":
            sla_cell = f"<strong>{html_module.escape(sla)}</strong>"
        else:
            sla_cell = html_module.escape(sla)
        body_rows.append(
            "<tr>"
            f"<td>{_cell(team)}</td>"
            f"<td>{_team_member_cell(row)}</td>"
            f"<td>{_cell(open_tickets)}</td>"
            f"<td>{sla_cell}</td>"
            "</tr>"
        )
    if not body_rows:
        return ""
    return (
        '<table class="coworker-data-table">'
        f"{head}<tbody>{''.join(body_rows)}</tbody></table>"
    )


def _compose_team_list_reply_html(intro: str, payload: dict[str, Any]) -> str:
    rows = _queue_list_rows(payload.get("data") if isinstance(payload, dict) else payload)
    if not rows and isinstance(payload, dict):
        rows = _queue_list_rows(payload)
    table = _build_team_list_html_table(rows)
    if not table:
        return intro.strip()
    total = int(payload.get("totalRows") or len(rows)) if isinstance(payload, dict) else len(rows)
    note = ""
    if total and len(rows) < total:
        note = f"<p><em>Showing {len(rows)} of {total} teams.</em></p>"
    parts = [p for p in [intro.strip(), table, note] if p]
    return "\n".join(parts)


def _kb_list_page_args(
    arguments: dict[str, Any] | None,
    *,
    cursor: dict[str, Any] | None,
    scope_already_requested: bool,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Knowledge list pages are 10 rows. The model chooses a new list or the next offset."""
    args = dict(arguments or {})
    query = str(args.get("query") or "").strip()
    category = str(args.get("category") or "").strip()
    status = str(args.get("status") or "").strip()
    try:
        limit = int(args.get("limit") or 10)
    except (TypeError, ValueError):
        limit = 10
    limit = min(50, max(1, limit))
    raw_offset = args.get("offset")
    offset: int | None
    if raw_offset in (None, ""):
        offset = None
    else:
        try:
            offset = max(0, int(raw_offset))
        except (TypeError, ValueError):
            offset = None
    pending = isinstance(cursor, dict) and bool(
        cursor.get("pendingPage") or cursor.get("hasMore")
    )
    try:
        next_offset = int(cursor.get("offset") or 0) if isinstance(cursor, dict) else 0
    except (TypeError, ValueError):
        next_offset = 0
    if query or category or status or offset is not None:
        args["limit"] = limit
        args["offset"] = 0 if offset is None else offset
        return None, args
    if pending and next_offset > 0 and not scope_already_requested:
        return (
            {
                "success": False,
                "error_code": "KB_PAGE_OFFSET_REQUIRED",
                "message": (
                    f"A later page is waiting. To show the next {limit} articles, "
                    f"call list_kb again with offset={next_offset} and limit={limit}. "
                    "To start the list over, call list_kb with offset=0 and limit=10. "
                    "Do not reply with the previous titles."
                ),
                "payload": {},
            },
            args,
        )
    if pending and next_offset > 0 and scope_already_requested:
        offset = next_offset
    args["limit"] = limit
    args["offset"] = 0 if offset is None else offset
    return None, args


def _stash_kb_list_cursor(
    memory: SharedMemory,
    payload: dict[str, Any],
    arguments: dict[str, Any],
) -> None:
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    try:
        offset = int(payload.get("offset") or 0)
        limit = int(payload.get("limit") or arguments.get("limit") or 10)
        total = int(payload.get("totalRows") or len(rows))
    except (TypeError, ValueError):
        return
    shown = len(rows)
    has_more = bool(payload.get("hasMore"))
    if not has_more:
        has_more = offset + shown < total
    filters = {
        key: arguments.get(key)
        for key in ("query", "category", "status")
        if arguments.get(key) not in (None, "")
    }
    memory.durable["kb_list_cursor"] = {
        "offset": offset + shown,
        "pageSize": limit,
        "totalRows": total,
        "hasMore": has_more,
        "pendingPage": has_more,
        "filters": filters,
    }


def _team_read_list_queues_args(
    arguments: dict[str, Any] | None,
    *,
    scope_already_requested: bool,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Team-read must say one team (`query`) or the full directory (`list_all`).

    The model owns that choice. An empty call asks once, then a repeat empty
    call is the full directory so an existing list-all turn still completes.
    """
    raw = dict(arguments or {})
    query = str(raw.get("query") or "").strip()
    list_all_raw = raw.get("list_all")
    list_all = list_all_raw is True or (
        isinstance(list_all_raw, str) and list_all_raw.strip().lower() in {"true", "1"}
    )
    cleaned = {key: value for key, value in raw.items() if key != "list_all"}
    if query:
        cleaned["query"] = query
        return None, cleaned
    cleaned.pop("query", None)
    if list_all or scope_already_requested:
        return None, cleaned
    return (
        {
            "success": False,
            "error_code": "TEAM_SCOPE_REQUIRED",
            "message": (
                "This call did not say which list to load. "
                "If they want the members of one team, call list_queues again "
                "with query set to that team's name (the name they used, or the "
                "focused team name already in context). "
                "If they want every team, call list_queues again with list_all true. "
                "Do not reply with a roster until that call succeeds."
            ),
            "payload": {},
        },
        cleaned,
    )


def _ground_team_list_reply(
    text: str | None,
    *,
    list_payload: dict[str, Any] | None,
    turn_tools_called: list[str],
    harness_skill: str | None,
    query: str,
    page: str | None,
) -> str | None:
    """Build team roster tables only from list_queues tool JSON."""
    if str(harness_skill or "") != "team-read":
        return None
    if "list_queues" not in turn_tools_called:
        if _llm_invented_list_table(text):
            intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
            return (
                intro
                or "I couldn't verify those team rows against the database. "
                "Try asking again and I'll reload from the team directory."
            )
        return None
    payload = dict(list_payload) if isinstance(list_payload, dict) else None
    if not payload:
        if _llm_invented_list_table(text):
            intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
            return (
                intro
                or "I couldn't verify those team rows against the database. "
                "Try asking again and I'll reload from the team directory."
            )
        return None
    rows = _queue_list_rows(payload.get("data") if isinstance(payload, dict) else payload)
    if not rows and isinstance(payload, dict):
        rows = _queue_list_rows(payload)
    intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
    team_query = str(payload.get("query") or "").strip() if isinstance(payload, dict) else ""
    listed_teams = [
        str(row.get("queueName") or row.get("name") or "").strip()
        for row in rows
        if str(row.get("queueName") or row.get("name") or "").strip()
    ]
    member_count = sum(len(_member_names_from_rows(row.get("members") or row.get("memberNames") or row.get("memberDetails"))) for row in rows)
    if not intro:
        if rows and not team_query:
            intro = "Here are the teams currently set up in your system:"
        elif not rows:
            intro = "No teams matched that request."
    phrase_context: dict[str, Any] = {
        "teamCount": len(rows),
        "totalRows": payload.get("totalRows") or len(rows),
    }
    validation_hint = None
    if team_query:
        phrase_context["listedTeams"] = listed_teams
        phrase_context["memberCount"] = member_count
        if len(listed_teams) == 1:
            phrase_context["teamName"] = listed_teams[0]
        validation_hint = (
            "The tool result is only Context.listedTeams. "
            "When Context.teamName is set, introduce that team's members and "
            "use Context.memberCount as the number of people. Do not mention other teams."
        )
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="team",
            kind="list",
            fallback="Introduce the team rows briefly; do not paste a table.",
            user_text=query,
            page_label=page or "Teams",
            context=phrase_context,
            validation_hint=validation_hint,
        )
        intro = _strip_html_table_from_text(
            _strip_markdown_table_lines(str(reply or "").strip())
        ) or intro
    except Exception:  # noqa: BLE001
        pass
    return _compose_team_list_reply_html(intro, payload)


def _ensure_ticket_list_cursor(memory: SharedMemory) -> None:
    """Rebuild a list cursor from last_tool_outcome when durable cursor was dropped."""
    cursor = memory.durable.get("ticket_list_cursor")
    if isinstance(cursor, dict) and cursor.get("offset") is not None:
        return
    last = memory.durable.get("last_tool_outcome")
    if not isinstance(last, dict):
        return
    if str(last.get("tool") or "") not in {"list_tickets", "portal_list_tickets"} or not last.get(
        "success"
    ):
        return
    payload = last.get("payload") if isinstance(last.get("payload"), dict) else {}
    args = last.get("arguments") if isinstance(last.get("arguments"), dict) else {}
    if not payload:
        return
    if (
        payload.get("hasMore") is None
        and payload.get("totalRows") is None
        and payload.get("rowCount") is None
        and payload.get("offset") is None
    ):
        return
    rows = payload.get("data") if isinstance(payload.get("data"), list) else []
    try:
        off = int(payload.get("offset") if payload.get("offset") is not None else args.get("offset") or 0)
        lim = int(payload.get("limit") or args.get("limit") or len(rows) or 12)
        shown = int(payload.get("rowCount") or len(rows) or lim)
        total = int(payload.get("totalRows") or (off + shown))
    except (TypeError, ValueError):
        return
    has_more = bool(payload.get("hasMore") or payload.get("truncated"))
    if not has_more:
        has_more = off + shown < total
    filters = {
        k: args.get(k)
        for k in (
            "scope",
            "created_by",
            "assigned_to",
            "status",
            "priority",
            "channel",
            "query",
            "queue",
            "customer",
            "due",
            "created_range",
            "updated_range",
            "sort",
        )
        if args.get(k) not in (None, "")
    }
    if payload.get("createdRange") and "created_range" not in filters:
        filters["created_range"] = payload.get("createdRange")
    if payload.get("updatedRange") and "updated_range" not in filters:
        filters["updated_range"] = payload.get("updatedRange")
    memory.durable["ticket_list_cursor"] = {
        "offset": off + shown,
        "pageSize": lim,
        "totalRows": total,
        "hasMore": has_more,
        "pendingPage": has_more,
        "filters": filters,
    }


def _ticket_list_has_remaining(cursor: Any) -> bool:
    if not isinstance(cursor, dict):
        return False
    if cursor.get("hasMore") or cursor.get("pendingPage") or cursor.get("truncated"):
        return True
    try:
        return int(cursor.get("totalRows") or 0) > int(cursor.get("offset") or 0)
    except (TypeError, ValueError):
        return False


def _ticket_list_page_pending(memory: SharedMemory) -> bool:
    cursor = memory.durable.get("ticket_list_cursor")
    if not isinstance(cursor, dict):
        return False
    return bool(cursor.get("pendingPage") and _ticket_list_has_remaining(cursor))


def _stash_ticket_list_cursor(
    memory: SharedMemory,
    payload: dict[str, Any],
    invoke_args: dict[str, Any],
) -> None:
    rows = _ticket_list_rows(payload)
    off = int(payload.get("offset") or 0)
    lim = int(payload.get("limit") or len(rows) or 12)
    shown = len(rows)
    try:
        total = int(payload.get("totalRows") or shown)
    except (TypeError, ValueError):
        total = shown
    has_more = bool(payload.get("hasMore")) or bool(payload.get("truncated"))
    if not has_more:
        has_more = off + shown < total
    filters = {
        k: invoke_args.get(k)
        for k in (
            "scope",
            "created_by",
            "assigned_to",
            "status",
            "priority",
            "channel",
            "query",
            "queue",
            "customer",
            "due",
            "created_range",
            "updated_range",
            "sort",
        )
        if invoke_args.get(k) not in (None, "")
    }
    if payload.get("createdRange") and "created_range" not in filters:
        filters["created_range"] = payload.get("createdRange")
    if payload.get("updatedRange") and "updated_range" not in filters:
        filters["updated_range"] = payload.get("updatedRange")
    memory.durable["ticket_list_cursor"] = {
        "offset": off + shown,
        "pageSize": lim,
        "totalRows": total,
        "hasMore": has_more,
        "pendingPage": has_more,
        "filters": filters,
    }


def _fetch_ticket_list_page(
    memory: SharedMemory,
    *,
    offset: int,
    limit: int,
) -> dict[str, Any] | None:
    from app.tools.catalog_tools import portal_list_tickets
    from app.tools.ticket_read import list_tickets

    cursor = memory.durable.get("ticket_list_cursor")
    filters = (
        dict(cursor.get("filters") or {})
        if isinstance(cursor, dict)
        else {}
    )
    portal_page = _is_portal_session(memory)
    invoke_args = (
        {"limit": limit, "offset": offset}
        if portal_page
        else {
            "scope": filters.get("scope"),
            "created_by": filters.get("created_by"),
            "assigned_to": filters.get("assigned_to"),
            "status": filters.get("status"),
            "priority": filters.get("priority"),
            "channel": filters.get("channel"),
            "query": filters.get("query"),
            "queue": filters.get("queue"),
            "customer": filters.get("customer"),
            "due": filters.get("due"),
            "created_range": filters.get("created_range"),
            "updated_range": filters.get("updated_range"),
            "sort": filters.get("sort"),
            "limit": limit,
            "offset": offset,
        }
    )
    tool_name = "portal_list_tickets" if portal_page else "list_tickets"
    with _memory_tool_actor_scope(memory):
        result = (
            portal_list_tickets(limit=limit, offset=offset)
            if portal_page
            else list_tickets(
                **{k: v for k, v in invoke_args.items() if v not in (None, "")}
            )
        )
    try:
        from app.observability.turn_log import record_tool

        record_tool(
            tool_name,
            {k: v for k, v in invoke_args.items() if v not in (None, "")},
            result,
            agent="ticket_lifecycle_executor",
        )
    except Exception:  # noqa: BLE001
        pass
    if not isinstance(result, dict) or not result.get("success"):
        return None
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else None
    if not payload:
        return None
    if portal_page:
        projected = _project_portal_ticket_list_payload(payload)
        payload = dict(projected) if isinstance(projected, dict) else payload
    _stash_ticket_list_cursor(memory, payload, {**filters, "limit": limit, "offset": offset})
    memory.durable["last_tool_outcome"] = {
        "tool": tool_name,
        "success": True,
        "payload": payload,
    }
    return payload


def _precreate_customer_list_key(draft: dict[str, Any]) -> str:
    email = str(draft.get("customerEmail") or draft.get("contact") or "").strip()
    if "@" in email:
        return email[:128]
    name = str(draft.get("customerName") or "").strip()
    return name[:128]


def _prefetch_precreate_customer_tickets(memory: SharedMemory) -> dict[str, Any] | None:
    """Load this customer's tickets for the create-path duplicate check (no UI table)."""
    draft = memory.durable.get("ticket_draft")
    if not isinstance(draft, dict):
        return None
    stamp = str(draft.get("precreate_duplicate_check") or "").strip().lower()
    issue = str(draft.get("issue") or draft.get("description") or "").strip()
    if not issue or not _ticket_directory_verified(draft):
        return None
    key = _precreate_customer_list_key(draft)
    if not key:
        return None
    evidence = draft.get("_precreate_duplicate_evidence")
    draft_oid = str(draft.get("orderId") or draft.get("order_id") or "").strip()
    if (
        stamp == "not_duplicate"
        and isinstance(evidence, dict)
        and str(evidence.get("issue") or "").strip() == issue
        and str(evidence.get("customer") or "").strip().lower() == key.lower()
        and str(evidence.get("orderId") or "").strip() == draft_oid
    ):
        return None
    from app.tools.ticket_read import list_tickets

    result = list_tickets(customer=key, scope="search", limit=20)
    if not isinstance(result, dict) or not result.get("success"):
        return None
    payload = result.get("payload")
    if isinstance(payload, list):
        rows = [row for row in payload if isinstance(row, dict)]
        total = len(rows)
    elif isinstance(payload, dict):
        rows = _ticket_list_rows(payload)
        try:
            total = int(payload.get("totalRows") or len(rows))
        except (TypeError, ValueError):
            total = len(rows)
    else:
        return None
    evidence_blob: dict[str, Any] = {
        "customer": key,
        "issue": issue,
    }
    if draft_oid:
        evidence_blob["orderId"] = draft_oid
    draft["_precreate_duplicate_evidence"] = evidence_blob
    memory.durable["ticket_draft"] = draft
    slim: list[dict[str, Any]] = []
    for row in rows[:20]:
        slim.append(
            {
                "id": row.get("id") or row.get("ticket_number") or row.get("ticketNumber"),
                "subject": row.get("subject"),
                "status": row.get("status"),
                "customerName": row.get("customerName") or row.get("customer_name"),
                "orderId": row.get("orderId") or row.get("order_id"),
                "productId": row.get("productId") or row.get("product_id"),
            }
        )
    return {
        "customer": key,
        "totalRows": total,
        "tickets": slim,
        "draftIssue": issue,
    }


def _prefetch_ticket_list_page(
    memory: SharedMemory,
    *,
    turn_tools_called: list[str],
) -> dict[str, Any] | None:
    if not _ticket_list_page_pending(memory):
        return None
    cursor = memory.durable.get("ticket_list_cursor")
    if not isinstance(cursor, dict):
        return None
    turn_tools_called.append("list_tickets")
    return _fetch_ticket_list_page(
        memory,
        offset=int(cursor.get("offset") or 0),
        limit=int(cursor.get("pageSize") or 12),
    )


def _append_tickets_navigate(ui_actions: list[dict[str, Any]] | None) -> None:
    if ui_actions is None:
        return
    if any(isinstance(a, dict) and a.get("type") == "navigate" for a in ui_actions):
        return
    ui_actions.append({"type": "navigate", "view": "assigned"})


def _ticket_list_ui_filters(
    payload: dict[str, Any],
    memory: SharedMemory,
) -> dict[str, Any]:
    """Facets the list tool actually used — never the user sentence."""
    cursor = memory.durable.get("ticket_list_cursor")
    cur = (
        dict(cursor.get("filters") or {})
        if isinstance(cursor, dict) and isinstance(cursor.get("filters"), dict)
        else {}
    )
    body = (
        dict(payload.get("filters") or {})
        if isinstance(payload.get("filters"), dict)
        else {}
    )
    raw = {**body, **cur}
    return _express_filters_from_sql_list(raw, [])


def _customer_list_ui_filters(
    payload: dict[str, Any],
    memory: SharedMemory,
) -> dict[str, Any]:
    cursor = memory.durable.get("customer_list_cursor")
    cur = (
        dict(cursor.get("filters") or {})
        if isinstance(cursor, dict) and isinstance(cursor.get("filters"), dict)
        else {}
    )
    out: dict[str, Any] = {}
    query = str(cur.get("query") or payload.get("query") or "").strip()
    email = str(cur.get("exact_email") or "").strip()
    phone = str(cur.get("exact_phone") or "").strip()
    if email:
        out["query"] = email
    elif phone:
        out["query"] = phone
    elif query:
        out["query"] = query
    status = cur.get("status")
    if status not in (None, ""):
        out["status"] = status
    return out


def _ticket_list_navigate_view(filters: dict[str, Any]) -> str:
    scope = str(filters.get("scope") or "").strip().lower()
    if scope in {"assignee", "assigned", "default"}:
        return "assigned"
    if scope in {"unassigned"}:
        return "unassigned"
    if scope in {"team", "team-inbox"}:
        return "team-inbox"
    return "tickets-list"


def _append_list_filter_ui_actions(
    ui_actions: list[dict[str, Any]] | None,
    *,
    module: str,
    filters: dict[str, Any],
    navigate_view: str,
) -> None:
    """Stamp the right-hand list from this turn's list TOOL args."""
    if ui_actions is None:
        return
    action: dict[str, Any] = {
        "type": "set_filter",
        "module": module,
        "query": str(filters.get("query") or "").strip(),
    }
    if module == "tickets":
        if filters.get("status") not in (None, ""):
            action["status"] = str(filters["status"])
        if filters.get("priority") not in (None, ""):
            action["priority"] = str(filters["priority"])
        if filters.get("channel") not in (None, ""):
            action["channel"] = str(filters["channel"])
        if filters.get("queue") not in (None, ""):
            action["queue"] = str(filters["queue"])
        assigned = filters.get("assigned_to")
        if assigned not in (None, ""):
            action["assignee"] = str(assigned)
        created = str(filters.get("created_by") or "").strip().lower()
        if created in {"me", "self"}:
            action["creator"] = "me"
    elif module == "customers":
        if filters.get("status") not in (None, ""):
            action["status"] = str(filters["status"])
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and a.get("type") == "set_filter"
            and a.get("module") == module
        )
    ]
    ui_actions.append(action)
    if not any(
        isinstance(a, dict) and a.get("type") == "navigate" for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": navigate_view})


def _ticket_list_open_page_reply(query: str, page: str | None) -> str:
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="ticket",
            kind="filter",
            fallback=(
                "I don't have another verified page from the database in this turn. "
                "Open the Tickets page to browse the full list."
            ),
            user_text=query,
            page_label=page or "Tickets",
            context={
                "ticketList": False,
                "openTicketsPage": True,
            },
        )
        intro = _strip_html_table_from_text(
            _strip_markdown_table_lines(str(reply or "").strip())
        )
        if intro:
            return intro
    except Exception:  # noqa: BLE001
        pass
    return (
        "I don't have another verified page from the database in this turn. "
        "Open the Tickets page on the right to browse the full list."
    )


def _hide_ticket_list_table(harness_skill: str | None) -> bool:
    """Create-ticket uses list_tickets as a private duplicate check, not a browse table."""
    return str(harness_skill or "") == "ticket-create"


def _ground_ticket_list_reply(
    text: str | None,
    *,
    list_payload: dict[str, Any] | None,
    turn_tools_called: list[str],
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]] | None,
    harness_skill: str | None,
    query: str,
    page: str | None,
) -> str | None:
    """Build ticket list tables only from list_tickets tool JSON."""
    if _hide_ticket_list_table(harness_skill):
        return None
    listed = (
        "list_tickets" in turn_tools_called
        or "ask_sql_layer" in turn_tools_called
        or "portal_list_tickets" in turn_tools_called
    )
    if str(harness_skill or "") != "ticket-read-search" and not listed:
        return None
    payload = dict(list_payload) if isinstance(list_payload, dict) else None
    if payload and "portal_list_tickets" in turn_tools_called:
        projected = _project_portal_ticket_list_payload(payload)
        payload = dict(projected) if isinstance(projected, dict) else payload
    invented = _llm_invented_list_table(text)
    cursor = memory.durable.get("ticket_list_cursor")
    needs_next = "list_tickets" not in turn_tools_called and (
        _ticket_list_page_pending(memory)
        or (invented and _ticket_list_has_remaining(cursor))
    )
    if not payload and needs_next:
        if isinstance(cursor, dict):
            portal_page = _is_portal_session(memory)
            payload = _fetch_ticket_list_page(
                memory,
                offset=int(cursor.get("offset") or 0),
                limit=int(cursor.get("pageSize") or (10 if portal_page else 12)),
            )
            if payload:
                turn_tools_called.append(
                    "portal_list_tickets" if portal_page else "list_tickets"
                )
    if not payload:
        if invented:
            _append_tickets_navigate(ui_actions)
            return _ticket_list_open_page_reply(query, page)
        return None
    rows = _ticket_list_rows(payload)
    if not _is_portal_session(memory):
        list_filters = _ticket_list_ui_filters(payload, memory)
        _append_list_filter_ui_actions(
            ui_actions,
            module="tickets",
            filters=list_filters,
            navigate_view=_ticket_list_navigate_view(list_filters),
        )
    intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
    if not intro:
        rng = str(payload.get("createdRange") or payload.get("updatedRange") or "").strip()
        if rows:
            suffix = f" for {rng.replace('_', ' ')}" if rng else ""
            intro = f"Here are the ticket records{suffix}:"
        else:
            intro = "No tickets matched that request."
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="ticket",
            kind="filter",
            fallback="Introduce the ticket rows briefly; do not paste a table.",
            user_text=query,
            page_label=page or "Tickets",
            context={
                "ticketList": True,
                "listCount": len(rows),
                "totalCount": payload.get("totalRows") or len(rows),
                "offset": payload.get("offset"),
                "createdRange": payload.get("createdRange"),
                "updatedRange": payload.get("updatedRange"),
                "hasMore": payload.get("hasMore"),
            },
        )
        intro = _strip_html_table_from_text(
            _strip_markdown_table_lines(str(reply or "").strip())
        ) or intro
    except Exception:  # noqa: BLE001
        pass
    return _compose_ticket_list_reply_html(intro, payload)


def _customer_360_consent_pending(memory: SharedMemory) -> bool:
    cand = memory.durable.get("customer_360_candidate")
    if not isinstance(cand, dict):
        return False
    if not cand.get("awaiting_consent"):
        return False
    return bool(str(cand.get("email") or "").strip())


def _customer_360_prompt_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    tickets = payload.get("tickets") if isinstance(payload.get("tickets"), list) else []
    slim_tickets: list[dict[str, Any]] = []
    for row in tickets[:25]:
        if not isinstance(row, dict):
            continue
        slim_tickets.append(
            {
                "id": row.get("id"),
                "subject": row.get("subject"),
                "status": row.get("status"),
                "priority": row.get("priority"),
                "assignee": row.get("assignee"),
                "csatScore": row.get("csatScore"),
                "createdAt": row.get("createdAt"),
            }
        )
    return {
        "email": payload.get("email"),
        "totalTickets": payload.get("totalTickets"),
        "avgCsat": payload.get("avgCsat"),
        "ratingsCount": payload.get("ratingsCount"),
        "tickets": slim_tickets,
    }


def _prefetch_customer_360_on_consent(
    memory: SharedMemory,
    *,
    turn_tools_called: list[str],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Call get_customer_360 before the Executor loop when 360 consent is pending."""
    if not _customer_360_consent_pending(memory):
        return None, None
    cand = memory.durable.get("customer_360_candidate")
    email = str((cand or {}).get("email") or "").strip() if isinstance(cand, dict) else ""
    if not email:
        return None, None
    turn_tools_called.append("get_customer_360")
    return _fetch_customer_360_payload(memory, email)


def _stash_customer_360_candidate(
    memory: SharedMemory,
    payload: dict[str, Any],
) -> None:
    """Pin a single directory match for the next 360 consent turn (tool JSON only)."""
    rows = [
        r
        for r in (payload.get("data") if isinstance(payload.get("data"), list) else [])
        if isinstance(r, dict)
    ]
    if len(rows) != 1:
        cand = memory.durable.get("customer_360_candidate")
        if isinstance(cand, dict) and len(rows) != 1:
            cleared = dict(cand)
            cleared["awaiting_consent"] = False
            memory.durable["customer_360_candidate"] = cleared
        return
    hit = next(
        (
            r
            for r in rows
            if str(
                _customer_row_field(r, "email", "customer_email", "customerEmail") or ""
            ).strip()
        ),
        None,
    )
    if not hit:
        return
    memory.durable["customer_360_candidate"] = {
        "email": str(
            _customer_row_field(hit, "email", "customer_email", "customerEmail") or ""
        ).strip(),
        "name": str(
            _customer_row_field(hit, "name", "customer_name", "customerName") or ""
        ).strip(),
        "customerId": str(
            hit.get("id") or hit.get("customerId") or hit.get("customer_id") or ""
        ).strip(),
        "awaiting_consent": True,
    }


def _mark_customer_360_resolved(memory: SharedMemory, *, success: bool) -> None:
    cand = memory.durable.get("customer_360_candidate")
    if not isinstance(cand, dict):
        return
    updated = dict(cand)
    if success:
        updated["awaiting_consent"] = False
        updated["loaded"] = True
    memory.durable["customer_360_candidate"] = updated


def _fetch_customer_360_payload(
    memory: SharedMemory,
    email: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    from app.tools.catalog_tools import get_customer_360

    em = str(email or "").strip()
    if not em:
        return None, None
    with _memory_tool_actor_scope(memory):
        result = get_customer_360(email=em)
    if isinstance(result, dict) and result.get("success"):
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
        if payload:
            memory.durable["last_tool_outcome"] = {
                "tool": "get_customer_360",
                "success": True,
                "payload": payload,
            }
            _stash_customer_360_ticket_roster(memory, payload)
            _mark_customer_360_resolved(memory, success=True)
            return dict(payload), None
    if isinstance(result, dict):
        memory.durable["last_tool_outcome"] = {
            "tool": "get_customer_360",
            "success": False,
            "error_code": result.get("error_code"),
            "message": result.get("message"),
        }
        _mark_customer_360_resolved(memory, success=False)
        return None, result
    return None, None


def _stash_customer_360_ticket_roster(
    memory: SharedMemory,
    payload: dict[str, Any],
) -> None:
    """Pin ticket ids/status from get_customer_360 for follow-up reopen/resolve in chat."""
    tickets = payload.get("tickets") if isinstance(payload.get("tickets"), list) else []
    rows: list[dict[str, str]] = []
    for row in tickets:
        if not isinstance(row, dict):
            continue
        tid = str(row.get("id") or "").strip()
        if not tid:
            continue
        rows.append(
            {
                "id": tid,
                "status": str(row.get("status") or "").strip(),
                "subject": str(row.get("subject") or "").strip(),
            }
        )
    if rows:
        memory.durable["last_customer_360_tickets"] = rows
        if len(rows) == 1:
            hit = rows[0]
            memory.durable["last_entity"] = {
                "type": "ticket",
                "id": hit["id"],
                "name": hit.get("subject") or hit["id"],
                "status": hit.get("status") or "",
            }


def _build_customer_360_html_table(payload: dict[str, Any]) -> str:
    import html as html_module

    tickets = (
        payload.get("tickets") if isinstance(payload.get("tickets"), list) else []
    )

    def _cell(raw: Any) -> str:
        text = str(raw or "").strip()
        return html_module.escape(text if text else "—")

    head = (
        "<thead><tr>"
        "<th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th>"
        "<th>Assignee</th><th>CSAT</th><th>Created</th>"
        "</tr></thead>"
    )
    body_rows: list[str] = []
    for row in tickets:
        if not isinstance(row, dict):
            continue
        csat = row.get("csatScore")
        csat_text = f"{csat}/5" if csat is not None else "—"
        body_rows.append(
            "<tr>"
            f"<td>{_cell(row.get('id'))}</td>"
            f"<td>{_cell(row.get('subject'))}</td>"
            f"<td>{_cell(row.get('status'))}</td>"
            f"<td>{_cell(row.get('priority'))}</td>"
            f"<td>{_cell(row.get('assignee'))}</td>"
            f"<td>{html_module.escape(csat_text)}</td>"
            f"<td>{_cell(row.get('createdAt'))}</td>"
            "</tr>"
        )
    if not body_rows:
        return ""
    return (
        '<table class="coworker-data-table">'
        f"{head}<tbody>{''.join(body_rows)}</tbody></table>"
    )


def _customer_360_summary_note(payload: dict[str, Any]) -> str:
    total = int(payload.get("totalTickets") or 0)
    avg = payload.get("avgCsat")
    ratings = int(payload.get("ratingsCount") or 0)
    parts: list[str] = [f"{total} ticket{'s' if total != 1 else ''}"]
    if avg is not None:
        parts.append(f"avg CSAT {avg}/5 ({ratings} rating{'s' if ratings != 1 else ''})")
    elif ratings:
        parts.append(f"{ratings} CSAT rating{'s' if ratings != 1 else ''}")
    return f"<p><em>{', '.join(parts)} from the database.</em></p>"


def _compose_customer_360_reply_html(intro: str, payload: dict[str, Any]) -> str:
    table = _build_customer_360_html_table(payload)
    summary = _customer_360_summary_note(payload)
    parts = [p for p in [intro.strip(), summary, table] if p]
    total = int(payload.get("totalTickets") or 0)
    if not table and total <= 0:
        parts.append("<p><em>No tickets on record for this customer email.</em></p>")
    return "\n".join(parts)


def _ground_customer_360_reply(
    text: str | None,
    *,
    c360_payload: dict[str, Any] | None,
    c360_error: dict[str, Any] | None = None,
    turn_tools_called: list[str],
    memory: SharedMemory,
    harness_skill: str | None,
    query: str,
    page: str | None,
    ui_actions: list[dict[str, Any]] | None = None,
) -> str | None:
    """Build customer 360 views only from get_customer_360 tool JSON."""
    consent_pending = _customer_360_consent_pending(memory)
    c360_turn = "get_customer_360" in turn_tools_called
    listed_this_turn = (
        "list_customers" in turn_tools_called or "ask_sql_layer" in turn_tools_called
    )
    if (
        str(harness_skill or "") != "customer-read-360"
        and not consent_pending
        and not c360_turn
    ):
        return None

    payload = dict(c360_payload) if isinstance(c360_payload, dict) else None
    tool_err_result: dict[str, Any] | None = (
        dict(c360_error) if isinstance(c360_error, dict) else None
    )
    if not payload and not tool_err_result and c360_turn:
        last = memory.durable.get("last_tool_outcome")
        if (
            isinstance(last, dict)
            and last.get("tool") == "get_customer_360"
            and not last.get("success")
        ):
            tool_err_result = {
                "error_code": last.get("error_code"),
                "message": last.get("message"),
            }
    # Same-turn directory list is the 360 offer. Do not fetch 360 or treat the
    # runtime directory table as invented ticket history.
    if listed_this_turn and not c360_turn and not payload and not tool_err_result:
        return None
    cand = memory.durable.get("customer_360_candidate")
    needs_fetch = (
        not c360_turn
        and not listed_this_turn
        and consent_pending
        and str((cand or {}).get("email") or "").strip()
        if isinstance(cand, dict)
        else False
    )
    invented_table = (
        not c360_turn
        and not listed_this_turn
        and _llm_invented_list_table(text)
    )

    if not payload and (needs_fetch or invented_table):
        email = ""
        if isinstance(cand, dict):
            email = str(cand.get("email") or "").strip()
        if email:
            payload, tool_err_result = _fetch_customer_360_payload(memory, email)

    if tool_err_result and not payload:
        code = str(tool_err_result.get("error_code") or "").upper()
        message = str(tool_err_result.get("message") or "").strip()
        try:
            from app.tasks.phrase import phrase_reply

            reply = phrase_reply(
                module="customer",
                kind="validation",
                fallback=(
                    "Explain the customer 360 lookup failed using Context.error only; "
                    "do not invent ticket rows."
                ),
                user_text=query,
                page_label=page or "Customers",
                context={
                    "error": message or code or "lookup failed",
                    "errorCode": code,
                    "customer360Failed": True,
                },
            )
            intro = _strip_html_table_from_text(
                _strip_markdown_table_lines(str(reply or "").strip())
            )
            if intro:
                return intro
        except Exception:  # noqa: BLE001
            pass
        if message:
            return message
        return (
            "I couldn't load the customer 360 view from the database. "
            "Please try again in a moment."
        )

    if not payload:
        if invented_table:
            intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
            return (
                intro
                or "I couldn't verify that ticket history against the database. "
                "I'll reload it from the customer 360 API when you ask again."
            )
        return None

    intro = _strip_html_table_from_text(_strip_markdown_table_lines(text))
    if not intro:
        total = int(payload.get("totalTickets") or 0)
        email = str(payload.get("email") or "").strip()
        if total > 0:
            intro = f"Here is the ticket history for {email or 'this customer'}:"
        else:
            intro = f"No tickets on record for {email or 'this customer'}."

    try:
        from app.tasks.phrase import phrase_reply

        tickets = payload.get("tickets") if isinstance(payload.get("tickets"), list) else []
        reply = phrase_reply(
            module="customer",
            kind="filter",
            fallback=(
                "Introduce the customer 360 snapshot briefly using only Context fields; "
                "do not paste a table."
            ),
            user_text=query,
            page_label=page or "Customers",
            context={
                "customer360": True,
                "email": payload.get("email"),
                "totalTickets": payload.get("totalTickets"),
                "avgCsat": payload.get("avgCsat"),
                "ratingsCount": payload.get("ratingsCount"),
                "ticketCount": len(tickets),
            },
        )
        intro = _strip_html_table_from_text(
            _strip_markdown_table_lines(str(reply or "").strip())
        ) or intro
    except Exception:  # noqa: BLE001
        pass

    cand = memory.durable.get("customer_360_candidate")
    if isinstance(cand, dict):
        _append_open_customer_profile(
            ui_actions,
            memory,
            customer_id=str(cand.get("customerId") or ""),
            name=str(cand.get("name") or ""),
            email=str(payload.get("email") or cand.get("email") or ""),
        )
    else:
        _append_open_customer_profile(
            ui_actions,
            memory,
            email=str(payload.get("email") or ""),
        )
    return _compose_customer_360_reply_html(intro, payload)


_ANALYTICS_EXPORT_RANGE_LABELS = {
    "24hours": "the last 24 hours",
    "7days": "the last 7 days",
    "30days": "the last 30 days",
}


def _strip_analytics_export_link_noise(text: str | None) -> str:
    """Remove markdown links and raw export hrefs the model must not show in chat."""
    import re

    t = str(text or "").strip()
    if not t:
        return ""
    t = re.sub(r"\[([^\]]*)\]\([^)]+\)", r"\1", t)
    t = re.sub(r"/api/analytics/export\S*", "", t)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t


def _ground_export_analytics_reply(
    _text: str | None,
    *,
    export_payload: dict[str, Any] | None,
    query: str,
    page: str | None,
) -> str | None:
    """Replace raw markdown export links with a grounded natural reply."""
    if not isinstance(export_payload, dict) or not export_payload:
        return None
    rng = str(export_payload.get("range") or "7days").strip() or "7days"
    range_label = _ANALYTICS_EXPORT_RANGE_LABELS.get(rng, rng)
    grounded = (
        f"Your analytics export for {range_label} is ready — "
        "the CSV download should start automatically."
    )
    try:
        from app.tasks.phrase import phrase_reply

        reply = phrase_reply(
            module="admin",
            kind="filter",
            fallback=(
                "Tell them the analytics export is ready and the download starts "
                "automatically. Do not paste links or CSV."
            ),
            user_text=query,
            page_label=page or "Analytics",
            context={
                "export": True,
                "range": rng,
                "rangeLabel": range_label,
            },
        )
        reply = _strip_analytics_export_link_noise(str(reply or "").strip())
        if reply:
            return reply
    except Exception:  # noqa: BLE001
        pass
    return grounded


def _append_export_analytics_download(
    result: dict[str, Any],
    ui_actions: list[dict[str, Any]],
) -> None:
    """Mirror legacy workflow_manager export: structured download + analytics refresh."""
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    href = str(payload.get("href") or "").strip()
    if not href.startswith("/api/analytics/export"):
        return
    rng = str(payload.get("range") or "7days").strip() or "7days"
    filename = f"worktual-analytics-{rng}.csv"
    if not any(
        isinstance(a, dict) and a.get("type") == "download" and a.get("href") == href
        for a in ui_actions
    ):
        ui_actions.append({"type": "download", "href": href, "filename": filename})
    if not any(
        isinstance(a, dict) and a.get("type") == "refresh_analytics" for a in ui_actions
    ):
        ui_actions.append({"type": "refresh_analytics"})


def _merge_enrich_into_draft(
    memory: SharedMemory,
    result: dict[str, Any],
    ui_actions: list[dict[str, Any]],
) -> None:
    """Apply triage enrich payload into ticket_draft + UI (old confirm preview)."""
    payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}
    if not payload:
        return
    draft = dict(memory.durable.get("ticket_draft") or {})
    for key in (
        "customerName",
        "customerEmail",
        "customerPhone",
        "contact",
        "issue",
        "subject",
        "description",
        "priority",
        "queue",
        "category",
        "skill",
        "assignee",
        "assigneeId",
        "resolver",
        "resolverId",
        "resolver_confidence",
        "resolverConfidence",
        "confidence",
        "rationale",
        "channel",
        "enrichedByAi",
        "enriched",
    ):
        if key in payload and payload[key] not in (None, ""):
            draft[key] = payload[key]
    draft["awaiting"] = "confirm"
    draft["step"] = "confirm"
    draft["enriched"] = True
    memory.durable["ticket_draft"] = draft
    memory.durable["current_workflow"] = "create_ticket"
    memory.durable["pending_ask"] = "confirm"
    slots = dict(memory.durable.get("slots") or {})
    slots.update({k: v for k, v in draft.items() if k not in {"awaiting", "step"}})
    memory.durable["slots"] = slots
    if not any(
        isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == "create-ticket"
        for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": "create-ticket"})
    ui_actions.append(
        {
            "type": "create_ticket",
            **draft,
            "step": "confirm",
            "awaiting": "confirm",
            "enriched": True,
        }
    )


def _park_other_active_drafts(
    memory: SharedMemory,
    *,
    keep_workflow: str,
) -> None:
    """Park sibling guided drafts when switching workflows (native side-quest)."""
    from app.memory_contract import park_flows

    active: dict[str, dict[str, Any]] = {}
    for draft_key, workflow_id, _nav in _DRAFT_TOOL_SPEC.values():
        blob = memory.durable.get(draft_key)
        if not isinstance(blob, dict):
            continue
        has_signal = bool(str(blob.get("awaiting") or blob.get("step") or "").strip()) or any(
            str(v).strip()
            for k, v in blob.items()
            if k not in {"awaiting", "step"} and not isinstance(v, (dict, list))
        )
        if not has_signal:
            continue
        active[workflow_id] = dict(blob)

    if not active:
        return

    existing = memory.durable.get("parked_drafts")
    parked = park_flows(
        active,
        except_flows={keep_workflow},
        existing_parked=existing if isinstance(existing, list) else None,
    )
    memory.durable["parked_drafts"] = parked
    for draft_key, workflow_id, _nav in _DRAFT_TOOL_SPEC.values():
        if workflow_id == keep_workflow:
            continue
        memory.durable.pop(draft_key, None)


def _member_names_from_rows(rows: Any) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    if not isinstance(rows, list):
        return names
    for row in rows:
        if isinstance(row, dict):
            n = str(row.get("name") or row.get("displayName") or "").strip()
        else:
            n = str(row or "").strip()
        if not n:
            continue
        key = n.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(n)
    return names


def _stash_reassign_from_resolve_person(
    memory: SharedMemory,
    result: dict[str, Any],
    *,
    query: str = "",
) -> None:
    """Seed reassign_draft from resolve_ticket_person so person picks bind + write."""
    payload = _tool_payload_dict(result)
    people = payload.get("person_data")
    if not isinstance(people, list):
        people = []
    names: list[str] = []
    roles: dict[str, str] = {}
    ids: dict[str, str] = {}
    for row in people:
        if not isinstance(row, dict):
            continue
        n = str(
            row.get("person_name") or row.get("name") or row.get("displayName") or ""
        ).strip()
        if not n:
            continue
        names.append(n)
        role = str(row.get("role") or row.get("target_role") or "").strip().lower()
        if role in {"agent", "resolver", "admin"}:
            roles[n] = "agent" if role == "admin" else role
        pid = str(row.get("person_id") or row.get("id") or "").strip()
        if pid and n:
            ids[pid] = n
    tn = str(
        payload.get("ticket_number")
        or payload.get("ticketNumber")
        or ""
    ).strip()
    if not tn:
        ent = memory.durable.get("last_entity")
        if isinstance(ent, dict):
            tn = str(
                ent.get("ticket_number")
                or ent.get("ticketNumber")
                or ent.get("id")
                or ""
            ).strip()
    role = str(payload.get("target_role") or "").strip().lower()
    if role not in {"agent", "resolver"}:
        role = ""
    draft = memory.durable.get("reassign_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    if tn:
        draft["ticket_number"] = tn if tn.startswith("#") or not tn.lstrip("#").isdigit() else f"#{tn.lstrip('#')}"
    if role:
        draft["target_role"] = role
    if names:
        draft["available_members"] = names
        draft["roster_roles"] = roles
    if ids:
        draft["roster_ids"] = ids
    suggested = payload.get("suggested_person")
    suggested = suggested if isinstance(suggested, dict) else {}
    suggested_name = str(
        suggested.get("person_name") or suggested.get("name") or ""
    ).strip()
    suggested_id = str(
        suggested.get("person_id") or suggested.get("id") or ""
    ).strip()
    proceed = payload.get("proceed")
    proceed_ok = str(proceed or "").strip().lower() in {"1", "true", "yes"}
    tool_query = str(payload.get("user_query") or query or "").strip()
    from app.workflow_schemas import person_from_user_text

    named = person_from_user_text(tool_query, names, allow_fuzzy=False) if names else None
    if (
        suggested_name
        and suggested_name in names
        and (proceed_ok or named == suggested_name)
        and not str(draft.get("person") or "").strip()
    ):
        draft["person"] = suggested_name
        if suggested_id:
            draft["person_id"] = suggested_id
        draft["roster_role"] = str(suggested.get("role") or role or "").strip()
    from app.workflow_schemas import enforce_reassign_draft_roles

    draft = enforce_reassign_draft_roles(draft)
    # Keep an in-progress person pick; otherwise advance to the next missing slot.
    awaiting = str(draft.get("awaiting") or "").strip().lower()
    if (
        str(draft.get("person") or "").strip()
        and str(draft.get("ticket_number") or "").strip()
        and str(draft.get("target_role") or "").strip()
    ):
        draft["awaiting"] = "confirm"
        draft["step"] = "confirm"
    elif awaiting not in {"confirm", "person", "target_role"}:
        if not str(draft.get("ticket_number") or "").strip():
            draft["awaiting"] = "ticket"
        elif not str(draft.get("target_role") or "").strip() and role:
            draft["awaiting"] = "person"
        elif not str(draft.get("target_role") or "").strip():
            # Both columns listed — pick person first; role inferred from roster.
            draft["awaiting"] = "person"
        elif not str(draft.get("person") or "").strip():
            draft["awaiting"] = "person"
        else:
            draft["awaiting"] = "confirm"
    elif awaiting == "ticket" and str(draft.get("ticket_number") or "").strip():
        draft["awaiting"] = "person" if names else "target_role"
    draft["step"] = draft.get("awaiting") or "person"
    draft["flow"] = "reassign"
    draft["workflow"] = "reassign_ticket"
    memory.durable["reassign_draft"] = draft
    memory.durable["current_workflow"] = "reassign_ticket"
    if str(query or "").strip():
        # Don't overwrite a typed person this turn — absorb owns that.
        pass


def _fetch_kb_category_names() -> list[str]:
    """Category labels from this turn's list_kb / list_kb_categories (Postgres)."""
    try:
        from app.tools.catalog_tools import list_kb_categories

        result = list_kb_categories()
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    cats: list[str] = []
    if isinstance(payload, dict):
        raw = payload.get("categories") or payload.get("data") or []
        if isinstance(raw, list):
            cats = [str(c).strip() for c in raw if str(c).strip()]
    elif isinstance(payload, list):
        cats = [str(c).strip() for c in payload if str(c).strip()]
    return cats


def _kb_draft_category_names(draft: dict[str, Any] | None) -> list[str]:
    blob = draft if isinstance(draft, dict) else {}
    raw = blob.get("available_categories") or blob.get("availableCategories") or []
    if not isinstance(raw, list):
        return []
    return [str(item).strip() for item in raw if str(item).strip()]


def _ensure_kb_categories_on_draft(draft: dict[str, Any]) -> list[str]:
    """Ensure kb_draft.available_categories is populated; return the list."""
    existing = _kb_draft_category_names(draft)
    if existing:
        draft["available_categories"] = existing
        return existing
    cats = _fetch_kb_category_names()
    draft["available_categories"] = cats
    return cats


def _kb_create_category_turn_hint(query: str, cats: list[str]) -> str:
    """Ask for a pick vs patch this turn. Schema bind only — not Skill routing."""
    from app.workflow_schemas import bind_awaiting_value

    picked = bind_awaiting_value("create_kb", "category", query)
    if str((picked or {}).get("category") or "").strip():
        return (
            " This utterance is the category for the live kb_draft. "
            "Call patch_kb_draft with that category this turn. "
            "Do not call list_kb_categories again."
        )
    return (
        " For knowledge-article-create while awaiting category: the "
        "list_kb_categories TOOL RESULT below is Postgres. Put each "
        "name on its own line so they can choose — not a comma list, "
        "not or Other. Do not invent names. Then ask them to pick a "
        "line or type a new short name."
        + (
            "\n## KB categories tool result (authoritative Postgres)\n"
            + json.dumps(
                {"categories": cats, "count": len(cats)},
                ensure_ascii=False,
            )
            if cats
            else " list_kb_categories is empty — say none are on file yet."
        )
    )


def _prefetch_kb_categories_for_collect(
    memory: SharedMemory,
    *,
    turn_tools_called: list[str] | None = None,
) -> list[str]:
    """TaskState: load list_kb_categories onto kb_draft while awaiting category.

    Not utterance matching — same pattern as ticket_list_cursor prefetch.
    """
    draft = memory.durable.get("kb_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    if str(draft.get("awaiting") or "").strip().lower() != "category":
        return _kb_draft_category_names(draft)
    called = {str(name or "").strip() for name in (turn_tools_called or [])}
    if "list_kb_categories" in called and _kb_draft_category_names(draft):
        return _kb_draft_category_names(draft)
    cats = _ensure_kb_categories_on_draft(draft)
    memory.durable["kb_draft"] = draft
    return cats


def _stash_kb_categories_from_list(memory: SharedMemory, result: dict[str, Any]) -> None:
    draft = memory.durable.get("kb_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    payload = result.get("payload") if isinstance(result, dict) else None
    cats: list[str] = []
    if isinstance(payload, dict):
        raw = payload.get("categories") or payload.get("data") or []
        if isinstance(raw, list):
            cats = [str(c).strip() for c in raw if str(c).strip()]
    if cats:
        draft["available_categories"] = cats
        memory.durable["kb_draft"] = draft


def _eligible_staff_names(all_names: list[str], current_names: list[str]) -> list[str]:
    taken = {str(n).strip().lower() for n in current_names if str(n).strip()}
    return [n for n in all_names if str(n).strip().lower() not in taken]


def _team_member_validation_roster(draft: dict[str, Any]) -> list[str]:
    """Canonical names the LLM may patch: org staff plus people already on the team.

    Add-members keeps available_members as eligible-only. Remove/replace patches the
    remaining roster, who are current members — they must still validate.
    """
    names: list[str] = []
    seen: set[str] = set()
    for key in (
        "org_staff",
        "available_members",
        "availableMembers",
        "current_members",
        "existing_members",
    ):
        raw = draft.get(key)
        if not isinstance(raw, list):
            continue
        for item in raw:
            name = str(item).strip()
            key_l = name.lower()
            if not name or key_l in seen:
                continue
            seen.add(key_l)
            names.append(name)
    return names


def _is_add_members_draft(draft: dict[str, Any]) -> bool:
    flow = str(draft.get("flow") or draft.get("workflow") or "").strip().lower()
    return flow in {"add_team_members", "add_members"}


def _stash_current_team_members_from_list_queues(
    memory: SharedMemory, result: dict[str, Any]
) -> None:
    """Remember who is already on the chosen team so add-members lists eligible staff only."""
    draft = memory.durable.get("team_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    if not draft or not _is_add_members_draft(draft):
        current_wf = str(memory.durable.get("current_workflow") or "").strip().lower()
        if current_wf not in {"add_team_members", "add_members"}:
            return
    payload = result.get("payload")
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = (
            payload.get("data")
            or payload.get("queues")
            or payload.get("items")
            or payload.get("rows")
            or []
        )
        if not rows and (payload.get("id") or payload.get("queueName") or payload.get("name")):
            rows = [payload]
    if not isinstance(rows, list):
        return
    from app.tools.catalog_tools import catalog_row_id_usable

    want_id = str(draft.get("id") or draft.get("queue_id") or "").strip().lower()
    want_name = str(draft.get("team") or draft.get("name") or "").strip().lower()
    match: dict[str, Any] | None = None
    if want_name:
        for row in rows:
            if not isinstance(row, dict):
                continue
            rname = str(row.get("queueName") or row.get("name") or "").strip().lower()
            if rname == want_name:
                match = row
                break
    if match is None and catalog_row_id_usable(want_id):
        for row in rows:
            if not isinstance(row, dict):
                continue
            rid = str(row.get("id") or row.get("queueId") or "").strip().lower()
            if rid == want_id:
                match = row
                break
    if match is None and want_id and not catalog_row_id_usable(want_id):
        for row in rows:
            if not isinstance(row, dict):
                continue
            rname = str(row.get("queueName") or row.get("name") or "").strip().lower()
            if rname == want_id:
                match = row
                break
    if match is None and len(rows) == 1 and isinstance(rows[0], dict):
        match = rows[0]
    if not match:
        return
    _pin_add_members_team_row(memory, draft, match)
    current = _member_names_from_rows(match.get("members") or match.get("memberNames"))
    if not current:
        memory.durable["team_draft"] = draft
        return
    draft["current_members"] = current
    roster = draft.get("available_members")
    if isinstance(roster, list) and roster:
        draft["available_members"] = _eligible_staff_names(
            [str(n).strip() for n in roster if str(n).strip()], current
        )
    memory.durable["team_draft"] = draft


def _stash_team_roster_from_list_agents(
    memory: SharedMemory, result: dict[str, Any]
) -> None:
    """Keep create-team roster in draft for exact member validation (no fuzzy rewrite)."""
    payload = result.get("payload")
    rows: list[Any] = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = (
            payload.get("data")
            or payload.get("agents")
            or payload.get("items")
            or payload.get("rows")
            or []
        )
    names = _member_names_from_rows(rows)
    ids = [
        str(row.get("id") or "").strip()
        for row in rows
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    ]
    if not names:
        return
    draft = memory.durable.get("team_draft")
    draft = dict(draft) if isinstance(draft, dict) else {}
    draft["org_staff"] = list(names)
    current = draft.get("current_members") or draft.get("existing_members")
    current_list = (
        [str(n).strip() for n in current if str(n).strip()]
        if isinstance(current, list)
        else []
    )
    if current_list and _is_add_members_draft(draft):
        names = _eligible_staff_names(names, current_list)
    draft["available_members"] = names
    if ids:
        draft["available_member_ids"] = ids
    memory.durable["team_draft"] = draft


def _exact_roster_member_names(
    raw_members: Any, roster: list[str]
) -> tuple[list[str] | None, list[str]]:
    """Map members to roster by exact name or unique first-token; typos stay unresolved."""
    from app.workflow_schemas import (
        looks_like_field_edit_instruction,
        person_from_user_text,
    )

    if not isinstance(raw_members, list):
        if isinstance(raw_members, str) and raw_members.strip():
            raw_list = [raw_members.strip()]
        else:
            return None, ["(empty)"]
    else:
        raw_list = [str(m).strip() for m in raw_members if str(m).strip()]
    if not raw_list:
        return None, ["(empty)"]
    by_lower = {str(n).strip().lower(): str(n).strip() for n in roster if str(n).strip()}
    canonical: list[str] = []
    unresolved: list[str] = []
    seen: set[str] = set()
    for item in raw_list:
        if looks_like_field_edit_instruction(item):
            continue
        hit = by_lower.get(item.lower())
        if not hit:
            hit = person_from_user_text(
                item,
                roster,
                allow_fuzzy=False,
                allow_substring=False,
            )
        if not hit:
            unresolved.append(item)
            continue
        key = hit.lower()
        if key in seen:
            continue
        seen.add(key)
        canonical.append(hit)
    if unresolved:
        return None, unresolved
    if not canonical:
        return None, ["(empty)"]
    return canonical, []


def _execute_local_ui_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]],
) -> dict[str, Any]:
    if name == "navigate":
        view = str(arguments.get("view") or "").strip()
        if not view:
            return {
                "success": False,
                "error_code": "INVALID_ARGS",
                "message": "navigate requires view",
            }
        if not any(
            isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == view
            for a in ui_actions
        ):
            ui_actions.append({"type": "navigate", "view": view})
        return {"success": True, "payload": {"view": view}}

    if name == "open_customer_import":
        if not any(
            isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == "customers"
            for a in ui_actions
        ):
            ui_actions.append({"type": "navigate", "view": "customers"})
        if not any(
            isinstance(a, dict) and a.get("type") == "open_customer_import"
            for a in ui_actions
        ):
            ui_actions.append({"type": "open_customer_import", "needsFile": True})
        return {
            "success": True,
            "payload": {
                "needsFile": True,
                "formats": [".csv", ".tsv", ".xlsx", ".xls"],
                "message": "File picker opened for customer/contact import.",
            },
        }

    spec = _DRAFT_TOOL_SPEC.get(name)
    if not spec:
        return {
            "success": False,
            "error_code": "UNKNOWN_TOOL",
            "message": f"Unknown local tool {name}",
        }
    draft_key, workflow_id, nav_view = spec
    draft = dict(memory.durable.get(draft_key) or {})
    incoming = {k: v for k, v in arguments.items() if v is not None}
    # Team draft is shared by create_team and add_team_members — resolve from blob.
    if draft_key == "team_draft":
        from app.workflow_schemas import workflow_id_for_draft

        resolved = workflow_id_for_draft(draft_key, {**draft, **incoming})
        if resolved:
            workflow_id = resolved
    prior_wf = str(memory.durable.get("current_workflow") or "").strip()
    if prior_wf and prior_wf != workflow_id:
        _park_other_active_drafts(memory, keep_workflow=workflow_id)
    # Alias name → customerName for ticket guided steps
    if workflow_id == "create_ticket" and incoming.get("name") and not incoming.get("customerName"):
        incoming["customerName"] = incoming.pop("name")
    if workflow_id == "create_ticket":
        camel_check = incoming.pop("precreateDuplicateCheck", None)
        if camel_check is not None and incoming.get("precreate_duplicate_check") is None:
            incoming["precreate_duplicate_check"] = camel_check
        ready_alias = incoming.pop("issue_ready", None)
        if ready_alias is not None and incoming.get("issueReady") is None:
            incoming["issueReady"] = ready_alias
    if workflow_id in {"create_macro", "macro"}:
        if incoming.get("name") and not incoming.get("title"):
            incoming["title"] = incoming.pop("name")
        if incoming.get("content") and not incoming.get("body"):
            incoming["body"] = incoming.pop("content")
        if incoming.get("reply") and not incoming.get("body"):
            incoming["body"] = incoming.pop("reply")
    # Priority/status UI uses name/hours; schema tools use displayName/resolutionHours
    if workflow_id in {"create_priority", "create_status"}:
        if incoming.get("name") and not incoming.get("displayName"):
            incoming["displayName"] = incoming.pop("name")
        if incoming.get("label") and not incoming.get("displayName"):
            incoming["displayName"] = incoming.pop("label")
        if workflow_id == "create_priority":
            from app.workflow_schemas import usable_priority_label

            dn_raw = incoming.get("displayName")
            if dn_raw is not None:
                start = str(draft.get("_intent_start_text") or "").strip()
                labeled = usable_priority_label(str(dn_raw).strip(), start_utterance=start)
                if labeled:
                    incoming["displayName"] = labeled
                else:
                    incoming.pop("displayName", None)
            if incoming.get("hours") is not None and incoming.get("resolutionHours") is None:
                incoming["resolutionHours"] = incoming.pop("hours")
            lq_patch = _last_query_dict(memory)
            if lq_patch.get("catalog_op") == "delete_pick":
                incoming.pop("resolutionHours", None)
                incoming.pop("hours", None)
                pick_label = str(
                    incoming.get("displayName") or incoming.get("name") or incoming.get("label") or ""
                ).strip()
                if not str(incoming.get("id") or draft.get("id") or "").strip() and pick_label:
                    resolved_id = _resolve_catalog_pick_id(lq_patch, pick_label)
                    if resolved_id:
                        incoming["id"] = resolved_id
            # Do not accept invented SLA hours while still collecting the name.
            aw_now = str(draft.get("awaiting") or "").strip().lower()
            setting_name = bool(
                incoming.get("displayName") or incoming.get("name") or incoming.get("label")
            )
            name_already = str(
                draft.get("displayName") or draft.get("name") or ""
            ).strip()
            if (
                "resolutionHours" in incoming or "hours" in incoming
            ) and (
                aw_now in {"name", "displayname", "display_name", "label", ""}
                or (setting_name and not name_already)
            ):
                incoming.pop("resolutionHours", None)
                incoming.pop("hours", None)
        else:
            from app.workflow_schemas import usable_status_label

            dn_raw = incoming.get("displayName")
            if dn_raw is not None:
                start = str(draft.get("_intent_start_text") or "").strip()
                labeled = usable_status_label(str(dn_raw).strip(), start_utterance=start)
                if labeled:
                    incoming["displayName"] = labeled
                else:
                    incoming.pop("displayName", None)
    if workflow_id in {"create_kb", "kb"}:
        if incoming.get("content") and not incoming.get("body"):
            incoming["body"] = incoming.pop("content")
        incoming = _drop_ungrounded_kb_skip_ahead(incoming, draft, memory)
    patch_hint = ""
    retargeted = _retarget_instruction_valued_patch(incoming)
    if retargeted is not None:
        incoming = retargeted
        _scrub_instruction_list_field(draft, "members")
        patch_hint = (
            "Did not overwrite collected fields with the instruction sentence. "
            "Ask for the replacement value next. Keep quoting the current draft."
        )
    else:
        incoming = _strip_instruction_valued_patch(incoming)
        _scrub_instruction_list_field(incoming, "members")
    incoming = _ground_guided_patch_in_utterance(memory, incoming, draft)
    incoming, snap_err = _snap_guided_next_field(workflow_id, draft, incoming)
    if snap_err:
        return snap_err
    if workflow_id in {"create_kb", "kb"}:
        from app.workflow_schemas import usable_kb_title

        title_in = incoming.get("title")
        if title_in is not None:
            start = str(draft.get("_intent_start_text") or "").strip()
            titled = usable_kb_title(str(title_in).strip(), start_utterance=start)
            if titled:
                incoming["title"] = titled
            else:
                incoming.pop("title", None)
        aw_kb = str(draft.get("awaiting") or "").strip().lower()
        # While collecting category, do not invent a label in the same turn as body.
        if (
            aw_kb == "category"
            and incoming.get("body")
            and incoming.get("category") is not None
        ):
            incoming.pop("category", None)
        cat_raw = incoming.get("category")
        if cat_raw is not None:
            cat_text = str(cat_raw).strip()
            if len(cat_text) > 64 or "\n" in cat_text:
                if not str(draft.get("body") or incoming.get("body") or "").strip():
                    incoming["body"] = cat_text
                incoming.pop("category", None)
            elif cat_text:
                cats = _ensure_kb_categories_on_draft(draft)
                matched = next(
                    (
                        item
                        for item in cats
                        if str(item).strip().lower() == cat_text.lower()
                    ),
                    None,
                )
                cat = matched or cat_text
                utterances = _recent_user_utterances(memory, limit=1)
                user_text = utterances[-1] if utterances else ""
                if not _user_stated_kb_category(cat, user_text, draft):
                    return {
                        "success": False,
                        "error_code": "CATEGORY_REQUIRED",
                        "message": (
                            "Call list_kb_categories, list every option from that "
                            "TOOL RESULT, and ask them to pick a line or type a new "
                            "short name. Do not invent a category from the title."
                        ),
                        "payload": {
                            "available_categories": cats,
                            "awaiting": "category",
                        },
                        "retryable": False,
                    }
                incoming["category"] = cat
    # Structural slot checks only — reject instruction phrases as data values.
    # Meaning/routing stays with the LLM; this only blocks invalid payloads.
    rejected = _reject_incompatible_slot_values(workflow_id, incoming)
    if rejected:
        return {
            "success": False,
            "error_code": "INVALID_FIELD_VALUE",
            "message": rejected,
            "payload": {
                "hint": (
                    "Do not store meta/correction phrases as field values. "
                    "Set awaiting to the field to edit and ask for the real value, "
                    "or patch with the actual name/email/phone/text."
                ),
            },
        }
    # Team members: exact roster spellings only — LLM asks "Did you mean …?" for typos.
    if (
        workflow_id in {"create_team", "add_team_members"}
        and "members" in incoming
    ):
        roster = _team_member_validation_roster(draft)
        if not roster:
            return {
                "success": False,
                "error_code": "ROSTER_REQUIRED",
                "message": (
                    "Call list_queues and list_agents first, then patch members "
                    "with canonical staff names from those tool results "
                    "(remaining roster for a remove)."
                ),
                "retryable": False,
            }
        canonical, unresolved = _exact_roster_member_names(
            incoming.get("members"), roster
        )
        if unresolved or not canonical:
            return {
                "success": False,
                "error_code": "MEMBER_NOT_ON_ROSTER",
                "message": (
                    "Those names are not exact roster spellings: "
                    + ", ".join(unresolved or ["(empty)"])
                    + ". Ask Did you mean <canonical roster name>? then patch "
                    "with exact names from list_agents / list_queues "
                    "(remaining roster for a remove)."
                ),
                "retryable": False,
                "payload": {
                    "unresolved": unresolved,
                    "available_members": draft.get("available_members") or roster,
                    "current_members": draft.get("current_members") or [],
                },
            }
        incoming["members"] = canonical
    contact_snapshot = dict(draft) if workflow_id == "create_ticket" else None
    if workflow_id == "create_ticket":
        incoming = _strip_premature_ticket_enrich(incoming, draft)
    if workflow_id == "create_customer":
        from app.workflow_schemas import normalize_customer_fields

        awaiting_keep = incoming.get("awaiting")
        step_keep = incoming.get("step")
        skipped_keep = incoming.get("skippedFields")
        incoming = normalize_customer_fields(incoming)
        if awaiting_keep is not None:
            incoming["awaiting"] = awaiting_keep
        if step_keep is not None:
            incoming["step"] = step_keep
        if skipped_keep is not None:
            incoming["skippedFields"] = skipped_keep
    prior_draft = dict(draft)
    draft.update(incoming)
    if workflow_id in {"create_team", "team", "add_team_members", "add_members"}:
        _scrub_instruction_list_field(draft, "members")
    if workflow_id in {"create_macro", "macro"}:
        from app.workflow_schemas import sanitize_macro_draft_fields

        start = str(draft.get("_intent_start_text") or "").strip()
        cleaned = sanitize_macro_draft_fields(draft)
        if start:
            cleaned["_intent_start_text"] = start
        draft.clear()
        draft.update(cleaned)
    if workflow_id in {"create_priority", "create_status"}:
        from app.workflow_schemas import sanitize_priority_draft_fields

        start = str(draft.get("_intent_start_text") or "").strip()
        cleaned = sanitize_priority_draft_fields(draft)
        if start:
            cleaned["_intent_start_text"] = start
        draft.clear()
        draft.update(cleaned)
    if workflow_id == "create_customer":
        from app.workflow_schemas import normalize_customer_fields

        cleaned = normalize_customer_fields(draft)
        awaiting_keep = draft.get("awaiting")
        step_keep = draft.get("step")
        draft.clear()
        draft.update(cleaned)
        if awaiting_keep is not None:
            draft["awaiting"] = awaiting_keep
        if step_keep is not None:
            draft["step"] = step_keep
    if workflow_id == "create_ticket":
        _normalize_ticket_contact(draft)
        contact_changed = bool(
            contact_snapshot is not None
            and _ticket_contact_changed(contact_snapshot, draft)
        )
        issue_changed = bool(
            contact_snapshot is not None
            and str(contact_snapshot.get("issue") or "")
            != str(draft.get("issue") or "")
        )
        if contact_changed:
            draft.pop("customerDirectoryStatus", None)
            draft.pop("customerId", None)
            draft.pop("customer_not_found", None)
        if contact_changed or issue_changed:
            incoming_stamp = incoming.get("precreate_duplicate_check")
            draft.pop("precreate_duplicate_check", None)
            draft.pop("_precreate_duplicate_evidence", None)
            if incoming_stamp is not None and str(incoming_stamp).strip():
                draft["precreate_duplicate_check"] = incoming_stamp
            stamped_ready = incoming.get("issueReady")
            if stamped_ready is True or str(stamped_ready or "").strip().lower() in {
                "true",
                "ready",
                "1",
            }:
                draft["issueReady"] = True
            else:
                draft.pop("issueReady", None)
        order_changed = bool(
            contact_snapshot is not None
            and str(contact_snapshot.get("orderId") or contact_snapshot.get("order_id") or "")
            != str(draft.get("orderId") or draft.get("order_id") or "")
        )
        if order_changed or contact_changed:
            draft.pop("orderVerified", None)
        if contact_changed or issue_changed:
            state = memory.current_task_state()
            if state:
                dependency_results = dict(state.dependency_results)
                if contact_changed:
                    dependency_results.pop("customer-verify", None)
                dependency_results.pop("ticket-enrich", None)
                memory.set_task_state(
                    state.model_copy(
                        update={
                            "dependency_results": dependency_results,
                            "confirmation": None,
                            "status": "collecting",
                        }
                    )
                )
    if workflow_id in {"create_priority", "create_status"}:
        from app.workflow_schemas import normalize_fields

        draft.update(normalize_fields(workflow_id, draft))
    if workflow_id == "create_priority":
        draft["kind"] = "priority"
    elif workflow_id == "create_status":
        draft["kind"] = "status"
    miss = missing_fields(workflow_id, draft)
    skipped = merge_skipped_fields(draft, incoming)
    if incoming.get("skippedFields") is not None or skipped:
        draft["skippedFields"] = skipped
    awaiting = str(incoming.get("awaiting") or "").strip()
    # awaiting-only correction: keep prior filled values; just move the ask
    data_keys = [
        k for k in incoming.keys() if k not in {"awaiting", "step", "skippedFields", "ready"}
    ]
    awaiting_lower = awaiting.lower()
    if awaiting_lower == "delete_confirm":
        awaiting = "delete_confirm"
    elif not awaiting:
        awaiting = miss[0] if miss else "confirm"
    awaiting_lower = str(awaiting or "").strip().lower()
    # Schema: never stay on confirm while required fields are still missing
    # (LLM may pass awaiting=confirm after copying title into body).
    if miss and awaiting_lower == "confirm":
        awaiting = miss[0]
        awaiting_lower = str(awaiting or "").strip().lower()
    if workflow_id == "create_ticket":
        from app.workflow_schemas import missing_fields as _ticket_miss_fields

        ticket_miss = _ticket_miss_fields(workflow_id, draft)
        awaiting_l = str(awaiting or "").strip().lower()
        if "contact" in ticket_miss and awaiting_l in {"issue", "confirm"}:
            awaiting = "contact"
        elif _ticket_needs_directory_lookup(draft) and awaiting_l in {
            "",
            "issue",
            "confirm",
            "contact",
        }:
            # Contact is present but CDP verify has not succeeded — do not advance
            # the ask to issue until verify_ticket_customer marks the draft verified.
            awaiting = "contact"
    # UI ticket preview uses awaiting=name for the customerName step
    if workflow_id == "create_ticket" and awaiting == "customerName":
        awaiting = "name"
    # Priorities UI steps: name → hours → confirm (not displayName/resolutionHours)
    catalog_update = (
        workflow_id in {"create_priority", "create_status"}
        and _catalog_update_task_active(memory)
    )
    if workflow_id == "create_priority":
        has_catalog_id = bool(str(draft.get("id") or incoming.get("id") or "").strip())
        lq_flow = _last_query_dict(memory)
        delete_pick = lq_flow.get("catalog_op") == "delete_pick"
        # Rename/hours update must keep the catalog table — never the delete panel.
        if catalog_update:
            if str(awaiting or "").strip().lower() == "delete_confirm":
                awaiting = "confirm"
            else:
                al = awaiting.lower()
                if al in {"displayname", "display_name", "label"}:
                    awaiting = "name"
                elif al in {"resolutionhours", "resolution_hours", "hours"}:
                    awaiting = "hours"
        # Existing catalog row (has id) is delete target — never force SLA collect.
        elif has_catalog_id or delete_pick:
            if has_catalog_id:
                awaiting = "delete_confirm"
            elif delete_pick:
                return {
                    "success": False,
                    "error_code": "MISSING_CATALOG_ID",
                    "message": (
                        "Call list_priorities and patch with the catalog id for the "
                        "label the user chose — do not start create collect or ask "
                        "for resolution hours during delete."
                    ),
                    "payload": {
                        "catalog_op": "delete_pick",
                        "catalog_pick_options": lq_flow.get("catalog_pick_options"),
                        "awaiting": "delete_pick",
                    },
                    "retryable": False,
                }
        else:
            al = awaiting.lower()
            if al in {"displayname", "display_name", "label"}:
                awaiting = "name"
            elif al in {"resolutionhours", "resolution_hours", "hours"}:
                awaiting = "hours"
            # After name is filled for a NEW create (no id), force hours next.
            elif awaiting == "confirm" and "resolutionHours" in miss:
                awaiting = "hours"
        awaiting_lower = str(awaiting or "").strip().lower()
    elif workflow_id == "create_status":
        has_catalog_id = bool(str(draft.get("id") or "").strip())
        if catalog_update:
            if str(awaiting or "").strip().lower() == "delete_confirm":
                awaiting = "confirm"
            awaiting_lower = str(awaiting or "").strip().lower()
        elif has_catalog_id:
            awaiting = "delete_confirm"
            awaiting_lower = "delete_confirm"
        else:
            al = awaiting.lower()
            if al in {"displayname", "display_name", "label"}:
                awaiting = "name"
    if workflow_id in {"create_kb", "kb"}:
        from app.workflow_schemas import sanitize_kb_draft_fields, usable_kb_title

        cleaned = sanitize_kb_draft_fields(draft)
        draft.clear()
        draft.update(cleaned)
        miss = missing_fields(workflow_id, draft)
        retarget_only = bool(incoming.get("awaiting")) and not data_keys
        if retarget_only:
            awaiting = str(incoming.get("awaiting") or "").strip() or awaiting
            if not usable_kb_title(
                str(draft.get("title") or ""),
                start_utterance=str(draft.get("_intent_start_text") or "").strip(),
            ):
                awaiting = "title"
            elif awaiting.lower() == "category" or "category" in miss:
                _ensure_kb_categories_on_draft(draft)
        elif not usable_kb_title(
            str(draft.get("title") or ""),
            start_utterance=str(draft.get("_intent_start_text") or "").strip(),
        ):
            awaiting = "title"
        elif "category" in miss:
            awaiting = "category"
            _ensure_kb_categories_on_draft(draft)
        elif "body" in miss:
            awaiting = "body"
        elif str(draft.get("publication_intent") or "").strip().lower() not in {
            "draft",
            "publish",
        }:
            awaiting = "publication_intent"
        else:
            awaiting = "confirm"
    if catalog_update:
        kind = "status" if workflow_id == "create_status" else "priority"
        rid = str(draft.get("id") or incoming.get("id") or "").strip()
        if str(awaiting or "").strip().lower() == "delete_confirm":
            awaiting = "confirm"
        awaiting_lower = str(awaiting or "").strip().lower()
        if rid:
            _ground_catalog_update_target(
                memory,
                kind=kind,
                row_id=rid,
                name=str(
                    draft.get("currentName")
                    or draft.get("displayName")
                    or draft.get("name")
                    or ""
                ),
                hours=draft.get("resolutionHours"),
            )
        draft.pop("id", None)
    if workflow_id in {"create_customer", "customer"}:
        from app.workflow_schemas import customer_write_ready

        if (
            customer_write_ready(draft)
            and not str(draft.get("phone") or "").strip()
            and str(awaiting or "").strip().lower() == "confirm"
        ):
            skipped_now = [
                str(x).strip()
                for x in (draft.get("skippedFields") or [])
                if str(x).strip()
            ]
            if "phone" not in {s.lower() for s in skipped_now}:
                skipped_now.append("phone")
            draft["skippedFields"] = skipped_now
    if (
        data_keys
        and str(awaiting or "").strip().lower() != "delete_confirm"
        and not catalog_update
    ):
        if workflow_id == "create_ticket" and _ticket_needs_directory_lookup(draft):
            awaiting = "contact"
        else:
            from app.workflow_schemas import (
                _CURRENT_SLOT_KEYS,
                sequence_slot_for_awaiting,
            )

            requested_aw = str(incoming.get("awaiting") or "").strip().lower()
            requested_slot = sequence_slot_for_awaiting(workflow_id, requested_aw)
            prior_open = str(
                first_open_guided_slot(workflow_id, prior_draft) or ""
            ).strip().lower()
            # Contact Center snap: reopen a filled field until a real replacement
            # lands. Do not jump the RH pointer to the next missing slot.
            reopen = requested_aw not in {
                "",
                "confirm",
                "delete_confirm",
                "done",
            } and requested_aw != prior_open
            slot_keys = (
                set(_CURRENT_SLOT_KEYS.get(requested_slot, frozenset()))
                if requested_slot
                else set()
            )
            if not slot_keys and requested_aw:
                slot_keys = {requested_aw}
            replacement = any(
                key in slot_keys and not _unusable_patch_value(incoming.get(key))
                for key in data_keys
            )
            if reopen and not replacement:
                awaiting = str(incoming.get("awaiting") or requested_aw)
            else:
                awaiting = first_open_guided_slot(workflow_id, draft)
    draft["awaiting"] = awaiting
    draft["step"] = awaiting
    apply_guided_ready(workflow_id, draft)
    memory.durable[draft_key] = draft
    if not catalog_update:
        memory.durable["current_workflow"] = workflow_id
        memory.durable["pending_ask"] = awaiting
    state = memory.current_task_state()
    if state and catalog_update:
        provenance = dict(state.provenance)
        collected = dict(state.collected)
        for key, value in incoming.items():
            if key in {"awaiting", "step", "id"}:
                continue
            provenance[key] = "executor_llm"
            collected[key] = value
        memory.set_task_state(
            state.model_copy(update={"collected": collected, "provenance": provenance})
        )
    elif state:
        provenance = dict(state.provenance)
        for key in incoming:
            provenance[key] = "executor_llm"
        changed_values = any(
            key not in {"awaiting", "step"}
            and state.collected.get(key) != value
            for key, value in incoming.items()
        )
        memory.set_task_state(
            state.model_copy(
                update={
                    "collected": dict(draft),
                    "provenance": provenance,
                    "confirmation": None if changed_values else state.confirmation,
                    "status": (
                        "collecting" if awaiting not in {"confirm", "delete_confirm"}
                        else "awaiting_confirmation"
                    ),
                }
            )
        )
    # Active workflow owns slots — do not bleed parked ticket fields into macro/etc.
    if not catalog_update:
        memory.durable["slots"] = {
            k: v for k, v in draft.items() if k not in {"awaiting", "step"}
        }
    create_type = _ui_type_for_workflow(workflow_id)
    panel_types = {
        t
        for t in (
            create_type,
            "create_ticket",
            "create_team",
            "update_team",
            "create_customer",
            "create_macro",
            "create_kb",
            "create_priority",
            "create_status",
            "escalate",
            "reassign",
            "delete_priority",
            "delete_status",
        )
        if t
    }
    # Keep only navigates/creates for this workflow on the turn (avoid last-wins stale ticket nav).
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and (
                (a.get("type") == "navigate" and nav_view and str(a.get("view") or "") != nav_view)
                or (
                    str(a.get("type") or "") in panel_types
                    and create_type
                    and str(a.get("type") or "")
                    not in {create_type, "delete_priority", "delete_status"}
                    and not a.get("done")
                )
            )
        )
    ]
    if nav_view and not any(
        isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == nav_view
        for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": nav_view})
    if catalog_update:
        # Rename/hours update stays on the catalog table — no create/delete panel.
        ui_actions[:] = [
            a
            for a in ui_actions
            if not (
                isinstance(a, dict)
                and str(a.get("type") or "") in panel_types
                and not a.get("done")
            )
        ]
    elif awaiting_lower == "delete_confirm":
        kind = str(draft.get("kind") or ("status" if workflow_id == "create_status" else "priority")).lower()
        draft["kind"] = kind
        del_type = "delete_status" if kind == "status" else "delete_priority"
        ui_actions[:] = [
            a
            for a in ui_actions
            if not (
                isinstance(a, dict)
                and str(a.get("type") or "") in panel_types
                and not a.get("done")
            )
        ]
        ui_actions.append(
            {
                "type": del_type,
                **draft,
                "step": "confirm",
                "awaiting": "delete_confirm",
                "kind": kind,
            }
        )
    elif create_type:
        # Always refresh the progress panel from the latest draft (incl. corrections).
        ui_actions[:] = [
            a
            for a in ui_actions
            if not (
                isinstance(a, dict)
                and str(a.get("type") or "") in panel_types
                and not a.get("done")
            )
        ]
        ui_actions.append(
            {
                "type": create_type,
                **_public_guided_draft(draft),
                "step": awaiting,
                "awaiting": awaiting,
            }
        )
    # Delete-confirm is not create collect — never advertise resolutionHours as missing.
    if awaiting_lower == "delete_confirm":
        miss = []
    payload_out: dict[str, Any] = {
        "draft_key": draft_key,
        "workflow": (
            "delete_status"
            if awaiting_lower == "delete_confirm" and workflow_id == "create_status"
            else "delete_priority"
            if awaiting_lower == "delete_confirm"
            else workflow_id
        ),
        "awaiting": awaiting,
        "ready": bool(draft.get("ready")),
        "skippedFields": draft.get("skippedFields") or [],
        "missing": miss,
        "draft": draft,
        "updated_fields": data_keys,
        "message": _patch_followup_message(awaiting, draft),
    }
    if not data_keys:
        slot = _awaiting_ask_label(awaiting)
        payload_out["next_action"] = "clarify_or_park"
        payload_out["message"] = (
            "This utterance did not fill the open slot. Do not call this patch "
            "again with the same arguments. If they stated a how-to or a problem "
            "they have not asked to file, return_to_super with action=park and "
            "query set to their message. If they are still filing, ask one "
            f"clarification for {slot} — do not invent values from Context."
        )
    if (
        workflow_id == "create_ticket"
        and str(awaiting or "").strip().lower() == "confirm"
        and memory.durable.get("_portal_create_after_self_service")
        and str(draft.get("surface") or "").strip().lower() == "portal"
    ):
        payload_out["message"] = (
            "Draft is confirm-ready after self-service. Recap name, contact, "
            "and issue in simple HTML and ask whether to file. Call "
            "portal_create_ticket only after they confirm. Do not file this "
            "turn. Do not claim the ticket was filed."
        )
    if patch_hint:
        payload_out["message"] = f"{patch_hint} {payload_out['message']}"
    if (
        workflow_id == "create_ticket"
        and data_keys
        and _ticket_needs_directory_lookup(draft)
    ):
        payload_out["next_tool"] = "verify_ticket_customer"
        payload_out["message"] = (
            "Contact is saved but the customer is not directory-verified yet. "
            "Call verify_ticket_customer now with the draft email/phone. "
            "Do not ask for the issue until verification succeeds "
            "(customerDirectoryStatus=verified)."
        )
    return {
        "success": True,
        "payload": payload_out,
    }


_PATCH_FIELD_TO_AWAITING: dict[str, str] = {
    "title": "title",
    "name": "name",
    "customerName": "name",
    "body": "body",
    "category": "category",
    "email": "email",
    "phone": "phone",
    "contact": "contact",
    "displayName": "name",
    "label": "name",
    "issue": "issue",
    "hours": "hours",
    "resolutionHours": "hours",
    "description": "description",
    "members": "members",
    "assignee": "assignee",
    "ticket_number": "ticket_number",
    "ticketNumber": "ticket_number",
    "target_role": "target_role",
    "person": "person",
    "publication_intent": "publication_intent",
}


def _unusable_patch_value(value: Any) -> bool:
    """True when a patch value is an instruction or invented empty token."""
    from app.workflow_schemas import (
        is_placeholder_field_value,
        value_looks_like_field_edit_instruction,
    )

    if value_looks_like_field_edit_instruction(value):
        return True
    if isinstance(value, str) and is_placeholder_field_value(value):
        return True
    return False


def _retarget_instruction_valued_patch(
    incoming: dict[str, Any],
) -> dict[str, Any] | None:
    """If every patched value is an edit instruction, keep awaiting only."""
    data_items = [
        (key, value)
        for key, value in incoming.items()
        if key not in {"awaiting", "step", "skippedFields", "ready"}
        and value is not None
        and str(value).strip()
    ]
    if not data_items:
        return None
    for _key, value in data_items:
        if not _unusable_patch_value(value):
            return None
    target = ""
    for key, _value in data_items:
        if key in _PATCH_FIELD_TO_AWAITING:
            target = _PATCH_FIELD_TO_AWAITING[key]
            break
    out: dict[str, Any] = {}
    awaiting = str(incoming.get("awaiting") or "").strip()
    if awaiting:
        out["awaiting"] = awaiting
    elif target:
        out["awaiting"] = target
    return out


def _strip_instruction_valued_patch(incoming: dict[str, Any]) -> dict[str, Any]:
    """Drop correction sentences mixed into an otherwise real field patch."""
    from app.workflow_schemas import (
        is_placeholder_field_value,
        looks_like_field_edit_instruction,
    )

    out = dict(incoming)
    for key, value in list(out.items()):
        if key in {"awaiting", "step", "skippedFields", "ready"}:
            continue
        if isinstance(value, list):
            kept = [
                item
                for item in value
                if str(item).strip()
                and not looks_like_field_edit_instruction(str(item))
                and not is_placeholder_field_value(str(item))
            ]
            if not kept:
                out.pop(key, None)
            else:
                out[key] = kept
        elif isinstance(value, str) and (
            looks_like_field_edit_instruction(value)
            or is_placeholder_field_value(value)
        ):
            out.pop(key, None)
    return out


def _scrub_instruction_list_field(draft: dict[str, Any], key: str = "members") -> None:
    from app.workflow_schemas import looks_like_field_edit_instruction

    raw = draft.get(key)
    if isinstance(raw, str):
        if looks_like_field_edit_instruction(raw):
            draft.pop(key, None)
        return
    if not isinstance(raw, list):
        return
    kept = [
        item
        for item in raw
        if str(item).strip() and not looks_like_field_edit_instruction(str(item))
    ]
    if kept:
        draft[key] = kept
    else:
        draft.pop(key, None)


def _user_stated_kb_category(
    cat: str, user_text: str, draft: dict[str, Any] | None
) -> bool:
    """True when this turn's utterance is the category pick, not a title substring."""
    ut = str(user_text or "").strip().lower()
    cl = str(cat or "").strip().lower()
    if not ut or not cl:
        return False
    if ut == cl:
        return True
    blob = draft if isinstance(draft, dict) else {}
    title = str(blob.get("title") or "").strip().lower()
    if title and ut == title and cl in title:
        return False
    known_l = {item.lower() for item in _kb_draft_category_names(blob)}
    return cl in known_l and cl in ut


def _drop_ungrounded_kb_skip_ahead(
    incoming: dict[str, Any],
    draft: dict[str, Any],
    memory: SharedMemory,
) -> dict[str, Any]:
    """Do not invent category/body while still collecting an earlier field."""
    out = dict(incoming)
    utterances = _recent_user_utterances(memory, limit=1)
    user_text = utterances[-1] if utterances else ""
    aw = str(draft.get("awaiting") or out.get("awaiting") or "").strip().lower()
    cat = str(out.get("category") or "").strip()
    already_cat = str(draft.get("category") or "").strip()
    mentioned = _user_stated_kb_category(cat, user_text, draft)
    if "category" in out and aw in {"title", ""} and not already_cat and not mentioned:
        out.pop("category", None)
    body = str(out.get("body") or "").strip()
    if "body" in out and aw in {"title", ""}:
        from app.workflow_schemas import looks_like_field_edit_instruction

        same_as_utterance = bool(body and user_text and body.lower() == user_text.lower())
        if not body or same_as_utterance or looks_like_field_edit_instruction(body):
            out.pop("body", None)
    return out


_PATCH_PRESERVE_KEYS = frozenset(
    {
        "awaiting",
        "step",
        "skippedFields",
        "ready",
        "customerId",
        "customer_id",
        "id",
        "queueId",
        "assigneeId",
        "resolverId",
        "add_members",
        "addMembers",
        # Internal create gates — not user-typed field values.
        "precreate_duplicate_check",
        "issueReady",
        "needsOrderCheck",
        "orderVerified",
        "orderId",
        "productId",
        "orderItemCount",
        "attachments",
    }
)


def _ground_guided_patch_in_utterance(
    memory: SharedMemory,
    incoming: dict[str, Any],
    draft: dict[str, Any],
) -> dict[str, Any]:
    """Same rule as ticket create: keep only values from this utterance.

    Correction without a replacement stays awaiting-only. Invented labels
    (e.g. Severe when they said change the name) are dropped. Ids from
    list/get stay — they are Postgres, not user-typed names.
    """
    utterances = _recent_user_utterances(memory, limit=1)
    user_text = utterances[-1] if utterances else ""
    if not str(user_text).strip():
        return incoming
    preserved = {k: incoming[k] for k in _PATCH_PRESERVE_KEYS if k in incoming}
    roster = _team_member_validation_roster(draft)
    replace = incoming.get("add_members") is False or incoming.get(
        "addMembers"
    ) is False or draft.get("add_members") is False or draft.get(
        "addMembers"
    ) is False
    fields = {k: v for k, v in incoming.items() if k not in _PATCH_PRESERVE_KEYS}
    remaining: list[str] | None = None
    if replace and isinstance(fields.get("members"), list):
        remaining, _unresolved = _exact_roster_member_names(fields.get("members"), roster)
        fields = {k: v for k, v in fields.items() if k != "members"}
    grounded = ground_fields_in_utterance(
        fields,
        user_text,
        roster_members=roster or None,
    )
    wid = str((memory.durable or {}).get("current_workflow") or "").strip().lower()
    if wid in {"create_kb", "kb"}:
        from app.workflow_schemas import _CURRENT_SLOT_KEYS

        aw = str(draft.get("awaiting") or "").strip().lower()
        for key in _CURRENT_SLOT_KEYS.get(aw, frozenset()):
            if key in grounded or key not in fields:
                continue
            val = fields.get(key)
            if val in (None, ""):
                continue
            grounded[key] = val
    if remaining:
        grounded["members"] = remaining
    return {**grounded, **preserved}


def _reject_incompatible_slot_values(
    workflow_id: str, incoming: dict[str, Any]
) -> str | None:
    schema = schema_for_workflow(workflow_id) or {}
    slot_types = schema.get("slot_types") or {}
    labels = schema.get("field_labels") or {}
    for key, value in incoming.items():
        if key in {"awaiting", "step", "members_skipped", "enrichedByAi", "rationale"}:
            continue
        if value is None or isinstance(value, (bool, int, float, dict)):
            continue
        if isinstance(value, list):
            from app.workflow_schemas import looks_like_field_edit_instruction

            for item in value:
                text = str(item).strip()
                if text and looks_like_field_edit_instruction(text):
                    label = labels.get(key) or key
                    return (
                        f"Invalid {label} {text!r}: that looks like an instruction "
                        f"or wrong type, not a real {label}. Ask for the actual "
                        "value (or set awaiting only)."
                    )
            continue
        text = str(value).strip()
        if not text:
            continue
        # contact is email|phone
        if key == "contact":
            if not (email_looks_valid(text) or phone_looks_valid(text)):
                return (
                    f"Invalid contact {text!r}: need an email address or phone number, "
                    "not an instruction."
                )
            continue
        slot = slot_types.get(key)
        if not slot:
            continue
        if not slot_compatible(str(slot), text):
            label = labels.get(key) or key
            return (
                f"Invalid {label} {text!r}: that looks like an instruction or wrong type, "
                f"not a real {label}. Ask for the actual value (or set awaiting only)."
            )
    return None


def sync_ticket_directory_on_draft_merge(
    memory: SharedMemory,
    before: dict[str, Any] | None,
) -> bool:
    """Directory verify is LLM-owned via verify_ticket_customer — no silent merge handoff."""
    del memory, before
    return False


_TICKET_PRE_ISSUE_ENRICH_KEYS = frozenset(
    {
        "subject",
        "description",
        "priority",
        "queue",
        "assignee",
        "assigneeId",
        "assignee_id",
        "resolver",
        "resolverId",
        "resolver_id",
        "resolverConfidence",
        "resolver_confidence",
        "confidence",
        "category",
        "skill",
        "rationale",
        "enrichedByAi",
        "enriched",
    }
)


def _strip_premature_ticket_enrich(incoming: dict[str, Any], draft: dict[str, Any]) -> dict[str, Any]:
    """ITRA assignee/resolver/subject only after issue is collected."""
    issue = str(draft.get("issue") or "").strip()
    if issue:
        return incoming
    cleaned = dict(incoming)
    for key in _TICKET_PRE_ISSUE_ENRICH_KEYS:
        cleaned.pop(key, None)
    return cleaned


def _issue_ready_for_enrich(draft: dict[str, Any], args: dict[str, Any]) -> bool:
    issue = str(args.get("issue") or draft.get("issue") or "").strip()
    if len(issue) < 8:
        return False
    name = str(args.get("customerName") or draft.get("customerName") or "").strip().lower()
    email, phone = _ticket_contact_fingerprint({**draft, **args})
    issue_l = issue.lower()
    if issue_l == name:
        return False
    if email and issue_l == email:
        return False
    if phone and len(phone) >= 7 and phone in re.sub(r"\D", "", issue):
        return False
    return True


def _ticket_contact_fingerprint(draft: dict[str, Any]) -> tuple[str, str]:
    """Normalized (email, phone_digits) for directory lookup."""
    _normalize_ticket_contact(draft)
    email = str(draft.get("customerEmail") or draft.get("email") or "").strip().lower()
    phone = re.sub(r"\D", "", str(draft.get("customerPhone") or draft.get("phone") or ""))
    contact = str(draft.get("contact") or "").strip()
    if not email and email_looks_valid(contact):
        email = contact.lower()
    if len(phone) < 7 and phone_looks_valid(contact):
        phone = re.sub(r"\D", "", contact)
    return email, phone


def _ticket_has_valid_directory_contact(draft: dict[str, Any]) -> bool:
    email, phone = _ticket_contact_fingerprint(draft)
    return bool(email) or len(phone) >= 7


def _ticket_directory_verified(draft: dict[str, Any]) -> bool:
    return bool(str(draft.get("customerId") or "").strip()) and str(
        draft.get("customerDirectoryStatus") or ""
    ).strip().lower() == "verified"


def _ticket_create_issue_absorbed_ready_to_confirm(memory: SharedMemory) -> bool:
    """Schema gate: create-ticket collect just completed (issue + verified contact).

    Super already routed CONTINUE; Domain pin is unchanged. Executor must recap
    and ask to file — not call create_ticket or wait on a tool-loop LLM.
    """
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if wf not in {"create_ticket", "ticket"}:
        return False
    draft = memory.durable.get("ticket_draft")
    if not isinstance(draft, dict):
        return False
    if str(draft.get("awaiting") or "").strip().lower() != "confirm":
        return False
    if not _ticket_directory_verified(draft):
        return False
    if not str(draft.get("customerName") or "").strip():
        return False
    issue = str(draft.get("issue") or draft.get("description") or "").strip()
    if not issue:
        return False
    stamp = str(draft.get("precreate_duplicate_check") or "").strip().lower()
    return stamp == "not_duplicate"


def _should_commit_portal_create_after_self_service(
    memory: SharedMemory,
    *,
    already_wrote: bool,
) -> bool:
    """Never auto-file. Recap first; write only after semantic confirm.

    Runtime used to commit when Super routed here after self-service and the
    draft was confirm-ready. That skipped the recap. The Executor must ask,
    then call ``portal_create_ticket`` only after they confirm.
    """
    del memory, already_wrote
    return False


def _ticket_needs_directory_lookup(draft: dict[str, Any]) -> bool:
    if not _ticket_has_valid_directory_contact(draft):
        return False
    if _ticket_directory_verified(draft):
        return False
    status = str(draft.get("customerDirectoryStatus") or "").strip().lower()
    return status != "verified"


def _ticket_contact_changed(before: dict[str, Any], after: dict[str, Any]) -> bool:
    if not _ticket_has_valid_directory_contact(after):
        return False
    return _ticket_contact_fingerprint(before) != _ticket_contact_fingerprint(after)


def _sanitize_unverified_ticket_customer_id(draft: dict[str, Any]) -> None:
    """Drop LLM-invented customerId until CDP bind marks verified."""
    if _ticket_directory_verified(draft):
        return
    status = str(draft.get("customerDirectoryStatus") or "").strip().lower()
    if status in {"verified", "missing", "ambiguous"}:
        if status == "missing":
            draft.pop("customerId", None)
        return
    if str(draft.get("customerId") or "").strip():
        draft.pop("customerId", None)


def _apply_ticket_directory_bind(
    memory: SharedMemory,
    draft: dict[str, Any],
    *,
    user_name: str | None = None,
    user_role: str | None = None,
) -> tuple[dict[str, Any], str]:
    """Lookup directory/CDP once email or phone is present."""
    from app.tasks.chat_commands import _bind_directory_customer

    org = str(memory.organization_id or "").strip()
    _sanitize_unverified_ticket_customer_id(draft)
    if not org or _ticket_directory_verified(draft):
        return draft, "ok"
    merged, status, _hits = _bind_directory_customer(
        dict(draft),
        org,
        user_id=str(memory.user_id or "").strip() or None,
        user_name=user_name,
        user_role=user_role,
    )
    return merged, status


def _handoff_ticket_to_add_customer(
    memory: SharedMemory,
    draft: dict[str, Any],
    ui_actions: list[dict[str, Any]],
    *,
    bind_status: str,
) -> bool:
    """Park create-ticket and seed add-customer when directory has no match."""
    if bind_status != "none":
        return False
    name = str(draft.get("customerName") or "").strip()
    if not name or not _ticket_has_valid_directory_contact(draft):
        return False
    memory.durable["ticket_draft"] = dict(draft)
    _prepare_add_customer_from_ticket(memory)
    memory.durable["pending_agent_handoff"] = "customers"
    memory.durable["route_start_agent"] = "customers"
    memory.durable["active_agent"] = "customers"
    ui_actions[:] = [
        a
        for a in ui_actions
        if not (
            isinstance(a, dict)
            and str(a.get("type") or "") == "create_ticket"
            and not a.get("done")
        )
    ]
    cust = dict(memory.durable.get("customer_draft") or {})
    ui_actions.append(
        {
            "type": "create_customer",
            **cust,
            "step": cust.get("awaiting"),
            "awaiting": cust.get("awaiting"),
        }
    )
    if not any(
        isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == "customers"
        for a in ui_actions
    ):
        ui_actions.append({"type": "navigate", "view": "customers"})
    return True


def _try_ticket_directory_after_contact(
    memory: SharedMemory,
    draft: dict[str, Any],
    prior: dict[str, Any],
    ui_actions: list[dict[str, Any]],
    *,
    user_name: str | None = None,
    user_role: str | None = None,
) -> tuple[dict[str, Any], bool]:
    """Directory bind on new contact; hand off to add-customer on CDP miss."""
    _normalize_ticket_contact(draft)
    if not _ticket_needs_directory_lookup(draft) and not _ticket_contact_changed(
        prior, draft
    ):
        return draft, False
    merged, bind_status = _apply_ticket_directory_bind(
        memory,
        draft,
        user_name=user_name,
        user_role=user_role,
    )
    if bind_status == "none":
        merged["customerDirectoryStatus"] = "missing"
    elif bind_status == "ok" and str(merged.get("customerId") or "").strip():
        merged["customerDirectoryStatus"] = "verified"
    if bind_status == "many":
        merged["awaiting"] = "contact"
        merged["step"] = "contact"
        return merged, False
    if _handoff_ticket_to_add_customer(
        memory, merged, ui_actions, bind_status=bind_status
    ):
        return dict(memory.durable.get("customer_draft") or {}), True
    if bind_status == "none":
        merged["customer_not_found"] = True
    return merged, False


def _finalize_ticket_directory_on_turn(
    memory: SharedMemory,
    ui_actions: list[dict[str, Any]],
) -> bool:
    """Last-chance CDP lookup when contact is in draft but never verified."""
    wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    ticket = memory.durable.get("ticket_draft")
    if wf != "create_ticket" or not isinstance(ticket, dict):
        return False
    if not _ticket_needs_directory_lookup(ticket):
        return False
    prior = dict(ticket)
    merged, handed_off = _try_ticket_directory_after_contact(
        memory, dict(ticket), prior, ui_actions
    )
    if handed_off:
        memory.durable["current_workflow"] = "create_customer"
        memory.durable["pending_agent_handoff"] = "customers"
        memory.durable["route_start_agent"] = "customers"
        return True
    if merged != ticket:
        memory.durable["ticket_draft"] = merged
    return False


def _normalize_ticket_contact(draft: dict[str, Any]) -> None:
    contact = str(draft.get("contact") or "").strip()
    email = str(draft.get("customerEmail") or draft.get("email") or "").strip()
    phone = str(draft.get("customerPhone") or draft.get("phone") or "").strip()
    # Never keep an email string in the phone slot (breaks directory exactPhone).
    if phone and "@" in phone:
        if not email_looks_valid(email):
            draft["customerEmail"] = phone
            email = phone
        draft.pop("customerPhone", None)
        draft.pop("phone", None)
        phone = ""
    # Explicit customerEmail / customerPhone win over a stale `contact` value.
    # Otherwise "change email to X" patches customerEmail but normalize copies the
    # old contact back and verification never sees the new address.
    if email_looks_valid(email):
        draft["customerEmail"] = email
        if not contact or email_looks_valid(contact):
            draft["contact"] = email
    elif phone_looks_valid(phone):
        draft["customerPhone"] = phone
        if not contact or phone_looks_valid(contact) or not email_looks_valid(contact):
            draft["contact"] = phone
    elif contact:
        if email_looks_valid(contact):
            draft["customerEmail"] = contact
            draft["contact"] = contact
        elif phone_looks_valid(contact):
            draft["customerPhone"] = contact
            draft["contact"] = contact
        else:
            draft["contact"] = contact


def _ensure_guided_ui_actions(
    memory: SharedMemory,
    turn_ui_actions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Always refresh the active guided progress panel from memory draft."""
    actions = list(turn_ui_actions)
    if _catalog_update_task_active(memory):
        skip_types = {
            "create_priority",
            "create_status",
            "delete_priority",
            "delete_status",
        }
        return [
            a
            for a in actions
            if not (
                isinstance(a, dict)
                and str(a.get("type") or "") in skip_types
                and not a.get("done")
            )
        ]
    current_wf = str(memory.durable.get("current_workflow") or "").strip().lower()
    if not current_wf:
        # Infer only from live (non-done) create_*/update_team already on the turn.
        for a in actions:
            if not isinstance(a, dict) or a.get("done"):
                continue
            t = str(a.get("type") or "").strip()
            if t.startswith("create_") or t in {"update_team", "escalate"}:
                current_wf = t if t != "update_team" else "add_team_members"
                break
    if not current_wf:
        return actions

    matched: tuple[str, str, str | None] | None = None
    if current_wf in {"add_team_members", "add_members", "update_team"}:
        matched = ("team_draft", "add_team_members", "agent-queues")
    else:
        for tool_name, (draft_key, workflow_id, nav_view) in _DRAFT_TOOL_SPEC.items():
            del tool_name
            if workflow_id != current_wf and _ui_type_for_workflow(workflow_id) != current_wf:
                continue
            matched = (draft_key, workflow_id, nav_view)
            break
    if not matched:
        return actions

    draft_key, workflow_id, nav_view = matched
    blob = memory.durable.get(draft_key)
    if not isinstance(blob, dict):
        return actions
    apply_guided_ready(workflow_id, blob)
    memory.durable[draft_key] = blob
    public = _public_guided_draft(blob)
    if not any(
        str(v).strip() for v in public.values() if not isinstance(v, (dict, list, bool))
    ) and not public.get("awaiting"):
        return actions

    awaiting = str(public.get("awaiting") or public.get("step") or "").strip()
    awaiting_lower = awaiting.lower()
    create_type = _ui_type_for_workflow(workflow_id)
    del_type = (
        "delete_status"
        if str(blob.get("kind") or "").lower() == "status" or workflow_id == "create_status"
        else "delete_priority"
        if awaiting_lower == "delete_confirm"
        else None
    )
    panel_types = {
        t
        for t in (
            create_type,
            del_type,
            "create_ticket",
            "create_team",
            "update_team",
            "create_customer",
            "create_macro",
            "create_kb",
            "create_priority",
            "create_status",
            "escalate",
            "reassign",
            "delete_priority",
            "delete_status",
        )
        if t
    }
    actions = [
        a
        for a in actions
        if not (
            isinstance(a, dict)
            and (
                (
                    a.get("type") == "navigate"
                    and nav_view
                    and str(a.get("view") or "").strip()
                    and str(a.get("view") or "").strip() != nav_view
                )
                or (
                    str(a.get("type") or "") in panel_types
                    and not a.get("done")
                )
            )
        )
    ]
    if awaiting_lower == "delete_confirm" and del_type:
        kind = str(public.get("kind") or ("status" if del_type == "delete_status" else "priority")).lower()
        actions.append(
            {
                "type": del_type,
                **public,
                "step": "confirm",
                "awaiting": "delete_confirm",
                "kind": kind,
            }
        )
    elif create_type:
        # Always re-emit so chat corrections show in the RH progress panel.
        actions.append(
            {
                "type": create_type,
                **public,
                "step": awaiting or public.get("step"),
                "awaiting": awaiting or public.get("awaiting"),
                "ready": public.get("ready"),
                "skippedFields": public.get("skippedFields") or [],
            }
        )
    if nav_view and not any(
        isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == nav_view
        for a in actions
    ):
        actions.append({"type": "navigate", "view": nav_view})
    memory.durable["current_workflow"] = workflow_id
    return actions


def _draft_data_from_memory(memory: SharedMemory) -> dict[str, Any]:
    data: dict[str, Any] = {}
    if _catalog_update_task_active(memory):
        last = memory.durable.get("last_tool_outcome")
        if isinstance(last, dict):
            data["last_tool_outcome"] = last
            data["lastToolOutcome"] = last
        return data
    current_wf = str(memory.durable.get("current_workflow") or "").strip()
    draft_for_wf = {
        "create_ticket": "ticket_draft",
        "create_team": "team_draft",
        "add_team_members": "team_draft",
        "add_members": "team_draft",
        "create_kb": "kb_draft",
        "create_macro": "macro_draft",
        "create_customer": "customer_draft",
        "create_priority": "priority_draft",
        "create_status": "status_draft",
        "escalate": "escalate_draft",
        "reassign_ticket": "reassign_draft",
        "reassign": "reassign_draft",
    }
    # Prefer the active workflow draft in the payload; still include parked for resume.
    if current_wf and current_wf in draft_for_wf:
        key = draft_for_wf[current_wf]
        blob = memory.durable.get(key)
        if isinstance(blob, dict):
            apply_guided_ready(workflow_id_for_draft(key, blob) or current_wf, blob)
            data[key] = blob
    else:
        for key in (
            "ticket_draft",
            "team_draft",
            "kb_draft",
            "macro_draft",
            "customer_draft",
            "priority_draft",
            "status_draft",
            "escalate_draft",
            "reassign_draft",
        ):
            blob = memory.durable.get(key)
            if isinstance(blob, dict):
                apply_guided_ready(workflow_id_for_draft(key, blob), blob)
                data[key] = blob
    wf = current_wf
    if wf:
        data["workflow"] = wf
    pending = memory.durable.get("pending_ask")
    if pending:
        data["step"] = pending
    active_key = draft_for_wf.get(current_wf) if current_wf else None
    active_draft = data.get(active_key) if active_key else None
    if isinstance(active_draft, dict):
        data["ready"] = bool(active_draft.get("ready"))
        data["awaiting"] = active_draft.get("awaiting") or pending
        data["skippedFields"] = active_draft.get("skippedFields") or []
    parked = memory.durable.get("parked_drafts")
    if isinstance(parked, list) and parked:
        data["parked_drafts"] = parked
    last = memory.durable.get("last_tool_outcome")
    if isinstance(last, dict):
        data["last_tool_outcome"] = last
        data["lastToolOutcome"] = last
    return data
