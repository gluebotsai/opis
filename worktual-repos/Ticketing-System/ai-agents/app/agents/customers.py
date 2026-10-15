"""Customers specialist — directory create / list + cross-agent resume."""

from __future__ import annotations

from typing import Any

from app.agents.base import run_specialist, specialist_llm_or_query
from app.agents.workflow_manager import (
    execute_customer_query,
    resolve_active_workflow,
    specialist_result_from_handler,
)
from app.agents.workflow_nlu import CUSTOMER_OPERATIONS
from app.state import AgentState
from app.workflow_state import last_entity_from_state

_CUSTOMER_QUERY_OPS = CUSTOMER_OPERATIONS - {"CREATE_CUSTOMER"} | {"GET_METRICS"}


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def customers_agent(state: AgentState) -> dict:
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
    from app.workflow_schemas import (
        looks_like_create_customer_command,
        redirect_import_customers_to_create,
    )

    decision = redirect_import_customers_to_create(decision or {}, text)
    operation = str((decision or {}).get("operation") or "").strip().upper()
    collecting = bool(
        isinstance(state.get("customer_draft"), dict)
        and str((state.get("customer_draft") or {}).get("awaiting") or "").strip()
    )
    # Create-vs-import meaning is LLM-owned via decision.operation.
    # Phrase-list create only when NLU did not already choose IMPORT_CUSTOMERS.
    create_in_chat = (
        looks_like_create_customer_command(text)
        and operation != "IMPORT_CUSTOMERS"
    )
    start_create = (
        str((decision or {}).get("action") or "").strip().upper()
        == "START_CREATE_CUSTOMER"
        or operation == "CREATE_CUSTOMER"
        or create_in_chat
    )
    if (
        org
        and text
        and not collecting
        and not start_create
        and (operation in _CUSTOMER_QUERY_OPS or reference in {"LAST_QUERY", "LAST_ENTITY"})
    ):
        llm_hit = specialist_llm_or_query("customers", state, should_query=True)
        if llm_hit:
            return llm_hit
        parked_snapshot: dict[str, Any] | None = None
        if state.get("parked_drafts") or state.get("customer_draft") is None:
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
        out = execute_customer_query(
            state,
            text,
            decision or {},
            parked_result=parked_snapshot,
        )
        return specialist_result_from_handler(
            out,
            prior_last_entity=last_entity_from_state(state),
            default_route="customers",
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
            kb_draft=None,
            ticket_draft=state.get("ticket_draft"),
            priority_draft=None,
            customer_draft=state.get("customer_draft"),
            parked_drafts=state.get("parked_drafts"),
            session_history=state.get("session_history"),
            last_entity=last_entity_from_state(state),
            workflow_decision=decision or None,
        )
        if result and result.get("handled"):
            return specialist_result_from_handler(
                result,
                prior_last_entity=last_entity_from_state(state),
                default_route="customers",
            )
        if isinstance(result, dict) and isinstance(result.get("customer_draft"), dict):
            merged_state: dict[str, Any] = {
                **dict(state),
                "customer_draft": result["customer_draft"],
            }
            if "parked_drafts" in result:
                merged_state["parked_drafts"] = result["parked_drafts"]
            if result.get("current_workflow"):
                merged_state["current_workflow"] = result["current_workflow"]
                merged_state["current_step"] = result.get("current_step")
            state = merged_state  # type: ignore[assignment]
        elif start_create and not collecting:
            from app.tasks.catalog_commands import start_create_customer_flow

            started = start_create_customer_flow(
                text,
                org=org,
                role=str(state.get("user_role") or ""),
                user_id=state.get("user_id"),
                user_name=state.get("user_name"),
                page=state.get("page"),
                ticket_draft=state.get("ticket_draft")
                if isinstance(state.get("ticket_draft"), dict)
                else None,
                parked_drafts=state.get("parked_drafts")
                if isinstance(state.get("parked_drafts"), list)
                else None,
                session_history=state.get("session_history")
                if isinstance(state.get("session_history"), list)
                else None,
                semantic_decision=decision or None,
            )
            return specialist_result_from_handler(
                started,
                prior_last_entity=last_entity_from_state(state),
                default_route="customers",
            )
    return run_specialist("customers", state)
