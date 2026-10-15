"""Commands shim — new mutations / nav after Workflow Manager.

Active draft continuation lives in workflow_manager. This node only runs when
no workflow owns the turn (skip_active_workflow=True).
"""

from __future__ import annotations

from app.state import AgentState
from app.tasks.chat_commands import resolve_chat_command
from app.workflow_state import enrich_handler_result, last_entity_from_state

_DRAFT_KEYS = (
    "escalate_draft",
    "reassign_draft",
    "macro_draft",
    "team_draft",
    "kb_draft",
    "ticket_draft",
    "priority_draft",
    "customer_draft",
    "parked_drafts",
    "current_workflow",
    "current_step",
    "workflow_data",
    "last_entity",
)


def _latest_user_text(state: AgentState) -> str:
    for msg in reversed(state.get("messages") or []):
        role = getattr(msg, "type", None) or getattr(msg, "role", None)
        if role in ("human", "user"):
            content = msg.content
            return content if isinstance(content, str) else str(content)
    return ""


def command_node(state: AgentState) -> dict:
    """
    Resolve new chat commands (Python/LLM heuristics) when Workflow Manager
    did not already handle the turn.
    """
    org = (state.get("organization_id") or "").strip()
    text = _latest_user_text(state)
    if not org or not text:
        return {"command_handled": False, "actions": []}

    decision = state.get("workflow_decision")
    action = (
        str(decision.get("action") or "").strip().upper()
        if isinstance(decision, dict)
        else ""
    )
    semantic_intent = str(state.get("semantic_intent") or "").strip().upper()
    if action == "SIDE_QUEST" and semantic_intent in {
        "TICKET",
        "SEARCH",
        "CUSTOMER",
        "KB",
        "TEAMS",
    }:
        # Generic list/search side quests must reach specialist tools.
        # Facet / list-all filters already have a command path that emits
        # set_filter — keep that so "high priority tickets" is not a bare list.
        from app.tasks.ui_actions import _fallback

        fb_actions = [
            a
            for a in (_fallback(text, state.get("page")).get("actions") or [])
            if isinstance(a, dict)
        ]
        has_list_ui = any(
            str(a.get("type") or "").lower() in ("set_filter", "clear_filters")
            for a in fb_actions
        )
        if not has_list_ui:
            return {"command_handled": False, "actions": []}

    result = resolve_chat_command(
        text,
        page=state.get("page"),
        organization_id=org,
        can_create_ticket=state.get("can_create_ticket"),
        user_role=state.get("user_role"),
        user_id=state.get("user_id"),
        user_name=state.get("user_name"),
        escalate_draft=state.get("escalate_draft"),
        reassign_draft=state.get("reassign_draft"),
        macro_draft=state.get("macro_draft"),
        team_draft=state.get("team_draft"),
        kb_draft=state.get("kb_draft"),
        ticket_draft=state.get("ticket_draft"),
        priority_draft=state.get("priority_draft"),
        customer_draft=state.get("customer_draft"),
        parked_drafts=state.get("parked_drafts"),
        session_history=state.get("session_history"),
        last_entity=last_entity_from_state(state),
        skip_active_workflow=True,
        workflow_decision=decision if isinstance(decision, dict) else None,
        semantic_intent=semantic_intent or None,
    )
    result = enrich_handler_result(
        result,
        prior_last_entity=last_entity_from_state(state),
    )
    actions = list(result.get("actions") or [])
    out: dict = {}
    for key in _DRAFT_KEYS:
        if key in result:
            out[key] = result[key]

    if result.get("handled"):
        out.update(
            {
                "command_handled": True,
                "reply": str(result.get("reply") or ""),
                "actions": actions,
            }
        )
        if isinstance(result.get("data"), dict):
            out["data"] = result["data"]
        route = result.get("route")
        if route:
            out["route"] = route
        return out

    out.update({"command_handled": False, "actions": actions})
    return out


def pick_after_command(state: AgentState) -> str:
    """Route to END when a command was handled; otherwise continue to intent."""
    if state.get("command_handled"):
        return "done"
    return "continue"
