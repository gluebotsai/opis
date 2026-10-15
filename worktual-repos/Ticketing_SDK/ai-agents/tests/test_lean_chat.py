"""Sub-2s lean chat — cheap intent, GeneralAgent no tools, no live dump."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.messages_compat import HumanMessage

from app.agents.base import run_specialist
from app.agents.intent import INTENT_LABELS, classify_intent, _normalize_label
from app.agents.policy import INTENT_TO_AGENT, NO_TOOL_INTENTS, apply_policy
from app.graph import run_chat
from app.prompts import GLOBAL_SYSTEM
from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db


def test_normalize_intent_labels():
    assert _normalize_label("GREETING") == "GREETING"
    assert _normalize_label("hiiii") == "CHAT"  # unknown raw token → CHAT
    assert _normalize_label("Tickets!!!") == "TICKET"
    assert _normalize_label("Thanks!") == "GREETING"
    assert set(INTENT_LABELS) >= {"GREETING", "TICKET", "NAVIGATE", "TEAMS", "MACRO", "ADMIN"}


def test_normalize_filter_maps_to_ticket():
    assert _normalize_label("FILTER") == "TICKET"
    assert _normalize_label("OPEN") == "NAVIGATE"


def test_normalize_leaked_reassign_workflow_token_maps_to_update():
    """Cheap intent must never treat START_REASSIGN as CHAT (Phase 1 fail-safe)."""
    assert _normalize_label("START_REASSIGN") == "UPDATE"
    assert _normalize_label("REASSIGN") == "UPDATE"
    assert _normalize_label("START_ESCALATE") == "UPDATE"


def test_intent_system_has_no_workflow_action_labels():
    from app.prompts import INTENT_SYSTEM

    # Rules must use the 12-label enum only — not Super Agent actions.
    assert "→ START_REASSIGN" not in INTENT_SYSTEM
    assert "→ CONFIRM_WORKFLOW" not in INTENT_SYSTEM
    assert "→ UPDATE" in INTENT_SYSTEM
    assert "reassign this ticket" in INTENT_SYSTEM.lower()


def test_intent_to_agent_greeting_is_general():
    assert INTENT_TO_AGENT["GREETING"] == "general"
    assert "GREETING" in NO_TOOL_INTENTS
    assert "CHAT" not in NO_TOOL_INTENTS
    out = apply_policy({"intent": "GREETING", "can_create_ticket": True})  # type: ignore[arg-type]
    assert out["route"] == "general"
    assert out["tools_allowed"] is False
    chat = apply_policy({"intent": "CHAT", "can_create_ticket": True})  # type: ignore[arg-type]
    assert chat["tools_allowed"] is True


def test_search_customer_does_not_route_to_tickets():
    """Idle customer chat uses CUSTOMER label or Customers page, not ticket regex."""
    from app.messages_compat import HumanMessage

    labeled = apply_policy(
        {
            "intent": "CUSTOMER",
            "can_create_ticket": True,
            "messages": [HumanMessage(content="find customer Acme")],
        }  # type: ignore[arg-type]
    )
    assert labeled["route"] == "customers"

    on_page = apply_policy(
        {
            "intent": "SEARCH",
            "can_create_ticket": True,
            "page": "Customers",
            "messages": [HumanMessage(content="find Mohamed Fazil")],
        }  # type: ignore[arg-type]
    )
    assert on_page["route"] == "customers"

    ticketish = apply_policy(
        {
            "intent": "SEARCH",
            "can_create_ticket": True,
            "messages": [HumanMessage(content="find ticket 12913")],
        }  # type: ignore[arg-type]
    )
    assert ticketish["route"] == "tickets"


def test_macro_admin_labels_and_pages_route():
    labeled_macro = apply_policy(
        {
            "intent": "MACRO",
            "can_create_ticket": True,
            "messages": [HumanMessage(content="show macros")],
        }  # type: ignore[arg-type]
    )
    assert labeled_macro["route"] == "macros"

    labeled_admin = apply_policy(
        {
            "intent": "ADMIN",
            "can_create_ticket": True,
            "messages": [HumanMessage(content="show analytics")],
        }  # type: ignore[arg-type]
    )
    assert labeled_admin["route"] == "admin"

    on_csat = apply_policy(
        {
            "intent": "SEARCH",
            "can_create_ticket": True,
            "page": "CSAT reports",
            "messages": [HumanMessage(content="average score")],
        }  # type: ignore[arg-type]
    )
    assert on_csat["route"] == "admin"

    on_directory = apply_policy(
        {
            "intent": "SEARCH",
            "can_create_ticket": True,
            "page": "Escalation directory",
            "messages": [HumanMessage(content="who handles frontend")],
        }  # type: ignore[arg-type]
    )
    assert on_directory["route"] == "admin"

    on_audit = apply_policy(
        {
            "intent": "CHAT",
            "can_create_ticket": True,
            "page": "Audit logs",
            "messages": [HumanMessage(content="latest logs")],
        }  # type: ignore[arg-type]
    )
    assert on_audit["route"] == "admin"

    on_prefs = apply_policy(
        {
            "intent": "SEARCH",
            "can_create_ticket": True,
            "page": "Org preferences",
            "messages": [HumanMessage(content="ticket prefix")],
        }  # type: ignore[arg-type]
    )
    assert on_prefs["route"] == "admin"

    greeting_on_csat = apply_policy(
        {
            "intent": "GREETING",
            "can_create_ticket": True,
            "page": "CSAT reports",
            "messages": [HumanMessage(content="What is the average CSAT?")],
        }  # type: ignore[arg-type]
    )
    assert greeting_on_csat["route"] == "admin"
    assert greeting_on_csat["tools_allowed"] is True

    hi_on_csat = apply_policy(
        {
            "intent": "GREETING",
            "can_create_ticket": True,
            "page": "CSAT reports",
            "messages": [HumanMessage(content="hi")],
        }  # type: ignore[arg-type]
    )
    assert hi_on_csat["route"] == "general"


def test_greeting_chat_uses_general_agent(monkeypatch, fresh_memory):
    patch_no_db(monkeypatch)
    llm = patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
    out = run_chat(
        "hiiii",
        organization_id="org-lean",
        session_id="s-hi",
        history=[{"role": "user", "text": "hiiii"}],
        user_id="u1",
        user_role="admin",
    )
    assert out["agent"] == "general"
    assert out["reply"]
    assert not out.get("data", {}).get("serviceError")
    # Native supervisor may answer greetings directly (no specialist handoff).
    assert llm.records
    top = llm.records[0]
    assert "route_to_agent:" not in (top.reply or "")
    assert "LIVE DATABASE RESULTS" not in top.human
    assert "ticketing supervisor" in top.system.lower() or "Worktual" in top.system


def test_run_specialist_skips_tools_for_greeting(monkeypatch):
    patch_no_db(monkeypatch)
    llm = AdvancedFakeLLM(route_mode="heuristic", reply="Hi — how can I help?")
    patch_llm(monkeypatch, llm)

    bound_tools: list = []

    class _Tracking(AdvancedFakeLLM):
        def bind_tools(self, tools, **_k):
            bound_tools.append(list(tools) if tools else [])
            return self

    tracking = _Tracking(route_mode="heuristic", reply="Hi there!")
    monkeypatch.setattr("app.agents.base.get_llm", lambda: tracking)

    state = {
        "messages": [HumanMessage(content="hi")],
        "route": "general",
        "intent": "GREETING",
        "tools_allowed": False,
        "page": "Home",
        "organization_id": "org-x",
        "session_history": [{"role": "user", "text": "hi"}],
        "user_id": "u1",
        "user_name": "Ada",
        "user_role": "admin",
        "can_create_ticket": True,
        "summary": None,
        "ticket_draft": None,
        "next_step": None,
        "reply": None,
    }
    out = run_specialist("general", state)  # type: ignore[arg-type]
    assert out["reply"]
    # tools_allowed False → bind_tools never called with a non-empty list
    assert not any(bound_tools)


def test_classify_intent_draft_override_skips_llm(monkeypatch):
    called = MagicMock()

    class _Boom:
        def invoke(self, *_a, **_k):
            called()
            raise AssertionError("intent LLM must not run for draft override")

    monkeypatch.setattr("app.agents.intent.get_llm", lambda: _Boom())
    state = {
        "messages": [HumanMessage(content="vip")],
        "macro_draft": {"step": "title", "title": ""},
        "organization_id": "o",
        "page": "Home",
    }
    out = classify_intent(state)  # type: ignore[arg-type]
    assert out["intent"] == "CREATE"
    called.assert_not_called()


def test_ticket_question_routes_to_tickets(monkeypatch, fresh_memory):
    from app.agents import ticketing_coworker as tc

    patch_no_db(monkeypatch)

    class _InsightsLLM:
        def __init__(self):
            self.round = 0

        def run(self, messages, tools=None, **kwargs):
            self.round += 1
            if self.round == 1:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "route-1",
                            "name": "route_to_agent",
                            "arguments": {
                                "agent_name": "tickets",
                                "query": "how many overall open tickets are there?",
                            },
                        }
                    ],
                }
            if self.round == 2:
                return {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "semantic-1",
                            "name": "ask_semantic_layer",
                            "arguments": {
                                "query": "how many overall open tickets are there?"
                            },
                        }
                    ],
                }
            return {"content": "There are 7 open tickets.", "tool_calls": []}

    insights_llm = _InsightsLLM()
    monkeypatch.setattr(tc, "get_llm", lambda: insights_llm)
    called = []

    def _dispatch(name, args, **kwargs):
        called.append(name)
        return {"success": True, "payload": {"open_tickets_metric": 7}}

    monkeypatch.setattr(tc, "dispatch_tool", _dispatch)
    out = run_chat(
        "how many overall open tickets are there?",
        organization_id="org-lean",
        session_id="s-tix",
        history=[{"role": "user", "text": "how many overall open tickets are there?"}],
        user_id="u1",
        user_role="admin",
    )
    # Count/KPI stays with tickets; do not yank a list filter.
    assert out.get("route") == "tickets" or out["agent"] == "tickets", out
    assert called == ["ask_semantic_layer"]
    assert not any(a.get("type") == "set_filter" for a in (out.get("actions") or []))
