"""Knowledge Base specialist — create / search with durable park/resume."""

from __future__ import annotations

from typing import Any

from app.agents.base import run_specialist, specialist_llm_or_query
from app.agents.workflow_manager import (
    execute_kb_query,
    resolve_active_workflow,
    specialist_result_from_handler,
)
from app.agents.workflow_nlu import KB_OPERATIONS
from app.state import AgentState
from app.workflow_state import conversation_context_from_state, last_entity_from_state

_KB_QUERY_OPS = KB_OPERATIONS - {"CREATE_KB"} | {"GET_METRICS"}


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def _is_portal_surface(state: AgentState) -> bool:
    role = str(state.get("user_role") or "").strip().lower()
    surface = str(state.get("chat_surface") or state.get("surface") or "").strip().lower()
    module = str(state.get("chat_module") or "").strip().lower()
    return role.startswith("portal") or surface == "portal" or module == "portal"


def kb_agent(state: AgentState) -> dict:
    if _is_portal_surface(state):
        return run_specialist("kb", state)

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
    pending = isinstance(last_q.get("pending_update"), dict)
    collecting = bool(
        isinstance(state.get("kb_draft"), dict)
        and str((state.get("kb_draft") or {}).get("awaiting") or "").strip()
    )
    from app.tasks.catalog_commands import (
        _KB_MANAGE_MODE_RE,
        _is_manage_category_draft,
        start_or_continue_kb_category_manage,
    )

    kb_draft_early = (
        state.get("kb_draft") if isinstance(state.get("kb_draft"), dict) else None
    )
    last_op = str(last_q.get("operation") or "").strip().upper()
    pending_manage = last_op == "MANAGE_CATEGORY" or isinstance(
        last_q.get("pending"), dict
    )
    text_low = (text or "").strip().lower().rstrip("!?.")
    force_manage = _is_manage_category_draft(kb_draft_early) or (
        pending_manage and bool(_KB_MANAGE_MODE_RE.match(text_low))
    )
    # Idle manage-categories / add-category (not create-article).
    if org and text and (
        force_manage
        or not collecting
        or _is_manage_category_draft(kb_draft_early)
    ):
        cat_out = start_or_continue_kb_category_manage(
            text,
            org=org,
            role=str(state.get("user_role") or "agent"),
            user_id=state.get("user_id"),
            user_name=state.get("user_name"),
            page=state.get("page"),
            kb_draft=kb_draft_early,
            semantic_decision=decision or None,
            force_start=force_manage,
        )
        if cat_out and cat_out.get("handled"):
            return specialist_result_from_handler(
                cat_out,
                prior_last_entity=last_entity_from_state(state),
                default_route="kb",
            )
    kb_followup = (
        reference in {"LAST_QUERY", "LAST_ENTITY"}
        or (
            last_q_entity in {"kb", "article"}
            and action in ("CONTINUE_WORKFLOW", "CONFIRM_WORKFLOW")
            and not collecting
        )
    )
    if (
        org
        and text
        and not collecting
        and (
            operation in _KB_QUERY_OPS
            or kb_followup
            or pending
        )
    ):
        llm_hit = specialist_llm_or_query("kb", state, should_query=True)
        if llm_hit:
            return llm_hit
        parked_snapshot: dict[str, Any] | None = None
        if state.get("parked_drafts") or state.get("kb_draft") is None:
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
        out = execute_kb_query(
            state,
            text,
            decision or {},
            parked_result=parked_snapshot,
        )
        return specialist_result_from_handler(
            out,
            prior_last_entity=last_entity_from_state(state),
            default_route="kb",
        )
    if org and text:
        result = resolve_active_workflow(
            text,
            page=state.get("page"),
            organization_id=org,
            user_role=state.get("user_role"),
            user_id=state.get("user_id"),
            user_name=state.get("user_name"),
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=state.get("kb_draft"),
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
                default_route="kb",
            )
        if isinstance(result, dict) and isinstance(result.get("kb_draft"), dict):
            merged_state: dict[str, Any] = {**dict(state), "kb_draft": result["kb_draft"]}
            if "parked_drafts" in result:
                merged_state["parked_drafts"] = result["parked_drafts"]
            if result.get("current_workflow"):
                merged_state["current_workflow"] = result["current_workflow"]
                merged_state["current_step"] = result.get("current_step")
            state = merged_state  # type: ignore[assignment]
        kb_draft = state.get("kb_draft") if isinstance(state.get("kb_draft"), dict) else None
        awaiting = str((kb_draft or {}).get("awaiting") or "").strip().lower()
        if _is_manage_category_draft(kb_draft):
            cat_out = start_or_continue_kb_category_manage(
                text,
                org=org,
                role=str(state.get("user_role") or "agent"),
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
                page=state.get("page"),
                kb_draft=kb_draft,
                semantic_decision=decision or None,
                force_start=True,
            )
            if cat_out and cat_out.get("handled"):
                return specialist_result_from_handler(
                    cat_out,
                    prior_last_entity=last_entity_from_state(state),
                    default_route="kb",
                )
        # Confirm writes belong to specialist create_kb_article.
        if kb_draft and awaiting and awaiting != "confirm":
            from app.tasks.catalog_commands import continue_kb_draft

            out = continue_kb_draft(
                text,
                org=org,
                role=str(state.get("user_role") or "agent"),
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
                page=state.get("page"),
                kb_draft=kb_draft,
                semantic_decision=decision or None,
            )
            if out.get("handled"):
                return specialist_result_from_handler(
                    out,
                    prior_last_entity=last_entity_from_state(state),
                    default_route="kb",
                )
            if isinstance(out.get("kb_draft"), dict):
                state = {**dict(state), "kb_draft": out["kb_draft"]}  # type: ignore[assignment]
    return run_specialist("kb", state)
