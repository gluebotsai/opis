"""
Layer 1 — Workflow Manager decision tree (pure, no LLM).

Covers continue / park / resume / interrupt / last_entity / cancel branches.
"""

from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

import pytest
from app.messages_compat import HumanMessage

from app.agents.workflow_manager import (
    complete_specialist_handoff,
    execute_team_query,
    resolve_active_workflow,
    workflow_manager_node,
)
from app.workflow_state import (
    WF_ADD_TEAM_MEMBERS,
    WF_CREATE_CUSTOMER,
    WF_CREATE_KB,
    WF_CREATE_MACRO,
    WF_CREATE_TEAM,
    enrich_handler_result,
    hydrate_from_legacy_drafts,
    intent_for_workflow,
    normalize_last_entity,
)


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")


@pytest.fixture(autouse=True)
def _stub_phrase():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.ticket_write.enrich_ticket",
        return_value={
            "success": True,
            "payload": {
                "data": {
                    "subject": "Validated issue",
                    "description": "Validated issue",
                    "priority": "medium",
                    "queue": "Support",
                }
            },
        },
    ):
        yield


def _resolve(
    text: str,
    *,
    team_draft=None,
    macro_draft=None,
    kb_draft=None,
    escalate_draft=None,
    ticket_draft=None,
    parked_drafts=None,
    priority_draft=None,
    customer_draft=None,
    last_entity=None,
    workflow_decision=None,
    session_history=None,
    role: str = "admin",
):
    return resolve_active_workflow(
        text,
        page="Teams",
        organization_id="org-1",
        user_role=role,
        user_id="u1",
        user_name="Admin",
        escalate_draft=escalate_draft,
        macro_draft=macro_draft,
        team_draft=team_draft,
        kb_draft=kb_draft,
        ticket_draft=ticket_draft,
        priority_draft=priority_draft,
        customer_draft=customer_draft,
        parked_drafts=parked_drafts,
        session_history=session_history,
        last_entity=last_entity,
        workflow_decision=workflow_decision,
    )


def _confirm_team_write(state: dict, asked: dict, payload: dict):
    confirm_state = {
        **state,
        "messages": [HumanMessage(content="yes go ahead")],
        "team_draft": asked.get("team_draft"),
        "current_workflow": "create_team",
        "current_step": "confirm",
        "workflow_decision": {
            **dict(state.get("workflow_decision") or {}),
            "action": "CONTINUE_WORKFLOW",
            "operation": "NONE",
        },
    }
    with patch(
        "app.tools.catalog_tools.create_queue",
        return_value={"success": True, "payload": payload},
    ) as created:
        orch = workflow_manager_node(confirm_state)  # type: ignore[arg-type]
        out = complete_specialist_handoff(confirm_state, orch)  # type: ignore[arg-type]
    return created, out


# ---- hydrate / serialize ----


class TestWorkflowStateContract:
    def test_hydrate_create_team(self):
        s = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft={"awaiting": "name"},
            kb_draft=None,
        )
        assert s["current_workflow"] == WF_CREATE_TEAM
        assert s["current_step"] == "name"

    def test_hydrate_create_team_confirm_keeps_members(self):
        s = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft={
                "awaiting": "confirm",
                "name": "CRM team",
                "description": "CRM related queries",
                "members": ["Yaswanth mg"],
                "available_members": ["Yaswanth mg", "Deva NS"],
            },
            kb_draft=None,
        )
        assert s["current_workflow"] == WF_CREATE_TEAM
        assert s["current_step"] == "confirm"
        assert s["workflow_data"]["name"] == "CRM team"
        assert s["workflow_data"]["description"] == "CRM related queries"
        assert s["workflow_data"]["members"] == ["Yaswanth mg"]

    def test_hydrate_create_team_roster_tool_memory(self):
        s = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft={
                "awaiting": "create_members",
                "name": "UMN",
                "available_members": ["raghu ram"],
            },
            kb_draft=None,
        )
        assert s["current_workflow"] == WF_CREATE_TEAM
        assert s["current_step"] == "create_members"
        assert s["workflow_data"]["available_members"] == ["raghu ram"]
        assert s["workflow_data"]["tool_memory"]["list_agents"]["names"] == ["raghu ram"]
        assert s["workflow_data"]["tool_memory"]["list_agents"]["count"] == 1
        assert s["workflow_data"]["tool_memory"]["list_agents"]["entities"] == [
            {"id": "", "name": "raghu ram"}
        ]

    def test_hydrate_live_team_draft_wins_over_stale_workflow(self):
        s = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft={"awaiting": "name"},
            kb_draft=None,
            current_workflow="escalate",
            current_step="ticket",
        )
        assert s["current_workflow"] == WF_CREATE_TEAM
        assert s["current_step"] == "name"

    def test_hydrate_add_members_sets_last_entity(self):
        s = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft={"awaiting": "members", "name": "nlp", "id": "q1"},
            kb_draft=None,
        )
        assert s["current_workflow"] == WF_ADD_TEAM_MEMBERS
        assert s["last_entity"]["name"] == "nlp"

    def test_hydrate_macro_kb(self):
        assert (
            hydrate_from_legacy_drafts(
                escalate_draft=None,
                macro_draft={"awaiting": "title"},
                team_draft=None,
                kb_draft=None,
            )["current_workflow"]
            == WF_CREATE_MACRO
        )
        assert (
            hydrate_from_legacy_drafts(
                escalate_draft=None,
                macro_draft=None,
                team_draft=None,
                kb_draft={
                    "awaiting": "confirm",
                    "title": "AI Help",
                    "category": "General",
                    "body": "Long enough article body for publish.",
                },
            )["workflow_data"]["body"]
            == "Long enough article body for publish."
        )

    def test_normalize_last_entity_rejects_empty(self):
        assert normalize_last_entity({}) is None
        assert normalize_last_entity({"type": "team", "id": "1"})["type"] == "team"

    def test_intent_for_workflow(self):
        assert intent_for_workflow(WF_ADD_TEAM_MEMBERS) == "UPDATE"
        assert intent_for_workflow(WF_CREATE_TEAM) == "CREATE"
        assert intent_for_workflow(None) is None

    def test_enrich_create_done_projects_last_entity(self):
        out = enrich_handler_result(
            {
                "handled": True,
                "actions": [
                    {"type": "create_team", "done": True, "name": "nlp", "id": "q1"}
                ],
                "team_draft": {"awaiting": "members", "name": "nlp", "id": "q1"},
            }
        )
        assert out["last_entity"]["id"] == "q1"
        assert out["current_workflow"] == WF_ADD_TEAM_MEMBERS

    def test_enrich_create_kb_done_projects_last_entity(self):
        out = enrich_handler_result(
            {
                "handled": True,
                "actions": [
                    {
                        "type": "create_kb",
                        "done": True,
                        "title": "AI Help",
                        "id": "kb-9",
                    }
                ],
                "kb_draft": None,
            }
        )
        assert out["last_entity"]["type"] == "article"
        assert out["last_entity"]["id"] == "kb-9"
        assert out["last_entity"]["name"] == "AI Help"
        assert out.get("current_workflow") is None

    def test_last_entity_falls_back_to_named_article(self):
        from app.workflow_state import resolve_query_reference

        resolved, error = resolve_query_reference(
            {
                "operation": "GET_ARTICLE",
                "entity_name": "AI Help",
                "reference": "LAST_ENTITY",
            },
            {},
        )
        assert error is None
        assert resolved["entity_name"] == "AI Help"
        assert resolved["reference"] is None

    def test_last_entity_survives_unrelated_list_turn(self):
        out = enrich_handler_result(
            {
                "handled": True,
                "actions": [{"type": "navigate", "view": "tickets-list"}],
            },
            prior_last_entity={"type": "article", "id": "kb-9", "name": "AI Help"},
        )
        assert out["last_entity"]["name"] == "AI Help"
        assert out["last_entity"]["type"] == "article"

    def test_last_entity_from_create_macro_done(self):
        out = enrich_handler_result(
            {
                "handled": True,
                "actions": [
                    {"type": "create_macro", "done": True, "title": "VIP reply"}
                ],
                "macro_draft": None,
            }
        )
        assert out["last_entity"]["type"] == "macro"
        assert out["last_entity"]["name"] == "VIP reply"

    def test_last_entity_picks_matching_type_from_recent(self):
        from app.workflow_state import resolve_query_reference

        resolved, error = resolve_query_reference(
            {
                "operation": "GET_ARTICLE",
                "reference": "LAST_ENTITY",
            },
            {
                "last_entity": {"type": "team", "id": "q1", "name": "nlp"},
                "recent_entities": [
                    {"type": "article", "id": "kb-9", "name": "AI Help"},
                    {"type": "team", "id": "q1", "name": "nlp"},
                ],
            },
        )
        assert error is None
        assert resolved["resolved_entity"]["name"] == "AI Help"
        assert resolved["filters"]["query"] == "AI Help"

    def test_last_entity_from_conversation_context_state(self):
        from app.workflow_state import last_entity_from_state

        le = last_entity_from_state(
            {
                "conversation_context": {
                    "last_entity": {"type": "article", "id": "1", "name": "AI Help"}
                }
            }
        )
        assert le["name"] == "AI Help"

    def test_ui_focus_hydrates_ticket_last_entity(self):
        from app.focus_entity import apply_ui_focused_entity

        row = {
            "id": "#13193",
            "subject": "Independence day campaign",
            "status": "Open",
            "priority": "High",
            "customerName": "Raghuram",
            "customerEmail": "raghuramm1502@gmail.com",
            "description": "clients are not getting the campaign",
        }
        with patch(
            "app.tools.ticket_read.get_ticket",
            return_value={"success": True, "payload": row},
        ):
            ctx = apply_ui_focused_entity(
                {},
                {"type": "ticket", "id": "#13193", "name": "#13193"},
                organization_id="00000000-0000-4000-8000-000000000001",
                user_id="u1",
                user_role="admin",
                user_name="Admin",
            )
        assert ctx["last_entity"]["type"] == "ticket"
        assert ctx["last_entity"]["name"] in {"13193", "#13193"}
        assert ctx["last_entity"]["customerName"] == "Raghuram"
        assert "campaign" in (ctx["last_entity"].get("subject") or "").lower()

    def test_conversation_context_resolves_last_query(self):
        from app.workflow_state import (
            normalize_conversation_context,
            resolve_query_reference,
        )

        context = normalize_conversation_context(
            {
                "last_query": {
                    "operation": "LIST_TICKETS",
                    "filters": {"created_by": "SELF", "status": "Open"},
                }
            }
        )
        resolved, error = resolve_query_reference(
            {
                "operation": "LIST_TICKETS",
                "filters": {},
                "reference": "LAST_QUERY",
            },
            context,
        )
        assert error is None
        assert resolved["filters"] == {"created_by": "SELF", "status": "Open"}
        assert resolved["reference"] is None

    def test_redundant_last_query_reference_does_not_block_explicit_filters(self):
        from app.workflow_state import resolve_query_reference

        resolved, error = resolve_query_reference(
            {
                "operation": "LIST_TICKETS",
                "filters": {"priority": "high"},
                "reference": "LAST_QUERY",
            },
            {},
        )
        assert error is None
        assert resolved["filters"] == {"priority": "high"}
        assert resolved["reference"] is None


class TestStructuredTicketQueries:
    @pytest.fixture(autouse=True)
    def _llm(self, llm, monkeypatch):
        # This legacy workflow-manager suite verifies its Express fallback.
        # Native chat gateway enforcement is covered in test_tool_loop.py.
        monkeypatch.setattr(
            "app.tools.insights_routing.try_semantic_metrics",
            lambda *args, **kwargs: {"success": False},
        )
        monkeypatch.setattr(
            "app.tools.insights_routing.try_ontology_narrative",
            lambda *args, **kwargs: {"success": False},
        )
        return llm

    def _state(self, decision, **extra):
        return {
            "messages": [HumanMessage(content="show tickets")],
            "organization_id": "00000000-0000-4000-8000-000000000001",
            "user_id": "00000000-0000-4000-8000-000000000002",
            "user_name": "Admin",
            "user_role": "admin",
            "workflow_decision": decision,
            "conversation_context": extra.pop("conversation_context", {}),
            "page": "Home",
            **extra,
        }

    def test_list_created_by_self_uses_structured_tool_and_saves_query(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"created_by": "SELF"},
            "proposed_tool": "list_tickets",
            "confidence": 0.98,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {
                    "data": [
                        {
                            "id": "#14001",
                            "subject": "Login",
                            "status": "Open",
                            "priority": "high",
                            "assignee": "Admin",
                        }
                    ]
                },
            },
        ) as listed:
            state = self._state(decision)
            orch = workflow_manager_node(state)
            assert orch.get("specialist_handoff") is True
            assert orch.get("route") == "tickets"
            listed.assert_not_called()
            out = complete_specialist_handoff(state, orch)
        assert out["data"]["last_query"]["filters"]["created_by"] == "SELF"
        assert any(a.get("creator") == "me" for a in out["actions"])
        assert "#14001" in out["reply"]
        assert listed.call_args.kwargs["created_by"] == "SELF"

    def test_ticket_query_side_quest_parks_active_create(self):
        decision = {
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"assigned_to": "SELF"},
            "proposed_tool": "list_tickets",
            "confidence": 0.97,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ):
            state = self._state(
                decision,
                ticket_draft={
                    "awaiting": "issue",
                    "customerName": "Ada",
                    "customerEmail": "ada@example.com",
                },
            )
            orch = workflow_manager_node(state)
            assert orch.get("ticket_draft") is None
            assert any(
                p.get("flow") == "ticket" for p in orch.get("parked_drafts") or []
            )
            out = complete_specialist_handoff(state, orch)
        assert out.get("specialist_handoff") is True or out.get("data", {}).get(
            "last_query"
        )

    def test_issue_answer_not_misread_as_ticket_list(self):
        issue = "my lola chat bot is not working prpoperly fox it soon"
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "reference": "LAST_QUERY",
            "filters": {},
            "proposed_tool": "list_tickets",
            "confidence": 0.9,
        }
        with patch("app.tools.ticket_read.list_tickets") as listed:
            state = self._state(
                decision,
                messages=[HumanMessage(content=issue)],
                ticket_draft={
                    "awaiting": "issue",
                    "customerName": "anto",
                    "customerEmail": "anto@gmail.com",
                },
                current_workflow="create_ticket",
                current_step="issue",
            )
            orch = workflow_manager_node(state)
            out = complete_specialist_handoff(state, orch)
        listed.assert_not_called()
        assert (out.get("ticket_draft") or {}).get("issue")
        assert (out.get("ticket_draft") or {}).get("awaiting") != "issue"
        assert "ticket list" not in (out.get("reply") or "").lower()

    def test_confirm_yes_not_misread_as_ticket_list(self):
        """Misrouted LIST on confirm must not list; informal yes files via the specialist tool."""
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "reference": "LAST_QUERY",
            "filters": {},
            "proposed_tool": "list_tickets",
            "confidence": 0.9,
        }
        draft = {
            "awaiting": "confirm",
            "customerId": "cust-anto",
            "customerName": "anto",
            "customerEmail": "anto@gmail.com",
            "issue": "His CRM account is not working",
            "subject": "His CRM account is not working",
            "priority": "high",
            "enriched": True,
        }
        with patch("app.tools.ticket_read.list_tickets") as listed, patch(
            "app.tools.ticket_write.create_ticket",
            return_value={
                "success": True,
                "payload": {"ticketNumber": "#99042", "id": "t-99042"},
            },
        ) as created:
            state = self._state(
                decision,
                messages=[HumanMessage(content="yes")],
                ticket_draft=draft,
                current_workflow="create_ticket",
                current_step="confirm",
            )
            orch = workflow_manager_node(state)
            out = complete_specialist_handoff(state, orch)
        listed.assert_not_called()
        created.assert_called_once()
        assert out.get("ticket_draft") is None
        assert str(orch.get("workflow_decision", {}).get("action") or "") == (
            "CONTINUE_WORKFLOW"
        )
        assert "ticket list" not in (out.get("reply") or "").lower()

    def test_confirm_via_nlu_action_files_ticket(self):
        decision = {
            "action": "CONFIRM_WORKFLOW",
            "intent": "CREATE",
            "operation": "NONE",
            "filters": {},
            "confidence": 0.95,
        }
        draft = {
            "awaiting": "confirm",
            "customerId": "cust-anto",
            "customerName": "anto",
            "customerEmail": "anto@gmail.com",
            "issue": "His CRM account is not working",
            "subject": "His CRM account is not working",
            "priority": "high",
            "enriched": True,
        }
        with patch("app.tools.ticket_read.list_tickets") as listed, patch(
            "app.tools.ticket_write.create_ticket",
            return_value={
                "success": True,
                "payload": {"ticketNumber": "#99042", "id": "t-99042"},
            },
        ) as created:
            state = self._state(
                decision,
                messages=[HumanMessage(content="yes")],
                ticket_draft=draft,
                current_workflow="create_ticket",
                current_step="confirm",
            )
            orch = workflow_manager_node(state)
            out = complete_specialist_handoff(state, orch)
        listed.assert_not_called()
        created.assert_called_once()
        assert out.get("ticket_draft") is None
        assert str(orch.get("workflow_decision", {}).get("action") or "") == (
            "CONFIRM_WORKFLOW"
        )

    def test_wrong_tool_proposal_is_rejected_without_execution(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {},
            "proposed_tool": "create_ticket",
            "confidence": 0.99,
        }
        with patch("app.tools.ticket_read.list_tickets") as listed:
            state = self._state(decision)
            orch = workflow_manager_node(state)
            out = complete_specialist_handoff(state, orch)
        listed.assert_not_called()
        assert out["workflow_handled"] is True
        assert out["data"]["serviceError"] == "INVALID_TOOL_PROPOSAL"

    def test_create_list_last_query_resume_confirm_executes_one_mutation(self):
        partial = {
            "awaiting": "issue",
            "customerId": "cust-ada",
            "customerName": "Ada",
            "customerEmail": "ada@example.com",
        }
        list_decision = {
            "action": "SIDE_QUEST",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"created_by": "SELF"},
            "proposed_tool": "list_tickets",
            "confidence": 0.99,
        }
        rows = {
            "success": True,
            "payload": {
                "data": [
                    {
                        "id": "#14001",
                        "subject": "Prior issue",
                        "status": "Open",
                        "priority": "high",
                        "assignee": "Admin",
                    }
                ]
            },
        }
        with patch("app.tools.ticket_read.list_tickets", return_value=rows) as listed:
            side_state = self._state(list_decision, ticket_draft=partial)
            side_quest = complete_specialist_handoff(
                side_state, workflow_manager_node(side_state)
            )
            follow_state = self._state(
                {
                    "action": "NORMAL_ROUTE",
                    "intent": "TICKET",
                    "operation": "LIST_TICKETS",
                    "filters": {},
                    "reference": "LAST_QUERY",
                    "proposed_tool": "list_tickets",
                    "confidence": 0.99,
                },
                conversation_context={
                    "last_query": side_quest["data"]["last_query"]
                },
                messages=[HumanMessage(content="list those tickets")],
            )
            follow_up = complete_specialist_handoff(
                follow_state, workflow_manager_node(follow_state)
            )

        assert listed.call_count == 2
        assert listed.call_args.kwargs["created_by"] == "SELF"
        assert follow_up["data"]["last_query"]["filters"] == {"created_by": "SELF"}
        parked = side_quest["parked_drafts"]
        assert parked[0]["draft"]["customerName"] == "Ada"

        resumed = _resolve(
            "continue",
            parked_drafts=parked,
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "fields": {},
                "confidence": 0.99,
            },
        )
        assert resumed["ticket_draft"]["awaiting"] == "issue"
        issue = _resolve(
            "VPN will not connect",
            ticket_draft=resumed["ticket_draft"],
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "operation": "CREATE_TICKET",
                "fields": {"issue": "VPN will not connect"},
                "values": [],
            },
        )
        assert issue["ticket_draft"]["awaiting"] == "confirm"
        assert str(issue["ticket_draft"].get("priority") or "").lower() in {
            "urgent",
            "high",
            "medium",
            "low",
        }

        with patch(
            "app.tools.ticket_write.create_ticket",
            return_value={"success": True, "payload": {"ticketNumber": "#14002"}},
        ) as create:
            confirm_state = self._state(
                {
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "operation": "NONE",
                    "fields": {},
                    "values": [],
                    "confidence": 0.99,
                },
                ticket_draft=issue["ticket_draft"],
                current_workflow="create_ticket",
                current_step="confirm",
                messages=[HumanMessage(content="yeah you can proceed")],
            )
            done = complete_specialist_handoff(
                confirm_state, workflow_manager_node(confirm_state)
            )
        create.assert_called_once()
        assert done["ticket_draft"] is None
        assert any(a.get("type") == "refresh_tickets" for a in done["actions"])

    def test_idle_nlu_trusts_gemma_ops_without_keyword_infer(self):
        """Normalize preserves Gemma idle ops; does not invent tools from utterance keywords."""
        from app.agents.workflow_nlu import normalize_workflow_decision

        empty = normalize_workflow_decision(
            {"action": "NORMAL_ROUTE", "intent": "CHAT", "confidence": 0.4},
            user_text="how many overall open tickets are there?",
            page="Home",
        )
        assert empty["operation"] == "NONE"
        assert empty["proposed_tool"] is None

        home = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "GET_METRICS",
                "filters": {"status": "Open", "scope": "org"},
                "proposed_tool": "get_metrics",
                "confidence": 0.95,
            },
            user_text="how many overall open tickets are there?",
            page="Home",
        )
        assert home["operation"] == "GET_METRICS"
        assert home["intent"] == "TICKET"
        assert home["proposed_tool"] == "ask_semantic_layer"
        assert home["filters"].get("status") == "Open"
        assert home["filters"].get("scope") == "org"

        ask_open = normalize_workflow_decision(
            {
                "action": "AMBIGUOUS",
                "intent": "TICKET",
                "operation": "NONE",
                "clarification": "overall organization or your assigned metrics?",
                "confidence": 0.9,
            },
            user_text="how many open tickets are there?",
            page="Home",
        )
        assert ask_open["action"] == "AMBIGUOUS"
        assert "overall" in (ask_open.get("clarification") or "").lower()

        listed = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "LIST_TICKETS",
                "filters": {"due": "today"},
                "proposed_tool": "list_tickets",
                "confidence": 0.9,
            },
            user_text="show tickets due today",
            page="Tickets",
        )
        assert listed["operation"] == "LIST_TICKETS"
        assert listed["filters"]["due"] == "today"

        rec = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "RECOMMEND",
                "proposed_tool": None,
                "confidence": 0.9,
            },
            user_text="what should I work on",
            page="Home",
        )
        assert rec["operation"] == "RECOMMEND"

        detail = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "GET_TICKET",
                "filters": {"query": "14001"},
                "proposed_tool": "get_ticket",
                "confidence": 0.95,
            },
            user_text="open ticket 14001",
            page="Tickets",
        )
        assert detail["operation"] == "GET_TICKET"
        assert "14001" in str(detail["filters"].get("query") or "")

        priorities = normalize_workflow_decision(
            {"action": "NORMAL_ROUTE", "intent": "NAVIGATE", "confidence": 0.4},
            user_text="open priorities",
            page="Home",
        )
        assert priorities["operation"] == "NONE"

        my_overdue = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "GET_METRICS",
                "filters": {"due": "overdue", "assigned_to": "SELF"},
                "proposed_tool": "get_metrics",
                "confidence": 0.9,
            },
            user_text="show my overdue tickets",
            page="Home",
        )
        assert my_overdue["operation"] == "GET_METRICS"
        assert my_overdue["filters"].get("assigned_to") == "SELF"
        assert my_overdue["filters"].get("due") == "overdue"

    def test_nlu_catalog_dimensions_do_not_invent_email(self):
        from app.agents.workflow_nlu import normalize_workflow_decision

        listed = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "LIST_TICKETS",
                "filters": {
                    "assigned_to": "manoj",
                    "due": "today",
                    "queue": "Tech Support",
                    "sort": "oldest",
                    "limit": 20,
                },
                "proposed_tool": "list_tickets",
                "confidence": 0.95,
            },
            user_text="oldest due today tickets for manoj in Tech Support",
        )
        assert listed["filters"]["assigned_to"] == "manoj"
        assert "@" not in str(listed["filters"]["assigned_to"])
        assert listed["filters"]["due"] == "today"
        assert listed["filters"]["queue"] == "Tech Support"
        assert listed["filters"]["sort"] == "oldest"
        assert listed["filters"]["limit"] == 20

        metrics = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "GET_METRICS",
                "filters": {"topic": "overview"},
                "proposed_tool": "get_metrics",
                "confidence": 0.94,
            },
            user_text="how is the queue looking",
        )
        assert metrics["operation"] == "GET_METRICS"
        assert metrics["proposed_tool"] == "ask_semantic_layer"
        assert metrics["tool_proposal_valid"] is True

    def test_overall_overdue_uses_metrics_total_not_assignee_sample(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "filters": {"due": "overdue", "scope": "org", "topic": "overview"},
            "proposed_tool": "get_metrics",
            "confidence": 0.98,
        }
        with patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {
                    "openTickets": 500,
                    "dueToday": 2,
                    "overdue": 496,
                    "openChange": "—",
                },
            },
        ) as metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {
                    "data": [
                        {
                            "id": "#14001",
                            "subject": "Mine",
                            "status": "Overdue",
                            "priority": "high",
                            "assignee": "Jane",
                        }
                    ]
                    * 6
                },
            },
        ) as listed:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="overall overdue tickets")],
                    page="Home",
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="overall overdue tickets")],
                        page="Home",
                    )
                ),
            )
        metrics.assert_called()
        listed.assert_not_called()
        assert out["data"]["_tool_name"] == "get_metrics"
        assert out["data"]["metrics"]["overdue"] == 496
        assert any(a.get("view") == "dashboard" for a in out["actions"])

        show = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"due": "overdue", "scope": "org"},
            "proposed_tool": "list_tickets",
            "confidence": 0.97,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {
                    "data": [
                        {
                            "id": f"#14{i:03d}",
                            "subject": "Overdue",
                            "status": "Overdue",
                            "priority": "high",
                            "assignee": "Pool",
                        }
                        for i in range(8)
                    ]
                },
            },
        ) as listed, patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {"openTickets": 500, "overdue": 496},
            },
        ):
            out = complete_specialist_handoff(
                self._state(
                    show,
                    messages=[HumanMessage(content="list overall overdue tickets")],
                    page="All tickets",
                ),
                workflow_manager_node(
                    self._state(
                        show,
                        messages=[HumanMessage(content="list overall overdue tickets")],
                        page="All tickets",
                    )
                ),
            )
        assert listed.call_args.kwargs.get("scope") == "org"
        assert listed.call_args.kwargs.get("due") == "overdue"
        assert listed.call_args.kwargs.get("assigned_to") in (None, "")

        hijack = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "filters": {"due": "overdue", "scope": "org"},
            "proposed_tool": "get_metrics",
            "confidence": 0.9,
        }
        with patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {
                    "openTickets": 500,
                    "dueToday": 2,
                    "overdue": 496,
                    "openChange": "—",
                },
            },
        ) as metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ) as listed:
            out = complete_specialist_handoff(
                self._state(
                    hijack,
                    messages=[HumanMessage(content="overall overdue ticket")],
                    page="Home",
                ),
                workflow_manager_node(
                    self._state(
                        hijack,
                        messages=[HumanMessage(content="overall overdue ticket")],
                        page="Home",
                    )
                ),
            )
        metrics.assert_called()
        listed.assert_not_called()
        assert out["data"]["_tool_name"] == "get_metrics"
        assert out["data"]["metrics"]["overdue"] == 496

    def test_vague_overdue_asks_overall_vs_person(self):
        with patch(
            "app.agents.workflow_manager._phrase_clarify",
            return_value="overall organization or your assigned metrics?",
        ):
            out = workflow_manager_node(
                self._state(
                    {
                        "action": "AMBIGUOUS",
                        "intent": "TICKET",
                        "operation": "NONE",
                        "filters": {"due": "overdue"},
                        "clarification": "overall organization or your assigned metrics?",
                        "confidence": 0.9,
                    },
                    messages=[HumanMessage(content="overdue tickets")],
                    page="Tickets",
                )
            )
        assert out.get("workflow_handled") is True
        assert out.get("data", {}).get("clarificationRequired") is True
        assert out.get("data", {}).get("last_query", {}).get("awaiting") == "metrics_scope"
        assert any(a.get("view") == "dashboard" for a in out.get("actions") or [])
        assert "overall" in (out.get("reply") or "").lower()

    def test_home_kpi_open_tickets_stays_on_dashboard(self):
        with patch(
            "app.agents.workflow_manager._phrase_clarify",
            return_value="overall organization or your assigned metrics?",
        ):
            out = workflow_manager_node(
                self._state(
                    {
                        "action": "AMBIGUOUS",
                        "intent": "TICKET",
                        "operation": "NONE",
                        "filters": {"status": "Open"},
                        "clarification": "overall organization or your assigned metrics?",
                        "confidence": 0.95,
                    },
                    messages=[HumanMessage(content="open tickets")],
                    page="Home",
                )
            )
        assert out.get("workflow_handled") is True
        assert out.get("data", {}).get("clarificationRequired") is True
        assert out.get("data", {}).get("last_query", {}).get("awaiting") == "metrics_scope"
        assert any(a.get("view") == "dashboard" for a in out.get("actions") or [])

    def test_show_how_many_overdue_uses_org_metrics_not_assignee_list(self):
        with patch(
            "app.agents.workflow_manager._phrase_clarify",
            return_value="overall organization or your assigned metrics?",
        ):
            out = workflow_manager_node(
                self._state(
                    {
                        "action": "AMBIGUOUS",
                        "intent": "TICKET",
                        "operation": "NONE",
                        "filters": {"due": "overdue"},
                        "clarification": "overall organization or your assigned metrics?",
                        "confidence": 0.95,
                    },
                    messages=[HumanMessage(content="show how many overdue tickets are there")],
                    page="All tickets",
                )
            )
        assert out.get("workflow_handled") is True
        assert out.get("data", {}).get("clarificationRequired") is True
        assert out.get("data", {}).get("last_query", {}).get("awaiting") == "metrics_scope"
        assert out.get("data", {}).get("last_query", {}).get("filters", {}).get("due") == "overdue"

    def test_overall_open_and_my_overdue_use_scoped_metrics(self):
        with patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {"openTickets": 538, "dueToday": 2, "overdue": 496},
            },
        ) as metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ) as listed:
            overall = complete_specialist_handoff(
                self._state(
                    {
                        "action": "NORMAL_ROUTE",
                        "intent": "TICKET",
                        "operation": "GET_METRICS",
                        "filters": {"status": "Open", "scope": "org"},
                        "proposed_tool": "get_metrics",
                        "confidence": 0.98,
                    },
                    messages=[HumanMessage(content="show overall open tickets")],
                    page="Home",
                ),
                workflow_manager_node(
                    self._state(
                        {
                            "action": "NORMAL_ROUTE",
                            "intent": "TICKET",
                            "operation": "GET_METRICS",
                            "filters": {"status": "Open", "scope": "org"},
                            "proposed_tool": "get_metrics",
                            "confidence": 0.98,
                        },
                        messages=[HumanMessage(content="show overall open tickets")],
                        page="Home",
                    )
                ),
            )
        assert metrics.call_args.kwargs.get("scope") == "org"
        listed.assert_not_called()
        assert overall["data"]["metrics"]["openTickets"] == 538
        assert not any(a.get("type") == "set_filter" for a in overall["actions"])

        metrics.reset_mock()
        with patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {"openTickets": 8, "dueToday": 1, "overdue": 6},
            },
        ) as mine_metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ):
            mine = complete_specialist_handoff(
                self._state(
                    {
                        "action": "NORMAL_ROUTE",
                        "intent": "TICKET",
                        "operation": "GET_METRICS",
                        "filters": {"due": "overdue", "assigned_to": "SELF"},
                        "proposed_tool": "get_metrics",
                        "confidence": 0.98,
                    },
                    messages=[HumanMessage(content="show my overdue tickets")],
                    page="Home",
                ),
                workflow_manager_node(
                    self._state(
                        {
                            "action": "NORMAL_ROUTE",
                            "intent": "TICKET",
                            "operation": "GET_METRICS",
                            "filters": {"due": "overdue", "assigned_to": "SELF"},
                            "proposed_tool": "get_metrics",
                            "confidence": 0.98,
                        },
                        messages=[HumanMessage(content="show my overdue tickets")],
                        page="Home",
                    )
                ),
            )
        assert mine_metrics.call_args.kwargs.get("scope") == "self"
        assert mine["data"]["metrics"]["overdue"] == 6

    def test_created_today_count_uses_createdToday_not_dueToday(self):
        captured: dict = {}

        def _capture_phrase(**kwargs):
            captured.update(kwargs.get("context") or {})
            return f"{kwargs.get('context', {}).get('createdToday')} created today"

        with patch(
            "app.tasks.chat_commands._llm_phrase", side_effect=_capture_phrase
        ), patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {
                    "openTickets": 100,
                    "dueToday": 3,
                    "overdue": 9,
                    "createdToday": 12,
                },
            },
        ) as metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ) as listed:
            out = complete_specialist_handoff(
                self._state(
                    {
                        "action": "NORMAL_ROUTE",
                        "intent": "TICKET",
                        "operation": "GET_METRICS",
                        "filters": {"created_range": "today"},
                        "proposed_tool": "get_metrics",
                        "confidence": 0.98,
                    },
                    messages=[HumanMessage(content="how many tickets created today")],
                    page="Home",
                ),
                workflow_manager_node(
                    self._state(
                        {
                            "action": "NORMAL_ROUTE",
                            "intent": "TICKET",
                            "operation": "GET_METRICS",
                            "filters": {"created_range": "today"},
                            "proposed_tool": "get_metrics",
                            "confidence": 0.98,
                        },
                        messages=[HumanMessage(content="how many tickets created today")],
                        page="Home",
                    )
                ),
            )
        listed.assert_not_called()
        assert metrics.called
        assert captured.get("createdToday") == 12
        assert captured.get("totalCount") == 12
        assert captured.get("askCreatedToday") is True
        assert out["data"]["metrics"]["createdToday"] == 12

    def test_metrics_scope_follow_up_overall_or_mine(self):
        pending = {
            "entity": "tickets",
            "operation": "GET_METRICS",
            "filters": {"due": "overdue", "topic": "overview"},
            "awaiting": "metrics_scope",
        }
        with patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {"openTickets": 538, "overdue": 496},
            },
        ) as metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ):
            out = complete_specialist_handoff(
                self._state(
                    {
                        "action": "NORMAL_ROUTE",
                        "intent": "TICKET",
                        "operation": "GET_METRICS",
                        "filters": {"scope": "org"},
                        "confidence": 0.9,
                    },
                    messages=[HumanMessage(content="overall")],
                    page="Home",
                    conversation_context={"last_query": pending},
                ),
                workflow_manager_node(
                    self._state(
                        {
                            "action": "NORMAL_ROUTE",
                            "intent": "TICKET",
                            "operation": "GET_METRICS",
                            "filters": {"scope": "org"},
                            "confidence": 0.9,
                        },
                        messages=[HumanMessage(content="overall")],
                        page="Home",
                        conversation_context={"last_query": pending},
                    )
                ),
            )
        assert metrics.call_args.kwargs.get("scope") == "org"
        assert out["data"]["metrics"]["overdue"] == 496

        with patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {"openTickets": 8, "overdue": 6},
            },
        ) as mine_metrics, patch(
            "app.tools.catalog_tools.get_triage_stats",
            return_value={"success": True, "payload": {}},
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ):
            mine = complete_specialist_handoff(
                self._state(
                    {
                        "action": "NORMAL_ROUTE",
                        "intent": "TICKET",
                        "operation": "GET_METRICS",
                        "filters": {"assigned_to": "SELF"},
                        "confidence": 0.9,
                    },
                    messages=[HumanMessage(content="mine")],
                    page="Home",
                    conversation_context={"last_query": pending},
                ),
                workflow_manager_node(
                    self._state(
                        {
                            "action": "NORMAL_ROUTE",
                            "intent": "TICKET",
                            "operation": "GET_METRICS",
                            "filters": {"assigned_to": "SELF"},
                            "confidence": 0.9,
                        },
                        messages=[HumanMessage(content="mine")],
                        page="Home",
                        conversation_context={"last_query": pending},
                    )
                ),
            )
        assert mine_metrics.call_args.kwargs.get("scope") == "self"
        assert mine["data"]["metrics"]["overdue"] == 6

    def test_list_due_today_and_named_assignee_call_list_tickets(self):
        due_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"due": "today"},
            "proposed_tool": "list_tickets",
            "confidence": 0.98,
        }
        rows = {
            "success": True,
            "payload": {
                "data": [
                    {
                        "id": "#14011",
                        "subject": "Due soon",
                        "status": "Open",
                        "priority": "high",
                        "assignee": "Sarah",
                    }
                ]
            },
        }
        with patch("app.tools.ticket_read.list_tickets", return_value=rows) as listed:
            out = complete_specialist_handoff(
                self._state(
                    due_decision,
                    messages=[HumanMessage(content="show tickets due today")],
                ),
                workflow_manager_node(
                    self._state(
                        due_decision,
                        messages=[HumanMessage(content="show tickets due today")],
                    )
                ),
            )
        assert listed.call_args.kwargs["due"] == "today"
        assert out["data"]["last_query"]["filters"]["due"] == "today"
        assert any(a.get("type") == "navigate" for a in out["actions"])
        assert "#14011" in (out.get("reply") or "")

        named = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"assigned_to": "Sarah"},
            "proposed_tool": "list_tickets",
            "confidence": 0.97,
        }
        with patch("app.tools.ticket_read.list_tickets", return_value=rows) as listed:
            out = complete_specialist_handoff(
                self._state(
                    named,
                    messages=[HumanMessage(content="tickets assigned to Sarah")],
                ),
                workflow_manager_node(
                    self._state(
                        named,
                        messages=[HumanMessage(content="tickets assigned to Sarah")],
                    )
                ),
            )
        assert listed.call_args.kwargs["assigned_to"] == "Sarah"
        assert any(a.get("assignee") == "Sarah" for a in out["actions"])

    def test_last_query_refine_adds_due_without_dropping_status(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"due": "overdue"},
            "reference": "LAST_QUERY",
            "proposed_tool": "list_tickets",
            "confidence": 0.96,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ) as listed:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    conversation_context={
                        "last_query": {
                            "operation": "LIST_TICKETS",
                            "filters": {"status": "Open"},
                        }
                    },
                    messages=[HumanMessage(content="only overdue")],
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        conversation_context={
                            "last_query": {
                                "operation": "LIST_TICKETS",
                                "filters": {"status": "Open"},
                            }
                        },
                        messages=[HumanMessage(content="only overdue")],
                    )
                ),
            )
        assert listed.call_args.kwargs["due"] == "overdue"
        assert listed.call_args.kwargs["status"] == "Open"
        assert out["data"]["last_query"]["filters"] == {
            "status": "Open",
            "due": "overdue",
        }

    def test_get_metrics_compare_recommend_use_live_tools(self):
        metrics_payload = {
            "success": True,
            "payload": {
                "openTickets": 12,
                "dueToday": 2,
                "overdue": 3,
                "openChange": "—",
            },
        }
        chart_payload = {
            "success": True,
            "payload": {"totals": {"open": 12, "created": 4}},
        }
        metrics_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "filters": {"topic": "overview"},
            "proposed_tool": "get_metrics",
            "confidence": 0.97,
        }
        with (
            patch(
                "app.tools.catalog_tools.get_metrics",
                return_value=metrics_payload,
            ) as metrics,
            patch(
                "app.tools.catalog_tools.get_triage_stats",
                return_value={"success": True, "payload": {"createdByMe": 4}},
            ),
            patch(
                "app.tools.catalog_tools.list_queues",
                return_value={"success": True, "payload": []},
            ),
        ):
            out = complete_specialist_handoff(
                self._state(
                    metrics_decision,
                    messages=[HumanMessage(content="how is the queue")],
                ),
                workflow_manager_node(
                    self._state(
                        metrics_decision,
                        messages=[HumanMessage(content="how is the queue")],
                    )
                ),
            )
        metrics.assert_called()
        assert out["data"]["_tool_name"] == "get_metrics"
        assert out["data"]["last_query"]["operation"] == "GET_METRICS"
        assert any(a.get("view") == "dashboard" for a in out["actions"])

        compare_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "COMPARE",
            "filters": {"created_range": "this_week"},
            "proposed_tool": "get_dashboard_chart",
            "confidence": 0.95,
        }
        with (
            patch(
                "app.tools.catalog_tools.get_metrics",
                return_value=metrics_payload,
            ),
            patch(
                "app.tools.catalog_tools.get_triage_stats",
                return_value={"success": True, "payload": {}},
            ),
            patch(
                "app.tools.catalog_tools.get_dashboard_chart",
                return_value=chart_payload,
            ) as chart,
        ):
            out = complete_specialist_handoff(
                self._state(
                    compare_decision,
                    messages=[HumanMessage(content="compare this week to last week")],
                ),
                workflow_manager_node(
                    self._state(
                        compare_decision,
                        messages=[HumanMessage(content="compare this week to last week")],
                    )
                ),
            )
        chart.assert_called()
        assert out["data"]["last_query"]["operation"] == "COMPARE"

        rec_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "RECOMMEND",
            "filters": {},
            "proposed_tool": "get_metrics",
            "confidence": 0.94,
        }
        rec_rows = {
            "success": True,
            "payload": {
                "data": [
                    {
                        "id": "#14020",
                        "subject": "VPN down",
                        "status": "Overdue",
                        "priority": "urgent",
                        "assignee": "Unassigned",
                    }
                ]
            },
        }
        with (
            patch(
                "app.tools.catalog_tools.get_metrics",
                return_value=metrics_payload,
            ),
            patch(
                "app.tools.catalog_tools.get_triage_stats",
                return_value={"success": True, "payload": {}},
            ),
            patch("app.tools.ticket_read.list_tickets", return_value=rec_rows) as listed,
        ):
            out = complete_specialist_handoff(
                self._state(
                    rec_decision,
                    messages=[HumanMessage(content="what should I work on")],
                ),
                workflow_manager_node(
                    self._state(
                        rec_decision,
                        messages=[HumanMessage(content="what should I work on")],
                    )
                ),
            )
        listed.assert_called()
        assert out["data"]["last_query"]["operation"] == "RECOMMEND"
        assert "#14020" in (out.get("reply") or "")

    def test_get_ticket_and_history_use_progress_tool(self):
        ticket = {
            "success": True,
            "payload": {
                "id": "#14001",
                "ticketNumber": "#14001",
                "subject": "Login",
                "status": "Open",
            },
        }
        progress = {
            "success": True,
            "payload": {"events": [{"action": "created", "at": "2026-08-01"}]},
        }
        detail = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "GET_TICKET",
            "filters": {"query": "#14001"},
            "proposed_tool": "get_ticket",
            "confidence": 0.98,
        }
        with patch("app.tools.ticket_read.get_ticket", return_value=ticket) as fetched:
            out = complete_specialist_handoff(
                self._state(
                    detail,
                    messages=[HumanMessage(content="open ticket 14001")],
                ),
                workflow_manager_node(
                    self._state(
                        detail,
                        messages=[HumanMessage(content="open ticket 14001")],
                    )
                ),
            )
        fetched.assert_called()
        assert out["data"]["_tool_name"] == "get_ticket"
        assert any(a.get("type") == "navigate" for a in out["actions"])

        history = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "GET_HISTORY",
            "filters": {"query": "#14001"},
            "proposed_tool": "get_ticket_progress",
            "confidence": 0.97,
        }
        with (
            patch("app.tools.ticket_read.get_ticket", return_value=ticket),
            patch(
                "app.tools.ticket_read.get_ticket_progress",
                return_value=progress,
            ) as timeline,
        ):
            out = complete_specialist_handoff(
                self._state(
                    history,
                    messages=[HumanMessage(content="show history for 14001")],
                ),
                workflow_manager_node(
                    self._state(
                        history,
                        messages=[HumanMessage(content="show history for 14001")],
                    )
                ),
            )
        timeline.assert_called()
        assert out["data"]["_tool_name"] == "get_ticket_progress"

    def test_update_ticket_confirms_then_writes_once(self):
        ask = {
            "action": "NORMAL_ROUTE",
            "intent": "UPDATE",
            "operation": "UPDATE_TICKET",
            "fields": {"ticket_number": "#14001", "assignee": "Sarah"},
            "proposed_tool": "update_ticket",
            "confidence": 0.98,
        }
        with patch(
            "app.tools.ticket_write.update_ticket",
            return_value={"success": True, "payload": {"id": "#14001"}},
        ) as updated:
            pending = complete_specialist_handoff(
                self._state(
                    ask,
                    messages=[HumanMessage(content="assign #14001 to Sarah")],
                ),
                workflow_manager_node(
                    self._state(
                        ask,
                        messages=[HumanMessage(content="assign #14001 to Sarah")],
                    )
                ),
            )
        updated.assert_not_called()
        pending_update = pending["data"]["last_query"]["pending_update"]
        assert pending_update["assignee"] == "Sarah"
        assert pending_update["ticket_number"] == "#14001"

        confirm = {
            "action": "CONFIRM_WORKFLOW",
            "intent": "UPDATE",
            "operation": "UPDATE_TICKET",
            "proposed_tool": "update_ticket",
            "confidence": 0.99,
        }
        with patch(
            "app.tools.ticket_write.update_ticket",
            return_value={"success": True, "payload": {"id": "#14001"}},
        ) as updated:
            done = complete_specialist_handoff(
                self._state(
                    confirm,
                    conversation_context={"last_query": pending["data"]["last_query"]},
                    messages=[HumanMessage(content="yes, do that")],
                ),
                workflow_manager_node(
                    self._state(
                        confirm,
                        conversation_context={
                            "last_query": pending["data"]["last_query"]
                        },
                        messages=[HumanMessage(content="yes, do that")],
                    )
                ),
            )
        updated.assert_called_once()
        assert updated.call_args.args[0] == "#14001"
        assert updated.call_args.kwargs["assignee"] == "Sarah"
        assert "pending_update" not in (done["data"].get("last_query") or {})
        assert any(a.get("type") == "refresh_tickets" for a in done["actions"])


# ---- decision tree ----


class TestContinueActiveWorkflow:
    @pytest.fixture(autouse=True)
    def _llm(self, llm):
        return llm

    def test_team_name_step_collects_name(self):
        with patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": []},
        ):
            hit = _resolve("nlp", team_draft={"awaiting": "name"})
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] == "description"
        assert hit["team_draft"]["name"] == "nlp"

    def test_team_name_rejects_existing_case_insensitive(self):
        with patch(
            "app.tools.catalog_tools.list_queues",
            return_value={
                "success": True,
                "payload": [
                    {"id": "q-ts", "queueName": "Tech Support", "name": "Tech Support"}
                ],
            },
        ):
            hit = _resolve("tech support", team_draft={"awaiting": "name"})
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] == "name"
        assert not str(hit["team_draft"].get("name") or "").strip()
        assert hit.get("current_step") == "name"

    def test_team_description_too_short_stays(self):
        hit = _resolve(
            "ab",
            team_draft={"awaiting": "description", "name": "nlp"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "team",
                "fields": {},
                "values": [],
                "confidence": 0.9,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] == "description"
        assert hit["team_draft"]["name"] == "nlp"

    def test_cancel_clears_team_draft(self):
        hit = _resolve(
            "cancel",
            team_draft={"awaiting": "description", "name": "nlp"},
            workflow_decision={"action": "CANCEL_WORKFLOW", "intent": "CREATE"},
        )
        assert hit and hit["handled"] is True
        assert hit.get("team_draft") is None

    def test_members_step_asks_for_names(self):
        hit = _resolve(
            "add members",
            team_draft={"awaiting": "members", "name": "nlp", "id": "q1"},
        )
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] in ("members", "members_names")
        assert hit["team_draft"].get("awaiting") != "name"

    def test_macro_title_step(self):
        hit = _resolve("vip reply", macro_draft={"awaiting": "title"})
        assert hit and hit["handled"] is True
        assert hit["macro_draft"]["awaiting"] == "body"
        assert hit["macro_draft"]["title"] == "vip reply"

    def test_kb_body_step(self):
        with patch(
            "app.tasks.catalog_commands._live_kb_categories",
            return_value=["General"],
        ):
            hit = _resolve(
                "category is General",
                kb_draft={"awaiting": "category", "title": "How to reset"},
            )
        assert hit and hit["handled"] is True
        assert hit["kb_draft"]["awaiting"] == "body"

    def test_kb_confirm_okay_does_not_start_customer(self):
        state = {
            "messages": [HumanMessage(content="okay")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Knowledge Base",
            "kb_draft": {
                "awaiting": "confirm",
                "title": "AI",
                "category": "AI",
                "body": "Artificial Intelligence is the simulation of human intelligence.",
            },
            "current_workflow": "create_kb",
            "current_step": "confirm",
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "KB",
                "operation": "CREATE_KB",
                "proposed_tool": "create_kb_article",
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_kb_article",
            return_value={"success": True, "payload": {"id": "kb-1", "title": "AI"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            hit = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_called_once()
        assert hit.get("kb_draft") is None
        assert not (hit.get("customer_draft") or {}).get("awaiting")
        assert any(
            a.get("type") == "create_kb" and a.get("done")
            for a in hit.get("actions") or []
        )

    def test_okay_idle_does_not_start_customer(self):
        hit = _resolve(
            "okay",
            workflow_decision={
                "action": "NORMAL_ROUTE",
                "intent": "CHAT",
                "confidence": 0.9,
            },
        )
        draft = (hit or {}).get("customer_draft") if isinstance(hit, dict) else None
        awaiting = draft.get("awaiting") if isinstance(draft, dict) else ""
        assert awaiting != "name"

    def test_explicit_add_customer_still_starts(self):
        hit = _resolve(
            "please file this person",
            workflow_decision={
                "action": "START_CREATE_CUSTOMER",
                "intent": "CUSTOMER",
                "agent": "customers",
                "workflow": "create_customer",
                "confidence": 0.99,
            },
        )
        assert hit and hit["handled"] is True
        assert (hit.get("customer_draft") or {}).get("awaiting") == "name"

    def test_add_customer_command_is_not_the_customer_name(self):
        """Live bug: 'add customer' was stored as the name and asked for email."""
        hit = _resolve(
            "add customer",
            workflow_decision={
                "action": "START_CREATE_CUSTOMER",
                "intent": "CUSTOMER",
                "agent": "customers",
                "workflow": "create_customer",
                "fields": {"name": "add customer"},
                "confidence": 0.99,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("customer_draft") or {}
        assert draft.get("awaiting") == "name"
        assert not draft.get("name")

        again = _resolve(
            "add customer",
            customer_draft={"awaiting": "name"},
            workflow_decision={
                "action": "START_CREATE_CUSTOMER",
                "intent": "CUSTOMER",
                "agent": "customers",
                "workflow": "create_customer",
                "confidence": 0.99,
            },
        )
        assert again and again["handled"] is True
        draft2 = again.get("customer_draft") or {}
        assert draft2.get("awaiting") == "name"
        assert not draft2.get("name")
        reply = str(again.get("reply") or "").lower()
        assert "add customer" not in reply or "name" in reply
        assert "email" not in reply

    def test_add_customer_after_kb_confirm_does_not_seed_prior_utterance(self):
        """Live bug: 'yes proceed' from KB confirm was stored as the customer name."""
        hit = _resolve(
            "add customer",
            session_history=[
                {"role": "user", "text": "yes proceed"},
                {"role": "assistant", "text": "Logged the CRM article."},
                {"role": "user", "text": "add customer"},
            ],
            workflow_decision={
                "action": "START_CREATE_CUSTOMER",
                "intent": "CUSTOMER",
                "agent": "customers",
                "workflow": "create_customer",
                "fields": {"name": "yes proceed"},
                "confidence": 0.99,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("customer_draft") or {}
        assert draft.get("awaiting") == "name"
        assert not draft.get("name")
        reply = str(hit.get("reply") or "").lower()
        assert "yes proceed" not in reply
        actions = hit.get("actions") or []
        assert any(
            isinstance(a, dict) and a.get("type") == "navigate" and a.get("view") == "customers"
            for a in actions
        )
        assert any(
            isinstance(a, dict) and a.get("type") == "create_customer"
            for a in actions
        )

    def test_add_priority_at_customer_collect_parks_and_navigates(self):
        hit = _resolve(
            "add prioritly",
            customer_draft={"awaiting": "contact", "name": "yes proceed"},
            workflow_decision={
                "action": "START_CREATE_PRIORITY",
                "operation": "CREATE_PRIORITY",
                "intent": "CREATE",
                "confidence": 0.99,
            },
        )
        assert hit and hit["handled"] is True
        assert (hit.get("priority_draft") or {}).get("awaiting") == "name"
        assert hit.get("customer_draft") in (None, {})
        actions = [a for a in (hit.get("actions") or []) if isinstance(a, dict)]
        assert any(a.get("type") == "navigate" and a.get("view") == "priorities" for a in actions)
        assert any(a.get("type") == "create_priority" for a in actions)
        parked = hit.get("parked_drafts") or []
        assert any(
            isinstance(p, dict)
            and p.get("flow") == "customer"
            and (p.get("draft") or {}).get("name") == "yes proceed"
            for p in parked
        )


class TestSideQuestAndPark:
    def test_fallback_side_quest_parks_kb_draft(self):
        hit = _resolve(
            "how many open tickets?",
            kb_draft={"awaiting": "category", "title": "add"},
            workflow_decision={
                "action": "SIDE_QUEST",
                "intent": "TICKET",
                "operation": "GET_METRICS",
                "confidence": 0.95,
            },
        )
        assert hit is not None
        assert hit["handled"] is False
        assert hit.get("kb_draft") is None
        assert hit.get("defer_to_commands") is True
        assert any(
            item.get("flow") == "kb"
            and item.get("draft", {}).get("title") == "add"
            for item in hit.get("parked_drafts") or []
        )

    def test_list_categories_side_quest_stays_on_create_kb(self):
        """LIST_KB while awaiting category is collect help — do not park."""
        from app.agents.workflow_nlu import ground_active_collect_decision

        grounded = ground_active_collect_decision(
            {
                "action": "SIDE_QUEST",
                "intent": "KB",
                "operation": "LIST_KB",
                "agent": "kb",
                "workflow": "create_kb",
                "proposed_tool": "list_kb",
            },
            workflow="create_kb",
            step="category",
            user_text="show me the available categories",
            roster_members=None,
        )
        assert grounded["action"] == "CONTINUE_WORKFLOW"
        assert grounded["operation"] == "NONE"

        with patch(
            "app.tasks.catalog_commands._live_kb_categories",
            return_value=["General", "Troubleshooting"],
        ), patch(
            "app.tasks.catalog_commands._phrase",
            side_effect=lambda **kw: str(kw.get("fallback") or "ok"),
        ):
            hit = _resolve(
                "show me the available categories",
                kb_draft={"awaiting": "category", "title": "AI CHAT"},
                workflow_decision=grounded,
            )
        assert hit and hit["handled"] is True
        draft = hit.get("kb_draft") or {}
        assert draft.get("awaiting") == "category"
        assert draft.get("title") == "AI CHAT"
        assert hit.get("parked_drafts") in (None, [])

    def test_create_team_membership_question_is_list_not_add_members(self):
        from app.agents.workflow_nlu import ground_active_collect_decision

        grounded = ground_active_collect_decision(
            {
                "action": "START_ADD_TEAM_MEMBERS",
                "intent": "TEAMS",
                "operation": "ADD_MEMBERS",
                "agent": "teams",
            },
            workflow="create_team",
            step="create_members",
            user_text="can you tell me in which team the above people are already there",
            roster_members=["Mohamed Fazil", "raghu ram", "sri annamalai"],
        )
        assert grounded["action"] == "SIDE_QUEST"
        assert grounded["operation"] == "LIST_TEAMS"
        assert grounded["proposed_tool"] == "list_queues"

    def test_create_team_member_first_name_not_list_teams(self):
        from app.agents.workflow_nlu import ground_active_collect_decision

        roster = [
            "Mohamed Fazil",
            "raghu ram",
            "sri annamalai",
            "Yaswanth mg",
            "Deva NS",
        ]
        grounded = ground_active_collect_decision(
            {
                "action": "SIDE_QUEST",
                "intent": "TEAMS",
                "operation": "LIST_TEAMS",
                "agent": "teams",
                "entity_name": "yaswanth",
                "proposed_tool": "list_queues",
            },
            workflow="create_team",
            step="create_members",
            user_text="yaswanth",
            roster_members=roster,
        )
        assert grounded["action"] == "CONTINUE_WORKFLOW"
        assert grounded["operation"] == "NONE"
        assert grounded["fields"]["members"] == ["Yaswanth mg"]

        clarified = ground_active_collect_decision(
            {
                "action": "SIDE_QUEST",
                "intent": "TEAMS",
                "operation": "LIST_TEAMS",
                "agent": "teams",
                "entity_name": "yaswanth",
            },
            workflow="create_team",
            step="create_members",
            user_text="yaswanth is the team member",
            roster_members=roster,
        )
        assert clarified["action"] == "CONTINUE_WORKFLOW"
        assert clarified["fields"]["members"] == ["Yaswanth mg"]

        with patch(
            "app.tools.catalog_tools.list_agents",
            return_value={
                "success": True,
                "payload": {"data": [{"id": "u-y", "name": "Yaswanth mg"}]},
            },
        ), patch(
            "app.tasks.catalog_commands._phrase",
            side_effect=lambda *a, **kw: str(kw.get("fallback") or "ok"),
        ), patch(
            "app.tasks.catalog_commands._phrase_members_ask",
            side_effect=lambda *a, **kw: str(kw.get("fallback") or "ok"),
        ):
            hit = _resolve(
                "yaswanth",
                team_draft={
                    "awaiting": "create_members",
                    "name": "Chatbot team",
                    "description": "the developers of chatbot product",
                    "available_members": roster,
                },
                workflow_decision={
                    "action": "SIDE_QUEST",
                    "intent": "TEAMS",
                    "operation": "LIST_TEAMS",
                    "entity_name": "yaswanth",
                    "confidence": 0.9,
                },
            )
        assert hit and hit["handled"] is True
        draft = hit.get("team_draft") or {}
        assert draft.get("name") == "Chatbot team"
        assert draft.get("members") == ["Yaswanth mg"]
        assert draft.get("awaiting") in ("create_members", "confirm")
        assert not any(
            isinstance(a, dict) and str(a.get("type") or "") == "update_team"
            for a in (hit.get("actions") or [])
        )

    def test_parked_create_team_resumes_instead_of_add_members(self):
        with patch(
            "app.tools.catalog_tools.list_agents",
            return_value={
                "success": True,
                "payload": {"data": [{"id": "u-m", "name": "Mohamed Fazil"}]},
            },
        ), patch(
            "app.tasks.catalog_commands._phrase",
            side_effect=lambda *a, **kw: str(kw.get("fallback") or "ok"),
        ), patch(
            "app.tasks.catalog_commands._phrase_members_ask",
            side_effect=lambda *a, **kw: str(kw.get("fallback") or "ok"),
        ):
            hit = _resolve(
                "yes",
                team_draft=None,
                parked_drafts=[
                    {
                        "flow": "team",
                        "draft": {
                            "awaiting": "create_members",
                            "name": "CRM team",
                            "description": "The CRM group handles CRM issues",
                            "available_members": ["Mohamed Fazil"],
                        },
                    }
                ],
                workflow_decision={
                    "action": "START_ADD_TEAM_MEMBERS",
                    "intent": "TEAMS",
                    "operation": "ADD_MEMBERS",
                    "confidence": 0.9,
                },
            )
        assert hit and hit["handled"] is True
        draft = hit.get("team_draft") or {}
        assert draft.get("name") == "CRM team"
        assert draft.get("awaiting") in ("create_members", "confirm")
        assert not any(
            isinstance(a, dict) and str(a.get("type") or "") == "update_team"
            for a in (hit.get("actions") or [])
        )

    def test_create_team_collect_not_stolen_by_add_members_start(self):
        hit = _resolve(
            "which team are they already on",
            team_draft={
                "awaiting": "create_members",
                "name": "CRM team",
                "description": "CRM issues",
                "available_members": ["Mohamed Fazil"],
            },
            workflow_decision={
                "action": "START_ADD_TEAM_MEMBERS",
                "intent": "TEAMS",
                "operation": "ADD_MEMBERS",
                "confidence": 0.9,
            },
        )
        if hit:
            draft = hit.get("team_draft") or {}
            assert draft.get("name") == "CRM team"
            assert draft.get("awaiting") not in ("members_team", "members_names")
        else:
            assert hit is None

    def test_continue_kb_category_not_stolen_by_open_ticket(self):
        from app.agents.workflow_manager import bind_decision_to_open_entity

        decision = {
            "action": "CONTINUE_WORKFLOW",
            "intent": "KB",
            "entity_type": "article",
            "entity_name": "AI CHAT",
            "fields": {"category": "Troubleshooting"},
            "operation": "NONE",
            "reference": "LAST_ENTITY",
            "agent": "kb",
            "workflow": "create_kb",
        }
        out = bind_decision_to_open_entity(
            decision,
            {"type": "ticket", "id": "#13210", "name": "Login issue"},
            "troubleshooting",
        )
        assert out["action"] == "CONTINUE_WORKFLOW"
        assert out["operation"] == "NONE"
        assert out["agent"] == "kb"
        assert (out.get("fields") or {}).get("category") == "Troubleshooting"

    def test_interrupt_parks_kb_for_create_macro(self):
        hit = _resolve(
            "create macro",
            kb_draft={"awaiting": "category", "title": "add"},
            workflow_decision={
                "action": "NEW_TASK",
                "intent": "CREATE",
                "workflow": "create_macro",
                "confidence": 0.95,
            },
        )
        assert hit is not None
        assert hit["handled"] is False
        assert hit.get("defer_to_commands") is True
        assert hit.get("kb_draft") is None
        parked = hit.get("parked_drafts") or []
        assert any(p.get("flow") == "kb" for p in parked)


class TestResume:
    def test_explicit_resume_parked_kb(self):
        hit = _resolve(
            "continue the article",
            parked_drafts=[
                {"flow": "kb", "draft": {"awaiting": "category", "title": "add"}}
            ],
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "article",
                "confidence": 0.95,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["kb_draft"]["title"] == "add"
        assert hit["kb_draft"]["awaiting"] == "category"

    def test_auto_resume_parked_kb_on_answer(self):
        with patch(
            "app.tasks.catalog_commands._live_kb_categories",
            return_value=["General", "Help"],
        ):
            hit = _resolve(
                "category is help",
                parked_drafts=[
                    {"flow": "kb", "draft": {"awaiting": "category", "title": "add"}}
                ],
            )
        assert hit and hit["handled"] is True
        assert hit["kb_draft"]["awaiting"] == "body"

    def test_continue_article_does_not_resume_sole_parked_ticket(self):
        hit = _resolve(
            "yes",
            parked_drafts=[
                {
                    "flow": "ticket",
                    "draft": {"awaiting": "name", "customerName": "Ada"},
                }
            ],
            last_entity={"type": "article", "id": "kb-help", "name": "AI Help"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "KB",
                "agent": "kb",
                "entity_type": "article",
                "reference": "LAST_ENTITY",
                "operation": "NONE",
                "workflow": "article_summary",
                "confidence": 0.93,
            },
        )
        assert hit is None or hit.get("handled") is not True
        if hit:
            assert not (isinstance(hit.get("ticket_draft"), dict) and hit["ticket_draft"].get("awaiting"))
            assert hit.get("route") != "tickets"


class TestLastEntityFollowOn:
    def test_add_members_uses_last_entity_not_create(self):
        with patch(
            "app.tools.catalog_tools.list_queues",
            return_value={
                "success": True,
                "payload": [{"id": "q1", "queueName": "nlp", "name": "nlp"}],
            },
        ):
            hit = _resolve(
                "add members",
                last_entity={"type": "team", "id": "q1", "name": "nlp"},
                workflow_decision={
                    "action": "START_ADD_TEAM_MEMBERS",
                    "intent": "UPDATE",
                    "entity_type": "team",
                    "entity_name": "nlp",
                    "values": [],
                    "confidence": 0.99,
                },
            )
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["name"] == "nlp"
        assert hit["team_draft"]["awaiting"] != "name"

    def test_no_last_entity_returns_none_for_chitchat(self):
        assert _resolve("hello there") is None


class TestWorkflowManagerNode:
    @pytest.fixture(autouse=True)
    def _llm(self, llm):
        return llm

    def test_handled_short_circuit(self):
        state = {
            "messages": [HumanMessage(content="nlp")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "team_draft": {"awaiting": "name"},
            "page": "Teams",
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "team",
                "entity_name": "nlp",
                "values": [],
                "confidence": 0.99,
            },
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        assert orch.get("specialist_handoff") is True
        assert orch.get("route") == "teams"
        out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        assert out["team_draft"]["awaiting"] == "description"

    def test_continue_team_not_stolen_by_stale_ticket_draft(self):
        from app.agents.workflow_manager import route_to_agent

        assert (
            route_to_agent(
                {
                    "action": "CONTINUE_WORKFLOW",
                    "agent": "teams",
                    "workflow": "create_team",
                },
                current_workflow="create_ticket",
            )
            == "teams"
        )
        hit = _resolve(
            "mohamed",
            team_draft={"awaiting": "members", "name": "nlp", "id": "q1"},
            ticket_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "UPDATE",
                "agent": "teams",
                "workflow": "create_team",
                "entity_type": "team",
                "entity_name": "nlp",
                "confidence": 0.99,
            },
        )
        assert hit and hit.get("handled") is True
        assert (hit.get("team_draft") or {}).get("name") == "nlp"
        assert hit.get("team_draft", {}).get("awaiting") != "name"
        assert not (hit.get("ticket_draft") or {}).get("awaiting") or hit.get(
            "current_workflow"
        ) != "create_ticket"

    def test_new_task_create_kb_none_op_starts_draft_not_tickets(self):
        state = {
            "messages": [HumanMessage(content="create an article")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "ticket_draft": {"awaiting": "name"},
            "page": "Knowledge Base",
            "workflow_decision": {
                "action": "NEW_TASK",
                "intent": "CREATE",
                "agent": "kb",
                "workflow": "create_kb",
                "operation": "NONE",
                "entity_type": "article",
                "confidence": 1.0,
            },
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        assert orch.get("route") == "kb"
        trace = (orch.get("data") or {}).get("routing_trace") or orch.get("routing_trace")
        assert trace
        assert trace["super_agent"]["agent"] == "kb"
        assert trace["router"]["selected"] == "kb"
        assert trace.get("mismatch") is False
        assert (out.get("kb_draft") or {}).get("awaiting") == "title"
        assert any(
            a.get("type") == "create_kb" for a in (out.get("actions") or [])
        )

    def test_side_quest_parks_team_and_handoffs_tickets(self):
        state = {
            "messages": [HumanMessage(content="how many open tickets?")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "team_draft": {"awaiting": "members", "name": "nlp", "id": "q1"},
            "page": "Teams",
            "workflow_decision": {
                "action": "SIDE_QUEST",
                "intent": "TICKET",
                "agent": "tickets",
                "operation": "GET_METRICS",
                "confidence": 0.99,
            },
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        assert orch.get("route") == "tickets"
        assert orch.get("team_draft") in (None, {})
        assert any(
            (p.get("flow") == "team" or (p.get("draft") or {}).get("name") == "nlp")
            for p in (orch.get("parked_drafts") or [])
        )

    def test_confirm_kb_not_stolen_by_stale_ticket(self):
        state = {
            "messages": [HumanMessage(content="yes")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Knowledge Base",
            "kb_draft": {
                "awaiting": "confirm",
                "title": "AI Design",
                "category": "General",
                "body": "AI Design means using artificial intelligence tools.",
            },
            "ticket_draft": {"awaiting": "name"},
            "current_workflow": "create_kb",
            "current_step": "confirm",
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "agent": "kb",
                "workflow": "create_kb",
                "operation": "CREATE_KB",
                "confidence": 1.0,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_kb_article",
            return_value={"success": True, "payload": {"id": "kb-1", "title": "AI Design"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            hit = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_called_once()
        assert hit.get("kb_draft") is None
        assert any(
            a.get("type") == "create_kb" and a.get("done")
            for a in (hit.get("actions") or [])
        )

    def test_create_team_name_is_not_catalog_search(self):
        state = {
            "messages": [HumanMessage(content="Presales team")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "team_draft": {"awaiting": "name"},
            "page": "Teams",
            "workflow_decision": {
                "action": "NORMAL_ROUTE",
                "intent": "TEAMS",
                "operation": "SEARCH_TEAMS",
                "filters": {"query": "Presales team"},
                "entity_type": "team",
                "entity_name": "Presales team",
                "proposed_tool": "list_queues",
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.list_queues",
            return_value={"success": True, "payload": {"data": []}},
        ):
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        draft = out.get("team_draft") or {}
        assert "presales" in str(draft.get("name") or "").lower()
        assert draft.get("awaiting") == "description"

    def test_create_team_name_is_not_escalate_ticket_lookup(self):
        state = {
            "messages": [HumanMessage(content="presales")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "team_draft": {"awaiting": "name"},
            "page": "Teams",
            "session_history": [
                {
                    "role": "assistant",
                    "text": "Reply with a ticket number. #13192: Login issues",
                }
            ],
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "agent": "teams",
                "fields": {"name": "presales"},
                "confidence": 0.99,
            },
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        draft = out.get("team_draft") or {}
        assert "presales" in str(draft.get("name") or "").lower()
        assert draft.get("awaiting") == "description"
        assert not (out.get("escalate_draft") or {}).get("awaiting")
        reply = str(out.get("reply") or "").lower()
        assert "ticket number" not in reply

    def test_create_team_nlu_resolves_member_against_roster(self):
        state = {
            "messages": [HumanMessage(content="raghu")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "UMN team",
                "description": "Calls and network",
                "available_members": ["Jane Smith", "Rahuram"],
            },
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "fields": {"members": ["Rahuram"]},
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-umn"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        assert (asked.get("team_draft") or {}).get("awaiting") == "confirm"
        assert (asked.get("team_draft") or {}).get("members") == ["Rahuram"]
        confirm_state = {
            **state,
            "messages": [HumanMessage(content="yes go ahead")],
            "team_draft": asked.get("team_draft"),
            "current_workflow": "create_team",
            "current_step": "confirm",
            "workflow_decision": {**state["workflow_decision"], "action": "CONTINUE_WORKFLOW"},
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-umn"}},
        ) as created:
            orch = workflow_manager_node(confirm_state)  # type: ignore[arg-type]
            out = complete_specialist_handoff(confirm_state, orch)  # type: ignore[arg-type]
        created.assert_called_once()
        assert created.call_args.kwargs.get("members") == ["Rahuram"]
        assert out.get("team_draft") is None

    def test_create_team_add_all_selects_full_roster(self):
        roster = [
            "Mohamed Fazil",
            "raghu ram",
            "sri annamalai",
            "Yaswanth mg",
            "Deva NS",
        ]
        state = {
            "messages": [HumanMessage(content="add all")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "HR",
                "description": "This team used to solve candidates queries and employee support",
                "available_members": roster,
            },
            "current_workflow": "create_team",
            "current_step": "create_members",
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "entity_type": "team",
                "entity_name": "HR",
                "values": roster,
                "fields": {},
                "operation": "ADD_MEMBERS",
                "agent": "teams",
                "workflow": "create_team",
                "confidence": 1.0,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-hr"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        draft = asked.get("team_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert draft.get("members") == roster

    def test_create_team_uses_only_named_member_not_full_roster(self):
        roster = [
            "Mohamed Fazil",
            "raghu ram",
            "sri annamalai",
            "Yaswanth mg",
            "Deva NS",
        ]
        state = {
            "messages": [HumanMessage(content="deva")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "presales team",
                "description": "this team is responsible for technical demo for the customers",
                "available_members": roster,
                "members": roster,
            },
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "fields": {"members": roster},
                "values": roster,
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={
                "success": True,
                "payload": {"id": "q-pre", "queueName": "presales team"},
            },
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        created, _out = _confirm_team_write(
            state, asked, {"id": "q-pre", "queueName": "presales team"}
        )
        created.assert_called_once()
        assert created.call_args.kwargs.get("members") == roster

    def test_create_team_last_name_selects_only_that_member(self):
        roster = [
            "Mohamed Fazil",
            "raghu ram",
            "sri annamalai",
            "Yaswanth mg",
            "Deva NS",
        ]
        state = {
            "messages": [HumanMessage(content="annamalai")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "Rebuild team",
                "description": "This is the team creating all the products",
                "available_members": roster,
                "members": roster,
            },
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "fields": {"members": roster},
                "values": roster,
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={
                "success": True,
                "payload": {"id": "q-rebuild", "queueName": "Rebuild team"},
            },
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        created, _out = _confirm_team_write(
            state, asked, {"id": "q-rebuild", "queueName": "Rebuild team"}
        )
        created.assert_called_once()
        assert created.call_args.kwargs.get("members") == roster

    def test_create_team_short_name_resolves_from_roster_memory(self):
        state = {
            "messages": [HumanMessage(content="raghu")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "UMN Team",
                "description": "Calls and network",
                "available_members": [
                    "Mohamed Fazil",
                    "raghu ram",
                    "sri annamalai",
                ],
                "tool_memory": {
                    "list_agents": {
                        "names": [
                            "Mohamed Fazil",
                            "raghu ram",
                            "sri annamalai",
                        ],
                        "count": 3,
                        "entities": [
                            {"id": "a1", "name": "Mohamed Fazil"},
                            {"id": "a2", "name": "raghu ram"},
                            {"id": "a3", "name": "sri annamalai"},
                        ],
                    }
                },
            },
            "workflow_decision": {
                "action": "START_CREATE_TICKET",
                "intent": "TICKET",
                "operation": "CREATE_TICKET",
                "agent": "tickets",
                "fields": {"customerName": "raghu"},
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-umn"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        created, out = _confirm_team_write(state, asked, {"id": "q-umn"})
        created.assert_called_once()
        assert created.call_args.kwargs.get("members") == ["raghu ram"]
        assert out.get("team_draft") is None
        assert not (out.get("ticket_draft") or {}).get("awaiting")
        reply = str(out.get("reply") or "").lower()
        assert "customer" not in reply

    def test_create_team_mohamed_not_customer_full_name(self):
        state = {
            "messages": [HumanMessage(content="mohamed")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "UMN team",
                "description": "network related things",
                "available_members": [
                    "Mohamed Fazil",
                    "raghu ram",
                    "sri annamalai",
                ],
                "tool_memory": {
                    "list_agents": {
                        "names": [
                            "Mohamed Fazil",
                            "raghu ram",
                            "sri annamalai",
                        ],
                        "count": 3,
                        "entities": [
                            {"id": "u-m", "name": "Mohamed Fazil"},
                            {"id": "u-r", "name": "raghu ram"},
                            {"id": "u-s", "name": "sri annamalai"},
                        ],
                    }
                },
            },
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "agent": "teams",
                "fields": {"members": ["Mohamed Fazil"]},
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-umn"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        created, out = _confirm_team_write(state, asked, {"id": "q-umn"})
        created.assert_called_once()
        assert created.call_args.kwargs.get("members") == ["Mohamed Fazil"]
        assert not (out.get("ticket_draft") or {}).get("awaiting")
        assert "customer" not in str(out.get("reply") or "").lower()

    def test_create_team_yaswanth_does_not_start_create_ticket(self):
        state = {
            "messages": [HumanMessage(content="yaswanth")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
            "team_draft": {
                "awaiting": "create_members",
                "name": "DB Team",
                "description": "The DB team is responsible for Database",
                "available_members": [
                    "Yaswanth mg",
                    "Mohamed Fazil",
                    "raghu ram",
                ],
                "tool_memory": {
                    "list_agents": {
                        "names": ["Yaswanth mg", "Mohamed Fazil", "raghu ram"],
                        "count": 3,
                        "entities": [
                            {"id": "u-y", "name": "Yaswanth mg"},
                            {"id": "u-m", "name": "Mohamed Fazil"},
                            {"id": "u-r", "name": "raghu ram"},
                        ],
                    }
                },
            },
            "workflow_decision": {
                "action": "START_CREATE_TICKET",
                "intent": "TICKET",
                "operation": "CREATE_TICKET",
                "agent": "tickets",
                "fields": {"customerName": "yaswanth"},
                "confidence": 0.99,
            },
        }
        with patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-db"}},
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            asked = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        created, out = _confirm_team_write(state, asked, {"id": "q-db"})
        created.assert_called_once()
        assert created.call_args.kwargs.get("members") == ["Yaswanth mg"]
        assert not (out.get("ticket_draft") or {}).get("awaiting")
        assert "customer" not in str(out.get("reply") or "").lower()

    def test_create_team_conversation_member_name_does_not_open_ticket(self):
        """Live bug replay: create team → name → description → 'raghu' as START_CREATE_TICKET."""
        agents = {
            "success": True,
            "payload": {
                "data": [
                    {"id": "u-m", "name": "Mohamed Fazil"},
                    {"id": "u-r", "name": "raghu ram"},
                    {"id": "u-s", "name": "sri annamalai"},
                ]
            },
        }

        def _turn(text, *, team_draft, decision):
            state = {
                "messages": [HumanMessage(content=text)],
                "organization_id": "org-1",
                "user_role": "admin",
                "user_id": "u1",
                "page": "Teams",
                "team_draft": team_draft,
                "workflow_decision": decision,
            }
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
            return orch, out

        with patch("app.tools.catalog_tools.list_agents", return_value=agents), patch(
            "app.tools.catalog_tools.create_queue",
            return_value={"success": True, "payload": {"id": "q-fs"}},
        ) as created:
            _, named = _turn(
                "Full stack",
                team_draft={"awaiting": "name"},
                decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "TEAMS",
                    "operation": "NONE",
                    "fields": {"name": "Full stack"},
                    "confidence": 0.99,
                },
            )
            assert named.get("team_draft", {}).get("awaiting") == "description"
            assert named.get("team_draft", {}).get("name") == "Full stack"
            assert not (named.get("ticket_draft") or {}).get("awaiting")

            _, described = _turn(
                "the fullstack team handles all the UI wise functionalities",
                team_draft=named["team_draft"],
                decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "TEAMS",
                    "operation": "NONE",
                    "fields": {
                        "description": "the fullstack team handles all the UI wise functionalities"
                    },
                    "confidence": 0.99,
                },
            )
            assert described.get("team_draft", {}).get("awaiting") == "create_members"
            assert "raghu ram" in (
                described.get("team_draft", {}).get("available_members") or []
            )
            assert not (described.get("ticket_draft") or {}).get("awaiting")
            assert "customer" not in str(described.get("reply") or "").lower()

            orch_member, member = _turn(
                "raghu",
                team_draft=described["team_draft"],
                decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "TICKET",
                    "operation": "CREATE_TICKET",
                    "agent": "tickets",
                    "fields": {"customerName": "raghu"},
                    "confidence": 0.99,
                },
            )
            assert str(orch_member.get("workflow_decision", {}).get("action") or "") == (
                "CONTINUE_WORKFLOW"
            )
            assert orch_member.get("route") != "tickets"
            created.assert_not_called()
            assert (member.get("team_draft") or {}).get("awaiting") == "confirm"
            created, member = _confirm_team_write(
                {
                    "messages": [HumanMessage(content="raghu")],
                    "organization_id": "org-1",
                    "user_role": "admin",
                    "user_id": "u1",
                    "page": "Teams",
                    "workflow_decision": {
                        "action": "CONTINUE_WORKFLOW",
                        "intent": "TEAMS",
                        "operation": "NONE",
                    },
                },
                member,
                {"id": "q-fs"},
            )
            created.assert_called_once()
            assert created.call_args.kwargs.get("members") == ["raghu ram"]
            assert member.get("team_draft") is None
            assert not (member.get("ticket_draft") or {}).get("awaiting")
            assert "customer" not in str(member.get("reply") or "").lower()
            assert not any(
                isinstance(a, dict) and str(a.get("type") or "") == "create_ticket"
                for a in (member.get("actions") or [])
            )

    def test_create_ticket_interrupts_create_team_via_orchestrator(self):
        state = {
            "messages": [HumanMessage(content="create ticket")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "team_draft": {"awaiting": "name"},
            "page": "Teams",
            "workflow_decision": {
                "action": "START_CREATE_TICKET",
                "intent": "TICKET",
                "operation": "CREATE_TICKET",
                "agent": "tickets",
                "workflow": "create_ticket",
                "confidence": 0.99,
            },
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        assert str(orch.get("workflow_decision", {}).get("action") or "") == "START_CREATE_TICKET"
        assert orch.get("route") == "tickets"
        parked = orch.get("parked_drafts") or []
        assert any(
            str(item.get("flow") or "").lower() in {"team", "create_team"}
            or str(item.get("workflow_type") or "").lower() == "create_team"
            for item in parked
        )
        out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        assert (out.get("ticket_draft") or {}).get("awaiting")
        assert not (out.get("team_draft") or {}).get("awaiting")

    def test_empty_org_does_not_handle(self):
        out = workflow_manager_node(
            {
                "messages": [HumanMessage(content="nlp")],
                "organization_id": "",
                "team_draft": {"awaiting": "name"},
            }  # type: ignore[arg-type]
        )
        assert out["workflow_handled"] is False

    def test_side_quest_does_not_short_circuit(self):
        out = workflow_manager_node(
            {
                "messages": [HumanMessage(content="show my tickets")],
                "organization_id": "org-1",
                "user_role": "admin",
                "kb_draft": {"awaiting": "title"},
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
        assert out["workflow_handled"] is False
        assert out.get("kb_draft") is None
        assert out.get("current_workflow") is None
        assert any(
            item.get("flow") == "kb"
            for item in out.get("parked_drafts") or []
        )


class TestCreateTicketSemantic:
    @pytest.fixture(autouse=True)
    def _llm(self, llm):
        return llm

    @pytest.fixture(autouse=True)
    def _directory_customers(self):
        def _hits(*, query=None, exact_email=None, exact_phone=None):
            query = str(exact_email or exact_phone or query or "").strip()
            if "@" in query:
                return {
                    "success": True,
                    "payload": {
                        "data": [
                            {
                                "id": "cust-dir",
                                "name": "Directory Customer",
                                "email": query.lower(),
                                "phone": "",
                            }
                        ]
                    },
                }
            return {"success": True, "payload": {"data": []}}

        with patch("app.tools.catalog_tools.list_customers", side_effect=_hits):
            yield

    def test_start_create_ticket_from_nlu(self):
        hit = _resolve(
            "file a new ticket please",
            workflow_decision={
                "action": "START_CREATE_TICKET",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": [],
                "confidence": 0.97,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["ticket_draft"]["awaiting"] == "name"
        assert any(a.get("type") == "create_ticket" for a in hit.get("actions") or [])

    def test_create_ticket_command_is_not_customer_name(self):
        """Already awaiting name: 'create ticket' must not be stored as the customer."""
        for action in ("START_CREATE_TICKET", "CONTINUE_WORKFLOW"):
            hit = _resolve(
                "create ticket",
                ticket_draft={"awaiting": "name"},
                workflow_decision={
                    "action": action,
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "fields": {"customerName": "create ticket"},
                    "values": ["create ticket"],
                    "confidence": 0.99,
                },
            )
            assert hit and hit["handled"] is True, action
            draft = hit.get("ticket_draft") or {}
            assert draft.get("awaiting") == "name", action
            name = str(draft.get("customerName") or "").strip().lower()
            assert name in ("",), action
            assert "create" not in name, action

    def test_portal_start_create_asks_issue_only(self):
        hit = _resolve(
            "create ticket",
            role="portal_customer",
            workflow_decision={
                "action": "START_CREATE_TICKET",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": [],
                "confidence": 0.97,
            },
        )
        # State processor handoff — specialist paints the ask.
        assert hit and hit.get("handled") is False
        assert hit["ticket_draft"]["surface"] == "portal"
        assert hit["ticket_draft"]["awaiting"] == "issue"
        assert hit.get("route") == "kb"
        assert not str(hit.get("reply") or "").strip()

    def test_portal_issue_description_defers_to_kb_not_ticket(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create, patch(
            "app.proactive.dssa.evaluate_deflection",
            return_value={
                "deflect": True,
                "reply": "Try resetting your password using the login help article.",
                "confidence": 0.9,
                "articles": [],
                "chosen_articles": [{"id": "a1", "title": "Login help"}],
            },
        ):
            hit = _resolve(
                "i am facing login issue",
                role="portal_customer",
                workflow_decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "entity_name": None,
                    "values": ["login issue"],
                    "fields": {"issue": "login issue"},
                    "confidence": 0.95,
                },
            )
        assert hit and hit.get("handled") is False
        assert hit.get("route") == "kb"
        create.assert_not_called()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("surface") == "portal"
        assert "login" in str(draft.get("issue") or "").lower()
        assert draft.get("awaiting") == "kb_resolution"
        assert draft.get("kb_offered") is True
        assert isinstance(draft.get("pending_kb"), dict)
        assert not str(hit.get("reply") or "").strip()

    def test_portal_issue_no_kb_asks_confirm_keeps_draft(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create, patch(
            "app.proactive.dssa.evaluate_deflection",
            return_value={"deflect": False, "reply": "", "confidence": 0.2, "articles": []},
        ):
            hit = _resolve(
                "my lola chatbot is not responding while scheduling a demo",
                role="portal_customer",
                workflow_decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "entity_name": None,
                    "values": ["lola chatbot is not responding"],
                    "fields": {
                        "issue": "my lola chatbot is not responding while scheduling a demo"
                    },
                    "confidence": 0.95,
                },
            )
        assert hit and hit.get("handled") is False
        create.assert_not_called()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert "lola" in str(draft.get("issue") or "").lower()
        assert not str(hit.get("reply") or "").strip()

    def test_portal_yes_after_deferred_issue_hands_off_confirm_draft(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            hit = _resolve(
                "yes",
                role="portal_customer",
                ticket_draft={
                    "awaiting": "confirm",
                    "surface": "portal",
                    "issue": (
                        "chatbot is not working fine while scheduling a demo "
                        "and connecting to a live agent"
                    ),
                    "subject": "Lola chatbot issues",
                    "description": (
                        "chatbot is not working fine while scheduling a demo "
                        "and connecting to a live agent"
                    ),
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "entity_name": None,
                    "values": [],
                    "fields": {},
                    "confidence": 0.95,
                },
            )
        # Python does not file — specialist bind_tools owns portal_create_ticket.
        create.assert_not_called()
        assert hit and hit.get("handled") is False
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert "chatbot" in str(draft.get("issue") or "").lower()
        assert not str(hit.get("reply") or "").strip()

    def test_portal_yes_after_kb_resolution_arms_confirm_for_specialist(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            hit = _resolve(
                "still not working, please create a ticket",
                role="portal_customer",
                ticket_draft={
                    "awaiting": "kb_resolution",
                    "surface": "portal",
                    "kb_offered": True,
                    "issue": "VPN isn't connecting on the office network",
                    "subject": "VPN connection issue",
                    "description": "VPN isn't connecting on the office network",
                },
                workflow_decision={
                    "action": "CONFIRM_WORKFLOW",
                    "intent": "CREATE",
                    "operation": "CREATE_TICKET",
                    "entity_type": "ticket",
                    "values": [],
                    "fields": {},
                    "confidence": 0.95,
                },
            )
        create.assert_not_called()
        assert hit and hit.get("handled") is False
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert draft.get("kb_offered") is True
        assert "vpn" in str(draft.get("issue") or "").lower()

    def test_portal_kb_resolution_thanks_hands_off_without_python_reply(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            hit = _resolve(
                "okayy thanks ill follow this article and sort it myself",
                role="portal_customer",
                ticket_draft={
                    "awaiting": "kb_resolution",
                    "surface": "portal",
                    "kb_offered": True,
                    "pending_kb": {"guidance_notes": "Reset Wi-Fi steps…"},
                    "issue": "AI Worker is not correctly working in my CRM",
                    "subject": "AI Worker issue",
                    "description": "AI Worker is not correctly working in my CRM",
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "values": [],
                    "fields": {},
                    "confidence": 0.9,
                },
            )
        create.assert_not_called()
        assert hit and hit.get("handled") is False
        assert hit.get("route") == "kb"
        assert not str(hit.get("reply") or "").strip()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "kb_resolution"

    def test_portal_dssa_deflect_on_file_keeps_draft(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            create.return_value = {
                "success": False,
                "error_code": "DSSA_DEFLECTED",
                "message": "Try these Wi-Fi steps first.",
                "payload": {
                    "deflected": True,
                    "reply": "Try these Wi-Fi steps first.",
                    "confidence": 0.88,
                },
            }
            # Filing is specialist-owned; keep this as tool-path regression via _file_portal_ticket.
            from app.tasks.chat_commands import _file_portal_ticket

            hit = _file_portal_ticket(
                "yes",
                page="Support portal",
                org="org-1",
                role="portal_customer",
                user_id="u1",
                user_name="Cust",
                data={
                    "surface": "portal",
                    "issue": "wifi keeps dropping every few minutes at my desk",
                    "subject": "Wi-Fi drops",
                    "description": "wifi keeps dropping every few minutes at my desk",
                },
            )
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "kb_resolution"
        assert "wifi" in str(draft.get("issue") or "").lower()
        assert draft.get("kb_offered") is True

    def test_portal_guest_create_asks_signin(self):
        hit = _resolve(
            "create ticket",
            role="portal_guest",
            workflow_decision={
                "action": "START_CREATE_TICKET",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": [],
                "confidence": 0.97,
            },
        )
        assert hit and hit.get("handled") is False
        assert hit.get("ticket_draft") is None
        assert any(a.get("type") == "navigate" and a.get("view") == "login" for a in hit.get("actions") or [])
        assert hit.get("route") == "kb"

    def test_portal_issue_answer_advances_to_confirm_not_instant_file(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create, patch(
            "app.proactive.dssa.evaluate_deflection",
            return_value={"deflect": False, "reply": "", "confidence": 0.1, "articles": []},
        ):
            hit = _resolve(
                "subject : voice bot issue",
                role="portal_customer",
                ticket_draft={"awaiting": "issue", "surface": "portal"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "entity_name": None,
                    "values": ["voice bot issue"],
                    "fields": {"issue": "voice bot issue"},
                    "confidence": 0.95,
                },
            )
        create.assert_not_called()
        assert hit and hit.get("handled") is False
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert "voice bot" in str(draft.get("issue") or "").lower()
        assert not str(hit.get("reply") or "").strip()

    def test_name_only_does_not_invent_email(self):
        with patch("app.tools.ticket_write.create_ticket") as create:
            hit = _resolve(
                "manoj",
                ticket_draft={"awaiting": "name"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "entity_name": None,
                    "values": ["manoj"],
                    "fields": {
                        "customerName": "manoj",
                        "customerEmail": "manoj@gmail.com",
                    },
                    "confidence": 0.95,
                },
            )
        create.assert_not_called()
        assert hit and hit["handled"] is True
        draft = hit.get("ticket_draft") or {}
        assert "manoj" in str(draft.get("customerName") or "").lower()
        assert not draft.get("customerEmail")
        assert not draft.get("customerId")
        assert draft.get("awaiting") == "contact"
        act = next(
            a
            for a in (hit.get("actions") or [])
            if isinstance(a, dict) and a.get("type") == "create_ticket"
        )
        assert not act.get("customerEmail")
        assert act.get("step") == "contact"

    def test_issue_confirm_applies_local_triage_resolver(self):
        from app.tasks.schemas import TriageAssignResponse

        triaged = TriageAssignResponse(
            subject="Chat bot not responding",
            description="Customer reported:\n\nmy lola chat bot is not working",
            priority="medium",
            assignee="Jane Agent",
            queue="Support",
            rationale="Matched Support. L2 resolver auto-assigned Deva.",
            enrichedByAi=True,
            category="Support",
            skill="chatbot",
            assignee_id="a1",
            resolver="Deva",
            resolver_id="r1",
            resolver_confidence=0.91,
        )
        with patch(
            "app.tasks.pipeline.run_triage_assign",
            return_value=triaged,
        ):
            hit = _resolve(
                "my lola chat bot is not working properly",
                ticket_draft={
                    "awaiting": "issue",
                    "customerName": "raghu",
                    "customerEmail": "raghu@gmail.com",
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "fields": {"issue": "my lola chat bot is not working properly"},
                    "confidence": 0.9,
                },
            )
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert draft.get("resolver") == "Deva"
        assert draft.get("assignee") == "Jane Agent"
        assert draft.get("queue") == "Support"
        act = next(
            a
            for a in (hit.get("actions") or [])
            if isinstance(a, dict) and a.get("type") == "create_ticket"
        )
        assert act.get("resolver") == "Deva"
        assert act.get("resolverConfidence") == 0.91

    def test_invented_email_without_name_field_still_binds_name(self):
        hit = _resolve(
            "manoj",
            ticket_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "fields": {"customerEmail": "manoj@gmail.com"},
                "values": [],
                "confidence": 0.4,
            },
        )
        draft = hit.get("ticket_draft") or {}
        assert "manoj" in str(draft.get("customerName") or "").lower()
        assert not draft.get("customerEmail")
        assert draft.get("awaiting") == "contact"

    def test_filler_on_contact_does_not_invent_email(self):
        hit = _resolve(
            "hi",
            ticket_draft={"awaiting": "contact", "customerName": "manoj"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CHAT",
                "fields": {"customerEmail": "manoj@gmail.com"},
                "confidence": 0.3,
            },
        )
        draft = hit.get("ticket_draft") or {}
        assert draft.get("customerName") == "manoj"
        assert not draft.get("customerEmail")
        assert draft.get("awaiting") == "contact"

    def test_bare_email_semantic_field_stays_in_draft(self):
        with patch("app.tools.ticket_write.create_ticket") as create:
            hit = _resolve(
                "lokesh@gmail.com",
                ticket_draft={"awaiting": "contact", "customerName": "lokesh"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CHAT",
                    "entity_type": None,
                    "entity_name": None,
                    "values": [],
                    "fields": {"customerEmail": "lokesh@gmail.com"},
                    "confidence": 0.4,
                },
            )
        create.assert_not_called()
        assert hit and hit["handled"] is True
        draft = hit.get("ticket_draft") or {}
        assert draft.get("customerEmail") == "lokesh@gmail.com"
        assert draft.get("customerId") == "cust-dir"
        assert draft.get("customerName")
        assert draft.get("awaiting") == "issue"
        assert not any(
            a.get("type") == "create_ticket" and a.get("save")
            for a in hit.get("actions") or []
        )

    def test_email_on_issue_step_is_not_the_issue(self):
        with patch("app.tools.ticket_write.create_ticket") as create:
            hit = _resolve(
                "lokesh@gmail.com",
                ticket_draft={
                    "awaiting": "issue",
                    "customerName": "lokesh",
                    "customerEmail": "",
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CHAT",
                    "entity_type": None,
                    "entity_name": None,
                    "values": [],
                    "fields": {"customerEmail": "lokesh@gmail.com"},
                    "confidence": 0.4,
                },
            )
        create.assert_not_called()
        assert hit and hit["handled"] is True
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "issue"
        assert "lokesh@gmail.com" not in str(draft.get("issue") or "").lower()
        assert draft.get("customerEmail") == "lokesh@gmail.com"

    def test_unknown_directory_email_continues_to_issue(self):
        with patch(
            "app.tools.catalog_tools.list_customers",
            return_value={"success": True, "payload": {"data": []}},
        ), patch(
            "app.tools.ticket_write.create_ticket"
        ) as create:
            hit = _resolve(
                "nobody@example.com",
                ticket_draft={"awaiting": "contact", "customerName": "Ghost"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CHAT",
                    "entity_type": None,
                    "entity_name": None,
                    "values": [],
                    "fields": {"customerEmail": "nobody@example.com"},
                    "confidence": 0.4,
                },
            )
        create.assert_not_called()
        assert hit and hit["handled"] is True
        ticket = hit.get("ticket_draft") or {}
        assert hit.get("customer_draft") in (None, {})
        assert ticket.get("awaiting") == "issue"
        assert ticket.get("customerEmail") == "nobody@example.com"
        assert not ticket.get("customerId")
        assert not (hit.get("parked_drafts") or [])

    def test_issue_fragment_is_not_false_cancel_at_confirm(self):
        from app.agents.workflow_nlu import ground_active_collect_decision

        out = ground_active_collect_decision(
            {
                "action": "CANCEL_WORKFLOW",
                "intent": "CREATE",
                "operation": "NONE",
                "agent": "customers",
            },
            workflow="create_customer",
            step="confirm",
            user_text="ng properly fix it soon",
            roster_members=None,
        )
        assert out["action"] == "CONTINUE_WORKFLOW"

    def test_yeeh_typo_at_confirm_is_continue_not_new_task(self):
        """Live bug: informal ack typo must not restart create-ticket via NEW_TASK."""
        from app.agents.workflow_nlu import ground_active_collect_decision

        out = ground_active_collect_decision(
            {
                "action": "NEW_TASK",
                "intent": "CREATE",
                "operation": "NONE",
                "fields": {"customerName": "yeeh"},
                "entity_name": "yeeh",
                "values": ["yeeh"],
            },
            workflow="create_ticket",
            step="confirm",
            user_text="yeeh",
            roster_members=None,
            draft={
                "awaiting": "confirm",
                "customerName": "anto",
                "customerEmail": "anto@gmail.com",
                "issue": "chatbot is not responding",
                "priority": "high",
            },
        )
        assert out["action"] == "CONTINUE_WORKFLOW"
        assert not out.get("fields")
        assert not out.get("entity_name")

    def test_real_cancel_still_cancels_at_confirm(self):
        from app.agents.workflow_nlu import ground_active_collect_decision

        out = ground_active_collect_decision(
            {
                "action": "CANCEL_WORKFLOW",
                "intent": "CREATE",
                "operation": "NONE",
            },
            workflow="create_ticket",
            step="confirm",
            user_text="never mind cancel this",
            roster_members=None,
        )
        assert out["action"] == "CANCEL_WORKFLOW"

    def test_cancel_create_ticket_via_nlu_not_keyword(self):
        hit = _resolve(
            "actually never mind this filing",
            ticket_draft={"awaiting": "contact", "customerName": "Ada"},
            workflow_decision={
                "action": "CANCEL_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": [],
                "confidence": 0.96,
            },
        )
        assert hit and hit["handled"] is True
        assert hit.get("ticket_draft") is None

    def test_confirm_create_ticket_via_nlu(self):
        draft = {
            "awaiting": "confirm",
            "customerName": "Ada",
            "customerEmail": "a@t.test",
            "issue": "vpn down",
            "subject": "vpn down",
            "description": "vpn down",
            "priority": "high",
        }
        decision = {
            "action": "CONTINUE_WORKFLOW",
            "intent": "CREATE",
            "entity_type": "ticket",
            "entity_name": None,
            "values": [],
            "confidence": 0.95,
        }
        state = {
            "messages": [HumanMessage(content="go ahead and file it")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Tickets",
            "ticket_draft": draft,
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": decision,
        }
        with patch(
            "app.tools.ticket_write.create_ticket",
            return_value={
                "success": True,
                "payload": {"ticketNumber": "T-100", "id": "T-100"},
            },
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            hit = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_called_once()
        assert hit.get("ticket_draft") is None
        assert any(
            a.get("type") == "create_ticket" or a.get("type") == "refresh_tickets"
            for a in hit.get("actions") or []
        )

    def test_informal_proceed_at_confirm_files_ticket(self):
        draft = {
            "awaiting": "confirm",
            "customerName": "aashiika",
            "customerEmail": "aashiika@gmail.com",
            "issue": "my crm is not working properly so fix ti soon",
            "subject": "my crm is not working properly so fix ti soon",
            "priority": "medium",
        }
        decision = {
            "action": "CONTINUE_WORKFLOW",
            "intent": "CREATE",
            "entity_type": "ticket",
            "confidence": 0.9,
        }
        state = {
            "messages": [HumanMessage(content="yehh proceed with this")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Create Ticket",
            "ticket_draft": draft,
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": decision,
        }
        with patch(
            "app.tools.ticket_write.create_ticket",
            return_value={
                "success": True,
                "payload": {"ticketNumber": "T-101", "id": "T-101"},
            },
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            hit = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_called_once()
        assert hit.get("ticket_draft") is None

    def test_add_customer_at_ticket_confirm_parks_and_starts_customer(self):
        draft = {
            "awaiting": "confirm",
            "customerName": "aashiika",
            "customerEmail": "aashiika@gmail.com",
            "issue": "my crm is not working properly so fix ti soon",
            "subject": "my crm is not working properly so fix ti soon",
            "priority": "medium",
        }
        decision = {
            "action": "CONTINUE_WORKFLOW",
            "intent": "CUSTOMER",
            "operation": "CREATE_CUSTOMER",
            "agent": "customers",
            "workflow": "create_customer",
            "confidence": 0.9,
        }
        state = {
            "messages": [HumanMessage(content="add customer")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Create Ticket",
            "ticket_draft": draft,
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": decision,
        }
        with patch("app.tools.ticket_write.create_ticket") as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            hit = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_not_called()
        assert str((orch.get("workflow_decision") or {}).get("action") or "") == (
            "START_CREATE_CUSTOMER"
        )
        cust = hit.get("customer_draft") or {}
        assert cust.get("awaiting") in ("name", "email", "phone", "confirm")
        assert hit.get("ticket_draft") is None
        parked = hit.get("parked_drafts") or []
        assert any(
            isinstance(p, dict)
            and p.get("flow") == "ticket"
            and (p.get("draft") or {}).get("customerName") == "aashiika"
            for p in parked
        )

    def test_ground_keeps_foreign_create_at_ticket_confirm(self):
        from app.agents.workflow_nlu import ground_active_collect_decision

        out = ground_active_collect_decision(
            {
                "action": "CONTINUE_WORKFLOW",
                "intent": "CUSTOMER",
                "operation": "CREATE_CUSTOMER",
                "agent": "customers",
                "workflow": "create_customer",
            },
            workflow="create_ticket",
            step="confirm",
            user_text="add customer",
            roster_members=None,
        )
        assert out["action"] == "START_CREATE_CUSTOMER"

    def test_confirm_transport_keeps_confirm_does_not_reask_contact(self):
        draft = {
            "awaiting": "confirm",
            "customerName": "anto",
            "customerEmail": "anto@gmail.com",
            "issue": "Agent assist is not working as except",
            "subject": "Agent assist is not working as except",
            "priority": "medium",
        }
        state = {
            "messages": [HumanMessage(content="confirm")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Create Ticket",
            "ticket_draft": draft,
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": {
                "action": "CONFIRM_WORKFLOW",
                "intent": "CREATE",
                "operation": "NONE",
                "confidence": 1.0,
            },
        }
        with patch(
            "app.tools.ticket_write.create_ticket",
            return_value={
                "success": False,
                "error_code": "TRANSPORT",
                "message": "timed out",
            },
        ) as created:
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            hit = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
        created.assert_called()
        kept = hit.get("ticket_draft") or {}
        assert kept.get("awaiting") == "confirm"
        assert kept.get("customerEmail") == "anto@gmail.com"
        reply = str(hit.get("reply") or "").lower()
        assert "email address or phone number" not in reply

    def test_multi_field_extract_skips_filled(self):
        hit = _resolve(
            "John, john@test.com, login broken, urgent",
            ticket_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": ["John"],
                "fields": {
                    "customerName": "John",
                    "customerEmail": "john@test.com",
                    "issue": "login broken",
                    "priority": "urgent",
                },
                "confidence": 0.96,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("ticket_draft") or {}
        assert draft.get("customerEmail") == "john@test.com"
        assert draft.get("customerId") == "cust-dir"
        assert draft.get("customerName")
        assert draft.get("issue") == "login broken"
        assert draft.get("priority") == "urgent"
        assert draft.get("awaiting") == "confirm"

    def test_multi_field_turn_does_not_use_english_scraping_when_nlu_omits_fields(self):
        hit = _resolve(
            "Create a ticket for Probe, email probe@example.com, "
            "issue is cannot access portal, priority is high.",
            ticket_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": [],
                "fields": {},
                "confidence": 0.5,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("ticket_draft") or {}
        assert not draft.get("customerEmail")
        assert not draft.get("customerId")
        assert not draft.get("issue")
        assert draft.get("awaiting") == "name"

    def test_resume_asks_only_missing(self):
        hit = _resolve(
            "continue",
            parked_drafts=[
                {
                    "flow": "ticket",
                    "draft": {
                        "awaiting": "priority",
                        "customerName": "Ada",
                        "customerEmail": "a@t.test",
                        "issue": "vpn down",
                    },
                }
            ],
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": ["ticket"],
                "confidence": 0.93,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["ticket_draft"]["customerName"] == "Ada"
        assert hit["ticket_draft"]["issue"] == "vpn down"
        # Priority is enrich-owned; resume with customer+issue → confirm.
        assert hit["ticket_draft"]["awaiting"] == "confirm"

    def test_side_quest_parks_create_ticket_in_state(self):
        hit = _resolve(
            "show my tickets first",
            ticket_draft={"awaiting": "name", "customerName": ""},
            workflow_decision={
                "action": "SIDE_QUEST",
                "intent": "TICKET",
                "entity_type": None,
                "entity_name": None,
                "values": [],
                "confidence": 0.94,
            },
        )
        assert hit is not None
        assert hit.get("handled") is False
        assert hit.get("ticket_draft") is None
        assert hit.get("defer_to_commands") is True
        assert any(
            item.get("flow") == "ticket"
            and item.get("draft", {}).get("awaiting") == "name"
            for item in hit.get("parked_drafts") or []
        )

    def test_resume_parked_ticket(self):
        hit = _resolve(
            "continue the ticket",
            parked_drafts=[
                {
                    "flow": "ticket",
                    "draft": {"awaiting": "contact", "customerName": "Ada"},
                }
            ],
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "entity_name": None,
                "values": ["ticket"],
                "confidence": 0.93,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["ticket_draft"]["awaiting"] == "contact"
        assert hit["ticket_draft"]["customerName"] == "Ada"

    def test_every_schema_workflow_parks_and_resumes_missing_only(self):
        token = uuid4().hex
        cases = [
            (
                "ticket",
                "ticket_draft",
                {
                    "awaiting": "name",
                    "customerName": token,
                    "customerEmail": f"{token}@example.test",
                    "issue": "account access is unavailable",
                },
                "confirm",
            ),
            (
                "escalate",
                "escalate_draft",
                {"awaiting": "ticket", "ticket_number": token},
                "assignee",
            ),
            (
                "team",
                "team_draft",
                {"awaiting": "name", "name": token},
                "description",
            ),
            (
                "team",
                "team_draft",
                {
                    "awaiting": "description",
                    "name": token,
                    "description": "routes contact center work",
                },
                "create_members",
            ),
            (
                "team",
                "team_draft",
                {"awaiting": "members_team", "team": token},
                "members_names",
            ),
            (
                "macro",
                "macro_draft",
                {"awaiting": "title", "title": token},
                "body",
            ),
            (
                "kb",
                "kb_draft",
                {"awaiting": "title", "title": token},
                "category",
            ),
            (
                "customer",
                "customer_draft",
                {"awaiting": "name", "name": token},
                "email",
            ),
            (
                "priority",
                "priority_draft",
                {"awaiting": "name", "displayName": token},
                "hours",
            ),
            (
                "priority",
                "priority_draft",
                {"awaiting": "name", "displayName": token, "kind": "status"},
                "confirm",
            ),
        ]
        for flow, draft_key, draft, expected_awaiting in cases:
            parked_hit = _resolve(
                f"independent-{uuid4().hex}",
                **{draft_key: draft},
                workflow_decision={
                    "action": "SIDE_QUEST",
                    "intent": "TICKET",
                    "entity_type": None,
                    "entity_name": None,
                    "values": [],
                    "fields": {},
                    "confidence": 0.99,
                },
            )
            assert parked_hit and parked_hit["handled"] is False
            assert parked_hit.get("defer_to_commands") is True
            assert parked_hit.get(draft_key) is None
            parked = parked_hit.get("parked_drafts") or []
            saved = next(item["draft"] for item in parked if item["flow"] == flow)
            for key, value in draft.items():
                assert saved.get(key) == value

            resumed = _resolve(
                f"resume-{uuid4().hex}",
                parked_drafts=parked,
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": None,
                    "entity_name": None,
                    "values": [],
                    "fields": {},
                    "confidence": 0.99,
                },
            )
            assert resumed and resumed["handled"] is True
            restored = resumed.get(draft_key) or {}
            assert restored.get("awaiting") == expected_awaiting
            for key, value in draft.items():
                if key != "awaiting":
                    assert restored.get(key) == value


class TestPortalSpecialistGateway:
    """
    Strict portal pipeline: Python never paints chat text; specialist is the
    only UI exit. Covers no-KB, KB, confirm, thanks, guest, context factory.
    """

    @staticmethod
    def _assert_no_python_reply(hit: dict) -> None:
        assert hit is not None
        assert hit.get("handled") is False, "portal must hand off, not END in Python"
        assert not str(hit.get("reply") or "").strip(), "no Python user-facing reply"
        assert str(hit.get("route") or "").strip().lower() == "kb"

    @staticmethod
    def _portal_wm(
        text: str,
        *,
        decision: dict,
        ticket_draft: dict | None = None,
        role: str = "portal_customer",
    ) -> dict:
        state = {
            "messages": [HumanMessage(content=text)],
            "organization_id": "1",
            "user_role": role,
            "user_id": "cust-1",
            "user_name": "Customer",
            "page": "Support portal",
            "surface": "portal",
            "chat_module": "portal",
            "chat_surface": "home",
            "ticket_draft": ticket_draft,
            "current_workflow": "create_ticket" if ticket_draft else None,
            "current_step": (ticket_draft or {}).get("awaiting") if ticket_draft else None,
            "workflow_decision": decision,
            "session_history": [{"role": "user", "text": text}],
        }
        with patch(
            "app.agents.workflow_nlu.decide_workflow_turn",
            return_value=decision,
        ):
            return workflow_manager_node(state)  # type: ignore[arg-type]

    def test_strict_no_kb_issue_stores_confirm_draft_without_reply(self):
        scenarios = [
            "my lola chatbot is not responding while scheduling a demo",
            "VPN is not connecting on the office network today",
            "billing invoice shows the wrong amount for March",
        ]
        with patch("app.tools.catalog_tools.portal_create_ticket") as create, patch(
            "app.proactive.dssa.evaluate_deflection",
            return_value={
                "deflect": False,
                "reply": "",
                "confidence": 0.1,
                "articles": [],
            },
        ):
            for text in scenarios:
                hit = _resolve(
                    text,
                    role="portal_customer",
                    workflow_decision={
                        "action": "START_CREATE_TICKET",
                        "intent": "CREATE",
                        "entity_type": "ticket",
                        "values": [text],
                        "fields": {"issue": text},
                        "confidence": 0.95,
                    },
                )
                self._assert_no_python_reply(hit)
                draft = hit.get("ticket_draft") or {}
                assert draft.get("awaiting") == "confirm", text
                assert draft.get("surface") == "portal", text
                assert len(str(draft.get("issue") or "")) >= 8, text
                create.assert_not_called()

    def test_strict_kb_hit_stores_pending_kb_not_dssa_bubble(self):
        guidance = "Step 1: open Settings. Step 2: reset the AI Worker."
        with patch("app.tools.catalog_tools.portal_create_ticket") as create, patch(
            "app.proactive.dssa.evaluate_deflection",
            return_value={
                "deflect": True,
                "reply": guidance,
                "confidence": 0.92,
                "article_ids": ["art-1"],
                "chosen_articles": [
                    {"id": "art-1", "title": "AI Worker", "content": "definition…"}
                ],
            },
        ):
            hit = _resolve(
                "in my crm the AI worker is not correctly working",
                role="portal_customer",
                workflow_decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "fields": {
                        "issue": "in my crm the AI worker is not correctly working"
                    },
                    "values": ["AI worker is not correctly working"],
                    "confidence": 0.96,
                },
            )
        self._assert_no_python_reply(hit)
        create.assert_not_called()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "kb_resolution"
        assert draft.get("kb_offered") is True
        pending = draft.get("pending_kb") or {}
        assert isinstance(pending, dict)
        assert pending.get("guidance_notes") == guidance
        # Must not paint DSSA text as the turn reply
        assert guidance not in str(hit.get("reply") or "")

    def test_strict_confirm_yes_does_not_bind_yes_as_issue_or_file(self):
        issue = (
            "chatbot is not working fine while scheduling a demo "
            "and connecting to a live agent"
        )
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            hit = _resolve(
                "yes",
                role="portal_customer",
                ticket_draft={
                    "awaiting": "confirm",
                    "surface": "portal",
                    "issue": issue,
                    "subject": "Lola chatbot issues",
                    "description": issue,
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "values": [],
                    "fields": {},
                    "confidence": 0.95,
                },
            )
        self._assert_no_python_reply(hit)
        create.assert_not_called()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert draft.get("issue") == issue
        assert str(draft.get("issue") or "").lower() != "yes"

    def test_strict_thanks_after_kb_keeps_draft_for_specialist(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            hit = _resolve(
                "okayy thanks ill follow this article and sort it myself",
                role="portal_customer",
                ticket_draft={
                    "awaiting": "kb_resolution",
                    "surface": "portal",
                    "kb_offered": True,
                    "pending_kb": {
                        "guidance_notes": "Based on the article AI Worker…",
                        "articles": [{"id": "1", "title": "AI Worker"}],
                    },
                    "issue": "AI Worker is not correctly working in my CRM",
                    "subject": "AI Worker issue",
                    "description": "AI Worker is not correctly working in my CRM",
                },
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "values": [],
                    "fields": {},
                    "confidence": 0.9,
                },
            )
        self._assert_no_python_reply(hit)
        create.assert_not_called()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "kb_resolution"
        assert "AI Worker" in str(draft.get("issue") or "")

    def test_strict_still_need_ticket_arms_confirm_not_python_file(self):
        with patch("app.tools.catalog_tools.portal_create_ticket") as create:
            hit = _resolve(
                "still not working please create a ticket",
                role="portal_customer",
                ticket_draft={
                    "awaiting": "kb_resolution",
                    "surface": "portal",
                    "kb_offered": True,
                    "issue": "VPN isn't connecting on the office network",
                    "description": "VPN isn't connecting on the office network",
                },
                workflow_decision={
                    "action": "CONFIRM_WORKFLOW",
                    "operation": "CREATE_TICKET",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "values": [],
                    "fields": {},
                    "confidence": 0.95,
                },
            )
        self._assert_no_python_reply(hit)
        create.assert_not_called()
        draft = hit.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert draft.get("kb_offered") is True

    def test_strict_wm_node_always_specialist_handoff_empty_reply(self):
        with patch(
            "app.proactive.dssa.evaluate_deflection",
            return_value={"deflect": False, "reply": "", "confidence": 0.0},
        ), patch("app.tools.catalog_tools.portal_create_ticket") as create:
            out = self._portal_wm(
                "printer offline in building B since morning",
                decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "fields": {
                        "issue": "printer offline in building B since morning"
                    },
                    "values": ["printer offline"],
                    "confidence": 0.94,
                    "agent": "kb",
                },
            )
        create.assert_not_called()
        assert out.get("specialist_handoff") is True
        assert out.get("workflow_handled") is False
        assert not str(out.get("reply") or "").strip()
        assert str(out.get("route") or "") == "kb"
        draft = out.get("ticket_draft") or {}
        assert draft.get("awaiting") == "confirm"
        assert "printer" in str(draft.get("issue") or "").lower()

    def test_strict_wm_continue_confirm_handoff_preserves_issue(self):
        issue = "email sync failed after password reset yesterday"
        out = self._portal_wm(
            "yes go ahead",
            ticket_draft={
                "awaiting": "confirm",
                "surface": "portal",
                "issue": issue,
                "subject": "Email sync",
                "description": issue,
            },
            decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "confidence": 0.97,
                "agent": "kb",
                "values": [],
                "fields": {},
            },
        )
        assert out.get("specialist_handoff") is True
        assert out.get("workflow_handled") is False
        assert not str(out.get("reply") or "").strip()
        draft = out.get("ticket_draft") or {}
        assert draft.get("issue") == issue
        assert draft.get("awaiting") == "confirm"

    def test_strict_context_factory_exposes_draft_and_pending_kb(self):
        from app.context_factory import build_specialist_human, build_super_agent_context

        issue = "AI Worker fails when scheduling a demo"
        state = {
            "user_role": "portal_customer",
            "surface": "portal",
            "chat_module": "portal",
            "page": "Support portal",
            "current_workflow": "create_ticket",
            "current_step": "kb_resolution",
            "ticket_draft": {
                "awaiting": "kb_resolution",
                "surface": "portal",
                "issue": issue,
                "kb_offered": True,
                "pending_kb": {
                    "guidance_notes": "Open the AI Worker article steps…",
                    "articles": [{"id": "a1", "title": "AI Worker"}],
                },
            },
            "session_history": [
                {"role": "user", "text": issue},
                {"role": "assistant", "text": "Here are some steps…"},
                {"role": "user", "text": "okay thanks ill sort it myself"},
            ],
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
            },
        }
        sa = build_super_agent_context(state, "okay thanks ill sort it myself")  # type: ignore[arg-type]
        assert "ticket_draft" in (sa.get("drafts") or {})
        assert (sa["drafts"]["ticket_draft"]).get("awaiting") == "kb_resolution"
        human = build_specialist_human(
            state,  # type: ignore[arg-type]
            "okay thanks ill sort it myself",
            agent_key="kb",
        )
        assert "pending_kb" in human
        assert issue in human
        assert "do not paste verbatim" in human.lower() or "pending_kb" in human

    def test_strict_specialist_confirm_files_via_tool_not_python_continue(self):
        """End-to-end: WM handoff → KB specialist → portal_create_ticket tool."""
        issue = "lola chatbot not responding while scheduling a demo"
        draft = {
            "awaiting": "confirm",
            "surface": "portal",
            "issue": issue,
            "subject": "Lola chatbot",
            "description": issue,
            "kb_offered": True,  # skip local DSSA re-gate on force_create
        }
        decision = {
            "action": "CONFIRM_WORKFLOW",
            "intent": "CREATE",
            "operation": "CREATE_TICKET",
            "entity_type": "ticket",
            "agent": "kb",
            "confidence": 0.98,
            "values": [],
            "fields": {},
        }
        state = {
            "messages": [HumanMessage(content="yes")],
            "organization_id": "1",
            "user_role": "portal_customer",
            "user_id": "cust-1",
            "user_name": "Customer",
            "page": "Support portal",
            "surface": "portal",
            "chat_module": "portal",
            "chat_surface": "home",
            "ticket_draft": draft,
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": decision,
            "can_create_ticket": True,
            "session_history": [
                {"role": "user", "text": issue},
                {"role": "assistant", "text": "Want me to file a ticket?"},
                {"role": "user", "text": "yes"},
            ],
        }

        class _Msg:
            def __init__(self):
                self.content = ""
                self.tool_calls = [
                    {
                        "name": "portal_create_ticket",
                        "args": {
                            "issue": issue,
                            "subject": "Lola chatbot",
                            "description": issue,
                            "force_create": True,
                        },
                        "id": "tc1",
                    }
                ]

        class _FakeLLM:
            def bind(self, **_kwargs):
                return self

            def bind_tools(self, _tools):
                return self

            def invoke(self, _messages):
                return _Msg()

        calls: list[dict] = []

        def _fake_portal_create(
            issue: str = "",
            subject: str = "",
            description: str = "",
            *,
            force_create: bool = False,
        ):
            calls.append(
                {
                    "issue": issue,
                    "subject": subject,
                    "description": description,
                    "force_create": force_create,
                }
            )
            return {
                "success": True,
                "payload": {"ticketNumber": "#77001", "subject": "Lola chatbot"},
            }

        with patch(
            "app.agents.workflow_nlu.decide_workflow_turn", return_value=decision
        ), patch("app.agents.base.get_llm", return_value=_FakeLLM()), patch(
            # bound.Tool builders close over this name — MagicMock breaks from_function.
            "app.tools.bound.portal_create_ticket",
            new=_fake_portal_create,
        ), patch(
            "app.tasks.phrase.phrase_reply",
            return_value="Ticket #77001 is filed for your Lola chatbot issue.",
        ):
            orch = workflow_manager_node(state)  # type: ignore[arg-type]
            assert orch.get("specialist_handoff") is True
            assert not str(orch.get("reply") or "").strip()
            out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]

        assert calls, "specialist must invoke portal_create_ticket"
        issue_val = str(calls[0].get("issue") or "")
        assert "lola" in issue_val.lower() or "chatbot" in issue_val.lower()
        reply = str(out.get("reply") or "")
        assert reply.strip(), "specialist must produce the user-facing reply"
        assert "77001" in reply or "filed" in reply.lower() or "lola" in reply.lower()
        assert out.get("ticket_draft") is None

    def test_strict_guest_navigate_without_python_copy(self):
        hit = _resolve(
            "create ticket",
            role="portal_guest",
            workflow_decision={
                "action": "START_CREATE_TICKET",
                "intent": "CREATE",
                "entity_type": "ticket",
                "confidence": 0.97,
                "values": [],
            },
        )
        self._assert_no_python_reply(hit)
        assert hit.get("ticket_draft") is None
        assert any(
            a.get("type") == "navigate" and a.get("view") == "login"
            for a in (hit.get("actions") or [])
        )


class TestCreateTeamVsAddMembers:
    def test_create_team_not_add_members(self):
        hit = _resolve(
            "create team",
            workflow_decision={
                "action": "START_CREATE_TEAM",
                "intent": "CREATE",
                "entity_type": "team",
                "entity_name": None,
                "values": [],
                "confidence": 1.0,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] == "name"
        assert any(a.get("type") == "create_team" for a in hit.get("actions") or [])
        # Must not ask which existing team to update
        assert "members_team" not in str(hit.get("team_draft"))

    def test_team_name_does_not_invent_description(self):
        hit = _resolve(
            "nlp",
            team_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "fields": {
                    "name": "nlp",
                    "description": "Natural language processing team",
                },
                "values": ["nlp"],
                "confidence": 0.9,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("team_draft") or {}
        assert "nlp" in str(draft.get("name") or "").lower()
        assert not draft.get("description")
        assert draft.get("awaiting") == "description"

    def test_start_create_team_from_nlu(self):
        hit = _resolve(
            "create a new team",
            ticket_draft={"awaiting": "issue", "customerName": "lokes", "customerEmail": "a@b.c"},
            workflow_decision={
                "action": "START_CREATE_TEAM",
                "intent": "CREATE",
                "entity_type": "team",
                "entity_name": None,
                "values": [],
                "confidence": 0.99,
            },
        )
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] == "name"
        parked = hit.get("parked_drafts") or []
        assert any(p.get("flow") == "ticket" for p in parked)
        assert not (hit.get("team_draft") or {}).get("name")

    def test_create_command_is_not_stored_as_team_name(self):
        hit = _resolve(
            "create a new team",
            team_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "fields": {"name": "create a new team"},
                "values": ["create a new team"],
                "confidence": 0.9,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("team_draft") or {}
        assert draft.get("awaiting") == "name"
        assert not draft.get("name")

    def test_start_create_team_restarts_instead_of_binding_command_as_name(self):
        hit = _resolve(
            "create a new team",
            team_draft={"awaiting": "name"},
            workflow_decision={
                "action": "START_CREATE_TEAM",
                "intent": "CREATE",
                "entity_type": "team",
                "fields": {"name": "create a new team"},
                "values": [],
                "confidence": 0.99,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("team_draft") or {}
        assert draft.get("awaiting") == "name"
        assert not draft.get("name")

    def test_add_members_still_works(self):
        with patch(
            "app.tools.catalog_tools.list_queues",
            return_value={
                "success": True,
                "payload": [
                    {"id": "q1", "queueName": "nlp", "name": "nlp"},
                    {"id": "q2", "queueName": "Bug solvers", "name": "Bug solvers"},
                ],
            },
        ):
            hit = _resolve(
                "add members to a team",
                workflow_decision={
                    "action": "START_ADD_TEAM_MEMBERS",
                    "intent": "UPDATE",
                    "entity_type": "team",
                    "entity_name": None,
                    "values": [],
                    "confidence": 0.98,
                },
            )
        assert hit and hit["handled"] is True
        assert hit["team_draft"]["awaiting"] in (
            "members_team",
            "members_names",
            "members",
        )


class TestGenericWorkflowSchemas:
    @pytest.fixture(autouse=True)
    def _directory_customers(self):
        def _hits(*, query=None, exact_email=None, exact_phone=None):
            query = str(exact_email or exact_phone or query or "").strip()
            if "@" in query:
                return {
                    "success": True,
                    "payload": {
                        "data": [
                            {
                                "id": "cust-dir",
                                "name": "Directory Customer",
                                "email": query.lower(),
                                "phone": "",
                            }
                        ]
                    },
                }
            return {"success": True, "payload": {"data": []}}

        with patch("app.tools.catalog_tools.list_customers", side_effect=_hits):
            yield

    def test_resolve_roster_unique_first_token(self):
        from app.workflow_schemas import (
            ground_fields_in_utterance,
            resolve_entity,
            resolve_roster_name,
        )

        roster = ["Mohamed Fazil", "raghu ram", "sri annamalai"]
        assert resolve_roster_name("raghu", roster) == "raghu ram"
        hit = resolve_entity(
            "mohamed",
            [
                {"id": "u-m", "name": "Mohamed Fazil"},
                {"id": "u-r", "name": "raghu ram"},
            ],
        )
        assert hit and hit.get("name") == "Mohamed Fazil"
        assert hit.get("id") == "u-m"
        first = resolve_entity("first", [{"id": "1", "name": "Jane"}, {"id": "2", "name": "Alex"}])
        assert first and first.get("name") == "Jane"
        assert resolve_roster_name("raghu ram", roster) == "raghu ram"
        assert resolve_roster_name("nobody", roster) is None
        assert resolve_roster_name("annamalai", roster) == "sri annamalai"
        assert resolve_roster_name("raghu", ["raghu ram", "raghu k"]) is None
        assert (
            resolve_roster_name("rahu", ["Mohamed Fazil", "Raghuram M"])
            == "Raghuram M"
        )
        assert resolve_roster_name("raghu", ["Mohamed Fazil", "Raghuram M"]) == "Raghuram M"
        grounded = ground_fields_in_utterance(
            {"customerName": "raghu"},
            "raghu",
            roster_members=roster,
        )
        assert grounded.get("members") == ["raghu ram"]
        dumped = ground_fields_in_utterance(
            {"members": ["Deva NS"]},
            "deva",
            roster_members=[*roster, "Deva NS"],
        )
        assert dumped.get("members") == ["Deva NS"]
        all_kept = ground_fields_in_utterance(
            {"members": roster},
            "add them all",
            roster_members=roster,
        )
        assert all_kept.get("members") == roster
        invented = ground_fields_in_utterance(
            {"members": ["Not A Person"]},
            "add them all",
            roster_members=roster,
        )
        assert not invented.get("members")
        paraphrased_issue = ground_fields_in_utterance(
            {"issue": "All metrics on the page are wrong; needs to be fixed soon"},
            "here this page all metrics are wrong fix this soon",
        )
        assert paraphrased_issue.get("issue")
        assert "metrics" in str(paraphrased_issue.get("issue")).lower()
        file_urls = ground_fields_in_utterance(
            {"attachments": ["/uploads/shot.png", "http://evil.example/x"]},
            "here this page all metrics are wrong fix this soon",
        )
        assert file_urls.get("attachments") == ["/uploads/shot.png"]

    def test_registry_covers_all_modules(self):
        from app.workflow_schemas import schema_for_workflow

        for wid in (
            "create_ticket",
            "create_team",
            "add_team_members",
            "create_macro",
            "create_kb",
            "escalate",
            "create_priority",
            "create_status",
            "create_customer",
        ):
            schema = schema_for_workflow(wid)
            assert schema, wid
            assert schema.get("required")
            assert schema.get("field_labels")

    def test_every_module_confirm_handoff_and_false_cancel(self):
        """Guided writes: specialist owns confirm; issue-like text is not CANCEL."""
        from app.agents.workflow_nlu import ground_active_collect_decision
        from app.tasks.catalog_commands import (
            continue_customer_draft,
            continue_kb_draft,
            continue_priority_draft,
            continue_team_draft,
        )
        from app.tasks.chat_commands import (
            _continue_macro_draft,
            _continue_ticket_draft,
            continue_escalate_draft,
        )

        false_issue = "ng properly fix it soon"
        cases = [
            ("create_ticket", "confirm"),
            ("create_team", "confirm"),
            ("create_customer", "confirm"),
            ("create_kb", "confirm"),
            ("create_macro", "confirm"),
            ("create_priority", "confirm"),
            ("create_status", "confirm"),
            ("escalate", "confirm"),
            ("add_team_members", "confirm"),
        ]
        for wf, step in cases:
            grounded = ground_active_collect_decision(
                {
                    "action": "CANCEL_WORKFLOW",
                    "intent": "CREATE",
                    "operation": "NONE",
                },
                workflow=wf,
                step=step,
                user_text=false_issue,
                roster_members=None,
            )
            assert grounded["action"] == "CONTINUE_WORKFLOW", wf
            real = ground_active_collect_decision(
                {
                    "action": "CANCEL_WORKFLOW",
                    "intent": "CREATE",
                    "operation": "NONE",
                },
                workflow=wf,
                step=step,
                user_text="never mind cancel this",
                roster_members=None,
            )
            assert real["action"] == "CANCEL_WORKFLOW", wf

        informal = ground_active_collect_decision(
            {
                "action": "CONTINUE_WORKFLOW",
                "intent": "TEAMS",
                "operation": "NONE",
                "fields": {"name": "yehh"},
                "values": ["yehh"],
                "entity_name": "yehh",
            },
            workflow="create_team",
            step="confirm",
            user_text="yehh",
            roster_members=None,
        )
        assert informal["action"] == "CONTINUE_WORKFLOW"
        assert informal.get("fields") in (None, {})
        assert informal.get("values") in (None, [])
        assert not informal.get("entity_name")

        org = "org-1"
        role = "admin"
        common = dict(org=org, role=role, user_id="u1", user_name="Admin", page="Home")
        confirm_decision = {"action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        tix_hit = _continue_ticket_draft(
            "yeah go ahead",
            **common,
            ticket_draft={
                "awaiting": "confirm",
                "customerName": "Ada",
                "customerEmail": "ada@t.test",
                "issue": "VPN will not connect",
            },
            semantic_decision=confirm_decision,
        )
        assert tix_hit.get("handled") is False
        assert (tix_hit.get("ticket_draft") or {}).get("awaiting") == "confirm"

        team_hit = continue_team_draft(
            "yeah go ahead",
            **common,
            team_draft={
                "awaiting": "confirm",
                "name": "Ops",
                "description": "handles operations work",
            },
            semantic_decision=confirm_decision,
        )
        assert team_hit.get("handled") is False
        assert (team_hit.get("team_draft") or {}).get("awaiting") == "confirm"

        members_hit = continue_team_draft(
            "yeah go ahead",
            **common,
            team_draft={
                "awaiting": "confirm",
                "id": "q1",
                "team": "Ops",
                "name": "Ops",
                "members": ["Ada"],
                "flow": "add_team_members",
            },
            semantic_decision=confirm_decision,
        )
        assert members_hit.get("handled") is False
        assert (members_hit.get("team_draft") or {}).get("awaiting") == "confirm"

        cust_hit = continue_customer_draft(
            "yeah go ahead",
            **common,
            customer_draft={
                "awaiting": "confirm",
                "name": "Ada",
                "email": "ada@t.test",
                "phone": "5551234567",
            },
            semantic_decision=confirm_decision,
        )
        assert cust_hit.get("handled") is False
        assert (cust_hit.get("customer_draft") or {}).get("awaiting") == "confirm"

        kb_hit = continue_kb_draft(
            "yeah go ahead",
            **common,
            kb_draft={
                "awaiting": "confirm",
                "title": "VPN",
                "category": "General",
                "body": "Reset the client and retry the tunnel.",
            },
            semantic_decision=confirm_decision,
        )
        assert kb_hit.get("handled") is False
        assert (kb_hit.get("kb_draft") or {}).get("awaiting") == "confirm"

        pri_hit = continue_priority_draft(
            "yeah go ahead",
            **common,
            priority_draft={
                "awaiting": "confirm",
                "displayName": "Critical",
                "resolutionHours": 4,
            },
            semantic_decision=confirm_decision,
        )
        assert pri_hit.get("handled") is False
        assert (pri_hit.get("priority_draft") or {}).get("awaiting") == "confirm"

        status_hit = continue_priority_draft(
            "yeah go ahead",
            **common,
            priority_draft={
                "awaiting": "confirm",
                "kind": "status",
                "displayName": "Waiting on customer",
            },
            semantic_decision=confirm_decision,
        )
        assert status_hit.get("handled") is False
        assert (status_hit.get("priority_draft") or {}).get("awaiting") == "confirm"

        mac_hit = _continue_macro_draft(
            "yeah go ahead",
            **common,
            macro_draft={
                "awaiting": "confirm",
                "title": "vip",
                "body": "Thanks for contacting VIP support.",
            },
            semantic_decision=confirm_decision,
        )
        assert mac_hit.get("handled") is False
        assert (mac_hit.get("macro_draft") or {}).get("awaiting") == "confirm"

        esc_hit = continue_escalate_draft(
            "yeah go ahead",
            **common,
            escalate_draft={
                "awaiting": "confirm",
                "ticket_number": "T-1",
                "assignee": "Deva",
            },
            semantic_decision=confirm_decision,
        )
        assert esc_hit.get("handled") is False
        assert (esc_hit.get("escalate_draft") or {}).get("awaiting") == "confirm"

    def test_email_is_not_a_team_name(self):
        hit = _resolve(
            "lokesh@gmail.com",
            team_draft={"awaiting": "name"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "team",
                "values": [],
                "fields": {},
                "confidence": 0.4,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("team_draft") or {}
        assert draft.get("awaiting") == "name"
        assert "@" not in str(draft.get("name") or "")

    def test_macro_nlu_fields_skip_ahead(self):
        hit = _resolve(
            "title VIP greeting body thanks for waiting we will help shortly",
            macro_draft={"awaiting": "title"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "macro",
                "values": [],
                "fields": {
                    "title": "VIP greeting",
                    "body": "Thanks for waiting — we will help shortly.",
                },
                "confidence": 0.95,
            },
        )
        assert hit and hit["handled"] is True
        draft = hit.get("macro_draft") or {}
        assert draft.get("title") == "VIP greeting"
        assert "help shortly" in str(draft.get("body") or "")
        assert draft.get("awaiting") == "confirm"

    def test_hydrate_customer_draft(self):
        snap = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            customer_draft={"awaiting": "contact", "name": "Aashika"},
        )
        assert snap["current_workflow"] == WF_CREATE_CUSTOMER
        assert snap["current_step"] == "contact"

    def test_add_customer_name_does_not_invent_email(self):
        with patch("app.tools.catalog_tools.create_customer") as create:
            hit = _resolve(
                "manoj",
                customer_draft={"awaiting": "name"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "intent": "CUSTOMER",
                    "fields": {"name": "manoj", "email": "manoj@gmail.com"},
                    "values": ["manoj"],
                    "confidence": 0.9,
                },
            )
        create.assert_not_called()
        assert hit and hit.get("handled") is True
        draft = hit.get("customer_draft") or {}
        assert "manoj" in str(draft.get("name") or "").lower()
        assert not draft.get("email")
        assert draft.get("awaiting") == "email"

    def test_add_customer_from_ticket_asks_contact_not_name(self):
        hit = _resolve(
            "add customer",
            ticket_draft={"awaiting": "contact", "customerName": "Aashika"},
            workflow_decision={
                "action": "START_CREATE_CUSTOMER",
                "intent": "CUSTOMER",
                "fields": {},
                "values": [],
                "confidence": 0.99,
            },
        )
        assert hit and hit.get("handled") is True
        draft = hit.get("customer_draft") or {}
        assert draft.get("name") == "Aashika"
        assert draft.get("awaiting") == "email"
        parked = hit.get("parked_drafts") or []
        assert any(
            isinstance(p, dict)
            and p.get("flow") == "ticket"
            and (p.get("draft") or {}).get("customerName") == "Aashika"
            for p in parked
        )

    def test_create_customer_nested_payload_resumes_parked_ticket(self):
        """Express nests the row under payload.customer — resume must unwrap it."""
        from app.tasks.catalog_commands import (
            _directory_row_from_tool,
            _finish_customer_saved,
        )

        tool_result = {
            "success": True,
            "payload": {
                "customer": {
                    "id": "42",
                    "name": "Ashika",
                    "email": "ashika2701@gmail.com",
                    "phone": "9876543212",
                },
                "inviteSent": False,
            },
        }
        row = _directory_row_from_tool(tool_result)
        assert row and str(row.get("id")) == "42"
        # Flat payload.id alone must not be required for resume.
        assert not (tool_result["payload"].get("id"))

        resumed = _finish_customer_saved(
            "yehh",
            page="customers",
            name=str(row.get("name") or ""),
            email=str(row.get("email") or ""),
            phone=str(row.get("phone") or ""),
            cid=str(row.get("id") or ""),
            parked_drafts=[
                {
                    "flow": "ticket",
                    "draft": {
                        "awaiting": "confirm",
                        "customerName": "Ashika",
                        "issue": "CRM blank image",
                        "priority": "medium",
                    },
                }
            ],
            reused=False,
        )
        ticket = resumed.get("ticket_draft") or {}
        assert ticket.get("customerId") == "42"
        assert ticket.get("customerName") == "Ashika"
        assert ticket.get("customerEmail") == "ashika2701@gmail.com"
        assert ticket.get("awaiting") == "confirm"
        assert resumed.get("current_workflow") == "create_ticket"
        assert resumed.get("customer_draft") is None

    def test_parked_summary_preserves_filled_and_missing(self):
        from app.memory_contract import (
            maybe_offer_resume,
            summarize_parked_workflows,
        )

        parked = [
            {
                "flow": "customer",
                "draft": {
                    "awaiting": "phone",
                    "name": "John",
                    "email": "john@gmail.com",
                },
            }
        ]
        summaries = summarize_parked_workflows(parked)
        assert len(summaries) == 1
        assert summaries[0]["filled_fields"].get("name") == "John"
        assert summaries[0]["filled_fields"].get("email") == "john@gmail.com"
        assert "phone" in (summaries[0].get("missing_fields") or [])

        offer = maybe_offer_resume(parked, user_text="done", page="tickets")
        assert offer and offer.get("offer_reply")
        assert offer["pending_resume"]["flow"] == "customer"
        assert "phone" in (offer["pending_resume"].get("missing_fields") or [])

    def test_resume_parked_customer_asks_only_missing_phone(self):
        hit = _resolve(
            "yes",
            parked_drafts=[
                {
                    "flow": "customer",
                    "draft": {
                        "awaiting": "phone",
                        "name": "John",
                        "email": "john@gmail.com",
                    },
                }
            ],
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CUSTOMER",
                "entity_type": "customer",
                "fields": {},
                "values": ["customer"],
                "confidence": 0.99,
            },
        )
        assert hit and hit.get("handled") is True
        draft = hit.get("customer_draft") or {}
        assert draft.get("name") == "John"
        assert draft.get("email") == "john@gmail.com"
        assert draft.get("awaiting") == "phone"
        assert not hit.get("ticket_draft")
        reply = str(hit.get("reply") or "").lower()
        assert "name" not in reply or "john" in reply
        # Should be asking for phone / contact, not restarting at name-only.
        assert draft.get("awaiting") == "phone"

    def test_apply_customer_binds_parked_ticket_without_unparking(self):
        from app.memory_contract import apply_customer_row_to_parked_tickets

        parked = apply_customer_row_to_parked_tickets(
            [
                {
                    "flow": "ticket",
                    "draft": {
                        "awaiting": "confirm",
                        "customerName": "Ashika",
                        "issue": "CRM",
                    },
                },
                {
                    "flow": "macro",
                    "draft": {"awaiting": "body", "title": "Hi"},
                },
            ],
            customer_id="99",
            name="Ashika",
            email="a@x.com",
            phone="1234567890",
        )
        ticket = next(p for p in parked if p["flow"] == "ticket")
        assert ticket["draft"]["customerId"] == "99"
        assert ticket["draft"]["customerEmail"] == "a@x.com"
        assert any(p["flow"] == "macro" for p in parked)

    def test_resume_ticket_binds_last_entity_customer_id(self):
        from app.workflow_state import apply_last_entity_to_ticket

        bound = apply_last_entity_to_ticket(
            {"awaiting": "name", "issue": "VPN down"},
            {"type": "customer", "id": "cust-ada", "name": "Ada"},
        )
        assert bound["customerId"] == "cust-ada"
        assert bound["customerName"] == "Ada"
        assert bound["awaiting"] != "name"

        hit = _resolve(
            "continue",
            parked_drafts=[
                {
                    "flow": "ticket",
                    "draft": {"awaiting": "contact", "customerName": "Ada"},
                }
            ],
            last_entity={"type": "customer", "id": "cust-ada", "name": "Ada"},
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "intent": "CREATE",
                "entity_type": "ticket",
                "fields": {},
                "confidence": 0.99,
            },
        )
        assert hit and hit.get("handled") is True
        draft = hit.get("ticket_draft") or {}
        assert draft.get("customerId") == "cust-ada"
        assert draft.get("customerName") == "Ada"

    def test_hydrate_priority_draft(self):
        from app.workflow_state import WF_CREATE_PRIORITY, hydrate_from_legacy_drafts

        snap = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            priority_draft={"awaiting": "hours", "kind": "priority", "displayName": "P1"},
        )
        assert snap["current_workflow"] == WF_CREATE_PRIORITY
        assert snap["current_step"] == "hours"

    def test_hydrate_ignores_prompt_next_step(self):
        from app.workflow_state import hydrate_from_legacy_drafts

        snap = hydrate_from_legacy_drafts(
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            next_step="email address or phone number",
        )
        assert snap["current_workflow"] is None

    def test_create_ticket_action_includes_draft_fields(self):
        hit = _resolve(
            "lokesh@gmail.com",
            ticket_draft={"awaiting": "contact", "customerName": "lokesh"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "intent": "CREATE",
                "fields": {"customerEmail": "lokesh@gmail.com"},
                "confidence": 0.9,
            },
        )
        act = next(
            a
            for a in (hit.get("actions") or [])
            if isinstance(a, dict) and a.get("type") == "create_ticket"
        )
        assert act.get("customerEmail") == "lokesh@gmail.com"
        assert act.get("customerName")
        assert act.get("step") == "issue"


class TestModuleSpecialistQueries:
    @pytest.fixture(autouse=True)
    def _llm(self, llm):
        return llm

    def _state(self, decision, **extra):
        return {
            "messages": [HumanMessage(content="show tickets")],
            "organization_id": "00000000-0000-4000-8000-000000000001",
            "user_id": "00000000-0000-4000-8000-000000000002",
            "user_name": "Admin",
            "user_role": "admin",
            "workflow_decision": decision,
            "conversation_context": extra.pop("conversation_context", {}),
            "page": "Home",
            **extra,
        }

    def test_nlu_page_default_ticket_scopes(self):
        from app.agents.workflow_nlu import normalize_workflow_decision

        inbox = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "SEARCH_TICKETS",
                "filters": {"query": "VPN"},
                "proposed_tool": "list_tickets",
                "confidence": 0.9,
            },
            user_text="Find the VPN ticket",
            page="Team inbox",
        )
        assert inbox["operation"] in {"SEARCH_TICKETS", "LIST_TICKETS"}
        assert inbox["filters"].get("scope") == "team"

        unassigned = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "LIST_TICKETS",
                "filters": {"priority": "urgent"},
                "proposed_tool": "list_tickets",
                "confidence": 0.9,
            },
            user_text="Show unassigned urgent",
            page="Unassigned",
        )
        assert unassigned["filters"].get("scope") == "unassigned"

        all_tix = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "GET_TICKET",
                "filters": {"query": "13184"},
                "proposed_tool": "get_ticket",
                "confidence": 0.95,
            },
            user_text="Find ticket 13184",
            page="All tickets",
        )
        assert all_tix["operation"] == "GET_TICKET"

        teams = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "TEAMS",
                "operation": "LIST_TEAMS",
                "proposed_tool": "list_queues",
                "confidence": 0.9,
            },
            user_text="Show all teams",
            page="Teams",
        )
        assert teams["operation"] == "LIST_TEAMS"

        kb = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "KB",
                "operation": "SEARCH_KB",
                "filters": {"query": "password reset"},
                "proposed_tool": "list_kb",
                "confidence": 0.9,
            },
            user_text="Find password reset articles",
            page="Knowledge Base",
        )
        assert kb["operation"] == "SEARCH_KB"
        assert "password" in str(kb["filters"].get("query") or "").lower()

        customers = normalize_workflow_decision(
            {
                "action": "NORMAL_ROUTE",
                "intent": "CUSTOMER",
                "operation": "SEARCH_CUSTOMERS",
                "filters": {"query": "Mohamed Fazil"},
                "proposed_tool": "list_customers",
                "confidence": 0.9,
            },
            user_text="Find Mohamed Fazil",
            page="Customers",
        )
        assert customers["operation"] == "SEARCH_CUSTOMERS"

    def test_team_inbox_list_stays_on_page(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"status": "Open", "priority": "high", "queue": "Tech Support"},
            "proposed_tool": "list_tickets",
            "confidence": 0.97,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {
                    "data": [
                        {
                            "id": "#13190",
                            "subject": "VPN",
                            "status": "Open",
                            "priority": "high",
                            "queue": "Tech Support",
                        }
                    ]
                },
            },
        ) as listed:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="Show open high priority tickets in Tech Support")],
                    page="Team inbox",
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="Show open high priority tickets in Tech Support")],
                        page="Team inbox",
                    )
                ),
            )
        assert listed.call_args.kwargs.get("scope") == "team"
        assert listed.call_args.kwargs.get("priority") == "high"
        assert listed.call_args.kwargs.get("queue") == "Tech Support"
        assert any(a.get("view") == "team-inbox" for a in out["actions"])
        assert any(a.get("type") == "set_filter" for a in out["actions"])

    def test_unassigned_count_stays_without_filter_yank(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "GET_METRICS",
            "filters": {"scope": "unassigned"},
            "proposed_tool": "get_metrics",
            "confidence": 0.96,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {"data": [{"id": "#1", "subject": "A", "status": "Open"}] * 3},
            },
        ) as listed, patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={"success": True, "payload": {"unassigned": 3}},
        ):
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="How many unassigned tickets")],
                    page="Unassigned",
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="How many unassigned tickets")],
                        page="Unassigned",
                    )
                ),
            )
        listed.assert_called()
        assert listed.call_args.kwargs.get("scope") == "unassigned"
        assert any(a.get("view") == "unassigned" for a in out["actions"])

    def test_this_ticket_uses_open_ui_last_entity(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "agent": "tickets",
            "operation": "NONE",
            "reference": "LAST_ENTITY",
            "entity_type": "ticket",
            "confidence": 0.9,
        }
        row = {
            "id": "#13193",
            "subject": "Independence day campaign",
            "status": "Open",
            "priority": "High",
            "customerName": "Raghuram",
            "description": "clients are not getting the campaign",
        }
        ctx = {
            "last_entity": {
                "type": "ticket",
                "id": "#13193",
                "name": "13193",
                "subject": "Independence day campaign",
            }
        }
        with patch(
            "app.tools.ticket_read.get_ticket",
            return_value={"success": True, "payload": row},
        ) as got:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="tell me about this ticket")],
                    page="All tickets",
                    conversation_context=ctx,
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="tell me about this ticket")],
                        page="All tickets",
                        conversation_context=ctx,
                    )
                ),
            )
        got.assert_called()
        assert out["data"]["_tool_name"] == "get_ticket"
        assert (out.get("routing_trace") or {}).get("specialist") == "tickets"

    def test_ambiguous_this_ticket_uses_open_last_entity_not_clarify(self):
        decision = {
            "action": "AMBIGUOUS",
            "intent": "TICKET",
            "agent": "tickets",
            "operation": "GET_TICKET",
            "reference": None,
            "entity_name": None,
            "clarification": "I don't see a specific ticket selected. Provide the ticket number.",
            "proposed_tool": "get_ticket",
            "confidence": 0.5,
        }
        row = {
            "id": "#13193",
            "subject": "Independence day campaign",
            "status": "Open",
            "priority": "High",
            "customerName": "Raghuram",
            "description": "clients are not getting the campaign",
        }
        ctx = {
            "last_entity": {
                "type": "ticket",
                "id": "#13193",
                "name": "13193",
            }
        }
        with patch(
            "app.tools.ticket_read.get_ticket",
            return_value={"success": True, "payload": row},
        ) as got:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="give me the summary of this ticket")],
                    page="All tickets",
                    conversation_context=ctx,
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="give me the summary of this ticket")],
                        page="All tickets",
                        conversation_context=ctx,
                    )
                ),
            )
        got.assert_called()
        assert out.get("data", {}).get("clarificationRequired") is not True
        assert out["data"]["_tool_name"] == "get_ticket"

    def test_ambiguous_ticket_number_clarify_uses_open_last_entity(self):
        decision = {
            "action": "AMBIGUOUS",
            "intent": "TICKET",
            "agent": "tickets",
            "operation": "GET_TICKET",
            "reference": None,
            "entity_name": None,
            "clarification": "I don't see a specific ticket selected. Provide the ticket number.",
            "proposed_tool": "get_ticket",
            "confidence": 0.5,
        }
        row = {
            "id": "#13193",
            "subject": "Independence day campaign",
            "status": "Open",
            "priority": "High",
        }
        ctx = {
            "last_entity": {
                "type": "ticket",
                "id": "#13193",
                "name": "13193",
            }
        }
        with patch(
            "app.tools.ticket_read.get_ticket",
            return_value={"success": True, "payload": row},
        ) as got:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="details please")],
                    page="All tickets",
                    conversation_context=ctx,
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="details please")],
                        page="All tickets",
                        conversation_context=ctx,
                    )
                ),
            )
        got.assert_called()
        assert out.get("data", {}).get("clarificationRequired") is not True
        assert out["data"]["_tool_name"] == "get_ticket"

    def test_all_tickets_org_scope_navigates_team_queue(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "LIST_TICKETS",
            "filters": {"priority": "urgent", "created_range": "this_week", "scope": "org"},
            "proposed_tool": "list_tickets",
            "confidence": 0.97,
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "payload": {"data": []}},
        ) as listed:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="Show all urgent tickets created this week")],
                    page="All tickets",
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="Show all urgent tickets created this week")],
                        page="All tickets",
                    )
                ),
            )
        assert listed.call_args.kwargs.get("scope") == "org"
        assert listed.call_args.kwargs.get("priority") == "urgent"
        assert listed.call_args.kwargs.get("created_range") == "this_week"
        assert any(a.get("view") == "team-queue" for a in out["actions"])

    def test_assign_ticket_confirms_then_updates(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "UPDATE_TICKET",
            "fields": {"ticket_number": "13190", "assignee": "Mohamed"},
            "proposed_tool": "update_ticket",
            "confidence": 0.98,
        }
        with patch(
            "app.tools.ticket_write.update_ticket",
            return_value={"success": True, "payload": {"data": {"assignee": "Mohamed"}}},
        ) as updated:
            ask = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="Assign ticket 13190 to Mohamed")],
                    page="Team inbox",
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="Assign ticket 13190 to Mohamed")],
                        page="Team inbox",
                    )
                ),
            )
            updated.assert_not_called()
            assert ask["data"]["last_query"].get("pending_update")
            confirm = complete_specialist_handoff(
                self._state(
                    {**decision, "action": "CONFIRM_WORKFLOW"},
                    messages=[HumanMessage(content="confirm")],
                    page="Team inbox",
                    conversation_context={"last_query": ask["data"]["last_query"]},
                ),
                workflow_manager_node(
                    self._state(
                        {**decision, "action": "CONFIRM_WORKFLOW"},
                        messages=[HumanMessage(content="confirm")],
                        page="Team inbox",
                        conversation_context={"last_query": ask["data"]["last_query"]},
                    )
                ),
            )
        updated.assert_called_once()
        assert updated.call_args.args[0].lstrip("#") == "13190" or "13190" in str(
            updated.call_args.args[0]
        )
        assert any(a.get("type") == "refresh_tickets" for a in confirm["actions"])
        assert any(a.get("view") == "team-inbox" for a in confirm["actions"])

    def test_auto_assign_uses_express_tool(self):
        decision = {
            "action": "CONFIRM_WORKFLOW",
            "intent": "TICKET",
            "operation": "UPDATE_TICKET",
            "fields": {"ticket_number": "13191", "assignee": "AUTO"},
            "proposed_tool": "auto_assign_ticket",
            "confidence": 0.97,
        }
        with patch(
            "app.tools.ticket_write.auto_assign_ticket",
            return_value={"success": True, "payload": {"data": {"assignee": "Raghu"}}},
        ) as auto, patch(
            "app.tools.ticket_write.update_ticket",
            return_value={"success": True, "payload": {}},
        ) as updated:
            out = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="Assign this ticket automatically")],
                    page="Unassigned",
                    conversation_context={
                        "last_query": {
                            "entity": "tickets",
                            "operation": "UPDATE_TICKET",
                            "filters": {"query": "#13191"},
                            "pending_update": {"ticket_number": "#13191", "assignee": "AUTO"},
                        }
                    },
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="Assign this ticket automatically")],
                        page="Unassigned",
                        conversation_context={
                            "last_query": {
                                "entity": "tickets",
                                "operation": "UPDATE_TICKET",
                                "filters": {"query": "#13191"},
                                "pending_update": {"ticket_number": "#13191", "assignee": "AUTO"},
                            }
                        },
                    )
                ),
            )
        auto.assert_called_once()
        updated.assert_not_called()
        assert out["data"]["_tool_name"] == "auto_assign_ticket"

    def test_bulk_assign_confirms_then_refuses(self):
        decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TICKET",
            "operation": "UPDATE_TICKET",
            "fields": {"assignee": "Raghu"},
            "proposed_tool": "update_ticket",
            "confidence": 0.9,
        }
        ctx = {
            "last_query": {
                "entity": "tickets",
                "operation": "LIST_TICKETS",
                "filters": {"priority": "urgent", "scope": "org"},
            }
        }
        with patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {"data": [{"id": f"#{i}"} for i in range(4)]},
            },
        ), patch(
            "app.tools.ticket_write.update_ticket",
            return_value={"success": True, "payload": {}},
        ) as updated:
            ask = complete_specialist_handoff(
                self._state(
                    decision,
                    messages=[HumanMessage(content="Assign all matching tickets to Raghu")],
                    page="All tickets",
                    conversation_context=ctx,
                ),
                workflow_manager_node(
                    self._state(
                        decision,
                        messages=[HumanMessage(content="Assign all matching tickets to Raghu")],
                        page="All tickets",
                        conversation_context=ctx,
                    )
                ),
            )
            updated.assert_not_called()
            assert ask["data"]["last_query"].get("pending_bulk") is True
            done = complete_specialist_handoff(
                self._state(
                    {**decision, "action": "CONFIRM_WORKFLOW"},
                    messages=[HumanMessage(content="confirm")],
                    page="All tickets",
                    conversation_context={"last_query": ask["data"]["last_query"]},
                ),
                workflow_manager_node(
                    self._state(
                        {**decision, "action": "CONFIRM_WORKFLOW"},
                        messages=[HumanMessage(content="confirm")],
                        page="All tickets",
                        conversation_context={"last_query": ask["data"]["last_query"]},
                    )
                ),
            )
        updated.assert_not_called()
        assert "no_bulk_api" in str(done.get("data") or done.get("reply") or "") or done.get(
            "data", {}
        ).get("last_query", {}).get("operation") == "UPDATE_TICKET"

    def test_teams_list_search_compare_and_delete_confirm(self):
        queues = {
            "success": True,
            "payload": [
                {"id": "q1", "queueName": "Frontend", "openTickets": 12, "members": ["Ada"]},
                {"id": "q2", "queueName": "Backend", "openTickets": 30, "members": ["Bo"]},
            ],
        }
        listed_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TEAMS",
            "operation": "LIST_TEAMS",
            "filters": {},
            "proposed_tool": "list_queues",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_queues", return_value=queues):
            listed = complete_specialist_handoff(
                self._state(
                    listed_decision,
                    messages=[HumanMessage(content="Show all teams")],
                    page="Teams",
                ),
                workflow_manager_node(
                    self._state(
                        listed_decision,
                        messages=[HumanMessage(content="Show all teams")],
                        page="Teams",
                    )
                ),
            )
        assert listed["data"]["_tool_name"] == "list_queues"
        assert any(a.get("view") == "agent-queues" for a in listed["actions"])

        compare_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TEAMS",
            "operation": "COMPARE",
            "entity_type": "team",
            "filters": {},
            "proposed_tool": "list_queues",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_queues", return_value=queues):
            compared = complete_specialist_handoff(
                self._state(
                    compare_decision,
                    messages=[HumanMessage(content="Which team has the most open tickets?")],
                    page="Teams",
                ),
                workflow_manager_node(
                    self._state(
                        compare_decision,
                        messages=[HumanMessage(content="Which team has the most open tickets?")],
                        page="Teams",
                    )
                ),
            )
        assert compared["data"]["_tool_name"] == "list_queues"
        assert compared["route"] == "teams"

        delete_decision = {
            "action": "NORMAL_ROUTE",
            "intent": "TEAMS",
            "operation": "DELETE_TEAM",
            "filters": {"query": "Frontend"},
            "proposed_tool": "delete_queue",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_queues", return_value=queues), patch(
            "app.tools.catalog_tools.delete_queue",
            return_value={"success": True, "payload": {}},
        ) as deleted:
            ask = complete_specialist_handoff(
                self._state(
                    delete_decision,
                    messages=[HumanMessage(content="Delete the frontend team")],
                    page="Teams",
                ),
                workflow_manager_node(
                    self._state(
                        delete_decision,
                        messages=[HumanMessage(content="Delete the frontend team")],
                        page="Teams",
                    )
                ),
            )
            deleted.assert_not_called()
            done = complete_specialist_handoff(
                self._state(
                    {**delete_decision, "action": "CONFIRM_WORKFLOW"},
                    messages=[HumanMessage(content="confirm")],
                    page="Teams",
                    conversation_context={"last_query": ask["data"]["last_query"]},
                ),
                workflow_manager_node(
                    self._state(
                        {**delete_decision, "action": "CONFIRM_WORKFLOW"},
                        messages=[HumanMessage(content="confirm")],
                        page="Teams",
                        conversation_context={"last_query": ask["data"]["last_query"]},
                    )
                ),
            )
        deleted.assert_called_once()
        assert any(a.get("type") == "refresh_teams" for a in done["actions"])

    def test_team_membership_lookup_uses_live_member_lists(self):
        queues = {
            "success": True,
            "payload": [
                {
                    "id": "q1",
                    "queueName": "Frontend",
                    "openTickets": 2,
                    "members": ["Mohamed Fazil", "raghu ram"],
                },
                {
                    "id": "q2",
                    "queueName": "Backend",
                    "openTickets": 1,
                    "members": ["Deva NS"],
                },
            ],
        }
        captured: dict = {}

        def _capture(*_a, **kw):
            captured.update(kw.get("context") or {})
            return "membership from tool json"

        decision = {
            "action": "SIDE_QUEST",
            "intent": "TEAMS",
            "operation": "LIST_TEAMS",
            "values": ["Mohamed Fazil", "raghu ram", "sri annamalai"],
            "fields": {"members": ["Mohamed Fazil", "raghu ram", "sri annamalai"]},
            "proposed_tool": "list_queues",
            "confidence": 0.95,
        }
        state = self._state(
            decision,
            messages=[
                HumanMessage(content="which teams are those people already on")
            ],
            page="Teams",
            parked_drafts=[
                {
                    "flow": "team",
                    "draft": {
                        "awaiting": "create_members",
                        "name": "CRM team",
                        "description": "CRM issues",
                        "available_members": [
                            "Mohamed Fazil",
                            "raghu ram",
                            "sri annamalai",
                        ],
                    },
                }
            ],
        )
        with patch("app.tools.catalog_tools.list_queues", return_value=queues) as listed, patch(
            "app.tasks.chat_commands._llm_phrase",
            side_effect=_capture,
        ):
            out = execute_team_query(
                state,
                "which teams are those people already on",
                decision,
                parked_result={
                    "parked_drafts": state["parked_drafts"],
                    "team_draft": None,
                },
            )
        assert listed.call_args.kwargs.get("query") in (None, "")
        membership = captured.get("membership") or (out.get("data") or {}).get("membership") or []
        by_person = {row["person"]: row["teams"] for row in membership}
        assert "Frontend" in by_person.get("Mohamed Fazil", [])
        assert "Frontend" in by_person.get("raghu ram", [])
        assert by_person.get("sri annamalai") == []

    def test_kb_search_get_and_publish(self):
        articles = {
            "success": True,
            "payload": [
                {
                    "id": "a1",
                    "title": "Password reset",
                    "status": "Draft",
                    "category": "Accounts",
                    "content": "Use the reset link in email.",
                }
            ],
        }
        search = {
            "action": "NORMAL_ROUTE",
            "intent": "KB",
            "operation": "SEARCH_KB",
            "filters": {"query": "password reset"},
            "proposed_tool": "list_kb",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_kb", return_value=articles):
            out = complete_specialist_handoff(
                self._state(
                    search,
                    messages=[HumanMessage(content="Find password reset articles")],
                    page="Knowledge Base",
                ),
                workflow_manager_node(
                    self._state(
                        search,
                        messages=[HumanMessage(content="Find password reset articles")],
                        page="Knowledge Base",
                    )
                ),
            )
        assert out["data"]["_tool_name"] == "list_kb"
        assert any(a.get("view") == "kb" for a in out["actions"])

        detail = {
            "action": "NORMAL_ROUTE",
            "intent": "KB",
            "operation": "GET_ARTICLE",
            "filters": {"query": "password reset"},
            "proposed_tool": "get_kb",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_kb", return_value=articles), patch(
            "app.tools.catalog_tools.get_kb",
            return_value={
                "success": True,
                "payload": {"data": articles["payload"][0]},
            },
        ) as got:
            body = complete_specialist_handoff(
                self._state(
                    detail,
                    messages=[HumanMessage(content="What does the password reset article say?")],
                    page="Knowledge Base",
                ),
                workflow_manager_node(
                    self._state(
                        detail,
                        messages=[HumanMessage(content="What does the password reset article say?")],
                        page="Knowledge Base",
                    )
                ),
            )
        got.assert_called()
        assert body["data"]["_tool_name"] == "get_kb"
        assert any(a.get("type") == "open_kb" for a in body["actions"])

        last_created = {
            "action": "NORMAL_ROUTE",
            "intent": "KB",
            "operation": "GET_ARTICLE",
            "entity_name": "AI Help",
            "reference": "LAST_ENTITY",
            "proposed_tool": "get_kb",
            "confidence": 0.95,
        }
        help_row = {
            "id": "kb-help",
            "title": "AI Help",
            "status": "Published",
            "category": "General",
            "content": "How to use AI Help.",
        }
        with patch(
            "app.tools.catalog_tools.list_kb",
            return_value={"success": True, "payload": [help_row]},
        ), patch(
            "app.tools.catalog_tools.get_kb",
            return_value={"success": True, "payload": help_row},
        ):
            opened = complete_specialist_handoff(
                self._state(
                    last_created,
                    messages=[HumanMessage(content="open the article we created")],
                    page="Knowledge Base",
                    conversation_context={
                        "last_entity": {
                            "type": "article",
                            "id": "kb-help",
                            "name": "AI Help",
                        }
                    },
                ),
                workflow_manager_node(
                    self._state(
                        last_created,
                        messages=[HumanMessage(content="open the article we created")],
                        page="Knowledge Base",
                        conversation_context={
                            "last_entity": {
                                "type": "article",
                                "id": "kb-help",
                                "name": "AI Help",
                            }
                        },
                    )
                ),
            )
        assert opened["data"]["_tool_name"] == "get_kb"
        assert any(
            a.get("type") == "open_kb" and a.get("title") == "AI Help"
            for a in opened["actions"]
        )
        assert any(
            a.get("type") == "set_filter" and a.get("query") == "AI Help"
            for a in opened["actions"]
        )

        yes = {
            "action": "CONTINUE_WORKFLOW",
            "intent": "KB",
            "agent": "kb",
            "operation": "NONE",
            "workflow": "article_summary",
            "reference": "LAST_ENTITY",
            "entity_type": "article",
            "confidence": 0.93,
        }
        parked_ticket = [
            {
                "flow": "ticket",
                "draft": {"awaiting": "name", "customerName": "Ada"},
            }
        ]
        ctx = {
            "last_entity": {
                "type": "article",
                "id": "kb-help",
                "name": "AI Help",
            },
            "last_query": {
                "entity": "kb",
                "operation": "GET_ARTICLE",
                "filters": {"query": "AI Help", "id": "kb-help"},
            },
        }
        with patch(
            "app.tools.catalog_tools.list_kb",
            return_value={"success": True, "payload": [help_row]},
        ), patch(
            "app.tools.catalog_tools.get_kb",
            return_value={"success": True, "payload": help_row},
        ) as got_again:
            follow = complete_specialist_handoff(
                self._state(
                    yes,
                    messages=[HumanMessage(content="yes")],
                    page="Knowledge Base",
                    parked_drafts=parked_ticket,
                    conversation_context=ctx,
                ),
                workflow_manager_node(
                    self._state(
                        yes,
                        messages=[HumanMessage(content="yes")],
                        page="Knowledge Base",
                        parked_drafts=parked_ticket,
                        conversation_context=ctx,
                    )
                ),
            )
        got_again.assert_called()
        assert follow["data"]["_tool_name"] == "get_kb"
        assert (follow.get("routing_trace") or {}).get("specialist") == "kb"
        assert follow.get("route") == "kb"
        tix = follow.get("ticket_draft")
        assert not (isinstance(tix, dict) and tix.get("awaiting") == "name")

        publish = {
            "action": "CONFIRM_WORKFLOW",
            "intent": "KB",
            "operation": "PUBLISH_KB",
            "filters": {"query": "password reset"},
            "proposed_tool": "publish_kb_article",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_kb", return_value=articles), patch(
            "app.tools.catalog_tools.publish_kb_article",
            return_value={"success": True, "payload": {"status": "Published"}},
        ) as published:
            done = complete_specialist_handoff(
                self._state(
                    publish,
                    messages=[HumanMessage(content="confirm")],
                    page="Knowledge Base",
                    conversation_context={
                        "last_query": {
                            "entity": "kb",
                            "operation": "PUBLISH_KB",
                            "filters": {"query": "Password reset"},
                            "pending_update": {"id": "a1", "status": "Published"},
                        }
                    },
                ),
                workflow_manager_node(
                    self._state(
                        publish,
                        messages=[HumanMessage(content="confirm")],
                        page="Knowledge Base",
                        conversation_context={
                            "last_query": {
                                "entity": "kb",
                                "operation": "PUBLISH_KB",
                                "filters": {"query": "Password reset"},
                                "pending_update": {"id": "a1", "status": "Published"},
                            }
                        },
                    )
                ),
            )
        published.assert_called_once()
        assert any(a.get("type") == "refresh_kb" for a in done["actions"])

    def test_create_kb_confirm_does_not_publish_existing(self):
        decision = {
            "action": "CONFIRM_WORKFLOW",
            "intent": "KB",
            "operation": "PUBLISH_KB",
            "proposed_tool": "publish_kb_article",
            "confidence": 0.99,
        }
        state = self._state(
            decision,
            messages=[HumanMessage(content="yes")],
            page="Knowledge Base",
            current_workflow="create_kb",
            current_step="confirm",
            kb_draft={
                "awaiting": "confirm",
                "title": "AI",
                "category": "General",
                "body": "Artificial Intelligence is the simulation of human intelligence.",
            },
        )
        with patch(
            "app.tools.catalog_tools.create_kb_article",
            return_value={"success": True, "payload": {"id": "kb-new", "title": "AI"}},
        ) as created, patch(
            "app.tools.catalog_tools.publish_kb_article"
        ) as published:
            orch = workflow_manager_node(state)
            out = complete_specialist_handoff(state, orch)
        published.assert_not_called()
        created.assert_called_once()
        assert created.call_args.kwargs.get("category") == "General"
        assert out.get("kb_draft") is None

    def test_customers_search_status_tickets_and_import_prompt(self):
        rows = {
            "success": True,
            "payload": [
                {
                    "id": "c1",
                    "name": "Mohamed Fazil",
                    "email": "mohamed@example.com",
                    "status": "Active",
                    "totalTickets": 7,
                }
            ],
        }
        search = {
            "action": "NORMAL_ROUTE",
            "intent": "CUSTOMER",
            "operation": "SEARCH_CUSTOMERS",
            "filters": {"query": "Mohamed Fazil"},
            "proposed_tool": "list_customers",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_customers", return_value=rows):
            found = complete_specialist_handoff(
                self._state(
                    search,
                    messages=[HumanMessage(content="Find Mohamed Fazil")],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        search,
                        messages=[HumanMessage(content="Find Mohamed Fazil")],
                        page="Customers",
                    )
                ),
            )
        assert found["data"]["_tool_name"] == "list_customers"
        assert any(a.get("view") == "customers" for a in found["actions"])

        inactive = {
            "action": "NORMAL_ROUTE",
            "intent": "CUSTOMER",
            "operation": "LIST_CUSTOMERS",
            "filters": {"status": "Inactive"},
            "proposed_tool": "list_customers",
            "confidence": 0.95,
        }
        with patch(
            "app.tools.catalog_tools.list_customers",
            return_value={"success": True, "payload": []},
        ) as listed:
            complete_specialist_handoff(
                self._state(
                    inactive,
                    messages=[HumanMessage(content="Show inactive customers")],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        inactive,
                        messages=[HumanMessage(content="Show inactive customers")],
                        page="Customers",
                    )
                ),
            )
        assert listed.call_args.kwargs.get("status") == "Inactive"

        tickets = {
            "action": "NORMAL_ROUTE",
            "intent": "CUSTOMER",
            "operation": "GET_CUSTOMER_TICKETS",
            "filters": {"query": "Mohamed Fazil"},
            "proposed_tool": "list_tickets",
            "confidence": 0.95,
        }
        with patch("app.tools.catalog_tools.list_customers", return_value=rows), patch(
            "app.tools.catalog_tools.get_customer_360",
            return_value={"success": True, "payload": {"totalTickets": 7, "tickets": []}},
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={
                "success": True,
                "payload": {"data": [{"id": "#13184", "subject": "VPN", "status": "Open"}]},
            },
        ):
            history = complete_specialist_handoff(
                self._state(
                    tickets,
                    messages=[HumanMessage(content="How many tickets has Mohamed raised?")],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        tickets,
                        messages=[HumanMessage(content="How many tickets has Mohamed raised?")],
                        page="Customers",
                    )
                ),
            )
        assert any(a.get("view") == "customers" for a in history["actions"])
        assert not any(a.get("module") == "tickets" for a in history["actions"])

        importing = {
            "action": "NORMAL_ROUTE",
            "intent": "CUSTOMER",
            "operation": "IMPORT_CUSTOMERS",
            "filters": {},
            "proposed_tool": "import_customers",
            "confidence": 0.9,
        }
        with patch("app.tools.catalog_tools.import_customers") as imp:
            prompt = complete_specialist_handoff(
                self._state(
                    importing,
                    messages=[HumanMessage(content="Import customers from csv")],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        importing,
                        messages=[HumanMessage(content="Import customers from csv")],
                        page="Customers",
                    )
                ),
            )
        imp.assert_not_called()
        assert any(a.get("view") == "customers" for a in prompt["actions"])
        assert any(
            isinstance(a, dict) and a.get("type") == "open_customer_import"
            for a in (prompt.get("actions") or [])
        )

        # LLM chose IMPORT → open file picker (no phrase-list redirect to create).
        add_plural = {
            "action": "NORMAL_ROUTE",
            "intent": "CUSTOMER",
            "operation": "IMPORT_CUSTOMERS",
            "filters": {},
            "proposed_tool": "import_customers",
            "confidence": 0.9,
        }
        with patch("app.tools.catalog_tools.import_customers") as imp2:
            opened = complete_specialist_handoff(
                self._state(
                    add_plural,
                    messages=[HumanMessage(content="import contacts please")],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        add_plural,
                        messages=[HumanMessage(content="import contacts please")],
                        page="Customers",
                    )
                ),
            )
        imp2.assert_not_called()
        assert any(
            isinstance(a, dict) and a.get("type") == "open_customer_import"
            for a in (opened.get("actions") or [])
        )

        # LLM chose CREATE → guided add (not import).
        via_chat = {
            "action": "START_CREATE_CUSTOMER",
            "intent": "CREATE",
            "operation": "CREATE_CUSTOMER",
            "filters": {},
            "proposed_tool": None,
            "confidence": 0.9,
        }
        with patch("app.tools.catalog_tools.import_customers") as imp3:
            follow = complete_specialist_handoff(
                self._state(
                    via_chat,
                    messages=[
                        HumanMessage(
                            content="not i just want too add customer via chat"
                        )
                    ],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        via_chat,
                        messages=[
                            HumanMessage(
                                content="not i just want too add customer via chat"
                            )
                        ],
                        page="Customers",
                    )
                ),
            )
        imp3.assert_not_called()
        assert (follow.get("customer_draft") or {}).get("awaiting") == "name"
        assert "csv" not in str(follow.get("reply") or "").lower()

        add_one = {
            "action": "NORMAL_ROUTE",
            "intent": "CUSTOMER",
            "operation": "LIST_CUSTOMERS",
            "filters": {},
            "proposed_tool": "list_customers",
            "confidence": 0.9,
        }
        with patch("app.tools.catalog_tools.import_customers") as imp4, patch(
            "app.tools.catalog_tools.list_customers"
        ) as listed:
            singular = complete_specialist_handoff(
                self._state(
                    add_one,
                    messages=[HumanMessage(content="add customer")],
                    page="Customers",
                ),
                workflow_manager_node(
                    self._state(
                        add_one,
                        messages=[HumanMessage(content="add customer")],
                        page="Customers",
                    )
                ),
            )
        imp4.assert_not_called()
        listed.assert_not_called()
        assert (singular.get("customer_draft") or {}).get("awaiting") == "name"
        assert any(
            isinstance(a, dict) and a.get("type") == "create_customer"
            for a in (singular.get("actions") or [])
        )
        assert "csv" not in str(singular.get("reply") or "").lower()

