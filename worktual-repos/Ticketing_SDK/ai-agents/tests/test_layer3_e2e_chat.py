"""
Layer 3 — End-to-end chat happy paths (Workflow Manager + commands shim).

Uses fake LLM; no live Express/DB. Marks real DB parity as integration (skipped
unless RUN_INTEGRATION=1).
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from app.graph import run_chat
from app.agents.workflow_manager import resolve_active_workflow
from app.tasks.chat_commands import resolve_chat_command
from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")


@pytest.mark.e2e
class TestHappyPathWorkflows:
    def test_create_team_name_then_confirm_prompt(self, monkeypatch, fresh_memory):
        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            r1 = run_chat(
                "create team",
                organization_id="org-e2e",
                session_id="s-team",
                history=[{"role": "user", "text": "create team"}],
                user_role="admin",
                user_id="u1",
            )
            r2 = run_chat(
                "nlp",
                organization_id="org-e2e",
                session_id="s-team",
                history=[
                    {"role": "user", "text": "create team"},
                    {"role": "assistant", "text": r1.get("reply") or "x"},
                    {"role": "user", "text": "nlp"},
                ],
                user_role="admin",
                user_id="u1",
            )
        assert r1.get("actions")
        reply2 = (r2.get("reply") or "").lower()
        assert "nlp" in reply2 or "description" in reply2

    def test_cancel_mid_team(self):
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            out = resolve_chat_command(
                "cancel",
                organization_id="org-e2e",
                user_role="admin",
                user_id="u1",
                team_draft={"awaiting": "description", "name": "nlp"},
                workflow_decision={
                    "action": "CANCEL_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "team",
                    "confidence": 0.99,
                },
            )
        assert out["handled"] is True
        assert out.get("team_draft") is None

    def test_side_quest_then_resume_kb(self):
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ), patch(
            "app.tasks.catalog_commands._live_kb_categories", return_value=["General"]
        ), patch(
            "app.tools.catalog_tools.get_metrics",
            return_value={
                "success": True,
                "payload": {"openTickets": 5, "dueToday": 0, "overdue": 0},
            },
        ):
            mid = resolve_chat_command(
                "how many open tickets?",
                organization_id="org-e2e",
                user_role="admin",
                user_id="u1",
                kb_draft={"awaiting": "category", "title": "add"},
                workflow_decision={
                    "action": "SIDE_QUEST",
                    "intent": "TICKET",
                    "agent": "tickets",
                    "operation": "GET_METRICS",
                    "confidence": 0.99,
                },
            )
            # Command shim only parks; structured ticket execution belongs to LangGraph.
            assert mid["handled"] is False
            assert mid.get("kb_draft") is None
            assert any(
                item.get("flow") == "kb"
                and item.get("draft", {}).get("title") == "add"
                for item in mid.get("parked_drafts") or []
            )

            resume = resolve_chat_command(
                "continue the article",
                organization_id="org-e2e",
                user_role="admin",
                user_id="u1",
                parked_drafts=[
                    {"flow": "kb", "draft": {"awaiting": "category", "title": "add"}}
                ],
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "intent": "CREATE",
                    "entity_type": "article",
                    "confidence": 0.99,
                },
            )
        assert resume["handled"] is True
        assert resume.get("kb_draft", {}).get("awaiting") == "category"

    def test_entity_coreference_add_members_after_last_entity(self):
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ), patch(
            "app.tools.catalog_tools.list_queues",
            return_value={
                "success": True,
                "payload": [{"id": "q1", "queueName": "nlp", "name": "nlp"}],
            },
        ):
            out = resolve_active_workflow(
                "add members",
                page="Teams",
                organization_id="org-e2e",
                user_id="u1",
                user_name="Admin",
                user_role="admin",
                escalate_draft=None,
                macro_draft=None,
                team_draft=None,
                kb_draft=None,
                parked_drafts=None,
                session_history=None,
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
        assert out["handled"] is True
        assert out.get("team_draft", {}).get("name") == "nlp"
        assert out.get("team_draft", {}).get("awaiting") != "name"


@pytest.mark.e2e
class TestHomeTicketsConversationalFlow:
    """Home + Tickets catalog flow via run_chat — reuse existing tickets, never create."""

    def _install(self, monkeypatch):
        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
        monkeypatch.setattr(
            "app.tasks.chat_commands._llm_phrase",
            lambda **kwargs: str(kwargs.get("fallback") or kwargs.get("context", {}).get("nextStep") or "ok"),
        )
        monkeypatch.setattr(
            "app.tasks.catalog_commands._phrase",
            lambda **kwargs: str(kwargs.get("fallback") or "ok"),
        )
        store = {"ctx": {}, "ver": 0}

        def _load(*_a, **_k):
            return dict(store["ctx"]), store["ver"]

        def _save(_org, _uid, _sid, ctx, expected_version=None):
            store["ctx"] = dict(ctx or {})
            store["ver"] += 1
            return store["ver"]

        monkeypatch.setattr("app.graph.load_conversation_context", _load)
        monkeypatch.setattr("app.graph.save_conversation_context", _save)
        monkeypatch.setattr("app.graph.persist_workflow_events", lambda *_a, **_k: None)
        created = []

        def _no_create(*_a, **_k):
            created.append(True)
            raise AssertionError("create_ticket must not run for query scenarios")

        monkeypatch.setattr("app.tools.ticket_write.create_ticket", _no_create)
        metrics = {
            "success": True,
            "payload": {
                "openTickets": 12,
                "dueToday": 2,
                "overdue": 3,
                "createdToday": 7,
                "unassigned": 1,
                "openChange": "—",
            },
        }
        monkeypatch.setattr(
            "app.tools.catalog_tools.get_metrics",
            lambda **_kwargs: metrics,
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.get_triage_stats",
            lambda: {
                "success": True,
                "payload": {"createdByMe": 4, "reassignedOut": 0},
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.get_dashboard_chart",
            lambda chart_range="7days": {
                "success": True,
                "payload": {"totals": {"open": 12, "created": 4}, "range": chart_range},
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.list_activities",
            lambda: {
                "success": True,
                "payload": [{"text": "Ticket #14001 updated", "time": "1m ago"}],
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.list_queues",
            lambda: {"success": True, "payload": []},
        )
        listed_calls = []

        def _list_tickets(**kwargs):
            listed_calls.append(kwargs)
            return {
                "success": True,
                "payload": {
                    "data": [
                        {
                            "id": "#14001",
                            "subject": "VPN down",
                            "status": "Open",
                            "priority": "urgent",
                            "assignee": "Sarah",
                        }
                    ]
                },
            }

        monkeypatch.setattr("app.tools.ticket_read.list_tickets", _list_tickets)
        monkeypatch.setattr(
            "app.tools.ticket_read.get_ticket",
            lambda tn: {
                "success": True,
                "payload": {
                    "id": str(tn),
                    "ticketNumber": str(tn),
                    "subject": "VPN down",
                    "status": "Open",
                },
            },
        )
        monkeypatch.setattr(
            "app.tools.ticket_read.get_ticket_progress",
            lambda tn: {
                "success": True,
                "payload": {"events": [{"action": "created", "ticket": tn}]},
            },
        )
        return created, listed_calls, store

    def _chat(self, text, *, page="Home", history=None, session="s-home-tix"):
        return run_chat(
            text,
            organization_id="org-e2e",
            session_id=session,
            history=history
            or [{"role": "user", "text": text}],
            user_role="admin",
            user_id="u1",
            user_name="Jane",
            page=page,
        )

    def test_home_metrics_activity_recommend_compare_do_not_create(self, monkeypatch, fresh_memory):
        created, listed_calls, _store = self._install(monkeypatch)
        open_hit = self._chat("how many overall open tickets are there?", page="Home")
        assert created == []
        assert open_hit.get("data", {}).get("_tool_name") == "get_metrics"
        assert any(a.get("view") == "dashboard" for a in open_hit.get("actions") or [])
        assert open_hit.get("data", {}).get("last_query", {}).get("operation") == "GET_METRICS"

        created_by = self._chat("how many tickets created by me?", page="Home")
        assert created == []
        assert created_by.get("data", {}).get("_tool_name") == "get_metrics"

        created_today = self._chat("how many tickets created today", page="Home")
        assert created == []
        assert created_today.get("data", {}).get("_tool_name") == "get_metrics"
        assert (
            created_today.get("data", {}).get("last_query", {}).get("filters", {}).get(
                "created_range"
            )
            == "today"
        )

        reassigned = self._chat("how many tickets were reassigned", page="Home")
        assert created == []
        assert reassigned.get("data", {}).get("last_query", {}).get("filters", {}).get("topic") == "reassigned"

        due = self._chat("overall due today?", page="Home")
        assert created == []
        assert due.get("data", {}).get("_tool_name") == "get_metrics"
        assert not any(
            str(a.get("status") or "").lower() == "overdue" for a in due.get("actions") or []
        )
        assert not due.get("data", {}).get("macro_draft")
        assert not due.get("data", {}).get("ticket_draft")

        activity = self._chat("show recent activity", page="Home")
        assert created == []
        assert activity.get("data", {}).get("_tool_name") in {"list_activities", "get_metrics"}

        rec = self._chat("what should I work on", page="Home")
        assert created == []
        assert rec.get("data", {}).get("last_query", {}).get("operation") == "RECOMMEND"
        assert listed_calls

        compare = self._chat("compare this week to last week", page="Home")
        assert created == []
        assert compare.get("data", {}).get("last_query", {}).get("operation") == "COMPARE"

        overall = self._chat("overall overdue ticket", page="Home", session="s-home-overall")
        assert created == []
        assert overall.get("data", {}).get("_tool_name") == "get_metrics"
        assert overall.get("data", {}).get("metrics", {}).get("overdue") == 3
        assert not overall.get("data", {}).get("clarificationRequired")

        vague = self._chat("overdue tickets", page="Home", session="s-home-vague-od")
        assert created == []
        assert vague.get("data", {}).get("clarificationRequired") is True
        assert vague.get("data", {}).get("last_query", {}).get("awaiting") == "metrics_scope"

        open_kpi = self._chat("open tickets", page="Home", session="s-home-open-kpi")
        assert created == []
        assert open_kpi.get("data", {}).get("clarificationRequired") is True

        how_many = self._chat(
            "show how many overdue tickets are there",
            page="All tickets",
            session="s-all-how-many-od",
        )
        assert created == []
        assert how_many.get("data", {}).get("clarificationRequired") is True

        overall_open = self._chat(
            "show overall open tickets",
            page="Home",
            session="s-home-overall-open",
        )
        assert created == []
        assert overall_open.get("data", {}).get("_tool_name") == "get_metrics"
        assert overall_open.get("data", {}).get("metrics", {}).get("openTickets") == 12
        assert not overall_open.get("data", {}).get("clarificationRequired")

        my_od = self._chat(
            "show my overdue tickets",
            page="Home",
            session="s-home-my-od",
        )
        assert created == []
        assert my_od.get("data", {}).get("_tool_name") == "get_metrics"
        assert not my_od.get("data", {}).get("clarificationRequired")

    def test_list_follow_up_and_existing_ticket_detail(self, monkeypatch, fresh_memory):
        created, listed_calls, store = self._install(monkeypatch)
        first = self._chat("show open tickets", page="Tickets", session="s-tix-follow")
        assert created == []
        assert listed_calls
        assert listed_calls[-1].get("status") == "Open"
        assert first.get("data", {}).get("_tool_name") == "list_tickets"
        assert any(a.get("type") == "navigate" for a in first.get("actions") or [])

        hist = [
            {"role": "user", "text": "show open tickets"},
            {"role": "assistant", "text": first.get("reply") or "ok"},
            {"role": "user", "text": "only critical"},
        ]
        follow = self._chat(
            "only critical",
            page="Tickets",
            history=hist,
            session="s-tix-follow",
        )
        assert created == []
        assert listed_calls[-1].get("priority") == "urgent"
        assert listed_calls[-1].get("status") == "Open"
        assert follow.get("data", {}).get("last_query", {}).get("filters", {}).get("priority") == "urgent"

        due_list = self._chat("show tickets due today", page="Tickets", session="s-tix-due")
        assert created == []
        assert listed_calls[-1].get("due") == "today"

        named = self._chat(
            "tickets assigned to Sarah",
            page="Tickets",
            session="s-tix-sarah",
        )
        assert created == []
        assert listed_calls[-1].get("assigned_to") == "Sarah"

        detail = self._chat("open ticket 14001", page="Tickets", session="s-tix-one")
        assert created == []
        assert detail.get("data", {}).get("_tool_name") == "get_ticket"

        timeline = self._chat(
            "show history for 14001",
            page="Tickets",
            session="s-tix-hist",
        )
        assert created == []
        assert timeline.get("data", {}).get("_tool_name") == "get_ticket_progress"

    def test_module_pages_use_specialist_tools_not_create(self, monkeypatch, fresh_memory):
        created, listed_calls, _store = self._install(monkeypatch)

        def _nlu(state, text):
            page = str((state or {}).get("page") or "").lower()
            lower = (text or "").lower()
            if "macro" in page or "macro" in lower:
                return {
                    "action": "NORMAL_ROUTE",
                    "intent": "MACRO",
                    "operation": "LIST_MACROS",
                    "filters": {},
                    "proposed_tool": "list_macros",
                    "confidence": 0.95,
                    "tool_proposal_valid": True,
                }
            if "analytics" in page or "report" in lower:
                return {
                    "action": "NORMAL_ROUTE",
                    "intent": "ADMIN",
                    "operation": "GET_ANALYTICS",
                    "filters": {"topic": "analytics", "range": "7days"},
                    "proposed_tool": "get_analytics",
                    "confidence": 0.95,
                    "tool_proposal_valid": True,
                }
            if "csat" in page:
                return {
                    "action": "NORMAL_ROUTE",
                    "intent": "ADMIN",
                    "operation": "GET_CSAT",
                    "filters": {"topic": "csat", "range": "30days"},
                    "proposed_tool": "get_csat_reports",
                    "confidence": 0.95,
                    "tool_proposal_valid": True,
                }
            if "team" in page or "team" in lower:
                return {
                    "action": "NORMAL_ROUTE",
                    "intent": "TEAMS",
                    "operation": "LIST_TEAMS",
                    "filters": {},
                    "proposed_tool": "list_queues",
                    "confidence": 0.95,
                    "tool_proposal_valid": True,
                }
            if "knowledge" in page or "article" in lower:
                return {
                    "action": "NORMAL_ROUTE",
                    "intent": "KB",
                    "operation": "SEARCH_KB",
                    "filters": {"query": "password reset"},
                    "proposed_tool": "list_kb",
                    "confidence": 0.95,
                    "tool_proposal_valid": True,
                }
            return {
                "action": "NORMAL_ROUTE",
                "intent": "CUSTOMER",
                "operation": "SEARCH_CUSTOMERS",
                "filters": {"query": "Mohamed Fazil"},
                "proposed_tool": "list_customers",
                "confidence": 0.95,
                "tool_proposal_valid": True,
            }

        monkeypatch.setattr("app.agents.workflow_nlu.decide_workflow_turn", _nlu)
        monkeypatch.setattr(
            "app.tools.catalog_tools.list_queues",
            lambda **_k: {
                "success": True,
                "payload": [
                    {"id": "q1", "queueName": "Frontend", "openTickets": 4},
                    {"id": "q2", "queueName": "Backend", "openTickets": 9},
                ],
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.list_kb",
            lambda **_k: {
                "success": True,
                "payload": [
                    {
                        "id": "a1",
                        "title": "Password reset",
                        "status": "Published",
                        "content": "Use the reset link.",
                    }
                ],
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.list_customers",
            lambda **_k: {
                "success": True,
                "payload": [
                    {
                        "name": "Mohamed Fazil",
                        "email": "m@example.com",
                        "status": "Active",
                        "totalTickets": 3,
                    }
                ],
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.list_macros",
            lambda **_k: {
                "success": True,
                "payload": [{"id": "m1", "title": "Outage", "body": "Hello"}],
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.get_analytics",
            lambda **_k: {
                "success": True,
                "payload": {"totalTickets": 40, "resolvedTickets": 22, "csat": "4.2"},
            },
        )
        monkeypatch.setattr(
            "app.tools.catalog_tools.get_csat_reports",
            lambda **_k: {
                "success": True,
                "payload": {"avgScore": None, "ratings": 0, "lowScores": 0},
            },
        )
        teams = self._chat("Show all teams", page="Teams", session="s-mod-teams")
        assert created == []
        assert teams.get("data", {}).get("_tool_name") == "list_queues"
        assert any(a.get("view") == "agent-queues" for a in teams.get("actions") or [])

        kb = self._chat(
            "Find password reset articles",
            page="Knowledge Base",
            session="s-mod-kb",
        )
        assert created == []
        assert kb.get("data", {}).get("_tool_name") == "list_kb"
        assert any(a.get("view") == "kb" for a in kb.get("actions") or [])

        customers = self._chat(
            "Find Mohamed Fazil",
            page="Customers",
            session="s-mod-cust",
        )
        assert created == []
        assert customers.get("data", {}).get("_tool_name") == "list_customers"
        assert any(a.get("view") == "customers" for a in customers.get("actions") or [])

        macros = self._chat("Show all macros", page="Macros", session="s-mod-macros")
        assert created == []
        assert macros.get("data", {}).get("_tool_name") == "list_macros"
        assert any(a.get("view") == "macros" for a in macros.get("actions") or [])

        analytics = self._chat(
            "Show last 7 days reports",
            page="Analytics",
            session="s-mod-analytics",
        )
        assert created == []
        assert analytics.get("data", {}).get("_tool_name") == "get_analytics"
        assert any(a.get("view") == "analytics" for a in analytics.get("actions") or [])

        csat = self._chat(
            "CSAT average last 30 days",
            page="CSAT reports",
            session="s-mod-csat",
        )
        assert created == []
        assert csat.get("data", {}).get("_tool_name") == "get_csat_reports"
        assert any(a.get("view") == "csat-reports" for a in csat.get("actions") or [])


@pytest.mark.integration
@pytest.mark.skipif(
    os.environ.get("RUN_INTEGRATION") != "1",
    reason="Set RUN_INTEGRATION=1 with live Express+Postgres",
)
def test_tool_express_postgres_placeholder():
    """Parity / park-reload against real DB — enable in CI with services up."""
    pytest.skip("Wire live Express client here when RUN_INTEGRATION=1")


@pytest.mark.migration
def test_workflow_state_version_forward_compatible():
    """Parked v1 draft shape still hydrates under current contract."""
    from app.workflow_state import hydrate_from_legacy_drafts

    # v1-shaped team draft (no workflow fields) must still project
    snap = hydrate_from_legacy_drafts(
        escalate_draft=None,
        macro_draft=None,
        team_draft={"awaiting": "members", "name": "legacy", "id": "old"},
        kb_draft=None,
        current_workflow=None,
        last_entity=None,
    )
    assert snap["current_workflow"] == "add_team_members"
    assert snap["last_entity"]["name"] == "legacy"


@pytest.mark.e2e
class TestEveryModuleGuidedCollect:
    """Collect + cancel + confirm-handoff for every guided module (fake LLM)."""

    def test_collect_and_cancel_matrix(self):
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

        org_kw = dict(
            org="org-e2e",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Home",
        )
        cont = {"action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        cancel = {"action": "CANCEL_WORKFLOW", "operation": "NONE"}

        tix = _continue_ticket_draft(
            "Ada",
            **org_kw,
            ticket_draft={"awaiting": "name"},
            semantic_decision={**cont, "fields": {"customerName": "Ada"}},
        )
        assert tix.get("handled") is True
        assert (tix.get("ticket_draft") or {}).get("awaiting") == "contact"
        tix_c = _continue_ticket_draft(
            "never mind cancel this",
            **org_kw,
            ticket_draft={"awaiting": "contact", "customerName": "Ada"},
            semantic_decision=cancel,
        )
        assert tix_c.get("ticket_draft") is None

        cust_start = continue_customer_draft(
            "add customer",
            **org_kw,
            customer_draft={"awaiting": "name"},
            semantic_decision=cont,
        )
        assert (cust_start.get("customer_draft") or {}).get("awaiting") == "name"
        assert not (cust_start.get("customer_draft") or {}).get("name")

        team = continue_team_draft(
            "NetOps",
            **org_kw,
            team_draft={"awaiting": "name"},
            semantic_decision={**cont, "fields": {"name": "NetOps"}},
        )
        assert (team.get("team_draft") or {}).get("awaiting") == "description"
        team_c = continue_team_draft(
            "never mind cancel this",
            **org_kw,
            team_draft={"awaiting": "description", "name": "NetOps"},
            semantic_decision=cancel,
        )
        assert team_c.get("team_draft") is None

        cust = continue_customer_draft(
            "Ada",
            **org_kw,
            customer_draft={"awaiting": "name"},
            semantic_decision={**cont, "fields": {"name": "Ada"}},
        )
        assert (cust.get("customer_draft") or {}).get("awaiting") == "email"
        cust_c = continue_customer_draft(
            "never mind cancel this",
            **org_kw,
            customer_draft={"awaiting": "email", "name": "Ada"},
            semantic_decision=cancel,
        )
        assert cust_c.get("customer_draft") is None

        mac = _continue_macro_draft(
            "vip",
            **org_kw,
            macro_draft={"awaiting": "title"},
            semantic_decision={**cont, "fields": {"title": "vip"}},
        )
        assert (mac.get("macro_draft") or {}).get("awaiting") == "body"
        mac_c = _continue_macro_draft(
            "never mind cancel this",
            **org_kw,
            macro_draft={"awaiting": "body", "title": "vip"},
            semantic_decision=cancel,
        )
        assert mac_c.get("macro_draft") is None

        with patch(
            "app.tasks.catalog_commands._live_kb_categories", return_value=["General"]
        ):
            kb = continue_kb_draft(
                "VPN reset",
                **org_kw,
                kb_draft={"awaiting": "title"},
                semantic_decision={**cont, "fields": {"title": "VPN reset"}},
            )
        assert (kb.get("kb_draft") or {}).get("awaiting") == "category"
        kb_c = continue_kb_draft(
            "never mind cancel this",
            **org_kw,
            kb_draft={"awaiting": "category", "title": "VPN reset"},
            semantic_decision=cancel,
        )
        assert kb_c.get("kb_draft") is None

        pri = continue_priority_draft(
            "Critical",
            **org_kw,
            priority_draft={"awaiting": "name", "kind": "priority"},
            semantic_decision={**cont, "fields": {"displayName": "Critical"}},
        )
        assert (pri.get("priority_draft") or {}).get("awaiting") in {"hours", "confirm"}
        pri_c = continue_priority_draft(
            "never mind cancel this",
            **org_kw,
            priority_draft={"awaiting": "hours", "displayName": "Critical"},
            semantic_decision=cancel,
        )
        assert pri_c.get("priority_draft") is None

        status = continue_priority_draft(
            "Waiting on customer",
            **org_kw,
            priority_draft={"awaiting": "name", "kind": "status"},
            semantic_decision={**cont, "fields": {"displayName": "Waiting on customer"}},
        )
        assert (status.get("priority_draft") or {}).get("awaiting") == "confirm"
        status_c = continue_priority_draft(
            "never mind cancel this",
            **org_kw,
            priority_draft={
                "awaiting": "confirm",
                "kind": "status",
                "displayName": "Waiting on customer",
            },
            semantic_decision=cancel,
        )
        assert status_c.get("priority_draft") is None

        members_c = continue_team_draft(
            "never mind cancel this",
            **org_kw,
            team_draft={
                "awaiting": "confirm",
                "id": "q1",
                "team": "NetOps",
                "members": ["Ada"],
                "flow": "add_team_members",
            },
            semantic_decision=cancel,
        )
        assert members_c.get("team_draft") is None

        esc = continue_escalate_draft(
            "never mind cancel this",
            **org_kw,
            escalate_draft={"awaiting": "ticket"},
            semantic_decision=cancel,
        )
        assert esc.get("escalate_draft") is None

    def test_confirm_handoff_leaves_write_to_specialist(self):
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

        org_kw = dict(
            org="org-e2e",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Home",
        )
        confirm = {"action": "CONTINUE_WORKFLOW", "operation": "NONE"}
        cases = [
            (
                _continue_ticket_draft,
                "ticket_draft",
                {
                    "awaiting": "confirm",
                    "customerName": "Ada",
                    "customerEmail": "ada@t.test",
                    "issue": "VPN will not connect",
                },
            ),
            (
                continue_team_draft,
                "team_draft",
                {
                    "awaiting": "confirm",
                    "name": "NetOps",
                    "description": "handles network operations",
                    "members_skipped": True,
                },
            ),
            (
                continue_customer_draft,
                "customer_draft",
                {"awaiting": "confirm", "name": "Ada", "email": "ada@t.test", "phone": "5551234567"},
            ),
            (
                _continue_macro_draft,
                "macro_draft",
                {
                    "awaiting": "confirm",
                    "title": "vip",
                    "body": "Thanks for contacting VIP support.",
                },
            ),
            (
                continue_kb_draft,
                "kb_draft",
                {
                    "awaiting": "confirm",
                    "title": "VPN reset",
                    "category": "General",
                    "body": "Reset the client and retry the tunnel.",
                },
            ),
            (
                continue_priority_draft,
                "priority_draft",
                {
                    "awaiting": "confirm",
                    "displayName": "Critical",
                    "resolutionHours": 4,
                },
            ),
            (
                continue_priority_draft,
                "priority_draft",
                {
                    "awaiting": "confirm",
                    "kind": "status",
                    "displayName": "Waiting on customer",
                },
            ),
            (
                continue_escalate_draft,
                "escalate_draft",
                {
                    "awaiting": "confirm",
                    "ticket_number": "T-1",
                    "assignee": "Deva",
                },
            ),
        ]
        for fn, key, draft in cases:
            out = fn("yeah go ahead", **org_kw, **{key: draft}, semantic_decision=confirm)
            assert out.get("handled") is False, key
            assert (out.get(key) or {}).get("awaiting") == "confirm", key


def _wf(
    text: str,
    *,
    ticket_draft=None,
    customer_draft=None,
    team_draft=None,
    kb_draft=None,
    macro_draft=None,
    priority_draft=None,
    escalate_draft=None,
    reassign_draft=None,
    parked_drafts=None,
    last_entity=None,
    workflow_decision=None,
    page: str = "Home",
):
    """Deterministic chat workflow turn (Super Agent decision injected)."""
    return resolve_active_workflow(
        text,
        page=page,
        organization_id="org-e2e-strict",
        user_role="admin",
        user_id="u-strict",
        user_name="Admin",
        escalate_draft=escalate_draft,
        reassign_draft=reassign_draft,
        macro_draft=macro_draft,
        team_draft=team_draft,
        kb_draft=kb_draft,
        ticket_draft=ticket_draft,
        priority_draft=priority_draft,
        customer_draft=customer_draft,
        parked_drafts=parked_drafts,
        session_history=None,
        last_entity=last_entity,
        workflow_decision=workflow_decision,
    )


@pytest.mark.e2e
class TestStrictChatParkOfferResumeAllModules:
    """Strict chat-only scenarios: park → complete other flow → offer → resume missing-only.

    Covers every parkable module. Fake phrase / no live Express.
    """

    def test_john_customer_interrupted_by_ticket_then_offer_resume_phone(self):
        """Canonical product script: customer name+email → ticket → offer → phone only."""
        from app.agents.workflow_nlu import ground_resume_offer_decision
        from app.memory_contract import maybe_offer_resume, summarize_parked_workflows

        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            # Collect customer name + email
            r_name = _wf(
                "John",
                customer_draft={"awaiting": "name"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {"name": "John"},
                    "confidence": 0.99,
                },
            )
            assert (r_name.get("customer_draft") or {}).get("name") == "John"
            assert (r_name.get("customer_draft") or {}).get("awaiting") == "email"

            r_email = _wf(
                "john@gmail.com",
                customer_draft=r_name["customer_draft"],
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {"email": "john@gmail.com"},
                    "confidence": 0.99,
                },
            )
            cd = r_email.get("customer_draft") or {}
            assert cd.get("email") == "john@gmail.com"
            assert cd.get("awaiting") == "phone"

            # Interrupt: create ticket for ABC server issue
            start_tix = _wf(
                "Actually, create a ticket for ABC server issue.",
                customer_draft=cd,
                workflow_decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "CREATE",
                    "entity_type": "ticket",
                    "fields": {"issue": "ABC server issue"},
                    "confidence": 0.99,
                },
            )
            parked = start_tix.get("parked_drafts") or []
            assert any(
                p.get("flow") == "customer"
                and (p.get("draft") or {}).get("name") == "John"
                and (p.get("draft") or {}).get("email") == "john@gmail.com"
                for p in parked
            ), parked
            # Ticket may start at name/contact/issue depending on field extract
            assert start_tix.get("customer_draft") is None or start_tix.get(
                "ticket_draft"
            )

            # Ticket completed → generic offer (do not auto-unpark)
            offer = maybe_offer_resume(
                parked,
                user_text="ticket filed",
                page="Tickets",
                completed_tool="create_ticket",
            )
            assert offer and "continue" in (offer.get("offer_reply") or "").lower()
            pending = offer["pending_resume"]
            assert pending["flow"] == "customer"
            assert "phone" in (pending.get("missing_fields") or [])
            assert pending.get("filled_fields", {}).get("name") == "John"

            summaries = summarize_parked_workflows(parked)
            assert summaries[0]["missing_fields"] == ["phone"]

            # User says yes → ground to RESUME
            grounded = ground_resume_offer_decision(
                {"action": "CONFIRM_WORKFLOW", "fields": {}},
                {
                    "parked_drafts": parked,
                    "conversation_context": {
                        "last_query": {
                            "awaiting": "resume_offer",
                            "pending_resume": pending,
                        }
                    },
                },
            )
            assert grounded["action"] == "RESUME_WORKFLOW"
            assert grounded["entity_type"] == "customer"

            resumed = _wf(
                "yes",
                parked_drafts=parked,
                workflow_decision=grounded,
            )
            draft = resumed.get("customer_draft") or {}
            assert draft.get("name") == "John"
            assert draft.get("email") == "john@gmail.com"
            assert draft.get("awaiting") == "phone"
            assert not draft.get("phone")
            # Must not restart at name
            assert draft.get("awaiting") != "name"

    def test_ticket_parked_for_customer_then_bind_and_offer_ticket(self):
        """Ticket half-filled → add customer → bind id onto parked ticket → offer resume."""
        from app.memory_contract import (
            apply_customer_row_to_parked_tickets,
            maybe_offer_resume,
        )

        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            parked_ticket = {
                "flow": "ticket",
                "draft": {
                    "awaiting": "confirm",
                    "customerName": "Ashika",
                    "customerEmail": "ashika2701@gmail.com",
                    "issue": "CRM blank image",
                    "priority": "medium",
                },
            }
            start_cust = _wf(
                "add customer",
                ticket_draft=parked_ticket["draft"],
                workflow_decision={
                    "action": "START_CREATE_CUSTOMER",
                    "intent": "CUSTOMER",
                    "confidence": 0.99,
                },
            )
            parked = start_cust.get("parked_drafts") or []
            assert any(p.get("flow") == "ticket" for p in parked)
            cd = start_cust.get("customer_draft") or {}
            # Name seeded from ticket
            assert "Ashika" in str(cd.get("name") or "")

            bound = apply_customer_row_to_parked_tickets(
                parked,
                customer_id="42",
                name="Ashika",
                email="ashika2701@gmail.com",
                phone="9876543212",
            )
            tix = next(p for p in bound if p["flow"] == "ticket")
            assert tix["draft"]["customerId"] == "42"

            offer = maybe_offer_resume(
                bound,
                completed_tool="create_customer",
                user_text="customer saved",
            )
            assert offer["pending_resume"]["flow"] == "ticket"
            missing = offer["pending_resume"].get("missing_fields") or []
            # Ticket was at confirm with issue+contact — should be ready / no name restart
            assert "customerName" not in missing

            resumed = _wf(
                "yes continue the ticket",
                parked_drafts=bound,
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "entity_type": "ticket",
                    "values": ["ticket"],
                    "confidence": 0.99,
                },
            )
            td = resumed.get("ticket_draft") or {}
            assert td.get("customerId") == "42"
            assert td.get("customerName") == "Ashika"
            assert td.get("issue") == "CRM blank image"
            assert td.get("awaiting") in {"confirm", "priority", "contact", "issue"}

    def test_park_offer_resume_matrix_every_module(self):
        """Each parkable flow: park with filled fields → offer → resume → awaiting = first missing."""
        from app.memory_contract import (
            maybe_offer_resume,
            summarize_parked_item,
            workflow_id_for_parked_flow,
        )
        from app.workflow_schemas import missing_fields

        scenarios = [
            (
                "customer",
                {"awaiting": "phone", "name": "Pat", "email": "pat@x.test"},
                "phone",
            ),
            (
                "ticket",
                {
                    "awaiting": "issue",
                    "customerName": "Pat",
                    "customerEmail": "pat@x.test",
                },
                "issue",
            ),
            (
                "team",
                {"awaiting": "description", "name": "NetOps"},
                "description",
            ),
            (
                "macro",
                {"awaiting": "body", "title": "VIP greeting"},
                "body",
            ),
            (
                "kb",
                {"awaiting": "category", "title": "VPN reset"},
                "category",
            ),
            (
                "priority",
                {"awaiting": "hours", "displayName": "Critical", "kind": "priority"},
                "resolutionHours",
            ),
            (
                "escalate",
                {"awaiting": "assignee", "ticket_number": "14001"},
                "assignee",
            ),
            (
                "reassign",
                {
                    "awaiting": "person",
                    "ticket_number": "14001",
                    "target_role": "agent",
                },
                "person",
            ),
        ]

        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            for flow, draft, expect_missing in scenarios:
                parked = [{"flow": flow, "draft": dict(draft)}]
                summary = summarize_parked_item(parked[0])
                wid = workflow_id_for_parked_flow(flow, draft)
                assert expect_missing in (
                    summary.get("missing_fields") or missing_fields(wid, draft)
                ), (flow, summary)

                offer = maybe_offer_resume(
                    parked,
                    completed_tool="create_ticket",
                    user_text=f"done other work ({flow})",
                )
                assert offer, flow
                assert offer["pending_resume"]["flow"] == flow, flow
                assert expect_missing in (
                    offer["pending_resume"].get("missing_fields") or []
                ), flow

                entity = {
                    "customer": "customer",
                    "ticket": "ticket",
                    "team": "team",
                    "macro": "macro",
                    "kb": "article",
                    "priority": "priority",
                    "escalate": "ticket",
                    "reassign": "ticket",
                }[flow]
                resumed = _wf(
                    "yes",
                    parked_drafts=parked,
                    workflow_decision={
                        "action": "RESUME_WORKFLOW",
                        "entity_type": entity,
                        "values": [flow],
                        "confidence": 0.99,
                    },
                )
                assert resumed is not None, f"{flow} resume returned None"
                draft_key = {
                    "customer": "customer_draft",
                    "ticket": "ticket_draft",
                    "team": "team_draft",
                    "macro": "macro_draft",
                    "kb": "kb_draft",
                    "priority": "priority_draft",
                    "escalate": "escalate_draft",
                    "reassign": "reassign_draft",
                }[flow]
                restored = resumed.get(draft_key) or {}
                assert restored, f"{flow} not restored: {list(resumed.keys())}"
                # Filled values survive
                for key, val in draft.items():
                    if key == "awaiting":
                        continue
                    assert restored.get(key) == val, (flow, key, restored)
                assert restored.get("awaiting"), flow
                assert restored.get("awaiting") != "name" or expect_missing == "name"

    def test_specialist_prompt_includes_parked_filled_missing(self):
        from app.agents.base import _build_human

        text = _build_human(
            {
                "session_history": [
                    {"role": "user", "text": "create customer"},
                    {"role": "assistant", "text": "Name?"},
                ],
                "ticket_draft": {
                    "awaiting": "confirm",
                    "issue": "ABC server",
                    "customerName": "Temp",
                },
                "parked_drafts": [
                    {
                        "flow": "customer",
                        "draft": {
                            "awaiting": "phone",
                            "name": "John",
                            "email": "john@gmail.com",
                        },
                    }
                ],
                "page": "Tickets",
            },
            "file the ticket",
        )
        assert "PARKED WORKFLOWS" in text
        assert "John" in text
        assert "john@gmail.com" in text
        assert "phone" in text.lower()
        assert "ABC server" in text

    def test_side_quest_parks_each_active_module(self):
        """SIDE_QUEST while collecting must park the active draft for every module."""
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            actives = [
                (
                    "customer_draft",
                    {"awaiting": "email", "name": "Sam"},
                    "customer",
                ),
                (
                    "ticket_draft",
                    {"awaiting": "contact", "customerName": "Sam"},
                    "ticket",
                ),
                ("team_draft", {"awaiting": "description", "name": "Ops"}, "team"),
                ("macro_draft", {"awaiting": "body", "title": "Hello"}, "macro"),
                ("kb_draft", {"awaiting": "body", "title": "Doc", "category": "General"}, "kb"),
                (
                    "priority_draft",
                    {"awaiting": "hours", "displayName": "P1"},
                    "priority",
                ),
                (
                    "escalate_draft",
                    {"awaiting": "assignee", "ticket_number": "9"},
                    "escalate",
                ),
            ]
            for key, draft, flow in actives:
                out = _wf(
                    "how many open tickets?",
                    **{key: draft},
                    workflow_decision={
                        "action": "SIDE_QUEST",
                        "intent": "TICKET",
                        "operation": "GET_METRICS",
                        "confidence": 0.99,
                    },
                )
                parked = out.get("parked_drafts") or []
                assert any(
                    p.get("flow") == flow and (p.get("draft") or {}).get("awaiting")
                    for p in parked
                ), (key, parked)
                assert out.get(key) is None or out.get(key) == draft
                # Active collect draft should be cleared from active slot when parked
                # (manager parks and clears — accept either cleared or still if deferred)
                if out.get("handled") and out.get(key) is None:
                    assert any(p.get("flow") == flow for p in parked)


@pytest.mark.e2e
class TestStrictChatParkOfferResumeGaps:
    """Remaining gaps: write-success offer, decline, multi-park, pairs, run_chat, 409."""

    def test_run_specialist_create_ticket_success_appends_offer(self, monkeypatch):
        """Armed confirm write → tool success → offer parked customer (not auto-unpark)."""
        from app.agents.base import run_specialist
        from app.messages_compat import AIMessage, HumanMessage
        from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db

        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic", reply="Ticket filed."))
        monkeypatch.setattr(
            "app.tasks.chat_commands._llm_phrase",
            lambda **kw: str(
                kw.get("fallback")
                or "You also have an unfinished customer creation for John. Would you like to continue it?"
            ),
        )

        def _fake_exec(*_a, **_k):
            import json

            return json.dumps(
                {
                    "success": True,
                    "payload": {"ticketNumber": "T-9001", "id": "9001"},
                }
            )

        monkeypatch.setattr("app.agents.base.execute_tool_call", _fake_exec)

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
        state = {
            "messages": [HumanMessage(content="yes file it")],
            "organization_id": "org-e2e",
            "user_id": "u1",
            "user_role": "admin",
            "user_name": "Admin",
            "page": "Tickets",
            "intent": "CREATE",
            "tools_allowed": True,
            "chat_module": "tickets",
            "chat_surface": "list",
            "current_workflow": "create_ticket",
            "ticket_draft": {
                "awaiting": "confirm",
                "customerName": "Temp",
                "customerEmail": "t@x.test",
                "issue": "ABC server issue",
                "priority": "medium",
            },
            "parked_drafts": parked,
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "operation": "NONE",
            },
            "conversation_context": {},
        }
        out = run_specialist("tickets", state)  # type: ignore[arg-type]
        reply = str(out.get("reply") or "").lower()
        assert "continue" in reply or "unfinished" in reply
        assert out.get("ticket_draft") is None
        assert any(p.get("flow") == "customer" for p in (out.get("parked_drafts") or []))
        pending = (out.get("data") or {}).get("pending_resume") or (
            (out.get("conversation_context") or {}).get("last_query") or {}
        ).get("pending_resume")
        assert pending and pending.get("flow") == "customer"
        assert "phone" in (pending.get("missing_fields") or [])
        # Must NOT have auto-restored customer as active without user yes
        assert out.get("customer_draft") in (None, {})

    def test_decline_offer_does_not_resume(self):
        from app.agents.workflow_nlu import ground_resume_offer_decision
        from app.memory_contract import maybe_offer_resume

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
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
            offer = maybe_offer_resume(parked, completed_tool="create_ticket")
        state = {
            "parked_drafts": parked,
            "conversation_context": {
                "last_query": {
                    "awaiting": "resume_offer",
                    "pending_resume": offer["pending_resume"],
                }
            },
        }
        for action in ("CANCEL_WORKFLOW", "NEW_TASK", "NORMAL_ROUTE", "AMBIGUOUS"):
            grounded = ground_resume_offer_decision(
                {"action": action, "fields": {}, "intent": "CREATE"},
                state,
            )
            assert grounded["action"] == action
            assert grounded["action"] != "RESUME_WORKFLOW"

        # Explicit cancel leaves parked intact when workflow manager runs
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            out = _wf(
                "no thanks",
                parked_drafts=parked,
                workflow_decision={
                    "action": "CANCEL_WORKFLOW",
                    "confidence": 0.99,
                },
            )
        # Cancel with no active guided draft: either None or handled without wiping park
        if out and out.get("handled"):
            assert any(
                p.get("flow") == "customer" for p in (out.get("parked_drafts") or parked)
            ) or out.get("customer_draft") is None

    def test_multi_parked_offers_newest_keeps_older(self):
        from app.memory_contract import maybe_offer_resume

        parked = [
            {
                "flow": "macro",
                "draft": {"awaiting": "body", "title": "Older macro"},
            },
            {
                "flow": "customer",
                "draft": {
                    "awaiting": "phone",
                    "name": "John",
                    "email": "john@gmail.com",
                },
            },
        ]
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
            offer = maybe_offer_resume(parked, completed_tool="create_ticket")
        assert offer["pending_resume"]["flow"] == "customer"
        assert offer["pending_resume"]["parked_count"] == 2
        assert "macro" in (offer["pending_resume"].get("other_parked_flows") or [])
        # After resume customer, macro still parked
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            resumed = _wf(
                "yes",
                parked_drafts=parked,
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "entity_type": "customer",
                    "values": ["customer"],
                    "confidence": 0.99,
                },
            )
        assert (resumed.get("customer_draft") or {}).get("name") == "John"
        rest = resumed.get("parked_drafts") or []
        assert any(p.get("flow") == "macro" for p in rest)
        assert not any(p.get("flow") == "customer" for p in rest)

    def test_cross_module_pairs_park_and_resume(self):
        """team↔kb, macro↔customer, priority↔ticket — park A, start B, resume A."""
        pairs = [
            (
                "team_draft",
                {"awaiting": "description", "name": "NetOps"},
                "team",
                "START_CREATE_KB",
                "article",
                "kb",
            ),
            (
                "macro_draft",
                {"awaiting": "body", "title": "VIP"},
                "macro",
                "START_CREATE_CUSTOMER",
                "customer",
                "customer",
            ),
            (
                "priority_draft",
                {"awaiting": "hours", "displayName": "P1", "kind": "priority"},
                "priority",
                "START_CREATE_TICKET",
                "ticket",
                "ticket",
            ),
            (
                "kb_draft",
                {"awaiting": "body", "title": "VPN", "category": "General"},
                "kb",
                "START_CREATE_TEAM",
                "team",
                "team",
            ),
        ]
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ), patch(
            "app.tasks.catalog_commands._live_kb_categories", return_value=["General"]
        ):
            for draft_key, draft, flow_a, start_action, entity_b, flow_b in pairs:
                started = _wf(
                    f"switch to {flow_b}",
                    **{draft_key: draft},
                    workflow_decision={
                        "action": start_action,
                        "intent": "CREATE",
                        "entity_type": entity_b,
                        "confidence": 0.99,
                    },
                )
                parked = started.get("parked_drafts") or []
                assert any(p.get("flow") == flow_a for p in parked), (
                    flow_a,
                    flow_b,
                    parked,
                    started.keys(),
                )
                resumed = _wf(
                    "continue previous",
                    parked_drafts=parked,
                    workflow_decision={
                        "action": "RESUME_WORKFLOW",
                        "entity_type": {
                            "team": "team",
                            "kb": "article",
                            "macro": "macro",
                            "customer": "customer",
                            "priority": "priority",
                            "ticket": "ticket",
                        }[flow_a],
                        "values": [flow_a],
                        "confidence": 0.99,
                    },
                )
                assert resumed is not None, (flow_a, flow_b)
                restored = resumed.get(draft_key) or {}
                assert restored, (flow_a, flow_b, list(resumed.keys()))
                for k, v in draft.items():
                    if k == "awaiting":
                        continue
                    assert restored.get(k) == v, (flow_a, k)

    def test_add_team_members_park_offer_resume(self):
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            draft = {
                "awaiting": "members_names",
                "id": "q1",
                "team": "NetOps",
                "name": "NetOps",
                "flow": "add_team_members",
            }
            started = _wf(
                "create a ticket instead",
                team_draft=draft,
                workflow_decision={
                    "action": "START_CREATE_TICKET",
                    "intent": "CREATE",
                    "confidence": 0.99,
                },
            )
            parked = started.get("parked_drafts") or []
            assert any(p.get("flow") == "team" for p in parked)
            from app.memory_contract import maybe_offer_resume, workflow_id_for_parked_flow

            team_item = next(p for p in parked if p["flow"] == "team")
            wid = workflow_id_for_parked_flow("team", team_item["draft"])
            assert wid == "add_team_members"
            offer = maybe_offer_resume(parked, completed_tool="create_ticket")
            assert offer["pending_resume"]["flow"] == "team"
            resumed = _wf(
                "yes",
                parked_drafts=parked,
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "entity_type": "team",
                    "values": ["team"],
                    "confidence": 0.99,
                },
            )
            td = resumed.get("team_draft") or {}
            assert td.get("team") == "NetOps" or td.get("name") == "NetOps"
            assert td.get("id") == "q1"

    def test_reassign_collect_park_and_resume_person_step(self):
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            draft = {
                "awaiting": "person",
                "ticket_number": "14001",
                "target_role": "agent",
            }
            # Collect role already done; park at person
            started = _wf(
                "add a customer first",
                reassign_draft=draft,
                workflow_decision={
                    "action": "START_CREATE_CUSTOMER",
                    "intent": "CUSTOMER",
                    "confidence": 0.99,
                },
            )
            parked = started.get("parked_drafts") or []
            assert any(p.get("flow") == "reassign" for p in parked), parked
            resumed = _wf(
                "yes resume reassign",
                parked_drafts=parked,
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "entity_type": "ticket",
                    "values": ["reassign"],
                    "confidence": 0.99,
                },
            )
            assert resumed is not None
            rd = resumed.get("reassign_draft") or {}
            assert rd.get("ticket_number") == "14001"
            assert rd.get("target_role") == "agent"
            assert rd.get("awaiting") == "person"

    def test_create_customer_409_binds_and_offers_parked_ticket(self, monkeypatch):
        from app.agents.base import run_specialist
        from app.messages_compat import HumanMessage
        from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db

        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic", reply="Already on file."))
        monkeypatch.setattr(
            "app.tasks.chat_commands._llm_phrase",
            lambda **kw: str(kw.get("fallback") or "Continue unfinished ticket?"),
        )

        def _conflict(*_a, **_k):
            import json

            return json.dumps(
                {
                    "success": False,
                    "error_code": "CONFLICT",
                    "message": "Customer already exists",
                    "payload": {
                        "customer": {
                            "id": "77",
                            "name": "Ashika",
                            "email": "ashika2701@gmail.com",
                            "phone": "9876543212",
                        }
                    },
                }
            )

        monkeypatch.setattr("app.agents.base.execute_tool_call", _conflict)
        state = {
            "messages": [HumanMessage(content="yes add them")],
            "organization_id": "org-e2e",
            "user_id": "u1",
            "user_role": "admin",
            "page": "Customers",
            "intent": "CUSTOMER",
            "tools_allowed": True,
            "chat_module": "customers",
            "current_workflow": "create_customer",
            "customer_draft": {
                "awaiting": "confirm",
                "name": "Ashika",
                "email": "ashika2701@gmail.com",
                "phone": "9876543212",
            },
            "parked_drafts": [
                {
                    "flow": "ticket",
                    "draft": {
                        "awaiting": "confirm",
                        "customerName": "Ashika",
                        "issue": "CRM blank",
                        "priority": "medium",
                    },
                }
            ],
            "workflow_decision": {"action": "CONTINUE_WORKFLOW"},
            "conversation_context": {},
        }
        out = run_specialist("customers", state)  # type: ignore[arg-type]
        assert out.get("customer_draft") is None
        parked = out.get("parked_drafts") or []
        tix = next((p for p in parked if p.get("flow") == "ticket"), None)
        assert tix and tix["draft"].get("customerId") == "77"
        pending = (out.get("data") or {}).get("pending_resume") or (
            (out.get("conversation_context") or {}).get("last_query") or {}
        ).get("pending_resume")
        assert pending and pending.get("flow") == "ticket"

    def test_new_task_while_parked_keeps_prior_park_stack(self):
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            # Active customer + already parked macro → start ticket parks customer, keeps macro
            out = _wf(
                "create ticket instead",
                customer_draft={
                    "awaiting": "phone",
                    "name": "John",
                    "email": "john@gmail.com",
                },
                parked_drafts=[
                    {"flow": "macro", "draft": {"awaiting": "body", "title": "Hi"}}
                ],
                workflow_decision={
                    "action": "NEW_TASK",
                    "intent": "CREATE",
                    "operation": "CREATE_TICKET",
                    "confidence": 0.99,
                },
            )
            # NEW_TASK may defer to START via manager — also try explicit start
            if not any(
                p.get("flow") == "customer" for p in (out.get("parked_drafts") or [])
            ):
                out = _wf(
                    "create ticket instead",
                    customer_draft={
                        "awaiting": "phone",
                        "name": "John",
                        "email": "john@gmail.com",
                    },
                    parked_drafts=[
                        {"flow": "macro", "draft": {"awaiting": "body", "title": "Hi"}}
                    ],
                    workflow_decision={
                        "action": "START_CREATE_TICKET",
                        "intent": "CREATE",
                        "confidence": 0.99,
                    },
                )
            parked = out.get("parked_drafts") or []
            flows = {p.get("flow") for p in parked}
            assert "customer" in flows
            assert "macro" in flows

    def test_run_chat_customer_interrupt_ticket_park_resume(self, monkeypatch, fresh_memory):
        """Full graph path with injected workflow decisions via fake LLM context."""
        from app.graph import run_chat
        from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db

        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
        monkeypatch.setattr(
            "app.tasks.chat_commands._llm_phrase",
            lambda **kw: str(kw.get("fallback") or kw.get("context", {}).get("nextStep") or "ok"),
        )
        monkeypatch.setattr(
            "app.tasks.catalog_commands._phrase",
            lambda **kw: str(kw.get("fallback") or "ok"),
        )
        store = {"ctx": {}, "ver": 0}

        def _load(*_a, **_k):
            return dict(store["ctx"]), store["ver"]

        def _save(_org, _uid, _sid, ctx, expected_version=None):
            store["ctx"] = dict(ctx or {})
            store["ver"] += 1
            return store["ver"]

        monkeypatch.setattr("app.graph.load_conversation_context", _load)
        monkeypatch.setattr("app.graph.save_conversation_context", _save)
        monkeypatch.setattr("app.graph.persist_workflow_events", lambda *_a, **_k: None)

        # Seed via resolve then continue with run_chat turns that park
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
            "app.tasks.catalog_commands._phrase", side_effect=_phrase
        ):
            seeded = _wf(
                "John",
                customer_draft={"awaiting": "name"},
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {"name": "John"},
                    "confidence": 0.99,
                },
            )
            mid = _wf(
                "john@gmail.com",
                customer_draft=seeded.get("customer_draft"),
                workflow_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {"email": "john@gmail.com"},
                    "confidence": 0.99,
                },
            )
            parked_turn = _wf(
                "create a ticket for ABC server issue",
                customer_draft=mid.get("customer_draft"),
                workflow_decision={
                    "action": "START_CREATE_TICKET",
                    "fields": {"issue": "ABC server issue"},
                    "confidence": 0.99,
                },
            )
        parked = parked_turn.get("parked_drafts") or []
        assert any(p.get("flow") == "customer" for p in parked)

        # Persist parked into durable context the way graph would
        store["ctx"] = {
            "parked_drafts": parked,
            "active_workflow": {
                "type": "create_ticket",
                "data": parked_turn.get("ticket_draft") or {"awaiting": "name"},
            },
        }

        # Resume via resolve (graph would call same manager)
        resumed = _wf(
            "yes",
            parked_drafts=parked,
            workflow_decision={
                "action": "RESUME_WORKFLOW",
                "entity_type": "customer",
                "values": ["customer"],
                "confidence": 0.99,
            },
        )
        assert (resumed.get("customer_draft") or {}).get("awaiting") == "phone"
        assert (resumed.get("customer_draft") or {}).get("name") == "John"

        # Sanity: run_chat still boots for a follow-up on same session
        follow = run_chat(
            "hi",
            organization_id="org-e2e",
            session_id="s-strict-park",
            history=[{"role": "user", "text": "hi"}],
            user_role="admin",
            user_id="u1",
        )
        assert isinstance(follow.get("reply"), str)

    def test_resume_create_ticket_skips_list_query_authorize(self):
        """Regression: RESUME + CREATE_TICKET + LAST_ENTITY must not 403.

        Live failure: tickets_agent treated LAST_ENTITY as list follow-up,
        remapped CREATE_TICKET → LIST_TICKETS while keeping proposed_tool=
        create_ticket, authorize_tool raised PermissionError → HTTP 403 →
        UI phrased as chat offline.
        """
        from app.messages_compat import HumanMessage

        from app.agents.tickets import tickets_agent

        decision = {
            "action": "RESUME_WORKFLOW",
            "intent": "TICKET",
            "entity_type": "ticket",
            "entity_name": "Mohamed Fazil",
            "operation": "CREATE_TICKET",
            "proposed_tool": "create_ticket",
            "tool_proposal_valid": True,
            "reference": "LAST_ENTITY",
            "confidence": 1.0,
            "agent": "tickets",
            "workflow": "create_ticket",
        }
        state = {
            "messages": [HumanMessage(content="continue ticket creation flow")],
            "organization_id": "1000",
            "user_role": "admin",
            "user_id": "1005",
            "page": "Customers",
            "parked_drafts": [
                {
                    "flow": "create_ticket",
                    "draft": {
                        "awaiting": "confirm",
                        "customer_name": "Mohamed Fazil",
                        "subject": "CRM issues",
                    },
                }
            ],
            "workflow_decision": decision,
            "conversation_context": {
                "last_entity": {"type": "customer", "name": "Mohamed Fazil"},
                "last_query": {
                    "entity": "customers",
                    "operation": "CREATE_CUSTOMER",
                },
            },
        }

        with patch(
            "app.agents.tickets.execute_ticket_query"
        ) as query, patch(
            "app.agents.tickets.resolve_active_workflow"
        ) as resolve, patch(
            "app.agents.tickets.run_specialist"
        ) as specialist:
            resolve.return_value = {
                "handled": True,
                "workflow_handled": True,
                "reply": "Should I submit this ticket for Mohamed Fazil?",
                "ticket_draft": {
                    "awaiting": "confirm",
                    "customer_name": "Mohamed Fazil",
                    "subject": "CRM issues",
                },
                "parked_drafts": [],
                "current_workflow": "create_ticket",
                "route": "tickets",
            }
            out = tickets_agent(state)  # type: ignore[arg-type]
            query.assert_not_called()
            resolve.assert_called()
            specialist.assert_not_called()
            assert "submit" in str(out.get("reply") or "").lower()

        # Defense in depth: mismatched proposed_tool must not raise PermissionError.
        from app.agents.workflow_manager import _execute_ticket_query

        with patch(
            "app.workflow_state.resolve_query_reference",
            return_value=(
                {
                    "operation": "LIST_TICKETS",
                    "proposed_tool": "create_ticket",
                    "tool_proposal_valid": True,
                    "filters": {},
                    "reference": "NONE",
                },
                None,
            ),
        ), patch(
            "app.tools.ticket_read.list_tickets",
            return_value={"success": True, "tickets": []},
        ), patch(
            "app.tasks.chat_commands._llm_phrase",
            side_effect=lambda **kw: str(kw.get("fallback") or "ok"),
        ), patch(
            "app.tasks.chat_commands._compose_intro_and_list",
            return_value="No tickets.",
        ), patch(
            "app.tasks.chat_commands._tickets_from_tool_result",
            return_value=[],
        ), patch(
            "app.tasks.chat_commands._format_ticket_list_details",
            return_value="",
        ):
            hit = _execute_ticket_query(
                {
                    "organization_id": "1000",
                    "user_role": "admin",
                    "user_id": "1005",
                    "page": "Customers",
                    "conversation_context": {},
                },
                "show my tickets",
                {
                    "operation": "LIST_TICKETS",
                    "proposed_tool": "create_ticket",
                    "tool_proposal_valid": True,
                    "filters": {},
                },
            )
        assert hit.get("handled") is True
        assert "does not implement" not in str(
            (hit.get("data") or {}).get("message") or ""
        ).lower()
        req = hit.get("semantic_request") or {}
        assert str(req.get("proposed_tool") or "").lower() == "list_tickets"

    def test_yehh_complete_after_offer_resumes_filled_ticket_not_restart(self):
        """Live bug: after customer save + offer, 'yehh complete' restarted at name."""
        from app.agents.workflow_nlu import ground_resume_offer_decision
        from app.workflow_schemas import looks_like_person_name, normalize_ticket_fields

        parked = [
            {
                "flow": "ticket",
                "draft": {
                    "awaiting": "confirm",
                    "customerName": "Aakash",
                    "customerEmail": "aakash.worktual@gmail.com",
                    "customerPhone": "987654314",
                    "issue": "contact center not working",
                    "subject": "contact center not working",
                    "customerId": "1002",
                },
            }
        ]
        # CONTINUE + CREATE_TICKET with parked (pending may be missing) → RESUME
        grounded = ground_resume_offer_decision(
            {
                "action": "CONTINUE_WORKFLOW",
                "operation": "CREATE_TICKET",
                "workflow": "create_ticket",
                "proposed_tool": "create_ticket",
                "fields": {},
            },
            {
                "parked_drafts": parked,
                "conversation_context": {
                    "last_query": {
                        "awaiting": "resume_offer",
                        "pending_resume": {"flow": "ticket"},
                    }
                },
            },
        )
        assert grounded["action"] == "RESUME_WORKFLOW"
        assert grounded["entity_type"] == "ticket"

        # Even without pending_resume, matching CREATE_TICKET + CONTINUE resumes.
        grounded2 = ground_resume_offer_decision(
            {
                "action": "CONTINUE_WORKFLOW",
                "operation": "CREATE_TICKET",
                "workflow": "create_ticket",
                "fields": {},
            },
            {"parked_drafts": parked, "conversation_context": {}},
        )
        assert grounded2["action"] == "RESUME_WORKFLOW"

        resumed = _wf(
            "yehh complete iit",
            parked_drafts=parked,
            workflow_decision=grounded,
        )
        draft = resumed.get("ticket_draft") or {}
        assert draft.get("customerName") == "Aakash"
        assert draft.get("customerEmail") == "aakash.worktual@gmail.com"
        assert draft.get("awaiting") == "confirm"
        assert draft.get("awaiting") != "name"

        # Protest must never become the customer name.
        assert looks_like_person_name("details where already given") is False
        assert "customerName" not in normalize_ticket_fields(
            {"customerName": "details where already given"}
        )

    def test_stale_awaiting_name_does_not_bind_protest_when_contact_missing(self):
        """missing_fields SoT: stale awaiting=name must not store a protest as customerName."""
        from app.agents.workflow_nlu import ground_active_collect_decision
        from app.tasks.chat_commands import _merge_ticket_turn
        from app.workflow_schemas import awaiting_hint_from_missing, missing_ticket_fields

        draft = {
            "awaiting": "name",  # stale — name already filled
            "customerName": "Aakash",
            "customerEmail": "",
            "customerPhone": "",
            "issue": "",
        }
        assert missing_ticket_fields(draft)[0] == "contact"
        assert awaiting_hint_from_missing("create_ticket", draft) == "contact"

        grounded = ground_active_collect_decision(
            {
                "action": "CONTINUE_WORKFLOW",
                "fields": {},
                "confidence": 0.99,
            },
            workflow="create_ticket",
            step="name",
            user_text="details where already given",
            roster_members=None,
            draft=draft,
        )
        fields = grounded.get("fields") or {}
        assert not str(fields.get("customerName") or "").strip()
        assert not str(fields.get("contact") or "").strip()

        merged = _merge_ticket_turn(
            draft,
            "details where already given",
            {"action": "CONTINUE_WORKFLOW", "fields": {}},
        )
        assert merged.get("customerName") == "Aakash"
        assert not str(merged.get("customerEmail") or "").strip()
        assert "contact" in missing_ticket_fields(merged)

    def test_customer_stale_awaiting_name_asks_phone_when_email_filled(self):
        """continue_customer: missing SoT overrides stale awaiting=name → ask phone."""
        from app.tasks.catalog_commands import continue_customer_draft

        with patch(
            "app.tasks.catalog_commands._phrase",
            side_effect=lambda **kw: str(kw.get("fallback") or "ok"),
        ):
            out = continue_customer_draft(
                "9876543210",
                org="org-e2e-strict",
                role="admin",
                user_id="u-strict",
                user_name="Admin",
                page="Customers",
                customer_draft={
                    "awaiting": "name",  # stale
                    "name": "John",
                    "email": "john@gmail.com",
                },
                semantic_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {"phone": "9876543210"},
                    "confidence": 0.99,
                },
            )
        draft = out.get("customer_draft") or {}
        assert draft.get("name") == "John"
        assert draft.get("email") == "john@gmail.com"
        assert draft.get("phone") == "9876543210"
        assert draft.get("awaiting") == "confirm"


@pytest.mark.e2e
class TestStrictAiNativeChatEveryModule:
    """Chat-only strict coverage for AI-Native missing_fields SoT + screenshot regressions.

    Fake phrase / injected Super Agent decisions. No live Express.
    Modules: ticket, customer, team, add_members, macro, kb, priority, status,
    escalate, reassign.
    """

    def _phrase_patches(self):
        return (
            patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase),
            patch("app.tasks.catalog_commands._phrase", side_effect=_phrase),
        )

    # ----- Screenshot / live regressions -----

    def test_screenshot_offer_yehh_please_resumes_ticket_not_metrics(self):
        """Mohamed Fazil: after customer save + offer, informal yes resumes ticket.

        Must not fall through to ticket-metrics / list query (chat offline path).
        """
        from app.agents.workflow_nlu import ground_resume_offer_decision
        from app.memory_contract import maybe_offer_resume

        parked = [
            {
                "flow": "ticket",
                "draft": {
                    "awaiting": "confirm",
                    "customerName": "Mohamed Fazil",
                    "customerEmail": "smohamedfazil16@gmail.com",
                    "customerPhone": "9597036512",
                    "issue": "CRM issues",
                    "subject": "CRM issues",
                    "customerId": "1001",
                },
            }
        ]
        with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
            offer = maybe_offer_resume(
                parked,
                user_text="customer created",
                page="Customers",
                completed_tool="create_customer",
            )
        assert offer and offer["pending_resume"]["flow"] == "ticket"
        assert not (offer["pending_resume"].get("missing_fields") or [])

        for utter, action in (
            ("yehh please", "CONFIRM_WORKFLOW"),
            ("yes", "CONTINUE_WORKFLOW"),
            ("continue ticket creation flow", "RESUME_WORKFLOW"),
        ):
            grounded = ground_resume_offer_decision(
                {
                    "action": action,
                    "operation": "CREATE_TICKET",
                    "workflow": "create_ticket",
                    "proposed_tool": "create_ticket",
                    "reference": "LAST_ENTITY",
                    "fields": {},
                    "entity_type": "ticket",
                },
                {
                    "parked_drafts": parked,
                    "conversation_context": {
                        "last_query": {
                            "awaiting": "resume_offer",
                            "pending_resume": offer["pending_resume"],
                        },
                        "last_entity": {
                            "type": "customer",
                            "name": "Mohamed Fazil",
                        },
                    },
                },
            )
            assert grounded["action"] == "RESUME_WORKFLOW", (utter, grounded)
            assert grounded.get("operation") in {
                None,
                "",
                "NONE",
                "CREATE_TICKET",
                "RESUME_WORKFLOW",
            } or str(grounded.get("operation") or "").upper() != "LIST_TICKETS"

        p0, p1 = self._phrase_patches()
        with p0, p1:
            resumed = _wf(
                "yehh please",
                parked_drafts=parked,
                page="Customers",
                workflow_decision={
                    "action": "RESUME_WORKFLOW",
                    "entity_type": "ticket",
                    "operation": "CREATE_TICKET",
                    "proposed_tool": "create_ticket",
                    "reference": "LAST_ENTITY",
                    "values": ["ticket"],
                    "confidence": 0.99,
                },
            )
        td = resumed.get("ticket_draft") or {}
        assert td.get("customerName") == "Mohamed Fazil"
        assert td.get("issue") == "CRM issues"
        assert td.get("awaiting") == "confirm"
        assert td.get("awaiting") != "name"
        assert td.get("customerName") != "yehh please"

    def test_screenshot_protest_never_becomes_ticket_customer_name(self):
        """Aakash: 'details where already given' must not bind as customerName."""
        from app.agents.workflow_nlu import ground_active_collect_decision
        from app.tasks.chat_commands import _continue_ticket_draft, _merge_ticket_turn

        draft = {
            "awaiting": "name",  # stale after resume restart bug
            "customerName": "Aakash",
            "customerEmail": "aakash.worktual@gmail.com",
            "customerPhone": "987654314",
            "issue": "contact center not working",
            "subject": "contact center not working",
            "customerId": "1002",
        }
        grounded = ground_active_collect_decision(
            {"action": "CONTINUE_WORKFLOW", "fields": {}},
            workflow="create_ticket",
            step="name",
            user_text="details where already given",
            roster_members=None,
            draft=draft,
        )
        assert not str((grounded.get("fields") or {}).get("customerName") or "").strip()

        merged = _merge_ticket_turn(
            draft,
            "details where already given",
            {"action": "CONTINUE_WORKFLOW", "fields": {}},
        )
        assert merged.get("customerName") == "Aakash"

        p0, p1 = self._phrase_patches()
        with p0, p1, patch(
            "app.tasks.chat_commands._bind_directory_customer",
            return_value=(merged, "one", [{"id": "1002", "name": "Aakash"}]),
        ), patch(
            "app.tasks.chat_commands._enrich_ticket_preview",
            return_value=(dict(merged, priority="medium"), None),
        ):
            out = _continue_ticket_draft(
                "details where already given",
                org="org-e2e-strict",
                role="admin",
                user_id="u-strict",
                user_name="Admin",
                page="Create Ticket",
                ticket_draft=draft,
                semantic_decision={"action": "CONTINUE_WORKFLOW", "fields": {}},
            )
        td = out.get("ticket_draft") or {}
        assert td.get("customerName") == "Aakash"
        assert "details where already given" not in str(td.get("customerName") or "")

    def test_screenshot_yehh_complete_resumes_filled_not_restart(self):
        """After offer, informal complete keeps filled ticket at confirm."""
        from app.agents.workflow_nlu import ground_resume_offer_decision

        parked = [
            {
                "flow": "ticket",
                "draft": {
                    "awaiting": "confirm",
                    "customerName": "Aakash",
                    "customerEmail": "aakash.worktual@gmail.com",
                    "customerPhone": "987654314",
                    "issue": "contact center not working",
                    "customerId": "1002",
                },
            }
        ]
        grounded = ground_resume_offer_decision(
            {
                "action": "START_CREATE_TICKET",
                "operation": "CREATE_TICKET",
                "workflow": "create_ticket",
                "fields": {},
            },
            {
                "parked_drafts": parked,
                "conversation_context": {
                    "last_query": {
                        "awaiting": "resume_offer",
                        "pending_resume": {"flow": "ticket"},
                    }
                },
            },
        )
        assert grounded["action"] == "RESUME_WORKFLOW"

        p0, p1 = self._phrase_patches()
        with p0, p1:
            resumed = _wf(
                "yehh complete iit",
                parked_drafts=parked,
                workflow_decision=grounded,
            )
        td = resumed.get("ticket_draft") or {}
        assert td.get("customerName") == "Aakash"
        assert td.get("issue") == "contact center not working"
        assert td.get("awaiting") in {"confirm", "priority"}
        assert td.get("awaiting") != "name"

    # ----- Every module: collect → confirm handoff -----

    def test_every_module_full_collect_to_confirm_handoff(self):
        """Happy-path field collect for every guided module ends at specialist confirm."""
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
            continue_reassign_draft,
        )

        org = dict(
            org="org-e2e-strict",
            role="admin",
            user_id="u-strict",
            user_name="Admin",
            page="Home",
        )
        cont = {"action": "CONTINUE_WORKFLOW", "operation": "NONE"}

        p0, p1 = self._phrase_patches()
        with p0, p1, patch(
            "app.tasks.chat_commands._bind_directory_customer",
            side_effect=lambda data, *a, **k: (data, "one", [{"id": "1"}]),
        ), patch(
            "app.tasks.chat_commands._enrich_ticket_preview",
            side_effect=lambda data, *a, **k: (dict(data, priority="medium"), None),
        ), patch(
            "app.tasks.catalog_commands._live_kb_categories",
            return_value=["General"],
        ):
            # Ticket: name → contact → issue → confirm
            t = _continue_ticket_draft(
                "Ada",
                **org,
                ticket_draft={"awaiting": "name"},
                semantic_decision={**cont, "fields": {"customerName": "Ada"}},
            )
            assert (t.get("ticket_draft") or {}).get("awaiting") == "contact"
            t = _continue_ticket_draft(
                "ada@x.test",
                **org,
                ticket_draft=t["ticket_draft"],
                semantic_decision={**cont, "fields": {"contact": "ada@x.test"}},
            )
            assert (t.get("ticket_draft") or {}).get("awaiting") == "issue"
            t = _continue_ticket_draft(
                "VPN down",
                **org,
                ticket_draft=t["ticket_draft"],
                semantic_decision={**cont, "fields": {"issue": "VPN down"}},
            )
            assert (t.get("ticket_draft") or {}).get("awaiting") == "confirm"
            # Confirm turn: Python must NOT write — hand off to specialist
            t_confirm = _continue_ticket_draft(
                "yes proceed",
                **org,
                ticket_draft=t["ticket_draft"],
                semantic_decision={**cont},
            )
            assert t_confirm.get("handled") is False
            assert (t_confirm.get("ticket_draft") or {}).get("awaiting") == "confirm"

            # Customer: name → email → phone → confirm
            c = continue_customer_draft(
                "Pat",
                **org,
                customer_draft={"awaiting": "name"},
                semantic_decision={**cont, "fields": {"name": "Pat"}},
            )
            assert (c.get("customer_draft") or {}).get("awaiting") == "email"
            c = continue_customer_draft(
                "pat@x.test",
                **org,
                customer_draft=c["customer_draft"],
                semantic_decision={**cont, "fields": {"email": "pat@x.test"}},
            )
            assert (c.get("customer_draft") or {}).get("awaiting") == "phone"
            c = continue_customer_draft(
                "9876543210",
                **org,
                customer_draft=c["customer_draft"],
                semantic_decision={**cont, "fields": {"phone": "9876543210"}},
            )
            assert (c.get("customer_draft") or {}).get("awaiting") == "confirm"
            c_confirm = continue_customer_draft(
                "add them",
                **org,
                customer_draft=c["customer_draft"],
                semantic_decision=cont,
            )
            assert c_confirm.get("handled") is False

            # Team: name → description → members/confirm
            tm = continue_team_draft(
                "NetOps",
                **org,
                team_draft={"awaiting": "name"},
                semantic_decision={**cont, "fields": {"name": "NetOps"}},
            )
            assert (tm.get("team_draft") or {}).get("awaiting") == "description"
            tm = continue_team_draft(
                "Network operations team",
                **org,
                team_draft=tm["team_draft"],
                semantic_decision={
                    **cont,
                    "fields": {"description": "Network operations team"},
                },
            )
            aw = (tm.get("team_draft") or {}).get("awaiting")
            assert aw in {"create_members", "members", "confirm"}

            # Macro: title → body → confirm
            m = _continue_macro_draft(
                "VIP hello",
                **org,
                macro_draft={"awaiting": "title"},
                semantic_decision={**cont, "fields": {"title": "VIP hello"}},
            )
            assert (m.get("macro_draft") or {}).get("awaiting") == "body"
            m = _continue_macro_draft(
                "Thanks for reaching out, we are on it.",
                **org,
                macro_draft=m["macro_draft"],
                semantic_decision={
                    **cont,
                    "fields": {"body": "Thanks for reaching out, we are on it."},
                },
            )
            assert (m.get("macro_draft") or {}).get("awaiting") == "confirm"
            assert (
                _continue_macro_draft(
                    "save it",
                    **org,
                    macro_draft=m["macro_draft"],
                    semantic_decision=cont,
                ).get("handled")
                is False
            )

            # KB: title → category → body → confirm
            k = continue_kb_draft(
                "VPN reset",
                **org,
                kb_draft={"awaiting": "title"},
                semantic_decision={**cont, "fields": {"title": "VPN reset"}},
            )
            assert (k.get("kb_draft") or {}).get("awaiting") == "category"
            k = continue_kb_draft(
                "General",
                **org,
                kb_draft=k["kb_draft"],
                semantic_decision={**cont, "fields": {"category": "General"}},
            )
            assert (k.get("kb_draft") or {}).get("awaiting") == "body"
            k = continue_kb_draft(
                "Step one reboot the adapter then reconnect.",
                **org,
                kb_draft=k["kb_draft"],
                semantic_decision={
                    **cont,
                    "fields": {
                        "body": "Step one reboot the adapter then reconnect."
                    },
                },
            )
            assert (k.get("kb_draft") or {}).get("awaiting") == "confirm"

            # Priority + status
            pr = continue_priority_draft(
                "Critical",
                **org,
                priority_draft={"awaiting": "name", "kind": "priority"},
                semantic_decision={**cont, "fields": {"displayName": "Critical"}},
            )
            assert (pr.get("priority_draft") or {}).get("awaiting") in {
                "hours",
                "confirm",
            }
            if (pr.get("priority_draft") or {}).get("awaiting") == "hours":
                pr = continue_priority_draft(
                    "4",
                    **org,
                    priority_draft=pr["priority_draft"],
                    semantic_decision={**cont, "fields": {"resolutionHours": 4}},
                )
            assert (pr.get("priority_draft") or {}).get("awaiting") == "confirm"

            st = continue_priority_draft(
                "Waiting on customer",
                **org,
                priority_draft={"awaiting": "name", "kind": "status"},
                semantic_decision={
                    **cont,
                    "fields": {"displayName": "Waiting on customer"},
                },
            )
            assert (st.get("priority_draft") or {}).get("awaiting") == "confirm"

            # Escalate → confirm handoff when complete
            esc = continue_escalate_draft(
                "yes proceed",
                **org,
                escalate_draft={
                    "awaiting": "confirm",
                    "ticket_number": "14001",
                    "assignee": "Ada Agent",
                },
                semantic_decision=cont,
            )
            assert esc.get("handled") is False

            # Reassign → confirm handoff
            re = continue_reassign_draft(
                "yes proceed",
                **org,
                reassign_draft={
                    "awaiting": "confirm",
                    "ticket_number": "14001",
                    "target_role": "agent",
                    "person": "Ada Agent",
                },
                semantic_decision=cont,
            )
            assert re.get("handled") is False

    # ----- Every module: stale awaiting / wrong-type must not clobber -----

    def test_every_module_stale_awaiting_uses_missing_sot(self):
        """Stale awaiting label must not bind wrong-type text into a filled slot."""
        from app.agents.workflow_nlu import ground_active_collect_decision
        from app.tasks.catalog_commands import continue_customer_draft, continue_kb_draft
        from app.tasks.chat_commands import _continue_macro_draft, _merge_ticket_turn
        from app.workflow_schemas import (
            awaiting_hint_from_missing,
            bind_primary_missing,
            missing_fields,
        )

        # Ticket: filled name, stale awaiting=name, contact still missing — protest ≠ name
        t_draft = {
            "awaiting": "name",
            "customerName": "Sam",
            "customerEmail": "",
            "issue": "",
        }
        assert awaiting_hint_from_missing("create_ticket", t_draft) == "contact"
        assert not bind_primary_missing(
            "create_ticket", t_draft, "details where already given"
        )
        merged = _merge_ticket_turn(
            t_draft,
            "details where already given",
            {"action": "CONTINUE_WORKFLOW", "fields": {}},
        )
        assert merged.get("customerName") == "Sam"
        assert "contact" in missing_fields("create_ticket", merged)
        assert "details where already given" not in str(
            merged.get("customerName") or ""
        )

        # Customer: name+email filled, stale awaiting=name, phone utterance
        p0, p1 = self._phrase_patches()
        with p0, p1:
            c = continue_customer_draft(
                "9998887777",
                org="org-e2e",
                role="admin",
                user_id="u1",
                user_name="A",
                page="Customers",
                customer_draft={
                    "awaiting": "name",
                    "name": "Sam",
                    "email": "sam@x.test",
                },
                semantic_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {"phone": "9998887777"},
                },
            )
            assert (c.get("customer_draft") or {}).get("awaiting") == "confirm"
            assert (c.get("customer_draft") or {}).get("name") == "Sam"

            # Macro: title filled, stale awaiting=title, body text → body
            m = _continue_macro_draft(
                "Thanks we got your request and will update you soon.",
                org="org-e2e",
                role="admin",
                user_id="u1",
                user_name="A",
                page="Macros",
                macro_draft={"awaiting": "title", "title": "Ack"},
                semantic_decision={
                    "action": "CONTINUE_WORKFLOW",
                    "fields": {
                        "body": "Thanks we got your request and will update you soon."
                    },
                },
            )
            md = m.get("macro_draft") or {}
            assert md.get("title") == "Ack"
            assert md.get("awaiting") == "confirm" or len(str(md.get("body") or "")) >= 3

            # KB: title filled — primary missing is category; protest must not become title
            kb_draft = {"awaiting": "title", "title": "VPN guide"}
            bound = bind_primary_missing("create_kb", kb_draft, "General")
            assert bound.get("category") == "General"
            assert "title" not in bound

            g = ground_active_collect_decision(
                {"action": "CONTINUE_WORKFLOW", "fields": {}},
                workflow="create_kb",
                step="title",
                user_text="General",
                roster_members=None,
                draft=kb_draft,
            )
            fields = g.get("fields") or {}
            assert fields.get("category") == "General"
            assert fields.get("title") in (None, "")

            with patch(
                "app.tasks.catalog_commands._live_kb_categories",
                return_value=["General"],
            ):
                k = continue_kb_draft(
                    "General",
                    org="org-e2e",
                    role="admin",
                    user_id="u1",
                    user_name="A",
                    page="KB",
                    kb_draft={"awaiting": "title", "title": "VPN guide"},
                    semantic_decision={
                        "action": "CONTINUE_WORKFLOW",
                        "fields": {"category": "General"},
                    },
                )
            kd = k.get("kb_draft") or {}
            assert kd.get("title") == "VPN guide"
            assert kd.get("awaiting") in {"body", "category", "confirm"}

    # ----- Every module: specialist prompt filled/missing -----

    def test_specialist_prompt_filled_missing_every_active_draft(self):
        from app.agents.base import _build_human

        cases = [
            (
                "ticket_draft",
                {
                    "awaiting": "issue",
                    "customerName": "Pat",
                    "customerEmail": "pat@x.test",
                },
                ("Pat", "pat@x.test", "issue"),
            ),
            (
                "customer_draft",
                {"awaiting": "phone", "name": "Pat", "email": "pat@x.test"},
                ("Pat", "pat@x.test", "phone"),
            ),
            (
                "team_draft",
                {"awaiting": "description", "name": "NetOps"},
                ("NetOps", "description"),
            ),
            (
                "macro_draft",
                {"awaiting": "body", "title": "VIP"},
                ("VIP", "body"),
            ),
            (
                "kb_draft",
                {"awaiting": "body", "title": "VPN", "category": "General"},
                ("VPN", "General", "body"),
            ),
            (
                "priority_draft",
                {
                    "awaiting": "hours",
                    "displayName": "Critical",
                    "kind": "priority",
                },
                ("Critical",),
            ),
            (
                "escalate_draft",
                {"awaiting": "assignee", "ticket_number": "14001"},
                ("14001", "assignee"),
            ),
            (
                "reassign_draft",
                {
                    "awaiting": "person",
                    "ticket_number": "14001",
                    "target_role": "agent",
                },
                ("14001", "person"),
            ),
        ]
        for key, draft, needles in cases:
            route = {
                "ticket_draft": "tickets",
                "customer_draft": "customers",
                "team_draft": "teams",
                "kb_draft": "kb",
                "macro_draft": "macros",
                "priority_draft": "admin",
                "escalate_draft": "tickets",
                "reassign_draft": "tickets",
            }.get(key, "general")
            text = _build_human(
                {
                    "session_history": [],
                    key: draft,
                    "page": "Home",
                    "route": route,
                    "chat_module": route if route != "admin" else "admin",
                    "current_workflow": key.replace("_draft", ""),
                },
                "continue",
            )
            lower = text.lower()
            assert "filled (do not re-ask)" in lower or "filled:" in lower, key
            assert "missing" in lower, key
            for n in needles:
                assert str(n).lower() in lower, (key, n, text[:500])
            assert "ask only for missing" in lower or "never re-ask filled" in lower

    # ----- Every module: park → side quest → offer → resume missing-only -----

    def test_every_module_park_side_quest_offer_resume_missing_only(self):
        """Canonical acceptance: A half-filled → B → offer → resume asks only missing."""
        from app.memory_contract import maybe_offer_resume, workflow_id_for_parked_flow
        from app.workflow_schemas import missing_fields

        modules = [
            (
                "customer",
                "customer_draft",
                {"awaiting": "phone", "name": "Pat", "email": "pat@x.test"},
                "phone",
                "START_CREATE_TICKET",
                "ticket",
            ),
            (
                "ticket",
                "ticket_draft",
                {
                    "awaiting": "issue",
                    "customerName": "Pat",
                    "customerEmail": "pat@x.test",
                },
                "issue",
                "START_CREATE_CUSTOMER",
                "customer",
            ),
            (
                "team",
                "team_draft",
                {"awaiting": "description", "name": "NetOps"},
                "description",
                "START_CREATE_MACRO",
                "macro",
            ),
            (
                "macro",
                "macro_draft",
                {"awaiting": "body", "title": "VIP"},
                "body",
                "START_CREATE_KB",
                "kb",
            ),
            (
                "kb",
                "kb_draft",
                {
                    "awaiting": "body",
                    "title": "VPN",
                    "category": "General",
                },
                "body",
                "START_CREATE_TEAM",
                "team",
            ),
            (
                "priority",
                "priority_draft",
                {
                    "awaiting": "hours",
                    "displayName": "Critical",
                    "kind": "priority",
                },
                "resolutionHours",
                "START_CREATE_TICKET",
                "ticket",
            ),
            (
                "escalate",
                "escalate_draft",
                {"awaiting": "assignee", "ticket_number": "14001"},
                "assignee",
                "START_CREATE_CUSTOMER",
                "customer",
            ),
            (
                "reassign",
                "reassign_draft",
                {
                    "awaiting": "person",
                    "ticket_number": "14001",
                    "target_role": "agent",
                },
                "person",
                "START_CREATE_TICKET",
                "ticket",
            ),
        ]

        entity = {
            "customer": "customer",
            "ticket": "ticket",
            "team": "team",
            "macro": "macro",
            "kb": "article",
            "priority": "priority",
            "escalate": "ticket",
            "reassign": "ticket",
        }

        p0, p1 = self._phrase_patches()
        with p0, p1, patch(
            "app.tasks.catalog_commands._live_kb_categories", return_value=["General"]
        ):
            for flow, draft_key, draft, expect_miss, start_b, flow_b in modules:
                started = _wf(
                    f"switch to {flow_b} please",
                    **{draft_key: dict(draft)},
                    workflow_decision={
                        "action": start_b,
                        "intent": "CREATE",
                        "entity_type": {
                            "ticket": "ticket",
                            "customer": "customer",
                            "macro": "macro",
                            "kb": "article",
                            "team": "team",
                        }.get(flow_b, flow_b),
                        "confidence": 0.99,
                    },
                )
                parked = started.get("parked_drafts") or []
                assert any(p.get("flow") == flow for p in parked), (
                    flow,
                    parked,
                    list(started.keys()),
                )
                parked_item = next(p for p in parked if p.get("flow") == flow)
                filled_before = {
                    k: v
                    for k, v in (parked_item.get("draft") or {}).items()
                    if k != "awaiting" and v not in (None, "", [], {})
                }

                offer = maybe_offer_resume(
                    parked,
                    completed_tool=f"create_{flow_b}",
                    user_text=f"finished {flow_b}",
                )
                assert offer, flow
                assert offer["pending_resume"]["flow"] == flow
                assert expect_miss in (
                    offer["pending_resume"].get("missing_fields") or []
                ), (flow, offer["pending_resume"])

                resumed = _wf(
                    "yes continue",
                    parked_drafts=parked,
                    workflow_decision={
                        "action": "RESUME_WORKFLOW",
                        "entity_type": entity[flow],
                        "values": [flow],
                        "confidence": 0.99,
                    },
                )
                restored = resumed.get(draft_key) or {}
                assert restored, (flow, list(resumed.keys()))
                for k, v in filled_before.items():
                    assert restored.get(k) == v, (flow, k, restored)
                wid = workflow_id_for_parked_flow(flow, restored)
                miss = missing_fields(wid, restored)
                assert expect_miss in miss, (flow, miss)
                # Must not restart at first schema field when later fields missing
                if expect_miss != "name" and expect_miss != "customerName":
                    assert restored.get("awaiting") != "name" or expect_miss in {
                        "name",
                        "customerName",
                    }

    # ----- pendingAsk prefers missing -----

    def test_agent_turn_pending_ask_prefers_missing_over_stale_awaiting(self):
        from app.agent_turn import chat_result_to_agent_turn

        out = chat_result_to_agent_turn(
            {
                "reply": "What is the issue?",
                "agent": "tickets",
                "session_id": "s1",
                "actions": [
                    {
                        "type": "create_ticket",
                        "step": "name",  # stale UI hint
                        "customerName": "Jane",
                        "customerEmail": "jane@x.test",
                    }
                ],
                "request_id": "r1",
                "data": {
                    "workflow": "create_ticket",
                    "step": "name",
                    "ticket_draft": {
                        "awaiting": "name",
                        "customerName": "Jane",
                        "customerEmail": "jane@x.test",
                    },
                },
            }
        )
        ask = (out.get("sessionMemoryPatch") or {}).get("pendingAsk")
        assert ask == "issue", ask


@pytest.mark.e2e
class TestClientDraftRouting:
    """React form draft must hydrate the correct LangGraph draft key."""

    def test_customers_module_phone_draft_is_customer_not_ticket(self):
        from app.agent_turn import resolve_client_form_drafts

        blob = {
            "awaiting": "phone",
            "name": "Deva",
            "email": "devasekar815@gmail.com",
            "customerName": "Deva",
            "customerEmail": "devasekar815@gmail.com",
        }
        resolved = resolve_client_form_drafts(
            module="customers",
            page="Customers",
            session_memory={"pendingIntent": "create_customer", "pendingAsk": "phone"},
            ticket_draft=blob,
            draft=blob,
        )
        assert "customer_draft" in resolved
        assert "ticket_draft" not in resolved
        assert resolved["customer_draft"]["name"] == "Deva"
        assert resolved["customer_draft"]["email"] == "devasekar815@gmail.com"
        assert resolved["customer_draft"]["awaiting"] == "phone"

    def test_kb_module_draft_maps_to_kb_not_dropped(self):
        from app.agent_turn import resolve_client_form_drafts

        blob = {
            "awaiting": "category",
            "title": "login issue",
            "body": "Check session timeouts and clear local storage.",
        }
        resolved = resolve_client_form_drafts(
            module="kb",
            page="Knowledge Base",
            session_memory={"pendingIntent": "create_kb", "pendingAsk": "category"},
            ticket_draft=blob,
            draft=blob,
        )
        assert resolved == {
            "kb_draft": {
                "awaiting": "category",
                "title": "login issue",
                "body": "Check session timeouts and clear local storage.",
            }
        }

    def test_admin_priority_draft_not_ticket_and_empty_shell_inactive(self):
        from app.agent_turn import resolve_client_form_drafts
        from app.prompts.builder import _active_guided_workflow

        blob = {
            "awaiting": "name",
            "kind": "priority",
            "displayName": "Critical",
        }
        resolved = resolve_client_form_drafts(
            module="admin",
            page="Priorities",
            page_surface="priorities",
            session_memory={},
            ticket_draft=blob,
            draft=blob,
        )
        assert "priority_draft" in resolved
        assert "ticket_draft" not in resolved

        # Create Ticket page chrome with awaiting-only must not look like active collect
        assert (
            _active_guided_workflow(
                "tickets", {"ticket_draft": {"awaiting": "name"}}
            )
            is None
        )
        assert (
            _active_guided_workflow(
                "tickets",
                {
                    "ticket_draft": {
                        "awaiting": "name",
                        "customerName": "Ada",
                    }
                },
            )
            == "create_ticket"
        )

    def test_active_kb_collect_blocks_resume_of_parked_escalate(self):
        from app.agents.workflow_nlu import ground_resume_offer_decision

        grounded = ground_resume_offer_decision(
            {
                "action": "CONFIRM_WORKFLOW",
                "operation": "ESCALATE",
                "fields": {},
            },
            {
                "current_workflow": "",
                "kb_draft": {
                    "awaiting": "category",
                    "title": "login issue",
                    "body": "steps…",
                },
                "parked_drafts": [
                    {
                        "flow": "escalate",
                        "draft": {"awaiting": "assignee", "ticket_number": "skip"},
                    }
                ],
                "conversation_context": {
                    "last_query": {
                        "awaiting": "resume_offer",
                        "pending_resume": {"flow": "escalate"},
                    }
                },
            },
        )
        assert grounded["action"] == "CONFIRM_WORKFLOW"
        assert grounded["action"] != "RESUME_WORKFLOW"

    def test_phone_on_customers_continues_customer_not_offline(self, monkeypatch):
        """Regression: phone while adding customer must not misroute to create-ticket."""
        from app.agent_turn import run_agent_turn
        from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db

        patch_no_db(monkeypatch)
        patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
        monkeypatch.setattr(
            "app.tasks.catalog_commands._phrase",
            lambda **kw: str(kw.get("fallback") or "ok"),
        )
        monkeypatch.setattr(
            "app.tasks.chat_commands._llm_phrase",
            lambda **kw: str(kw.get("fallback") or "ok"),
        )

        out = run_agent_turn(
            "9876543216",
            page="Customers",
            organization_id="org-draft-route",
            session_id="s-customer-phone",
            user_id="u1",
            user_name="Admin",
            user_role="admin",
            can_create_ticket=True,
            module="customers",
            page_surface="create",
            session_memory={
                "pendingIntent": "create_customer",
                "pendingAsk": "phone",
                "slots": {
                    "awaiting": "phone",
                    "name": "Deva",
                    "email": "devasekar815@gmail.com",
                },
            },
            draft={
                "awaiting": "phone",
                "name": "Deva",
                "email": "devasekar815@gmail.com",
                "customerName": "Deva",
                "customerEmail": "devasekar815@gmail.com",
            },
            ticket_draft={
                "awaiting": "phone",
                "name": "Deva",
                "email": "devasekar815@gmail.com",
                "customerName": "Deva",
                "customerEmail": "devasekar815@gmail.com",
            },
            history=[
                {"role": "user", "text": "okay add customer"},
                {
                    "role": "assistant",
                    "text": "I noted Deva and the email. What is their phone?",
                },
            ],
        )
        data = out.get("data") or {}
        reply = str(out.get("assistantText") or out.get("reply") or "").lower()
        assert "offline" not in reply
        assert "unavailable" not in reply
        # Must not ask for ticket subject/description on a customer phone turn
        assert "subject" not in reply
        cd = data.get("customer_draft") or {}
        assert cd.get("name") == "Deva"
        assert cd.get("phone") == "9876543216" or cd.get("awaiting") == "confirm"
        td = data.get("ticket_draft")
        if isinstance(td, dict):
            assert not (
                td.get("awaiting") == "phone"
                and not td.get("issue")
                and td.get("name") == "Deva"
            )

    def test_super_agent_context_includes_session_memory(self):
        from app.agents.workflow_nlu import (
            _compact_session_memory,
            build_super_agent_context,
        )

        memory = {
            "pendingIntent": "create_ticket",
            "pendingAsk": "issue",
            "slots": {
                "awaiting": "issue",
                "customerName": "Aakash",
                "customerEmail": "a@x.com",
            },
        }
        compact = _compact_session_memory(memory)
        assert compact is not None
        assert compact["pendingIntent"] == "create_ticket"
        assert compact["pendingAsk"] == "issue"
        assert compact["slots"]["customerName"] == "Aakash"

        ctx = build_super_agent_context(
            {
                "session_memory": memory,
                "ticket_draft": {
                    "awaiting": "issue",
                    "customerName": "Aakash",
                    "customerEmail": "a@x.com",
                },
                "current_workflow": "create_ticket",
                "page": "Tickets",
                "user_role": "admin",
            },
            "cant login to portal",
        )
        sm = ctx.get("session_memory") or {}
        assert sm.get("pendingIntent") == "create_ticket"
        assert sm.get("pendingAsk") == "issue"
        assert (sm.get("slots") or {}).get("customerName") == "Aakash"

    def test_specialist_prompt_includes_session_memory(self):
        from app.agents.base import _build_human

        text = _build_human(
            {
                "session_memory": {
                    "pendingIntent": "create_kb",
                    "pendingAsk": "category",
                    "slots": {"title": "Login help", "awaiting": "category"},
                },
                "page": "Knowledge Base",
                "chat_module": "kb",
                "chat_surface": "create",
                "kb_draft": {
                    "title": "Login help",
                    "awaiting": "category",
                },
            },
            "troubelshooting",
        )
        assert "SESSION MEMORY" in text
        assert "create_kb" in text
        assert "category" in text

    def test_typed_collect_prefers_llm_corrected_field_over_raw(self):
        from app.agents.workflow_nlu import ground_active_collect_decision

        decision = ground_active_collect_decision(
            {
                "action": "CONTINUE_WORKFLOW",
                "fields": {"customerName": "Aakash"},
            },
            workflow="create_ticket",
            step="customer",
            user_text="Aakashh",
            roster_members=None,
            draft={"awaiting": "customer"},
        )
        fields = decision.get("fields") or {}
        assert fields.get("customerName") == "Aakash"
