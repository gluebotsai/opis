"""Macros specialist — create / list / update / delete."""

from __future__ import annotations

from typing import Any

from app.agents.base import run_specialist, specialist_llm_or_query
from app.agents.workflow_manager import (
    execute_macro_query,
    resolve_active_workflow,
    specialist_result_from_handler,
)
from app.agents.workflow_nlu import MACRO_OPERATIONS
from app.state import AgentState
from app.workflow_state import last_entity_from_state

_MACRO_QUERY_OPS = MACRO_OPERATIONS - {"CREATE_MACRO"} | {"GET_METRICS"}


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def macros_agent(state: AgentState) -> dict:
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
    ctx = (
        state.get("conversation_context")
        if isinstance(state.get("conversation_context"), dict)
        else {}
    )
    last_q = ctx.get("last_query") if isinstance(ctx.get("last_query"), dict) else {}
    pending = isinstance(last_q.get("pending_update"), dict) or isinstance(
        last_q.get("pending_delete"), dict
    )
    role = str(state.get("user_role") or "agent")
    collecting = bool(
        isinstance(state.get("macro_draft"), dict)
        and str((state.get("macro_draft") or {}).get("awaiting") or "").strip()
    )
    if org and text and not collecting and (
        operation in _MACRO_QUERY_OPS
        or reference in {"LAST_QUERY", "LAST_ENTITY"}
        or pending
    ):
        llm_hit = specialist_llm_or_query("macros", state, should_query=True)
        if llm_hit:
            return llm_hit
        parked_snapshot: dict[str, Any] | None = None
        if state.get("parked_drafts") or state.get("macro_draft") is None:
            parked_snapshot = {
                "parked_drafts": state.get("parked_drafts") or [],
                "ticket_draft": state.get("ticket_draft"),
                "team_draft": state.get("team_draft"),
                "macro_draft": state.get("macro_draft"),
                "kb_draft": state.get("kb_draft"),
                "escalate_draft": state.get("escalate_draft"),
                "priority_draft": state.get("priority_draft"),
                "customer_draft": state.get("customer_draft"),
            }
        out = execute_macro_query(
            state,
            text,
            decision or {},
            parked_result=parked_snapshot,
        )
        return specialist_result_from_handler(
            out,
            prior_last_entity=last_entity_from_state(state),
            default_route="macros",
        )
    if org and text:
        result = resolve_active_workflow(
            text,
            page=state.get("page"),
            organization_id=org,
            user_role=role,
            user_id=state.get("user_id"),
            user_name=state.get("user_name"),
            escalate_draft=None,
            macro_draft=state.get("macro_draft"),
            team_draft=None,
            kb_draft=None,
            ticket_draft=None,
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
                default_route="macros",
            )
        if isinstance(result, dict) and isinstance(result.get("macro_draft"), dict):
            merged_state: dict[str, Any] = {
                **dict(state),
                "macro_draft": result["macro_draft"],
            }
            if "parked_drafts" in result:
                merged_state["parked_drafts"] = result["parked_drafts"]
            if result.get("current_workflow"):
                merged_state["current_workflow"] = result["current_workflow"]
                merged_state["current_step"] = result.get("current_step")
            state = merged_state  # type: ignore[assignment]
    return run_specialist("macros", state)
