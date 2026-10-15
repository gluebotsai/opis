"""Tickets specialist — create / list / search / update / escalate lifecycle."""

from __future__ import annotations

from typing import Any

from app.agents.base import run_specialist, specialist_llm_or_query
from app.agents.workflow_manager import (
    execute_ticket_query,
    resolve_active_workflow,
    specialist_result_from_handler,
)
from app.agents.workflow_nlu import TICKET_OPERATIONS
from app.state import AgentState
from app.workflow_state import (
    conversation_context_from_state,
    ensure_team_draft,
    last_entity_from_state,
)

_TICKET_QUERY_OPS = TICKET_OPERATIONS - {"NONE", "CREATE_TICKET"}


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _draft_blob(state: AgentState, key: str) -> dict | None:
    blob = state.get(key) if isinstance(state.get(key), dict) else None
    if blob and str(blob.get("awaiting") or "").strip():
        return blob
    wf = str(state.get("current_workflow") or "").strip().lower()
    step = str(state.get("current_step") or "").strip()
    wd = state.get("workflow_data") if isinstance(state.get("workflow_data"), dict) else {}
    draft_key = {
        "reassign_draft": {"reassign_ticket", "reassign"},
        "escalate_draft": {"escalate", "escalate_ticket"},
        "ticket_draft": {"create_ticket", "ticket"},
    }.get(key, set())
    if wf in draft_key and (step or wd.get("awaiting")):
        awaiting = step or str(wd.get("awaiting") or "").strip()
        if awaiting:
            return {**wd, "awaiting": awaiting}
    return None


def _guided_draft_awaiting(state: AgentState) -> str | None:
    """Non-empty awaiting step on any ticket guided draft (reassign, escalate, create)."""
    for key in ("reassign_draft", "escalate_draft", "ticket_draft"):
        blob = _draft_blob(state, key)
        awaiting = str((blob or {}).get("awaiting") or "").strip()
        if awaiting:
            return awaiting
    return None


def _active_ticket_workflow(state: AgentState) -> str | None:
    wf = str(state.get("current_workflow") or "").strip().lower()
    if wf in {"reassign_ticket", "reassign", "escalate", "escalate_ticket", "create_ticket", "ticket"}:
        return wf
    if _draft_blob(state, "reassign_draft"):
        return "reassign_ticket"
    if _draft_blob(state, "escalate_draft"):
        return "escalate"
    if _draft_blob(state, "ticket_draft"):
        return "create_ticket"
    return None


def tickets_agent(state: AgentState) -> dict:
    """Own ticket create / list / search / update / escalate; else Q&A."""
    text = _latest_user_text(state)
    org = str(state.get("organization_id") or "").strip()
    decision = (
        state.get("workflow_decision")
        if isinstance(state.get("workflow_decision"), dict)
        else state.get("semantic_request")
        if isinstance(state.get("semantic_request"), dict)
        else {}
    )
    operation = str((decision or {}).get("operation") or "").strip().upper()
    reference = str((decision or {}).get("reference") or "").strip().upper()
    action = str((decision or {}).get("action") or "").strip().upper()
    ctx = conversation_context_from_state(dict(state))
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    last_q_entity = str(last_q.get("entity") or "").strip().lower()
    pending_update = isinstance(last_q.get("pending_update"), dict) or bool(
        last_q.get("pending_bulk")
    )
    guided_awaiting = _guided_draft_awaiting(state)
    collecting = guided_awaiting is not None
    active_wf = _active_ticket_workflow(state)
    reassign_draft = _draft_blob(state, "reassign_draft")
    escalate_draft = _draft_blob(state, "escalate_draft")
    ticket_draft = _draft_blob(state, "ticket_draft")
    le = last_entity_from_state(state) or {}
    le_type = str(le.get("type") or "").strip().lower()
    # Resume / create / reassign / escalate lifecycle must never enter list/search —
    # Gemma often sets reference=LAST_ENTITY on START_REASSIGN / RESUME with an open
    # ticket. That used to trip ticket_followup → execute_ticket_query and skip
    # start_or_continue_reassign, so reassign_draft never persisted (active_workflow
    # stayed None) and later "yaswanth"/"okay" fell into UPDATE_TICKET validation.
    lifecycle_guided = operation == "CREATE_TICKET" or action in {
        "RESUME_WORKFLOW",
        "START_CREATE_TICKET",
        "START_REASSIGN",
        "START_ESCALATE",
    }
    wf_hint = str((decision or {}).get("workflow") or "").strip().lower()
    assign_continue = action in {
        "CONTINUE_WORKFLOW",
        "CONFIRM_WORKFLOW",
        "CANCEL_WORKFLOW",
        "PROVIDE_TICKET",
        "PROVIDE_ASSIGNEE",
    } and wf_hint in {
        "reassign",
        "reassign_ticket",
        "reassign_draft",
        "escalate",
        "escalate_ticket",
        "create_ticket",
        "ticket",
    }
    ticket_followup = (not lifecycle_guided) and (not assign_continue) and (
        reference in {"LAST_QUERY", "LAST_ENTITY"}
        or (
            not collecting
            and active_wf not in {"reassign_ticket", "reassign", "escalate", "escalate_ticket"}
            and action in ("CONTINUE_WORKFLOW", "CONFIRM_WORKFLOW", "NORMAL_ROUTE")
            and (
                last_q_entity in {"tickets", "ticket"}
                or le_type == "ticket"
            )
            and operation in {"", "NONE", "GET_TICKET", "GET_HISTORY"}
        )
    )

    # Active reassign / escalate / create drafts must continue before query routing.
    if org and text and collecting:
        result = resolve_active_workflow(
            text,
            page=state.get("page"),
            organization_id=org,
            user_role=state.get("user_role"),
            user_id=state.get("user_id"),
            user_name=state.get("user_name"),
            escalate_draft=escalate_draft or state.get("escalate_draft"),
            reassign_draft=reassign_draft or state.get("reassign_draft"),
            macro_draft=None,
            team_draft=ensure_team_draft(dict(state)) or state.get("team_draft"),
            kb_draft=None,
            ticket_draft=ticket_draft or state.get("ticket_draft"),
            priority_draft=None,
            customer_draft=None,
            parked_drafts=state.get("parked_drafts"),
            session_history=state.get("session_history"),
            last_entity=last_entity_from_state(state),
            workflow_decision=decision or None,
        )
        if result and result.get("handled"):
            return specialist_result_from_handler(
                result,
                prior_last_entity=last_entity_from_state(state),
                default_route="tickets",
            )
        if isinstance(result, dict):
            merged_state: dict[str, Any] = dict(state)
            for key in (
                "reassign_draft",
                "escalate_draft",
                "ticket_draft",
                "parked_drafts",
                "current_workflow",
                "current_step",
            ):
                if key in result:
                    merged_state[key] = result[key]
            if result.get("current_workflow"):
                state = merged_state  # type: ignore[assignment]

    if (
        org
        and text
        and not collecting
        and not lifecycle_guided
        and not assign_continue
        and (
            operation in _TICKET_QUERY_OPS
            or ticket_followup
            or pending_update
        )
    ):
        # Structured WM UPDATE_TICKET must use execute_ticket_query (confirm /
        # pending_update / bulk guard). Fake LLM write-tool shortcuts bypass that.
        structured_update = operation == "UPDATE_TICKET" and action in {
            "NORMAL_ROUTE",
            "CONFIRM_WORKFLOW",
            "CANCEL_WORKFLOW",
        }
        if not structured_update:
            llm_hit = specialist_llm_or_query("tickets", state, should_query=True)
            if llm_hit:
                return llm_hit
        parked_snapshot: dict[str, Any] | None = None
        if state.get("parked_drafts") or state.get("ticket_draft") is None:
            parked_snapshot = {
                "parked_drafts": state.get("parked_drafts") or [],
                "ticket_draft": state.get("ticket_draft"),
                "team_draft": state.get("team_draft"),
                "macro_draft": state.get("macro_draft"),
                "kb_draft": state.get("kb_draft"),
                "escalate_draft": state.get("escalate_draft"),
                "reassign_draft": state.get("reassign_draft"),
                "priority_draft": state.get("priority_draft"),
                "customer_draft": state.get("customer_draft"),
            }
        out = execute_ticket_query(
            state,
            text,
            decision or {},
            parked_result=parked_snapshot,
        )
        return specialist_result_from_handler(
            out,
            prior_last_entity=last_entity_from_state(state),
            default_route="tickets",
        )

    if org and text:
        result = resolve_active_workflow(
            text,
            page=state.get("page"),
            organization_id=org,
            user_role=state.get("user_role"),
            user_id=state.get("user_id"),
            user_name=state.get("user_name"),
            escalate_draft=escalate_draft or state.get("escalate_draft"),
            reassign_draft=reassign_draft or state.get("reassign_draft"),
            macro_draft=None,
            team_draft=ensure_team_draft(dict(state)) or state.get("team_draft"),
            kb_draft=None,
            ticket_draft=ticket_draft or state.get("ticket_draft"),
            priority_draft=None,
            customer_draft=None,
            parked_drafts=state.get("parked_drafts"),
            session_history=state.get("session_history"),
            last_entity=last_entity_from_state(state),
            workflow_decision=decision or None,
        )
        if result and result.get("handled"):
            return specialist_result_from_handler(
                result,
                prior_last_entity=last_entity_from_state(state),
                default_route="tickets",
            )
        if isinstance(result, dict):
            merged_state = dict(state)
            for key in (
                "reassign_draft",
                "escalate_draft",
                "ticket_draft",
                "parked_drafts",
                "current_workflow",
                "current_step",
            ):
                if key in result:
                    merged_state[key] = result[key]
            if result.get("current_workflow") or result.get("reassign_draft") or result.get(
                "escalate_draft"
            ):
                state = merged_state  # type: ignore[assignment]

    return run_specialist("tickets", state)
