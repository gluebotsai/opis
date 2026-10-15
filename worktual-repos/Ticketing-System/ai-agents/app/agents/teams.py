"""Teams specialist — create / members / edit / delete lifecycle."""

from __future__ import annotations

from typing import Any

from app.agents.base import run_specialist, specialist_llm_or_query
from app.agents.workflow_manager import (
    _offered_staff_from_state,
    _people_from_team_request,
    execute_team_query,
    resolve_active_workflow,
    specialist_result_from_handler,
)
from app.agents.workflow_nlu import TEAM_OPERATIONS
from app.state import AgentState
from app.workflow_state import ensure_team_draft, last_entity_from_state

_TEAM_QUERY_OPS = TEAM_OPERATIONS - {"CREATE_TEAM"} | {"GET_METRICS", "COMPARE"}


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def teams_agent(state: AgentState) -> dict:
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
    draft = ensure_team_draft(dict(state)) or (
        state.get("team_draft") if isinstance(state.get("team_draft"), dict) else None
    )
    create_awaiting = str((draft or {}).get("awaiting") or "").strip().lower()
    from app.workflow_schemas import members_from_user_text, resolve_roster_name

    offered = _offered_staff_from_state(dict(state))
    member_answer = create_awaiting in {"create_members", "members"} and bool(
        members_from_user_text(text, offered) or resolve_roster_name(text, offered)
    )
    collecting_create = create_awaiting in {
        "name",
        "description",
        "create_members",
        "confirm",
    } and (
        member_answer
        or action
        in {
            "",
            "CONTINUE_WORKFLOW",
            "CONFIRM_WORKFLOW",
            "PROVIDE_TEAM",
            "PROVIDE_MEMBERS",
            "START_CREATE_TEAM",
            "AMBIGUOUS",
            "NORMAL_ROUTE",
        }
    )
    if org and text and not collecting_create and (
        operation in _TEAM_QUERY_OPS
        or reference in {"LAST_QUERY", "LAST_ENTITY"}
        or pending
    ):
        people = _people_from_team_request(decision or {})
        offered = _offered_staff_from_state(dict(state))
        membership_lookup = bool(people) or (
            bool(offered) and operation in {"LIST_TEAMS", "SEARCH_TEAMS", "GET_TEAM"}
        )
        if not membership_lookup:
            llm_hit = specialist_llm_or_query("teams", state, should_query=True)
            if llm_hit:
                return llm_hit
        parked_snapshot: dict[str, Any] | None = None
        if state.get("parked_drafts") or state.get("team_draft") is None:
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
        out = execute_team_query(
            state,
            text,
            decision or {},
            parked_result=parked_snapshot,
        )
        return specialist_result_from_handler(
            out,
            prior_last_entity=last_entity_from_state(state),
            default_route="teams",
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
            macro_draft=None,
            team_draft=ensure_team_draft(dict(state)) or state.get("team_draft"),
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
                default_route="teams",
            )
        if isinstance(result, dict) and isinstance(result.get("team_draft"), dict):
            merged_state: dict[str, Any] = {**dict(state), "team_draft": result["team_draft"]}
            if "parked_drafts" in result:
                merged_state["parked_drafts"] = result["parked_drafts"]
            if result.get("current_workflow"):
                merged_state["current_workflow"] = result["current_workflow"]
                merged_state["current_step"] = result.get("current_step")
            state = merged_state  # type: ignore[assignment]
        draft = state.get("team_draft") if isinstance(state.get("team_draft"), dict) else None
        awaiting = str((draft or {}).get("awaiting") or "")
        if awaiting in (
            "edit_name",
            "edit_description",
            "edit_team",
            "remove_members",
            "remove_names",
            "remove_team",
            "members",
            "members_names",
            "members_team",
        ):
            from app.tasks.catalog_commands import (
                start_or_continue_add_team_members,
                start_or_continue_delete_team,
                start_or_continue_edit_team,
                start_or_continue_remove_team_members,
            )

            for fn in (
                start_or_continue_remove_team_members,
                start_or_continue_edit_team,
                start_or_continue_delete_team,
                start_or_continue_add_team_members,
            ):
                kwargs = dict(
                    org=org,
                    role=role,
                    user_id=state.get("user_id"),
                    user_name=state.get("user_name"),
                    page=state.get("page"),
                    team_draft=draft,
                )
                decision = (
                    state.get("workflow_decision")
                    if isinstance(state.get("workflow_decision"), dict)
                    else None
                )
                if fn is start_or_continue_delete_team or fn is start_or_continue_edit_team:
                    kwargs["semantic_decision"] = decision
                hit = fn(text, **kwargs)
                if hit and hit.get("handled"):
                    return specialist_result_from_handler(
                        hit,
                        prior_last_entity=last_entity_from_state(state),
                        default_route="teams",
                    )
    return run_specialist("teams", state)
