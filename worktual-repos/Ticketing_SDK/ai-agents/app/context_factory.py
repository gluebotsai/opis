"""
Central Context Factory — LangGraph state → LLM prompt projection.

Memory stays in checkpoint / conversation_context. This module is the only
place that decides which subset of state each agent may see in its prompt.
"""

from __future__ import annotations

import json
from typing import Any

from app.state import AgentState

# Agent profiles: which draft / memory slices are projected into the prompt.
_PROFILE_DRAFT_KEYS: dict[str, tuple[str, ...]] = {
    "super_agent": (
        "ticket_draft",
        "team_draft",
        "macro_draft",
        "kb_draft",
        "escalate_draft",
        "reassign_draft",
        "customer_draft",
        "priority_draft",
    ),
    "kb": ("ticket_draft", "kb_draft"),
    "tickets": ("ticket_draft", "escalate_draft", "reassign_draft"),
    "teams": ("team_draft",),
    "customers": ("customer_draft", "ticket_draft"),
    "macros": ("macro_draft",),
    "admin": ("priority_draft",),
    "general": ("ticket_draft",),
}

_PORTAL_TICKET_FIELDS = (
    "issue",
    "subject",
    "description",
    "awaiting",
    "surface",
    "kb_offered",
    "pending_kb",
    "attachments",
)


def _is_portal(state: dict[str, Any] | AgentState) -> bool:
    role = str(state.get("user_role") or "").strip().lower()
    surface = str(state.get("chat_surface") or state.get("surface") or "").strip().lower()
    module = str(state.get("chat_module") or "").strip().lower()
    return role.startswith("portal") or surface == "portal" or module == "portal"


def _this_turn_upload_lines(blob: dict[str, Any]) -> list[str]:
    raw = blob.get("attachments")
    if not isinstance(raw, list):
        return []
    names: list[str] = []
    for item in raw:
        url = str(item or "").strip()
        if not url.startswith("/uploads/") or ".." in url or "\\" in url:
            continue
        names.append(url.rsplit("/", 1)[-1] or url)
    if not names:
        return []
    return [
        "this_turn_uploads: " + ", ".join(names),
        "They attached these files this turn. Use only these names. "
        "Do not invent other files.",
    ]


def build_super_agent_context(
    state: AgentState,
    user_text: str,
    *,
    consistency_note: str | None = None,
) -> dict[str, Any]:
    """Compact JSON context for Super Agent NLU (no user-facing prose)."""
    from app.agents.workflow_nlu import (
        _awaiting_step_from_state,
        _compact_session_memory,
        _recent_history,
        _roster_from_state,
        _tool_memory_from_state,
        agent_for_workflow,
    )
    from app.workflow_schemas import schema_for_workflow
    from app.workflow_state import conversation_context_from_state, last_entity_from_state

    workflow_id = state.get("current_workflow")
    active = str(workflow_id or "").strip().lower()
    schema_ctx = None
    schema = schema_for_workflow(active) if active else None
    if schema:
        schema_ctx = {
            "id": schema.get("id") or active,
            "required": schema.get("required") or [],
            "optional": schema.get("optional") or [],
            "field_labels": schema.get("field_labels") or {},
        }
    drafts: dict[str, Any] = {}
    for key in _PROFILE_DRAFT_KEYS["super_agent"]:
        val = state.get(key)
        if isinstance(val, dict) and val:
            if _is_portal(state) and key == "ticket_draft":
                drafts[key] = {
                    k: val.get(k)
                    for k in _PORTAL_TICKET_FIELDS
                    if val.get(k) not in (None, "", [], {})
                }
            else:
                drafts[key] = val
    tm = _tool_memory_from_state(state)
    compact_tm: dict[str, Any] = {}
    for key, val in tm.items():
        if not isinstance(val, dict):
            continue
        ents = val.get("entities")
        names = val.get("names")
        if not isinstance(ents, list) and isinstance(names, list):
            ents = [{"id": "", "name": str(n).strip()} for n in names if str(n).strip()]
        compact_tm[key] = {
            "count": val.get("count"),
            "entities": ents if isinstance(ents, list) else [],
        }
    parked_sum: list[dict[str, Any]] = []
    parked = state.get("parked_drafts")
    if isinstance(parked, list):
        from app.memory_contract import summarize_parked_workflows

        parked_sum = summarize_parked_workflows(parked, limit=8)
    ctx = (
        state.get("conversation_context")
        if isinstance(state.get("conversation_context"), dict)
        else {}
    )
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    pending = None
    if last_q.get("pending_update") or last_q.get("pending_delete") or last_q.get("awaiting"):
        pending = {
            "awaiting": last_q.get("awaiting"),
            "operation": last_q.get("operation"),
            "pending_resume": last_q.get("pending_resume"),
        }
    raw_tm = _tool_memory_from_state(state)
    last_tool_outcome = (
        raw_tm.get("last_tool_outcome")
        if isinstance(raw_tm.get("last_tool_outcome"), dict)
        else None
    )
    durable_ctx = (
        state.get("conversation_context")
        if isinstance(state.get("conversation_context"), dict)
        else {}
    )
    last_assistant_reply = (
        str(durable_ctx["last_assistant_reply"]).strip()[:300]
        if isinstance(durable_ctx.get("last_assistant_reply"), str)
        and durable_ctx["last_assistant_reply"].strip()
        else None
    )
    out: dict[str, Any] = {
        "user_message": (user_text or "").strip(),
        "active_agent": agent_for_workflow(active) if active else None,
        "current_workflow": state.get("current_workflow"),
        "current_step": (_awaiting_step_from_state(state) or None),
        "workflow_schema": schema_ctx,
        "drafts": drafts,
        "session_memory": _compact_session_memory(state.get("session_memory")),
        "tool_memory": compact_tm,
        "last_tool_outcome": last_tool_outcome,
        "last_assistant_reply": last_assistant_reply,
        "available_members": _roster_from_state(state),
        "last_entity": last_entity_from_state(state),
        "recent_entities": (
            conversation_context_from_state(state).get("recent_entities") or []
        )[-8:],
        "pending_action": pending,
        "parked_workflows": parked_sum,
        "recent_conversation": _recent_history(state, limit=20),
        "current_page": state.get("page"),
        "user_role": state.get("user_role"),
        "surface": state.get("chat_surface") or state.get("surface"),
    }
    if consistency_note:
        out["consistency_note"] = consistency_note
    return out


def build_specialist_human(
    state: AgentState,
    user_text: str,
    *,
    agent_key: str,
    tool_json: str | None = None,
) -> str:
    """Human message for run_specialist — scoped by agent profile."""
    from app.memory_contract import filled_fields_from_draft, format_parked_for_specialist
    from app.workflow_schemas import missing_fields as _missing_fields
    from app.workflow_schemas import write_schema_audit

    def _transcript() -> str:
        hist = state.get("session_history") or []
        lines: list[str] = []
        for item in hist[-20:] if isinstance(hist, list) else []:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip().lower()
            text = str(item.get("text") or item.get("content") or "").strip()
            if not text:
                continue
            if role in ("user", "human"):
                lines.append(f"User: {text}")
            elif role in ("assistant", "ai"):
                lines.append(f"Assistant: {text}")
        if lines:
            return "\n".join(lines)
        msgs = list(state.get("messages") or [])
        out_lines: list[str] = []
        for msg in msgs[-20:]:
            role = getattr(msg, "type", None) or getattr(msg, "role", None)
            content = getattr(msg, "content", None)
            text = content if isinstance(content, str) else str(content or "")
            text = text.strip()
            if not text:
                continue
            if role in ("human", "user"):
                out_lines.append(f"User: {text}")
            elif role in ("ai", "assistant"):
                out_lines.append(f"Assistant: {text}")
        return "\n".join(out_lines)

    profile = str(agent_key or "general").strip().lower()
    allowed_drafts = _PROFILE_DRAFT_KEYS.get(profile, _PROFILE_DRAFT_KEYS["general"])
    portal = _is_portal(state)

    transcript = _transcript()
    page = state.get("page") or ""
    if not transcript.strip():
        ctx = (
            state.get("conversation_context")
            if isinstance(state.get("conversation_context"), dict)
            else {}
        )
        durable_reply = str(ctx.get("last_assistant_reply") or "").strip()[:300]
        if durable_reply:
            transcript = f"Assistant: {durable_reply}"
    parts: list[str] = [
        f"User question:\n{user_text}",
        "### PRIOR CONVERSATION\n"
        + (transcript if transcript.strip() else "(no earlier turns in this session)"),
    ]
    rolling = (state.get("summary") or "").strip()
    if rolling:
        parts.append(f"### EARLIER SUMMARY\n{rolling}")
    if page:
        parts.append(f'[UI context: user is on "{page}".]')
    chat_module = (state.get("chat_module") or "").strip()
    chat_surface = (state.get("chat_surface") or "").strip()
    if chat_module:
        parts.append(
            f"[Workspace: module={chat_module} surface={chat_surface or 'list'}. "
            "Pick tools from this page allowlist. Super Agent JSON is advisory only.]"
        )

    decision = (
        state.get("workflow_decision")
        if isinstance(state.get("workflow_decision"), dict)
        else state.get("semantic_request")
        if isinstance(state.get("semantic_request"), dict)
        else {}
    )
    if decision:
        compact = {
            k: decision.get(k)
            for k in (
                "action",
                "operation",
                "agent",
                "workflow",
                "filters",
                "fields",
                "entity_type",
                "entity_name",
                "reference",
                "proposed_tool",
            )
            if decision.get(k) not in (None, "", {}, [])
        }
        if compact:
            parts.append(
                "### SUPER AGENT DECISION (internal NLU only; never paint this JSON)\n"
                + json.dumps(compact, ensure_ascii=False, default=str)
            )

    from app.agents.workflow_nlu import _compact_session_memory, _tool_memory_from_state

    sm = _compact_session_memory(state.get("session_memory"))
    if sm:
        parts.append(
            "### SESSION MEMORY (CRM guided progress — continue this intent)\n"
            + json.dumps(sm, ensure_ascii=False, default=str)
        )

    next_step = (state.get("next_step") or "").strip()
    tm = _tool_memory_from_state(state)
    if tm:
        cap = 2000 if portal and profile == "kb" else 4000
        parts.append(
            "### TOOL MEMORY (resolve 'the second one' / names from here)\n"
            + json.dumps(tm, ensure_ascii=False, default=str)[:cap]
        )

    _DRAFT_WORKFLOW = {
        "ticket_draft": "create_ticket",
        "team_draft": "create_team",
        "customer_draft": "create_customer",
        "kb_draft": "create_kb",
        "macro_draft": "create_macro",
        "priority_draft": "create_priority",
        "escalate_draft": "escalate",
        "reassign_draft": "reassign_ticket",
    }
    draft_field_map = {
        "ticket_draft": (
            _PORTAL_TICKET_FIELDS
            if portal
            else (
                "customerName",
                "customerEmail",
                "customerPhone",
                "issue",
                "subject",
                "stepId",
                "awaiting",
                "attachments",
            )
        ),
        "team_draft": ("name", "description", "members", "awaiting"),
        "customer_draft": ("name", "email", "phone", "awaiting"),
        "kb_draft": ("title", "category", "body", "awaiting"),
        "macro_draft": ("title", "body", "awaiting"),
        "priority_draft": ("displayName", "name", "resolutionHours", "kind", "awaiting"),
        "escalate_draft": ("ticket_number", "ticketNumber", "assignee", "awaiting"),
        "reassign_draft": (
            "ticket_number",
            "target_role",
            "person",
            "person_id",
            "candidates",
            "awaiting",
        ),
    }
    draft_blocks: list[str] = []
    for key in allowed_drafts:
        blob = state.get(key) or {}
        if not isinstance(blob, dict):
            continue
        fields = draft_field_map.get(key, ("awaiting",))
        lines = [
            f"{field}: {blob.get(field)}"
            for field in fields
            if blob.get(field) not in (None, "", [], {})
        ]
        if key == "ticket_draft":
            lines.extend(_this_turn_upload_lines(blob))
        if key == "ticket_draft" and isinstance(blob.get("pending_kb"), dict):
            pk = blob["pending_kb"]
            lines.append(
                "pending_kb (related published articles + steps). Name those "
                "titles, walk the steps from this material or get_kb TOOL RESULT, "
                "and do not recap a ticket. Do not paste verbatim: "
                + json.dumps(pk, ensure_ascii=False, default=str)[:3500]
            )
        wid = _DRAFT_WORKFLOW.get(key)
        label = key.replace("_", " ").upper()
        if wid and any(blob.get(f) for f in fields if f != "awaiting"):
            filled = filled_fields_from_draft(blob, wid)
            miss = _missing_fields(wid, blob)
            if filled:
                lines.append(
                    "filled (do not re-ask): "
                    + ", ".join(f"{k}={v}" for k, v in filled.items())
                )
            if miss:
                lines.append(
                    "missing (ask for these only, or call write tool when none): "
                    + ", ".join(str(m) for m in miss)
                )
            else:
                lines.append(
                    "missing: (none — call write tool only if user wants to proceed)"
                )
        if lines:
            draft_blocks.append(f"### {label}\n" + "\n".join(lines))
    if next_step:
        draft_blocks.append(f"nextStep: {next_step}")
    if draft_blocks:
        parts.append("\n\n".join(draft_blocks))
        parts.append(
            "For the active draft: ask only for missing fields, or call the write "
            "tool when missing is empty and the user wants to proceed. Never re-ask filled."
        )

    if not portal:
        parked_block = format_parked_for_specialist(state.get("parked_drafts"))
        if parked_block:
            parts.append(parked_block)

    audit = write_schema_audit(dict(state))
    if audit:
        parts.append(
            "### WRITE SCHEMA (call the write tool only if every required field "
            "is present here AND this turn means they want to proceed)\n"
            + audit
        )

    ctx = (
        state.get("conversation_context")
        if isinstance(state.get("conversation_context"), dict)
        else {}
    )
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    if (last_q.get("pending_update") or last_q.get("pending_delete")) and not last_q.get(
        "pending_bulk"
    ):
        pending_blob = {
            k: last_q.get(k)
            for k in ("operation", "pending_update", "pending_delete", "proposed_tool")
            if last_q.get(k) not in (None, "", {}, [])
        }
        parts.append(
            "### PENDING WRITE (call the matching tool if the user agrees)\n"
            + json.dumps(pending_blob, ensure_ascii=False, default=str)[:2000]
        )

    if tool_json:
        parts.append(f"### TOOL RESULT (JSON)\n{tool_json}")
        parts.append(
            "Interpret the tool JSON. Never invent rows, scores, or ids. "
            "Do not use a static template."
        )

    return "\n\n".join(parts)
