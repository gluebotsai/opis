"""Escalate owned by Workflow Manager + semantic decisions (Teams pattern).

Strict transcript coverage lives here — do not add parallel escalate test files.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from app.messages_compat import HumanMessage

from app.agents.workflow_manager import resolve_active_workflow, workflow_manager_node
from app.agents.workflow_nlu import decide_workflow_turn
from app.prompts import WORKFLOW_NLU_SYSTEM
from app.tasks.chat_commands import continue_escalate_draft, start_or_continue_escalate
from app.workflow_state import WF_ESCALATE
from tests.helpers import AdvancedFakeLLM, patch_llm


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return (
        f"kind={kwargs.get('kind')}"
        f"|awaiting={ctx.get('awaiting')}"
        f"|ticket={ctx.get('ticketNumber')}"
        f"|next={ctx.get('nextStep') or kwargs.get('fallback') or 'ok'}"
    )


def _ticket(tn: str = "12840"):
    return {
        "ticket_number": tn,
        "id": f"id-{tn}",
        "subject": "VPN down",
        "status": "Open",
        "priority": "high",
        "queue_id": None,
        "skill": "network",
        "category": "Access",
        "description": "Cannot connect",
        "assignee_id": "a-fazil",
        "assignee_name": "Mohammed Fazil",
        "resolver_id": "r-ashika",
        "resolver_name": "Ashika A",
    }


def _resolvers():
    return (
        [
            {"id": "r1", "name": "Yaswanth mg", "role": "resolver"},
            {"id": "r2", "name": "Annamalai", "role": "resolver"},
        ],
        "Support",
    )


@pytest.fixture
def escalate_mocks():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.chat_commands._phrase_plus_facts",
        side_effect=lambda **kw: (
            _phrase(
                kind="escalate_prompt",
                fallback=kw.get("fallback"),
                context=kw.get("context") or {},
            )
            + (
                f"\n\n{str(kw.get('facts') or '').strip()}"
                if str(kw.get("facts") or "").strip()
                else ""
            )
        ),
    ), patch(
        "app.tasks.chat_commands._list_escalate_ticket_choices",
        return_value=[
            {"ticket_number": "#12840", "subject": "VPN down", "priority": "high"},
            {"ticket_number": "#12839", "subject": "Login loop", "priority": "medium"},
        ],
    ), patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=lambda *_a, **_k: _ticket(),
    ), patch(
        "app.tasks.chat_commands._list_team_resolvers",
        return_value=_resolvers(),
    ), patch(
        "app.tasks.chat_commands._enrich_staff_skills",
        side_effect=lambda _org, rows: rows,
    ), patch(
        "app.tasks.chat_commands._match_named_assignee",
        side_effect=lambda _org, hint, exclude_id=None, candidates=None: (
            {
                "assignee": "Yaswanth mg",
                "assignee_id": "r1",
                "rationale_extra": "matched",
            }
            if "yaswanth" in str(hint).lower()
            else None
        ),
    ), patch(
        "app.tools.ticket_write.escalate_ticket",
        return_value={
            "success": True,
            "payload": {
                "resolver": "Yaswanth mg",
                "agent": "",
                "unchanged": False,
            },
        },
    ) as esc:
        yield esc


def test_production_prompt_has_no_escalate_typo_maps():
    for bad in ("escalte", "reasign", "asignee", "bets resolver"):
        assert bad not in WORKFLOW_NLU_SYSTEM


@pytest.mark.parametrize(
    "text",
    [
        "escalate",
        "escalte this",
        "escalation please",
    ],
)
def test_semantic_start_escalate_typos(monkeypatch, text):
    patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
    decision = decide_workflow_turn(
        {
            "organization_id": "org-1",
            "page": "Tickets",
            "user_role": "admin",
            "session_history": [{"role": "user", "text": text}],
        },  # type: ignore[arg-type]
        text,
    )
    assert decision["action"] == "START_ESCALATE"
    assert decision["intent"] == "UPDATE"


@pytest.mark.parametrize(
    "text",
    [
        "reassign ticket",
        "assign to someone",
    ],
)
def test_semantic_start_reassign_typos(monkeypatch, text):
    patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
    decision = decide_workflow_turn(
        {
            "organization_id": "org-1",
            "page": "Tickets",
            "user_role": "admin",
            "session_history": [{"role": "user", "text": text}],
        },  # type: ignore[arg-type]
        text,
    )
    assert decision["action"] == "START_REASSIGN"
    assert decision["intent"] == "UPDATE"


def test_start_escalate_asks_which_ticket_semantically(escalate_mocks):
    out = start_or_continue_escalate(
        "escalate",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        intent_confirmed=True,
    )
    assert out and out["handled"] is True
    assert out["escalate_draft"]["awaiting"] == "ticket"
    assert "12840" in (out.get("reply") or "")


def test_continue_escalate_provide_ticket(escalate_mocks):
    out = continue_escalate_draft(
        "12840",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        escalate_draft={"awaiting": "ticket", "candidates": ["12840"]},
        semantic_decision={
            "action": "PROVIDE_TICKET",
            "entity_name": "12840",
            "values": [],
        },
    )
    assert out["handled"] is True
    assert out["escalate_draft"]["awaiting"] == "assignee"
    assert out["escalate_draft"]["ticket_number"] == "12840"
    assert "Yaswanth" in (out.get("reply") or "")


def test_workflow_manager_continues_assignee_step(escalate_mocks):
    hit = resolve_active_workflow(
        "Yaswanth mg",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft={"ticket_number": "12840", "awaiting": "assignee"},
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "PROVIDE_ASSIGNEE",
            "intent": "UPDATE",
            "entity_type": "ticket",
            "entity_name": "Yaswanth mg",
            "values": ["Yaswanth mg"],
            "confidence": 0.99,
        },
    )
    assert hit and hit["handled"] is True
    assert (hit.get("escalate_draft") or {}).get("awaiting") == "confirm"
    escalate_mocks.assert_not_called()
    actions = hit.get("actions") or []
    assert not any(a.get("type") == "refresh_tickets" for a in actions if isinstance(a, dict))
    assert any(
        a.get("type") == "escalate" and a.get("step") == "confirm"
        for a in actions
        if isinstance(a, dict)
    )


def test_escalate_side_quest_parks_draft():
    out = workflow_manager_node(
        {
            "messages": [HumanMessage(content="how many open tickets?")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "escalate_draft": {"ticket_number": "12840", "awaiting": "assignee"},
            "page": "Tickets",
            "workflow_decision": {
                "action": "SIDE_QUEST",
                "intent": "TICKET",
                "entity_type": None,
                "entity_name": None,
                "values": [],
                "confidence": 0.99,
            },
        }  # type: ignore[arg-type]
    )
    assert out.get("workflow_handled") is False
    assert out.get("escalate_draft") is None
    parked = next(
        item["draft"]
        for item in out.get("parked_drafts") or []
        if item.get("flow") == "escalate"
    )
    assert parked.get("awaiting") == "assignee"
    assert out.get("current_workflow") is None


def test_full_escalate_transcript(escalate_mocks):
    """escalate → 12840 → Yaswanth → refresh_tickets + last_entity; no create paths."""
    start = start_or_continue_escalate(
        "escalate",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        intent_confirmed=True,
    )
    assert start["handled"] is True
    assert start["escalate_draft"]["awaiting"] == "ticket"
    assert "12840" in start["reply"] and "12839" in start["reply"]

    picked = continue_escalate_draft(
        "12840",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        escalate_draft=start["escalate_draft"],
        semantic_decision={
            "action": "PROVIDE_TICKET",
            "entity_name": "12840",
            "values": [],
        },
    )
    assert picked["escalate_draft"]["awaiting"] == "assignee"
    assert picked["escalate_draft"]["ticket_number"] == "12840"
    assert "Yaswanth" in picked["reply"]
    assert "Annamalai" in picked["reply"]
    assert "which ticket" not in picked["reply"].lower()

    done = continue_escalate_draft(
        "Yaswanth mg",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        escalate_draft=picked["escalate_draft"],
        semantic_decision={
            "action": "PROVIDE_ASSIGNEE",
            "entity_name": "Yaswanth mg",
            "values": ["Yaswanth mg"],
        },
    )
    assert done["handled"] is True
    assert (done.get("escalate_draft") or {}).get("awaiting") == "confirm"
    draft = done.get("escalate_draft") or {}
    assert draft.get("current_agent") == "Mohammed Fazil"
    assert draft.get("current_resolver") == "Ashika A"
    assert draft.get("assignee") == "Yaswanth mg"
    assert draft.get("agent") in (None, "")
    reply = str(done.get("reply") or "")
    assert "Mohammed Fazil" in reply
    assert "Ashika A" in reply
    assert "Current agent" in reply
    assert "Proposed resolver" in reply
    assert "Yaswanth" in reply
    actions = done.get("actions") or []
    assert not any(a.get("type") == "refresh_tickets" for a in actions if isinstance(a, dict))
    assert any(
        a.get("type") == "escalate" and a.get("step") == "confirm"
        for a in actions
        if isinstance(a, dict)
    )
    assert not any(
        a.get("type") == "create_ticket" for a in actions if isinstance(a, dict)
    )
    escalate_mocks.assert_not_called()


def test_wm_transcript_start_ticket_assignee(escalate_mocks):
    start = resolve_active_workflow(
        "escalate",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "START_ESCALATE",
            "intent": "UPDATE",
            "entity_type": "ticket",
            "entity_name": None,
            "values": [],
            "confidence": 0.99,
        },
    )
    assert start and start["handled"] is True
    assert start["escalate_draft"]["awaiting"] == "ticket"

    ticket = resolve_active_workflow(
        "12840",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=start["escalate_draft"],
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "PROVIDE_TICKET",
            "intent": "UPDATE",
            "entity_type": "ticket",
            "entity_name": "12840",
            "values": [],
            "confidence": 0.99,
        },
    )
    assert ticket["escalate_draft"]["awaiting"] == "assignee"

    done = resolve_active_workflow(
        "Yaswanth mg",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=ticket["escalate_draft"],
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        workflow_decision={
            "action": "PROVIDE_ASSIGNEE",
            "intent": "UPDATE",
            "entity_type": "ticket",
            "entity_name": "Yaswanth mg",
            "values": ["Yaswanth mg"],
            "confidence": 0.99,
        },
    )
    assert (done.get("escalate_draft") or {}).get("awaiting") == "confirm"
    assert not any(
        a.get("type") == "refresh_tickets"
        for a in (done.get("actions") or [])
        if isinstance(a, dict)
    )
    escalate_mocks.assert_not_called()


def test_cancel_clears_draft(escalate_mocks):
    out = continue_escalate_draft(
        "cancel",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        escalate_draft={"ticket_number": "12840", "awaiting": "assignee"},
        semantic_decision={"action": "CANCEL_WORKFLOW", "values": []},
    )
    assert out["handled"] is True
    assert out.get("escalate_draft") is None
    escalate_mocks.assert_not_called()


def test_unknown_assignee_relists_and_keeps_draft(escalate_mocks):
    out = continue_escalate_draft(
        "Nobody Real",
        org="org-1",
        role="admin",
        user_id="u1",
        user_name="Admin",
        page="Tickets",
        escalate_draft={
            "ticket_number": "12840",
            "awaiting": "assignee",
            "candidates": ["Yaswanth mg", "Annamalai"],
        },
        semantic_decision={
            "action": "PROVIDE_ASSIGNEE",
            "entity_name": "Nobody Real",
            "values": ["Nobody Real"],
        },
    )
    assert out["handled"] is True
    assert out["escalate_draft"]["awaiting"] == "assignee"
    assert "Yaswanth" in out["reply"]
    escalate_mocks.assert_not_called()


def test_last_entity_ticket_seeds_escalate(escalate_mocks):
    hit = resolve_active_workflow(
        "escalate",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        last_entity={"type": "ticket", "id": "id-12840", "name": "12840"},
        workflow_decision={
            "action": "START_ESCALATE",
            "intent": "UPDATE",
            "entity_type": "ticket",
            "entity_name": "12840",
            "values": [],
            "confidence": 0.99,
        },
    )
    assert hit and hit["handled"] is True
    assert hit.get("escalate_draft", {}).get("awaiting") == "assignee"
    assert str(hit.get("escalate_draft", {}).get("ticket_number")) == "12840"
    assert "Yaswanth" in (hit.get("reply") or "")


@pytest.fixture
def reassign_mocks():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.chat_commands._phrase_plus_facts",
        side_effect=lambda **kw: (
            _phrase(
                kind="reassign",
                fallback=kw.get("fallback"),
                context=kw.get("context") or {},
            )
            + (
                f"\n\n{str(kw.get('facts') or '').strip()}"
                if str(kw.get("facts") or "").strip()
                else ""
            )
        ),
    ), patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=lambda *_a, **_k: {
            **_ticket(),
            "assignee_name": "Mohamed Fazil",
            "resolver_name": None,
        },
    ), patch(
        "app.tasks.assign.list_org_agents",
        return_value=[
            {"id": "a1", "name": "Mohamed Fazil", "role": "agent"},
            {"id": "a2", "name": "raghu ram", "role": "agent"},
            {"id": "r1", "name": "Yaswanth mg", "role": "resolver"},
        ],
    ), patch(
        "app.tools.ticket_write.update_ticket",
        return_value={"success": True, "payload": {"assignee": "Mohamed Fazil"}},
    ) as update_mock, patch(
        "app.tools.ticket_write.escalate_ticket",
        return_value={"success": True, "payload": {"resolver": "Yaswanth mg"}},
    ) as escalate_mock, patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={},
    ):
        yield {"update": update_mock, "escalate": escalate_mock}


def test_reassign_this_ticket_not_generic_update_loop(reassign_mocks):
    """Bare 'reassign this ticket' must start reassign_draft, not status/priority ask."""
    from app.agents.workflow_nlu import normalize_workflow_decision

    decision = normalize_workflow_decision(
        {
            "action": "NORMAL_ROUTE",
            "intent": "UPDATE",
            "operation": "UPDATE_TICKET",
            "entity_type": "ticket",
            "entity_name": "13212",
            "fields": {},
            "values": [],
            "confidence": 0.9,
            "agent": "tickets",
        },
        user_text="reassign this ticket",
    )
    assert decision["action"] == "START_REASSIGN"

    hit = resolve_active_workflow(
        "reassign this ticket",
        **_resolve_wf_kwargs(
            last_entity={
                "type": "ticket",
                "id": "id-13212",
                "name": "13212",
            },
            workflow_decision=decision,
        ),
    )
    assert hit and hit.get("handled") is True
    assert hit.get("reassign_draft", {}).get("awaiting") in {
        "target_role",
        "person",
        "confirm",
    }
    reply = str(hit.get("reply") or "").lower()
    assert "status, priority" not in reply
    assert "ready to modify" not in reply


def test_reassign_short_ticket_number_from_last_entity(reassign_mocks):
    """Just-created #4 in memory must seed reassign (not ask which ticket)."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=lambda _org, tn, **_k: {
            "ticket_number": str(tn).lstrip("#"),
            "subject": "Incorrect customer detail values",
            "assignee_name": "Mohamed Fazil",
            "resolver_name": None,
            "id": "uuid-4",
        },
    ):
        hit = resolve_active_workflow(
            "reassign this ticket",
            **_resolve_wf_kwargs(
                last_entity={"type": "ticket", "id": "uuid-4", "name": "4"},
                session_history=[
                    {
                        "role": "assistant",
                        "text": "Ticket **#4** has been successfully filed for kurinji.",
                    },
                    {"role": "user", "text": "reassign this ticket"},
                ],
                workflow_decision={
                    "action": "START_REASSIGN",
                    "intent": "UPDATE",
                    "entity_type": "ticket",
                    "confidence": 0.99,
                    "agent": "tickets",
                },
            ),
        )
    assert hit and hit.get("handled") is True
    assert str(hit.get("reassign_draft", {}).get("ticket_number") or "").lstrip("#") == "4"
    assert hit.get("reassign_draft", {}).get("awaiting") in {
        "target_role",
        "person",
        "confirm",
    }
    reply = str(hit.get("reply") or "").lower()
    assert "which ticket" not in reply
    assert "ticket number" not in reply


def test_reassign_above_created_ticket_resolves_from_history(reassign_mocks):
    """After asking which ticket, 'the above created ticket' binds the open one."""
    from app.tasks.chat_commands import continue_reassign_draft

    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=lambda _org, tn, **_k: {
            "ticket_number": str(tn).lstrip("#"),
            "subject": "Incorrect customer detail values",
            "assignee_name": "Mohamed Fazil",
            "resolver_name": None,
            "id": "uuid-4",
        },
    ):
        hit = continue_reassign_draft(
            "the above created ticket",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft={"awaiting": "ticket", "flow": "reassign"},
            semantic_decision={"action": "CONTINUE_WORKFLOW"},
            session_history=[
                {
                    "role": "assistant",
                    "text": "Ticket **#4** has been successfully filed for kurinji.",
                },
                {"role": "user", "text": "reassign this ticket"},
                {
                    "role": "assistant",
                    "text": "Please provide the ticket number.",
                },
                {"role": "user", "text": "the above created ticket"},
            ],
            last_entity={"type": "ticket", "id": "uuid-4", "name": "4"},
        )
    assert hit and hit.get("handled") is True
    assert str(hit.get("reassign_draft", {}).get("ticket_number") or "").lstrip("#") == "4"
    assert hit.get("reassign_draft", {}).get("awaiting") in {
        "target_role",
        "person",
        "confirm",
    }


def test_assignee_field_label_escapes_pending_update_loop(reassign_mocks):
    """Saying 'assignee' after a generic update ask starts reassign, not another loop."""
    from app.agents.workflow_manager import _execute_ticket_query

    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = _execute_ticket_query(
            {
                "organization_id": "org-1",
                "user_role": "agent",
                "user_id": "u1",
                "user_name": "Agent",
                "page": "Tickets",
                "conversation_context": {
                    "last_entity": {
                        "type": "ticket",
                        "id": "id-13212",
                        "name": "13212",
                    },
                    "last_query": {
                        "entity": "tickets",
                        "operation": "UPDATE_TICKET",
                        "filters": {"query": "13212"},
                        "pending_update": {},
                    },
                },
            },
            "assignee",
            {
                "action": "CONTINUE_WORKFLOW",
                "intent": "UPDATE",
                "operation": "UPDATE_TICKET",
                "entity_type": "ticket",
                "entity_name": "13212",
                "fields": {"assignee": "assignee"},
                "values": ["assignee"],
                "confidence": 0.9,
                "agent": "tickets",
            },
        )
    assert hit and hit.get("handled") is True
    assert hit.get("reassign_draft", {}).get("awaiting") in {
        "target_role",
        "person",
        "confirm",
    }
    reply = str(hit.get("reply") or "").lower()
    assert "status, priority" not in reply


def test_last_entity_ticket_seeds_reassign_asks_role(reassign_mocks):
    hit = resolve_active_workflow(
        "reassign to yaswanth",
        page="Tickets",
        organization_id="org-1",
        user_role="agent",
        user_id="u1",
        user_name="Agent",
        escalate_draft=None,
        reassign_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        last_entity={"type": "ticket", "id": "id-13211", "name": "13211"},
        workflow_decision={
            "action": "START_REASSIGN",
            "intent": "UPDATE",
            "entity_type": "ticket",
            "entity_name": "13211",
            "values": ["yaswanth"],
            "confidence": 0.99,
        },
    )
    assert hit and hit["handled"] is True
    assert hit.get("reassign_draft", {}).get("awaiting") == "target_role"
    assert str(hit.get("reassign_draft", {}).get("ticket_number")) == "12840"


def test_reassign_resolver_confirm_hands_off_to_specialist(reassign_mocks):
    """Confirm agreement is judged by specialist LLM + bind_tools, not Python regex."""
    from app.workflow_schemas import armed_write_tools_from_state, write_tool_for_armed_draft

    draft = {
        "awaiting": "confirm",
        "ticket_number": "13211",
        "target_role": "resolver",
        "person": "Yaswanth mg",
        "person_id": "r1",
        "flow": "reassign",
    }
    hit = resolve_active_workflow(
        "yeah go ahead",
        page="Tickets",
        organization_id="org-1",
        user_role="agent",
        user_id="u1",
        user_name="Agent",
        escalate_draft=None,
        reassign_draft=draft,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        last_entity={"type": "ticket", "id": "id-13211", "name": "13211"},
        workflow_decision={
            "action": "CONFIRM_WORKFLOW",
            "intent": "UPDATE",
            "confidence": 0.99,
        },
    )
    assert hit is None
    reassign_mocks["escalate"].assert_not_called()
    reassign_mocks["update"].assert_not_called()
    assert write_tool_for_armed_draft("reassign_draft", draft) == "escalate_ticket"
    armed = armed_write_tools_from_state(
        {
            "reassign_draft": draft,
            "current_workflow": "reassign_ticket",
            "current_step": "confirm",
        }
    )
    assert "escalate_ticket" in armed


def test_reassign_resolver_then_raghu_asks_confirm_not_role(reassign_mocks):
    """Person collect must not restart agent-vs-resolver when user picks a resolver."""
    draft = {
        "awaiting": "person",
        "ticket_number": "13212",
        "target_role": "resolver",
        "flow": "reassign",
    }
    hit = resolve_active_workflow(
        "yaswanth",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        reassign_draft=draft,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        last_entity={"type": "ticket", "id": "id-13212", "name": "13212"},
        workflow_decision={
            "action": "CONTINUE_WORKFLOW",
            "intent": "UPDATE",
            "entity_name": "yaswanth",
            "values": ["yaswanth"],
            "confidence": 0.99,
        },
    )
    assert hit and hit["handled"] is True
    assert hit.get("reassign_draft", {}).get("awaiting") == "confirm"
    assert hit.get("reassign_draft", {}).get("target_role") == "resolver"
    assert hit.get("reassign_draft", {}).get("person") == "Yaswanth mg"
    assert hit.get("current_step") == "confirm"


def test_reassign_person_ignores_ticket_entity_name(reassign_mocks):
    """NLU often echoes open ticket # as entity_name — user text must win on person step."""
    draft = {
        "awaiting": "person",
        "ticket_number": "13212",
        "target_role": "agent",
        "flow": "reassign",
    }
    hit = resolve_active_workflow(
        "raghu",
        page="Tickets",
        organization_id="org-1",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=None,
        reassign_draft=draft,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        parked_drafts=None,
        session_history=None,
        last_entity={"type": "ticket", "id": "id-13212", "name": "13212"},
        workflow_decision={
            "action": "CONTINUE_WORKFLOW",
            "intent": "UPDATE",
            "entity_name": "13212",
            "values": ["13212"],
            "confidence": 0.99,
        },
    )
    assert hit and hit["handled"] is True
    assert hit.get("reassign_draft", {}).get("awaiting") == "confirm"
    assert hit.get("reassign_draft", {}).get("person") == "raghu ram"


def test_person_hint_resolves_partial_name_to_db_spelling():
    from app.tasks.chat_commands import _person_hint_from_collect

    hint = _person_hint_from_collect(
        "raghu",
        {"entity_name": "13212", "values": ["13212"]},
        ticket_number="13212",
        roster_names=["Mohamed Fazil", "raghu ram"],
    )
    assert hint == "raghu ram"


def test_person_hint_resolves_fazil_short_name():
    from app.tasks.chat_commands import _person_hint_from_collect

    hint = _person_hint_from_collect(
        "fazil",
        {"entity_name": "fazil", "values": ["fazil"]},
        ticket_number="13208",
        roster_names=["Mohamed Fazil", "raghu ram"],
    )
    assert hint == "Mohamed Fazil"


def test_person_hint_prefers_llm_exact_fields_person():
    from app.tasks.chat_commands import _person_hint_from_collect

    hint = _person_hint_from_collect(
        "fazil please",
        {
            "fields": {"person": "Mohamed Fazil"},
            "entity_name": "13208",
            "values": ["13208"],
        },
        ticket_number="13208",
        roster_names=["Mohamed Fazil", "raghu ram"],
    )
    assert hint == "Mohamed Fazil"


def test_roster_from_state_prefers_reassign_candidates():
    from app.agents.workflow_nlu import _roster_from_state

    names = _roster_from_state(
        {
            "reassign_draft": {
                "awaiting": "person",
                "candidates": ["Mohamed Fazil", "raghu ram"],
            },
            "team_draft": {},
            "tool_memory": {},
        }
    )
    assert names == ["Mohamed Fazil", "raghu ram"]



def test_reassign_suggest_already_assigned_agent_is_called_out(reassign_mocks):
    """Skill match equal to current agent must say they are already assigned."""
    from app.tasks.chat_commands import continue_reassign_draft

    with patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={
            "agent": "Raghuram M",
            "agent_id": "a-raghu",
            "resolver": "Ashika A",
            "resolver_id": "r1",
            "rationale": "skill match",
        },
    ), patch(
        "app.tasks.chat_commands._find_ticket",
        return_value={
            "ticket_number": "4",
            "id": "id-4",
            "subject": "Incorrect customer detail values",
            "status": "Open",
            "priority": "medium",
            "queue_name": "Bug Solvers",
            "skill": "Data Integrity",
            "category": "Data Integrity",
            "description": "wrong values",
            "assignee_id": "a-raghu",
            "assignee_name": "Raghuram M",
            "resolver_id": "r1",
            "resolver_name": "Ashika A",
        },
    ), patch(
        "app.tasks.chat_commands._reassign_roster_for_role",
        return_value=[
            {"id": "a-fazil", "name": "Mohammed Fazil", "role": "agent"},
            {"id": "a-raghu", "name": "Raghuram M", "role": "agent"},
        ],
    ):
        hit = continue_reassign_draft(
            "agent",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            reassign_draft={
                "awaiting": "target_role",
                "ticket_number": "4",
                "flow": "reassign",
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "entity_name": "agent",
                "values": ["agent"],
                "fields": {},
            },
        )
    assert hit and hit.get("handled") is True
    assert (hit.get("reassign_draft") or {}).get("awaiting") == "person"
    reply = str(hit.get("reply") or "")
    assert "Raghuram M" in reply
    assert "already" in reply.lower()
    assert "Suggested (skill match): **Raghuram M**" not in reply


def test_reassign_the_agent_is_role_not_person_name(reassign_mocks):
    """AI contract: role-only turn lists agents — never 'couldn't find that name'."""
    from app.tasks.chat_commands import continue_reassign_draft

    roster_rows = [
        {"id": "12", "name": "Mohammed Fazil", "role": "agent"},
        {"id": "18", "name": "Raghuram M", "role": "agent"},
    ]
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ), patch(
        "app.tasks.chat_commands._reassign_roster_for_role",
        return_value=roster_rows,
    ), patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={},
    ):
        # NLU understands ROLE target; person omitted (correct AI extraction).
        hit = continue_reassign_draft(
            "reassign the agent",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft={
                "awaiting": "target_role",
                "ticket_number": "13208",
                "flow": "reassign",
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {"target_role": "agent"},
                "entity_name": "agent",
                "values": ["agent"],
            },
        )
    draft = hit.get("reassign_draft") or {}
    assert hit.get("handled") is True
    assert draft.get("awaiting") == "person"
    assert draft.get("target_role") == "agent"
    assert not draft.get("person")
    reply = str(hit.get("reply") or "").lower()
    assert "mohammed fazil" in reply or "raghuram" in reply
    assert "couldn't find" not in reply
    assert "could not find" not in reply
    assert "no match" not in reply


def test_reassign_the_agent_without_nlu_fields_still_role_only(reassign_mocks):
    """Even if NLU omits fields, awaiting=target_role must not use utterance as person."""
    from app.tasks.chat_commands import continue_reassign_draft

    roster_rows = [
        {"id": "12", "name": "Mohammed Fazil", "role": "agent"},
        {"id": "18", "name": "Raghuram M", "role": "agent"},
    ]
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ), patch(
        "app.tasks.chat_commands._reassign_roster_for_role",
        return_value=roster_rows,
    ), patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={},
    ):
        hit = continue_reassign_draft(
            "reassign the agent",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft={
                "awaiting": "target_role",
                "ticket_number": "13208",
                "flow": "reassign",
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {},
            },
        )
    draft = hit.get("reassign_draft") or {}
    assert draft.get("awaiting") == "person"
    assert draft.get("target_role") == "agent"
    reply = str(hit.get("reply") or "").lower()
    assert "couldn't find" not in reply
    assert "could not find" not in reply


def test_nlu_target_role_strips_agent_from_person_field():
    from app.agents.workflow_nlu import ground_active_collect_decision

    out = ground_active_collect_decision(
        {
            "action": "CONTINUE_WORKFLOW",
            "fields": {"target_role": "agent", "person": "agent"},
            "entity_name": "agent",
            "values": ["agent"],
        },
        workflow="reassign_ticket",
        step="target_role",
        user_text="reassign the agent",
        roster_members=["Mohammed Fazil", "Raghuram M"],
        draft={"awaiting": "target_role", "ticket_number": "23"},
    )
    fields = out.get("fields") or {}
    assert fields.get("target_role") == "agent"
    assert not fields.get("person")


def test_escalate_the_resolver_is_role_not_person_name(escalate_mocks):
    """AI contract: role-only turn lists resolvers — never 'couldn't find that name'."""
    out = continue_escalate_draft(
        "escalate to the resolver",
        org="org-1",
        role="agent",
        user_id="u1",
        user_name="Agent",
        page="Tickets",
        escalate_draft={
            "awaiting": "assignee",
            "ticket_number": "12840",
            "candidates": ["Yaswanth mg", "Annamalai"],
        },
        semantic_decision={
            "action": "CONTINUE_WORKFLOW",
            "fields": {"assignee": "resolver"},
            "entity_name": "resolver",
            "values": ["resolver"],
        },
    )
    draft = out.get("escalate_draft") or {}
    assert out.get("handled") is True
    assert draft.get("awaiting") == "assignee"
    assert not draft.get("assignee")
    reply = str(out.get("reply") or "").lower()
    assert "yaswanth" in reply or "annamalai" in reply
    assert "couldn't find" not in reply
    assert "could not find" not in reply
    assert "no match" not in reply


def test_escalate_the_resolver_without_nlu_fields_still_role_only(escalate_mocks):
    """Even if NLU omits fields, awaiting=assignee must not use utterance as person."""
    out = continue_escalate_draft(
        "escalate to the resolver",
        org="org-1",
        role="agent",
        user_id="u1",
        user_name="Agent",
        page="Tickets",
        escalate_draft={
            "awaiting": "assignee",
            "ticket_number": "12840",
            "candidates": ["Yaswanth mg", "Annamalai"],
        },
        semantic_decision={
            "action": "CONTINUE_WORKFLOW",
            "fields": {},
        },
    )
    draft = out.get("escalate_draft") or {}
    assert draft.get("awaiting") == "assignee"
    reply = str(out.get("reply") or "").lower()
    assert "couldn't find" not in reply
    assert "could not find" not in reply


def test_nlu_escalate_assignee_strips_resolver_from_person_field():
    from app.agents.workflow_nlu import ground_active_collect_decision

    out = ground_active_collect_decision(
        {
            "action": "CONTINUE_WORKFLOW",
            "fields": {"assignee": "resolver"},
            "entity_name": "resolver",
            "values": ["resolver"],
        },
        workflow="escalate",
        step="assignee",
        user_text="escalate to the resolver",
        roster_members=["Yaswanth mg", "Annamalai"],
        draft={"awaiting": "assignee", "ticket_number": "12840"},
    )
    fields = out.get("fields") or {}
    assert not fields.get("assignee")
    assert not fields.get("person")
    assert not out.get("entity_name")
    assert not out.get("values")


def test_legacy_escalate_assignee_path_role_only_lists_roster(escalate_mocks):
    """Legacy resolve_chat_command path must not treat role phrase as person name."""
    from app.tasks.chat_commands import resolve_chat_command

    out = resolve_chat_command(
        "escalate to the resolver",
        organization_id="org-1",
        user_role="agent",
        user_id="u1",
        user_name="Agent",
        page="Tickets",
        escalate_draft={
            "awaiting": "assignee",
            "ticket_number": "12840",
            "candidates": ["Yaswanth mg", "Annamalai"],
        },
        skip_active_workflow=True,
        workflow_decision={"action": "CONTINUE_WORKFLOW", "fields": {}},
    )
    draft = out.get("escalate_draft") or {}
    assert out.get("handled") is True
    assert draft.get("awaiting") == "assignee"
    reply = str(out.get("reply") or "").lower()
    assert "couldn't find" not in reply
    assert "could not find" not in reply


def test_looks_like_assignee_choice_rejects_role_only():
    from app.tasks.chat_commands import _looks_like_assignee_choice

    assert not _looks_like_assignee_choice(
        "escalate to the resolver",
        {"candidates": ["Yaswanth mg", "Annamalai"]},
    )
    assert _looks_like_assignee_choice(
        "ashika",
        {"candidates": ["Ashika A", "Yaswanth mg"]},
    )


def test_reassign_person_step_fazil_goes_to_confirm(reassign_mocks):
    from app.tasks.chat_commands import continue_reassign_draft

    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = continue_reassign_draft(
            "fazil",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft={
                "awaiting": "person",
                "ticket_number": "13208",
                "target_role": "agent",
                "candidates": ["Mohamed Fazil", "raghu ram"],
                "flow": "reassign",
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {"person": "Mohamed Fazil"},
                "entity_name": "fazil",
                "values": ["fazil"],
            },
        )
    assert hit.get("reassign_draft", {}).get("awaiting") == "confirm"
    assert hit.get("reassign_draft", {}).get("person") == "Mohamed Fazil"


def test_ticket_person_resolution_clear_vs_propose():
    from app.workflow_schemas import ticket_person_resolution

    roster = [
        {"id": "12", "name": "Raghuram M"},
        {"id": "18", "name": "Rahul Kumar"},
        {"id": "20", "name": "Mohamed Fazil"},
    ]
    clear = ticket_person_resolution("fazil", roster)
    assert clear and clear["kind"] == "clear"
    assert clear["name"] == "Mohamed Fazil"
    # Both Raghuram and Rahul are plausible for \"rahu\" → ask which.
    amb = ticket_person_resolution("rahu", roster)
    assert amb and amb["kind"] == "ambiguous"
    names = {str(c.get("name")) for c in (amb.get("candidates") or [])}
    assert "Raghuram M" in names and "Rahul Kumar" in names
    # Unique fuzzy-only typo → propose (Did you mean?).
    propose = ticket_person_resolution(
        "rahu",
        [
            {"id": "12", "name": "Raghuram M"},
            {"id": "20", "name": "Mohamed Fazil"},
        ],
    )
    assert propose and propose["kind"] == "propose"
    assert propose["name"] == "Raghuram M"
    assert ticket_person_resolution("nobody", roster) is None


def test_reassign_typo_asks_did_you_mean_then_confirm(reassign_mocks):
    from app.tasks.chat_commands import continue_reassign_draft

    roster_rows = [
        {"id": "12", "name": "Raghuram M", "role": "agent"},
        {"id": "20", "name": "Mohamed Fazil", "role": "agent"},
    ]
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ), patch(
        "app.tasks.chat_commands._reassign_roster_for_role",
        return_value=roster_rows,
    ), patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={},
    ):
        ask = continue_reassign_draft(
            "rahu",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft={
                "awaiting": "person",
                "ticket_number": "13208",
                "target_role": "agent",
                "candidates": ["Raghuram M", "Mohamed Fazil"],
                "flow": "reassign",
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {"person": "rahu"},
                "entity_name": "rahu",
                "values": ["rahu"],
            },
        )
    draft = ask.get("reassign_draft") or {}
    # Did-you-mean lands on confirm with canonical person already bound.
    assert draft.get("awaiting") == "confirm"
    assert draft.get("person") == "Raghuram M"
    assert draft.get("person_id") == "12"
    assert draft.get("proposed_person") == "Raghuram M"
    assert ask.get("handled") is True
    assert "did you mean" in str(ask.get("reply") or "").lower() or "raghuram" in str(
        ask.get("reply") or ""
    ).lower()

    # CONTINUE / yeah/ with no different roster name → specialist write handoff
    # (no rematch; same person_id).
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ), patch(
        "app.tasks.chat_commands._reassign_roster_for_role",
        return_value=roster_rows,
    ), patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={},
    ):
        confirmed = continue_reassign_draft(
            "yeah/",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft=draft,
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {"person": "Raghuram M"},
            },
        )
    assert confirmed.get("handled") is False
    assert confirmed.get("reassign_draft", {}).get("awaiting") == "confirm"
    assert confirmed.get("reassign_draft", {}).get("person") == "Raghuram M"
    assert confirmed.get("reassign_draft", {}).get("person_id") == "12"
    reassign_mocks["update"].assert_not_called()
    reassign_mocks["escalate"].assert_not_called()


def test_person_from_user_text_finds_raghu_in_full_command():
    from app.workflow_schemas import person_from_user_text

    assert (
        person_from_user_text(
            "reassign #13208 to raghu as agent",
            ["Mohamed Fazil", "raghu ram", "Yaswanth mg"],
        )
        == "raghu ram"
    )


def test_reassign_oneshot_command_resolves_raghu_not_missing_name(reassign_mocks):
    from app.tasks.chat_commands import start_or_continue_reassign

    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = start_or_continue_reassign(
            "reassign #13208 to raghu as agent",
            org="org-1",
            role="agent",
            user_id="u1",
            user_name="Agent",
            page="Tickets",
            reassign_draft=None,
            intent_confirmed=True,
            resolved_ticket_number="13208",
            resolved_person="13208",
            resolved_target_role="agent",
            semantic_decision={
                "action": "START_REASSIGN",
                "entity_type": "ticket",
                "entity_name": "13208",
                "values": ["13208", "agent"],
                "fields": {},
            },
        )
    assert hit and hit.get("handled") is True
    assert hit.get("reassign_draft", {}).get("awaiting") == "confirm"
    assert hit.get("reassign_draft", {}).get("person") == "raghu ram"
    assert "couldn't find" not in str(hit.get("reply") or "").lower()
    assert "could not find" not in str(hit.get("reply") or "").lower()


def test_reassign_agent_arms_update_ticket_at_confirm(reassign_mocks):
    from app.tasks.chat_commands import start_or_continue_reassign
    from app.workflow_schemas import write_tool_for_armed_draft

    draft = {
        "awaiting": "confirm",
        "ticket_number": "13211",
        "target_role": "agent",
        "person": "Mohamed Fazil",
        "person_id": "a1",
        "flow": "reassign",
    }
    assert write_tool_for_armed_draft("reassign_draft", draft) == "update_ticket"
    hit = start_or_continue_reassign(
        "yeah do it",
        org="org-1",
        role="agent",
        user_id="u1",
        user_name="Agent",
        page="Tickets",
        reassign_draft=draft,
        intent_confirmed=True,
        resolved_ticket_number="13211",
        semantic_decision={"action": "CONFIRM_WORKFLOW"},
    )
    assert hit and hit.get("handled") is False
    reassign_mocks["update"].assert_not_called()
    reassign_mocks["escalate"].assert_not_called()


FIVE_TICKETS = ["13208", "13209", "13210", "13211", "13212"]


def _find_ticket_by_number(org_id, ticket_number, **kwargs):
    tn = str(ticket_number or "").strip().lstrip("#") or "12840"
    return {
        **_ticket(tn),
        "assignee_name": "Mohamed Fazil",
        "resolver_name": None,
    }


def _resolve_wf_kwargs(**overrides):
    base = {
        "page": "Tickets",
        "organization_id": "org-1",
        "user_role": "agent",
        "user_id": "u1",
        "user_name": "Agent",
        "escalate_draft": None,
        "reassign_draft": None,
        "macro_draft": None,
        "team_draft": None,
        "kb_draft": None,
        "parked_drafts": None,
        "session_history": None,
    }
    base.update(overrides)
    return base


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_escalate_transcript_per_ticket(ticket_number, escalate_mocks):
    """escalate → ticket → assignee → confirm for each of 5 tickets."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        start = start_or_continue_escalate(
            "escalate",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            intent_confirmed=True,
        )
        assert start["escalate_draft"]["awaiting"] == "ticket"

        picked = continue_escalate_draft(
            ticket_number,
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            escalate_draft=start["escalate_draft"],
            semantic_decision={
                "action": "PROVIDE_TICKET",
                "entity_name": ticket_number,
                "values": [ticket_number],
            },
        )
        assert picked["escalate_draft"]["awaiting"] == "assignee"
        assert str(picked["escalate_draft"]["ticket_number"]) == ticket_number

        done = continue_escalate_draft(
            "Yaswanth",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            escalate_draft=picked["escalate_draft"],
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "entity_name": "Yaswanth",
                "values": ["Yaswanth"],
            },
        )
        assert done["escalate_draft"]["awaiting"] == "confirm"
        assert str(done["escalate_draft"]["ticket_number"]) == ticket_number
        assert done["escalate_draft"].get("assignee") or done["escalate_draft"].get(
            "person"
        ) or "Yaswanth" in str(done.get("reply") or "")


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_escalate_last_entity_skips_ticket_step(ticket_number, escalate_mocks):
    """Open ticket detail seeds escalate assignee step (no re-ask ticket)."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = resolve_active_workflow(
            "escalate",
            **_resolve_wf_kwargs(
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "START_ESCALATE",
                    "intent": "UPDATE",
                    "confidence": 0.99,
                },
            ),
        )
        assert hit and hit["handled"] is True
        assert hit["escalate_draft"]["awaiting"] == "assignee"
        assert str(hit["escalate_draft"]["ticket_number"]) == ticket_number


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_reassign_agent_transcript_per_ticket(ticket_number, reassign_mocks):
    """reassign: agent → partial name → confirm for each ticket."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        role_hit = resolve_active_workflow(
            "agent",
            **_resolve_wf_kwargs(
                reassign_draft={
                    "awaiting": "target_role",
                    "ticket_number": ticket_number,
                    "flow": "reassign",
                },
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": "agent",
                    "values": ["agent"],
                },
            ),
        )
        assert role_hit and role_hit["handled"] is True
        assert role_hit["reassign_draft"]["awaiting"] == "person"
        assert role_hit["reassign_draft"]["target_role"] == "agent"
        assert str(role_hit["reassign_draft"]["ticket_number"]) == ticket_number

        person_hit = resolve_active_workflow(
            "raghu",
            **_resolve_wf_kwargs(
                reassign_draft=role_hit["reassign_draft"],
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": "13212" if ticket_number == "13212" else ticket_number,
                    "values": [ticket_number],
                },
            ),
        )
        assert person_hit and person_hit["handled"] is True
        assert person_hit["reassign_draft"]["awaiting"] == "confirm"
        assert person_hit["reassign_draft"]["person"] == "raghu ram"
        assert person_hit["reassign_draft"]["person_id"] == "a2"
        assert person_hit["reassign_draft"]["target_role"] == "agent"

        from app.workflow_schemas import write_tool_for_armed_draft

        assert (
            write_tool_for_armed_draft("reassign_draft", person_hit["reassign_draft"])
            == "update_ticket"
        )


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_reassign_resolver_transcript_per_ticket(ticket_number, reassign_mocks):
    """reassign: resolver → Yaswanth → confirm for each ticket."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        role_hit = resolve_active_workflow(
            "resolver",
            **_resolve_wf_kwargs(
                reassign_draft={
                    "awaiting": "target_role",
                    "ticket_number": ticket_number,
                    "flow": "reassign",
                },
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": "resolver",
                    "values": ["resolver"],
                },
            ),
        )
        assert role_hit["reassign_draft"]["awaiting"] == "person"
        assert role_hit["reassign_draft"]["target_role"] == "resolver"

        person_hit = resolve_active_workflow(
            "yaswanth",
            **_resolve_wf_kwargs(
                reassign_draft=role_hit["reassign_draft"],
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": ticket_number,
                    "values": [ticket_number],
                },
            ),
        )
        assert person_hit["reassign_draft"]["awaiting"] == "confirm"
        assert person_hit["reassign_draft"]["person"] == "Yaswanth mg"
        assert person_hit["reassign_draft"]["person_id"] == "r1"

        from app.workflow_schemas import write_tool_for_armed_draft

        assert (
            write_tool_for_armed_draft("reassign_draft", person_hit["reassign_draft"])
            == "escalate_ticket"
        )


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_reassign_confirm_hands_off_per_ticket(ticket_number, reassign_mocks):
    """Confirm step returns None — specialist owns write for all tickets."""
    draft = {
        "awaiting": "confirm",
        "ticket_number": ticket_number,
        "target_role": "resolver",
        "person": "Yaswanth mg",
        "person_id": "r1",
        "flow": "reassign",
    }
    hit = resolve_active_workflow(
        "go ahead",
        **_resolve_wf_kwargs(
            reassign_draft=draft,
            last_entity={
                "type": "ticket",
                "id": f"id-{ticket_number}",
                "name": ticket_number,
            },
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "UPDATE",
            },
        ),
    )
    assert hit is None
    reassign_mocks["escalate"].assert_not_called()
    reassign_mocks["update"].assert_not_called()


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_reassign_unknown_person_keeps_draft(ticket_number, reassign_mocks):
    """Unknown name stays on person step with candidates preserved."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = resolve_active_workflow(
            "nobody_here",
            **_resolve_wf_kwargs(
                reassign_draft={
                    "awaiting": "person",
                    "ticket_number": ticket_number,
                    "target_role": "agent",
                    "candidates": ["Mohamed Fazil", "raghu ram"],
                    "flow": "reassign",
                },
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "entity_name": "nobody_here",
                },
            ),
        )
        assert hit and hit["handled"] is True
        assert hit["reassign_draft"]["awaiting"] == "person"
        assert str(hit["reassign_draft"]["ticket_number"]) == ticket_number
        assert hit["reassign_draft"].get("candidates")


@pytest.mark.parametrize("ticket_number", FIVE_TICKETS)
def test_reassign_start_from_last_entity_per_ticket(ticket_number, reassign_mocks):
    """START_REASSIGN with open ticket asks agent vs resolver."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = resolve_active_workflow(
            "reassign this ticket",
            **_resolve_wf_kwargs(
                last_entity={
                    "type": "ticket",
                    "id": f"id-{ticket_number}",
                    "name": ticket_number,
                },
                workflow_decision={
                    "action": "START_REASSIGN",
                    "intent": "UPDATE",
                    "entity_type": "ticket",
                    "entity_name": ticket_number,
                },
            ),
        )
        assert hit and hit["handled"] is True
        assert hit["reassign_draft"]["awaiting"] == "target_role"
        assert str(hit["reassign_draft"]["ticket_number"]) == ticket_number


def test_start_reassign_clears_stale_escalate_confirm(reassign_mocks):
    """Stale escalate-at-confirm must not swallow START_REASSIGN (confirm loop)."""
    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = resolve_active_workflow(
            "reassign this ticket to any other resolver",
            **_resolve_wf_kwargs(
                escalate_draft={
                    "awaiting": "confirm",
                    "ticket_number": "4",
                    "assignee": "Sri Annamalai",
                    "assignee_id": "a1",
                },
                last_entity={"type": "ticket", "id": "id-4", "name": "4"},
                workflow_decision={
                    "action": "START_REASSIGN",
                    "intent": "TICKET",
                    "entity_type": "ticket",
                    "entity_name": "#4",
                    "fields": {},
                },
            ),
        )
    assert hit and hit["handled"] is True
    assert hit.get("escalate_draft") is None
    assert (hit.get("reassign_draft") or {}).get("ticket_number") in {"4", "#4"}
    assert str((hit.get("reassign_draft") or {}).get("awaiting") or "") in {
        "target_role",
        "person",
    }


def test_tickets_agent_start_reassign_not_swallowed_by_last_entity(reassign_mocks):
    """START_REASSIGN + LAST_ENTITY must start reassign, not ticket follow-up/update."""
    from app.agents.tickets import tickets_agent
    from app.messages_compat import HumanMessage

    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        out = tickets_agent(
            {
                "messages": [
                    HumanMessage(content="reassign this to other resolver")
                ],
                "organization_id": "org-1",
                "user_id": "u1",
                "user_name": "Admin",
                "user_role": "admin",
                "page": "All tickets",
                "last_entity": {"type": "ticket", "id": "id-4", "name": "4"},
                "workflow_decision": {
                    "action": "START_REASSIGN",
                    "intent": "TICKET",
                    "entity_type": "ticket",
                    "entity_name": "4",
                    "reference": "LAST_ENTITY",
                    "operation": "NONE",
                    "workflow": "reassign_ticket",
                    "agent": "tickets",
                    "fields": {},
                },
            }
        )
    assert (out.get("reassign_draft") or {}).get("awaiting") in {
        "target_role",
        "person",
        "ticket",
    }
    assert out.get("current_workflow") in {"reassign_ticket", "reassign"}
    reply = str(out.get("reply") or "").lower()
    assert "status, priority, assignee, queue" not in reply


def test_hydrate_prefers_reassign_when_current_workflow_set():
    from app.workflow_state import hydrate_from_legacy_drafts

    snap = hydrate_from_legacy_drafts(
        escalate_draft={
            "awaiting": "confirm",
            "ticket_number": "4",
            "assignee": "Sri Annamalai",
        },
        reassign_draft={
            "awaiting": "person",
            "ticket_number": "4",
            "target_role": "resolver",
        },
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
        current_workflow="reassign_ticket",
        current_step="person",
    )
    assert snap.get("current_workflow") == "reassign_ticket"
    assert snap.get("current_step") == "person"


def test_normalize_ticket_row_keeps_resolver():
    from app.tasks.chat_commands import _normalize_ticket_row

    row = _normalize_ticket_row(
        {
            "id": "#4",
            "subject": "Incorrect customer detail values",
            "assignee": "Mohammed Fazil",
            "assigneeId": "1001",
            "resolver": "Ashika A",
            "resolverId": "1002",
        }
    )
    assert row is not None
    assert row["assignee_name"] == "Mohammed Fazil"
    assert row["resolver_name"] == "Ashika A"
    assert row["resolver_id"] == "1002"


def test_show_resolvers_mid_reassign_lists_roster_not_side_quest(reassign_mocks):
    """At target_role, 'show me the resolvers' must list names and stay on reassign."""
    from app.agents.workflow_nlu import ground_active_collect_decision

    grounded = ground_active_collect_decision(
        {
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "operation": "NONE",
            "filters": {"skill": "resolver"},
            "agent": "tickets",
            "workflow": "reassign_ticket",
        },
        workflow="reassign_ticket",
        step="target_role",
        user_text="show me the resolvers",
        roster_members=["Ashika A", "Yaswanth MG"],
    )
    assert grounded.get("action") == "CONTINUE_WORKFLOW"

    with patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=_find_ticket_by_number,
    ):
        hit = resolve_active_workflow(
            "show me the resolvers",
            **_resolve_wf_kwargs(
                reassign_draft={
                    "awaiting": "target_role",
                    "ticket_number": "4",
                    "flow": "reassign",
                },
                last_entity={"type": "ticket", "id": "id-4", "name": "4"},
                workflow_decision=grounded,
            ),
        )
    assert hit and hit.get("handled") is True
    draft = hit.get("reassign_draft") or {}
    assert draft.get("awaiting") == "person"
    assert draft.get("target_role") == "resolver"
    assert draft.get("candidates")
    reply = str(hit.get("reply") or "").lower()
    assert "metric" not in reply
    assert "authentication" not in reply
    assert "yaswanth" in reply


def test_resolver_after_agent_confirm_lists_roster(reassign_mocks):
    """Saying 'resolver' at agent confirm must list resolvers, not invent ticket people."""
    hit = resolve_active_workflow(
        "resolver",
        **_resolve_wf_kwargs(
            reassign_draft={
                "awaiting": "confirm",
                "ticket_number": "4",
                "target_role": "agent",
                "person": "raghu ram",
                "person_id": "a2",
                "flow": "reassign",
            },
            last_entity={"type": "ticket", "id": "id-4", "name": "4"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "entity_name": "resolver",
                "values": ["resolver"],
            },
        ),
    )
    assert hit and hit.get("handled") is True
    draft = hit.get("reassign_draft") or {}
    assert draft.get("awaiting") == "person"
    assert draft.get("target_role") == "resolver"
    assert draft.get("candidates") == ["Yaswanth mg"]
    reply = str(hit.get("reply") or "")
    assert "Yaswanth" in reply
    assert "current resolver" not in reply.lower()


def test_reasing_typo_starts_reassign(reassign_mocks):
    """Typo 'reasing this ticket' must START_REASSIGN, not 'already updated'."""
    from app.agents.workflow_nlu import normalize_workflow_decision
    from app.workflow_schemas import utterance_plausibly_starts_reassign

    assert utterance_plausibly_starts_reassign("reasing this ticket")
    decision = normalize_workflow_decision(
        {
            "action": "NORMAL_ROUTE",
            "intent": "UPDATE",
            "operation": "UPDATE_TICKET",
            "entity_type": "ticket",
            "entity_name": "4",
            "fields": {},
            "values": [],
            "confidence": 0.9,
            "agent": "tickets",
        },
        user_text="reasing this ticket",
    )
    assert decision["action"] == "START_REASSIGN"

    hit = resolve_active_workflow(
        "reasing this ticket",
        **_resolve_wf_kwargs(
            last_entity={"type": "ticket", "id": "id-4", "name": "4"},
            workflow_decision=decision,
        ),
    )
    assert hit and hit.get("handled") is True
    assert hit.get("reassign_draft", {}).get("awaiting") in {
        "target_role",
        "person",
        "confirm",
    }
    reply = str(hit.get("reply") or "").lower()
    assert "already updated" not in reply
    assert "status, priority" not in reply


def test_idle_show_resolvers_starts_reassign_lists_roster(reassign_mocks):
    """Idle 'show resolvers' must list DB resolvers — not greeting/metrics."""
    from app.agents.workflow_nlu import normalize_workflow_decision

    decision = normalize_workflow_decision(
        {
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "entity_type": "ticket",
            "entity_name": "4",
            "fields": {},
            "values": [],
            "confidence": 0.9,
            "agent": "tickets",
        },
        user_text="show resolvers",
    )
    assert decision["action"] == "START_REASSIGN"
    assert (decision.get("fields") or {}).get("target_role") == "resolver"

    hit = resolve_active_workflow(
        "show resolvers",
        **_resolve_wf_kwargs(
            last_entity={"type": "ticket", "id": "id-4", "name": "4"},
            workflow_decision=decision,
        ),
    )
    assert hit and hit.get("handled") is True
    draft = hit.get("reassign_draft") or {}
    assert draft.get("awaiting") == "person"
    assert draft.get("target_role") == "resolver"
    assert "Yaswanth" in str(hit.get("reply") or "")
    assert "current resolver" not in str(hit.get("reply") or "").lower()
    assert "hello" not in str(hit.get("reply") or "").lower()


def test_match_named_assignee_prefers_candidates_partial_name():
    """Natural partial names resolve to canonical DB spelling from offered list."""
    from app.tasks import chat_commands as cc

    staff = [
        {"id": "1", "name": "Ashika A", "role": "resolver"},
        {"id": "2", "name": "Sri Annamalai", "role": "resolver"},
        {"id": "3", "name": "Yaswanth MG", "role": "resolver"},
    ]
    with patch.object(cc, "list_org_agents", return_value=staff):
        hit = cc._match_named_assignee(
            "org-1",
            "ashika",
            candidates=["Ashika A", "Sri Annamalai", "Yaswanth MG"],
        )
    assert hit and hit.get("assignee") == "Ashika A"
    assert hit.get("assignee_id") == "1"


def test_match_named_assignee_ambiguous_asks_not_guess():
    from app.tasks import chat_commands as cc

    staff = [
        {"id": "1", "name": "John A", "role": "resolver"},
        {"id": "2", "name": "John B", "role": "resolver"},
        {"id": "3", "name": "Yaswanth MG", "role": "resolver"},
    ]
    with patch.object(cc, "list_org_agents", return_value=staff):
        hit = cc._match_named_assignee(
            "org-1",
            "john",
            candidates=["John A", "John B", "Yaswanth MG"],
        )
    assert hit and hit.get("ambiguous")
    names = {str(a.get("name")) for a in hit["ambiguous"]}
    assert names == {"John A", "John B"}


def test_continue_escalate_ashika_uses_candidates():
    """Partial name against draft candidates reaches confirm with canonical spelling."""
    from app.tasks import chat_commands as cc

    staff = [
        {"id": "a1", "name": "Ashika A", "role": "resolver"},
        {"id": "r1", "name": "Yaswanth mg", "role": "resolver"},
        {"id": "r2", "name": "Annamalai", "role": "resolver"},
    ]
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.chat_commands._phrase_plus_facts",
        side_effect=lambda **kw: (
            _phrase(
                kind="escalate_prompt",
                fallback=kw.get("fallback"),
                context=kw.get("context") or {},
            )
            + (
                f"\n\n{str(kw.get('facts') or '').strip()}"
                if str(kw.get("facts") or "").strip()
                else ""
            )
        ),
    ), patch(
        "app.tasks.chat_commands._find_ticket",
        side_effect=lambda *_a, **_k: _ticket(),
    ), patch.object(cc, "list_org_agents", return_value=staff), patch(
        "app.tools.ticket_write.escalate_ticket",
    ) as esc:
        out = continue_escalate_draft(
            "ashika",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            escalate_draft={
                "ticket_number": "12840",
                "awaiting": "assignee",
                "candidates": ["Ashika A", "Yaswanth mg", "Annamalai"],
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {},
            },
        )
    assert out["handled"] is True
    draft = out.get("escalate_draft") or {}
    assert draft.get("awaiting") == "confirm"
    assert draft.get("assignee") == "Ashika A"
    esc.assert_not_called()


def test_ground_escalate_assignee_binds_partial_to_candidates():
    from app.agents.workflow_nlu import ground_active_collect_decision

    decision = ground_active_collect_decision(
        {"action": "CONTINUE_WORKFLOW", "fields": {}},
        workflow="escalate",
        step="assignee",
        user_text="ashika",
        roster_members=["Ashika A", "Sri Annamalai", "Yaswanth MG"],
        draft={
            "awaiting": "assignee",
            "ticket_number": "2",
            "candidates": ["Ashika A", "Sri Annamalai", "Yaswanth MG"],
        },
    )
    assert decision.get("action") == "CONTINUE_WORKFLOW"
    fields = decision.get("fields") or {}
    assert fields.get("assignee") == "Ashika A"


def test_should_force_armed_write_on_yehh_confirm():
    from app.agents.base import _should_force_armed_write

    # Consent wording is irrelevant — NLU action + armed draft own the force.
    assert _should_force_armed_write(
        {
            "workflow_decision": {"action": "CONTINUE_WORKFLOW", "fields": {}},
            "escalate_draft": {
                "awaiting": "confirm",
                "ticket_number": "2",
                "assignee": "Ashika A",
                "assignee_id": "a1",
            },
        },
        "yehh",
    )
    assert _should_force_armed_write(
        {"workflow_decision": {"action": "CONFIRM_WORKFLOW", "fields": {}}},
        "proceed",
    )
    # Cancel is LLM/NLU-owned: CANCEL_WORKFLOW must not force; keyword text alone
    # does not gate (no phrase lists).
    assert not _should_force_armed_write(
        {"workflow_decision": {"action": "CANCEL_WORKFLOW", "fields": {}}},
        "cancel this",
    )
    assert not _should_force_armed_write(
        {
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "fields": {"assignee": "Sri Annamalai"},
            }
        },
        "give it to Sri",
    )
    # Re-ask / recommend must never force the write (false "I've escalated").
    assert not _should_force_armed_write(
        {
            "workflow_decision": {"action": "CONTINUE_WORKFLOW", "fields": {}},
            "escalate_draft": {
                "awaiting": "confirm",
                "ticket_number": "5",
                "assignee": "Yaswanth MG",
                "assignee_id": "r1",
            },
        },
        "reccomend me the best agent here",
    )
    assert not _should_force_armed_write(
        {"workflow_decision": {"action": "CONTINUE_WORKFLOW", "fields": {}}},
        "recommend me the best agent here",
    )
    assert _should_force_armed_write(
        {
            "workflow_decision": {"action": "RESUME_WORKFLOW", "fields": {}},
            "ticket_draft": {
                "awaiting": "confirm",
                "customerName": "Ada Lovelace",
                "customerId": "1",
                "customerEmail": "ada@example.com",
                "issue": "Cannot login to CRM portal",
                "priority": "Medium",
            },
        },
        "yesh proceedd",
    )
    assert _should_force_armed_write(
        {
            "force_armed_write": True,
            "workflow_decision": {"action": "SIDE_QUEST", "fields": {}},
            "kb_draft": {
                "awaiting": "confirm",
                "title": "MFA",
                "content": "body",
                "body": "body",
            },
        },
        "resume filing",
    )

def test_escalate_confirm_recommend_repicks_does_not_write(escalate_mocks):
    """At confirm, another 'best agent' re-proposes — does not mutate the ticket."""
    with patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={
            "agent": "Raghuram M",
            "agent_id": "a-raghu",
            "resolver": "Yaswanth mg",
            "resolver_id": "r1",
            "rationale": "skill match",
        },
    ):
        out = continue_escalate_draft(
            "recommend me the best agent here",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            escalate_draft={
                "awaiting": "confirm",
                "ticket_number": "12840",
                "assignee": "Annamalai",
                "assignee_id": "r2",
                "current_agent": "Mohammed Fazil",
                "current_resolver": "Ashika A",
            },
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "entity_name": "",
                "values": [],
            },
        )
    escalate_mocks.assert_not_called()
    draft = out.get("escalate_draft") or {}
    assert draft.get("awaiting") == "confirm"
    assert draft.get("assignee") == "Yaswanth mg"
    assert draft.get("current_agent") == "Mohammed Fazil"
    reply = str(out.get("reply") or "").lower()
    assert "escalated" not in reply or "prepared" in reply or "propos" in reply
    assert "mohammed fazil" in reply


def test_specialist_forces_escalate_ticket_when_confirm_without_tool_call(monkeypatch):
    """Armed confirm + Super Agent CONTINUE must call escalate_ticket even if LLM re-asks."""
    from app.agents import base as base_mod
    from app.agents.base import run_specialist
    from app.messages_compat import AIMessage, HumanMessage

    class _FakeBound:
        def invoke(self, _messages):
            return AIMessage(
                content=(
                    "I have prepared the escalation of ticket #2 to Ashika A. "
                    "Should I proceed with this change?"
                )
            )

        def bind_tools(self, _tools):
            return self

    class _FakeLlm:
        def bind(self, **_kwargs):
            return self

        def bind_tools(self, _tools):
            return _FakeBound()

        def invoke(self, _messages):
            return _FakeBound().invoke(_messages)

    monkeypatch.setattr(base_mod, "get_llm", lambda: _FakeLlm())
    monkeypatch.setattr(
        base_mod,
        "langchain_tools_for_agent",
        lambda *_a, **_k: [],
    )
    executed: list[str] = []

    def _exec(agent_key, name, args, **kwargs):
        executed.append(name)
        return (
            '{"success": true, "payload": {"resolver": "Ashika A", '
            '"agent": "", "unchanged": false}}'
        )

    monkeypatch.setattr(base_mod, "execute_tool_call", _exec)
    monkeypatch.setattr(
        "app.workflow_schemas.fill_tool_args_from_state",
        lambda name, args, state: {
            "ticket_number": "2",
            "assignee": "Ashika A",
            "assignee_id": "a1",
        },
    )

    out = run_specialist(
        "tickets",
        {
            "messages": [HumanMessage(content="yehh")],
            "organization_id": "org-1",
            "user_id": "u1",
            "user_role": "admin",
            "user_name": "Admin",
            "page": "Tickets",
            "tools_allowed": True,
            "intent": "UPDATE",
            "current_workflow": "escalate",
            "current_step": "confirm",
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "UPDATE",
                "fields": {},
            },
            "escalate_draft": {
                "awaiting": "confirm",
                "ticket_number": "2",
                "assignee": "Ashika A",
                "assignee_id": "a1",
            },
            "session_history": [
                {"role": "user", "text": "ashika"},
                {
                    "role": "assistant",
                    "text": "I'll escalate #2 to Ashika A. Shall I proceed?",
                },
                {"role": "user", "text": "yehh"},
            ],
        },
    )
    assert "escalate_ticket" in executed
    assert out.get("escalate_draft") is None or out.get("current_workflow") is None


def test_escalate_confirm_assignee_survives_context_round_trip():
    """Hydrate must keep assignee so the next 'yehh' turn still arms escalate_ticket."""
    from app.workflow_schemas import armed_write_tools_from_state
    from app.workflow_state import (
        context_state_projection,
        hydrate_from_legacy_drafts,
        update_context_from_result,
    )

    draft = {
        "awaiting": "confirm",
        "ticket_number": "4",
        "assignee": "Sri Annamalai",
        "assignee_id": "a99",
        "candidates": ["Ashika A", "Sri Annamalai"],
    }
    snap = hydrate_from_legacy_drafts(
        escalate_draft=draft,
        reassign_draft=None,
        macro_draft=None,
        team_draft=None,
        kb_draft=None,
    )
    assert (snap.get("workflow_data") or {}).get("assignee") == "Sri Annamalai"
    assert (snap.get("workflow_data") or {}).get("assignee_id") == "a99"

    # Stripped workflow_data must not win over the full escalate_draft on the result.
    result = {
        **snap,
        "workflow_data": {
            "ticket_number": "4",
            "candidates": ["Ashika A", "Sri Annamalai"],
        },
        "escalate_draft": draft,
        "reply": "Prepared escalation to Sri Annamalai — proceed?",
    }
    ctx = update_context_from_result({}, result)
    active = ctx.get("active_workflow") or {}
    assert (active.get("data") or {}).get("assignee") == "Sri Annamalai"

    proj = context_state_projection(ctx)
    assert (proj.get("escalate_draft") or {}).get("assignee") == "Sri Annamalai"
    assert "escalate_ticket" in armed_write_tools_from_state(proj)



def test_escalate_best_agent_confirm_shows_current_not_proposed_l1(escalate_mocks):
    """Auto-pick must not invent a new L1 and label it as the current owner."""
    with patch(
        "app.tasks.chat_commands.skill_pick_agent_and_resolver",
        return_value={
            "agent": "Raghuram M",
            "agent_id": "a-raghu",
            "resolver": "Yaswanth mg",
            "resolver_id": "r1",
            "rationale": "skill match",
        },
    ):
        out = continue_escalate_draft(
            "recommend me the best agent",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Tickets",
            escalate_draft={
                "ticket_number": "12840",
                "awaiting": "assignee",
                "candidates": ["Yaswanth mg", "Annamalai"],
            },
            semantic_decision={
                "action": "PROVIDE_ASSIGNEE",
                "entity_name": "best agent",
                "values": [],
            },
        )
    draft = out.get("escalate_draft") or {}
    assert draft.get("awaiting") == "confirm"
    assert draft.get("current_agent") == "Mohammed Fazil"
    assert draft.get("current_resolver") == "Ashika A"
    assert draft.get("assignee") == "Yaswanth mg"
    # Escalate auto-pick is resolver-only — ignore dual L1 suggestion.
    assert draft.get("agent") in (None, "")
    reply = str(out.get("reply") or "")
    assert "Mohammed Fazil" in reply
    assert "Ashika A" in reply
    assert "Yaswanth" in reply
    assert "Current agent" in reply
    assert "Proposed resolver" in reply
    # Must not present Raghuram as the current owner.
    assert "from Raghuram" not in reply
    assert "Current agent: **Raghuram" not in reply


# --- Phase 2 routing / hydrate regression table (extend this owner; no parallel suite) ---

@pytest.mark.parametrize(
    "utterance,bug_class,expected",
    [
        (
            "reasing this ticket",
            "routing/label",
            {"action": "START_REASSIGN"},
        ),
        (
            "show resolvers",
            "routing/label",
            {"action": "START_REASSIGN", "target_role": "resolver"},
        ),
        (
            "resolver",
            "routing/label",
            {"action": "START_REASSIGN", "target_role": "resolver"},
        ),
        (
            "reassign this ticket",
            "routing/label",
            {"action": "START_REASSIGN"},
        ),
    ],
)
def test_phase2_routing_regression_normalize(utterance, bug_class, expected):
    from app.agents.workflow_nlu import normalize_workflow_decision

    del bug_class  # documentation tag for the table
    decision = normalize_workflow_decision(
        {
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "entity_type": "ticket",
            "entity_name": "4",
            "fields": {},
            "values": [],
            "confidence": 0.9,
            "agent": "tickets",
        },
        user_text=utterance,
    )
    assert decision["action"] == expected["action"]
    if expected.get("target_role"):
        assert (decision.get("fields") or {}).get("target_role") == expected[
            "target_role"
        ]


def test_normalize_parked_keeps_filled_draft_without_awaiting():
    """Phase 3: park must not drop drafts that lost awaiting but still have fields."""
    from app.memory_contract import normalize_parked

    kept = normalize_parked(
        [
            {
                "flow": "ticket",
                "draft": {
                    "customerName": "Ada Lovelace",
                    "customerEmail": "ada@example.test",
                    "issue": "VPN down",
                },
            }
        ]
    )
    assert len(kept) == 1
    assert kept[0]["draft"]["customerName"] == "Ada Lovelace"
    assert kept[0]["draft"].get("awaiting")
    assert kept[0]["draft"]["awaiting"] != "name"


def test_park_side_quest_resume_keeps_create_ticket_fields(reassign_mocks):
    """Phase 3 acceptance: park mid-create → side quest → resume → no re-ask of name."""
    from app.agents.workflow_manager import resolve_active_workflow
    from app.memory_contract import park_flows
    from app.workflow_schemas import awaiting_hint_from_missing

    partial = {
        "awaiting": "issue",
        "customerName": "Ada Lovelace",
        "customerEmail": "ada@example.test",
    }
    parked = park_flows({"ticket": partial}, except_flows=set())
    assert parked and parked[0]["draft"]["customerName"] == "Ada Lovelace"

    hit = resolve_active_workflow(
        "continue the ticket",
        **_resolve_wf_kwargs(
            ticket_draft=None,
            parked_drafts=parked,
            last_entity={"type": "ticket", "id": "id-4", "name": "4"},
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "values": ["ticket"],
                "confidence": 0.95,
            },
        ),
    )
    assert hit and hit.get("handled") is True
    draft = hit.get("ticket_draft") or {}
    assert draft.get("customerName") == "Ada Lovelace"
    assert draft.get("customerEmail") == "ada@example.test"
    expect = awaiting_hint_from_missing("create_ticket", draft)
    assert draft.get("awaiting") == expect
    assert draft.get("awaiting") != "name"
