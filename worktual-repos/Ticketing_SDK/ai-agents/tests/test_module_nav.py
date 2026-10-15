"""Module navigation fast-path + view aliases + chat role × intent matrix."""

import re
from unittest.mock import patch

import pytest
from app.messages_compat import HumanMessage

from app.tasks.ui_actions import (
    _module_nav_fallback,
    actions_for_navigate_intent,
    normalize_nav_view,
    resolve_ui_actions,
)
from app.tasks.chat_commands import _gate_ui_actions_for_role, _resolve_nav_for_role


@pytest.fixture(autouse=True)
def _ticket_enrichment_preview():
    with patch(
        "app.tools.ticket_write.enrich_ticket",
        return_value={
            "success": True,
            "payload": {
                "data": {
                    "subject": "Validated issue",
                    "description": "Validated issue",
                    "priority": "medium",
                }
            },
        },
    ):
        yield


def test_normalize_aliases():
    assert normalize_nav_view("teams") == "agent-queues"
    assert normalize_nav_view("workboard") == "work-board"
    assert normalize_nav_view("home") == "dashboard"
    assert normalize_nav_view("not-a-view") is None


def test_module_nav_search_and_work_board():
    search = _module_nav_fallback("go to search")
    assert search and search["actions"][0]["view"] == "search"
    wb = _module_nav_fallback("open work board")
    assert wb and wb["actions"][0]["view"] == "work-board"
    kb = resolve_ui_actions("open knowledge base", page="Home")
    assert kb["actions"][0]["view"] == "kb"
    settings = resolve_ui_actions("open settings", page="Home")
    assert settings["actions"][0]["view"] == "settings"


def test_module_nav_macros_and_admin_modules():
    write = _module_nav_fallback("write macros")
    assert write and write["actions"][0]["view"] == "macros"
    how = _module_nav_fallback("how to write macros")
    assert how and how["actions"][0]["view"] == "macros"
    open_m = _module_nav_fallback("open macros")
    assert open_m and open_m["actions"][0]["view"] == "macros"
    inbox = _module_nav_fallback("open team inbox")
    assert inbox and inbox["actions"][0]["view"] == "team-inbox"
    # counts stay with specialists
    assert _module_nav_fallback("how many macros are there?") is None

    assert _module_nav_fallback("open csat reports")["actions"][0]["view"] == "csat-reports"
    assert _module_nav_fallback("go to priorities")["actions"][0]["view"] == "priorities"
    assert (
        _module_nav_fallback("open escalation directory")["actions"][0]["view"]
        == "escalation-directory"
    )
    assert (
        _module_nav_fallback("org preferences")["actions"][0]["view"] == "org-preferences"
    )
    assert _module_nav_fallback("open audit log")["actions"][0]["view"] == "audit"
    assert _module_nav_fallback("show recent activity")["actions"][0]["view"] == "dashboard"
    # do not steal ticket priority filters
    assert _module_nav_fallback("show high priority tickets") is None


def test_route_from_page_macros_and_admin_modules():
    from app.agents.policy import _route_from_page

    assert _route_from_page("Macros") == "macros"
    assert _route_from_page("Analytics") == "admin"
    assert _route_from_page("CSAT reports") == "admin"
    assert _route_from_page("csat-reports") == "admin"
    assert _route_from_page("Audit logs") == "admin"
    assert _route_from_page("audit") == "admin"
    assert _route_from_page("Priorities & Statuses") == "admin"
    assert _route_from_page("Org preferences") == "admin"
    assert _route_from_page("org-preferences") == "admin"
    assert _route_from_page("Escalation directory") == "admin"
    assert _route_from_page("escalation-directory") == "admin"
    assert _route_from_page("Customers") == "customers"


def test_open_priorities_does_not_handoff_ticket_list():
    """Idle 'open priorities' is catalog nav even if NLU says LIST_TICKETS."""
    from app.messages_compat import HumanMessage

    from app.agents.workflow_manager import workflow_manager_node

    out = workflow_manager_node(
        {
            "messages": [HumanMessage(content="open priorities")],
            "organization_id": "org-1",
            "user_role": "admin",
            "workflow_decision": {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "LIST_TICKETS",
                "confidence": 0.9,
            },
        }  # type: ignore[arg-type]
    )
    assert out.get("specialist_handoff") is not True
    from app.agents.commands import command_node

    cmd = command_node(
        {
            "messages": [HumanMessage(content="open priorities")],
            "organization_id": "org-1",
            "user_role": "admin",
        }  # type: ignore[arg-type]
    )
    actions = cmd.get("actions") or []
    assert any(a.get("type") == "navigate" and a.get("view") == "priorities" for a in actions)


def test_navigate_views_come_from_ui_actions_not_specialist():
    """Page moves are explicit navigate actions, never specialist agent labels."""
    teams = actions_for_navigate_intent("open teams")
    assert teams and teams[0]["type"] == "navigate"
    assert teams[0]["view"] == "agent-queues"

    home = actions_for_navigate_intent("go to home")
    assert home and home[0]["view"] == "dashboard"

    low = actions_for_navigate_intent("show low priority tickets")
    assert low == []
    assert actions_for_navigate_intent("how many open tickets") == []
    assert _module_nav_fallback("how many open tickets are there?") is None


def test_ensure_navigate_actions_backfills_nav_only():
    from app.graph import _ensure_navigate_actions

    acts, reply = _ensure_navigate_actions(
        "open teams",
        intent="NAVIGATE",
        actions=[],
        role="admin",
        page="Home",
        reply="Opening Teams.",
    )
    assert any(a.get("view") == "agent-queues" for a in acts)
    assert reply == "Opening Teams."

    # Existing actions win — do not replace a filter turn with module nav.
    kept, _ = _ensure_navigate_actions(
        "open teams",
        intent="NAVIGATE",
        actions=[{"type": "set_filter", "module": "tickets", "priority": "low"}],
        role="admin",
        page="Home",
        reply="Filtered.",
    )
    assert kept == [{"type": "set_filter", "module": "tickets", "priority": "low"}]

    # Q&A / counts: no page yank even if intent is mislabeled NAVIGATE.
    none, qa_reply = _ensure_navigate_actions(
        "how many open tickets are there?",
        intent="NAVIGATE",
        actions=[],
        role="admin",
        page="Home",
        reply="There are 3 open tickets.",
    )
    assert none == []
    assert qa_reply == "There are 3 open tickets."

    # Non-NAVIGATE specialist answers must not invent navigate.
    ticket_q, _ = _ensure_navigate_actions(
        "how many open tickets",
        intent="TICKET",
        actions=[],
        role="admin",
        page="Home",
        reply="There are 3.",
    )
    assert ticket_q == []

    # A specialist that actually executed the list tool must reveal that live
    # result in the role's ticket view, regardless of the current page.
    listed, _ = _ensure_navigate_actions(
        "independent ticket operation",
        intent="TICKET",
        actions=[],
        data={"success": True, "_tool_name": "list_tickets", "payload": {"data": []}},
        role="agent",
        page="Create Ticket",
        reply="Live ticket list loaded.",
    )
    assert any(a.get("type") == "navigate" and a.get("view") == "assigned" for a in listed)
    assert any(
        a.get("type") == "set_filter"
        and a.get("module") == "tickets"
        and a.get("query") == ""
        for a in listed
    )

    faceted, _ = _ensure_navigate_actions(
        "show high priorty tickets",
        intent="TICKET",
        actions=[],
        data={"success": True, "_tool_name": "list_tickets", "payload": {"data": []}},
        role="agent",
        page="Tickets",
        reply="High priority tickets.",
    )
    assert not any(a.get("priority") == "high" for a in faceted)

    metrics_nav, _ = _ensure_navigate_actions(
        "how is the queue",
        intent="TICKET",
        actions=[],
        data={"success": True, "_tool_name": "get_metrics"},
        role="admin",
        page="Home",
        reply="Live overview loaded.",
    )
    assert any(
        a.get("type") == "navigate" and a.get("view") == "dashboard" for a in metrics_nav
    )

    rewritten, _ = _ensure_navigate_actions(
        "open tickets",
        intent="TICKET",
        actions=[
            {"type": "navigate", "view": "tickets-list"},
            {"type": "set_filter", "module": "tickets", "status": "Open"},
        ],
        data={
            "success": True,
            "_tool_name": "get_metrics",
            "last_query": {"operation": "GET_METRICS"},
        },
        role="admin",
        page="Home",
        reply="500 open tickets.",
    )
    assert rewritten == [{"type": "navigate", "view": "dashboard"}]


def test_semantic_data_side_quest_reaches_specialist_tools():
    from app.agents.commands import command_node

    out = command_node(
        {
            "messages": [HumanMessage(content="independent data operation")],
            "organization_id": "org-runtime",
            "workflow_decision": {
                "action": "SIDE_QUEST",
                "intent": "SEARCH",
            },
            "semantic_intent": "SEARCH",
        }  # type: ignore[arg-type]
    )
    assert out == {"command_handled": False, "actions": []}


def test_semantic_filter_side_quest_keeps_command_facets(llm):
    from app.agents.workflow_manager import (
        complete_specialist_handoff,
        workflow_manager_node,
    )

    with patch(
        "app.tools.ticket_read.list_tickets",
        return_value={"success": True, "payload": {"data": []}},
    ):
        state = {
            "messages": [HumanMessage(content="show high priorty tickets")],
            "organization_id": "00000000-0000-4000-8000-000000000001",
            "user_id": "00000000-0000-4000-8000-000000000002",
            "user_role": "admin",
            "page": "Tickets",
            "workflow_decision": {
                "action": "NORMAL_ROUTE",
                "intent": "TICKET",
                "operation": "LIST_TICKETS",
                "filters": {"priority": "high"},
                "proposed_tool": "list_tickets",
                "confidence": 0.99,
            },
        }
        out = complete_specialist_handoff(
            state, workflow_manager_node(state)  # type: ignore[arg-type]
        )
    assert any(a.get("priority") == "high" for a in out["actions"])


def test_compatibility_list_helper_does_not_execute_ticket_reads(monkeypatch):
    from app.tasks import chat_commands as cc

    monkeypatch.setattr(
        cc,
        "_llm_phrase",
        lambda **kwargs: "Here are matching tickets from live data.",
    )
    monkeypatch.setattr(
        cc,
        "_live_tickets_matching_filter",
        lambda **kwargs: [
            {
                "ticket_number": "#1001",
                "subject": "Printer jam",
                "status": "Open",
                "priority": "low",
                "assignee_name": "Mohamed",
            },
            {
                "ticket_number": "#1002",
                "subject": "Slow VPN",
                "status": "Pending",
                "priority": "low",
                "assignee_name": "Unassigned",
            },
        ],
    )
    gated = {
        "handled": True,
        "reply": "look at the list",
        "actions": [
            {"type": "navigate", "view": "assigned"},
            {
                "type": "set_filter",
                "module": "tickets",
                "query": "",
                "priority": "low",
            },
        ],
        "route": "tickets",
    }
    out = cc._with_live_list_in_reply(
        gated,
        org="o1",
        role="agent",
        user_id="u1",
        user_name="Mohamed",
        user_text="show low priority tickets",
    )
    assert out["reply"] == "look at the list"
    assert "data" not in out
    assert any(a.get("priority") == "low" for a in out["actions"])


def test_resolver_role_gates():
    def _fake_phrase(**kwargs):
        fb = str(kwargs.get("fallback") or "")
        if "cannot use" in fb.lower() or kwargs.get("kind") == "forbidden":
            return "Your role can’t use that module."
        return fb or "ok"

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase):
        customers = _gate_ui_actions_for_role(
            [{"type": "navigate", "view": "customers"}],
            role="resolver",
            reply_hint="Intent: open customers.",
        )
        assert customers["handled"] is True
        assert customers["actions"] == []
        assert "can’t use" in customers["reply"] or "can't use" in customers["reply"]

        wb = _gate_ui_actions_for_role(
            [{"type": "navigate", "view": "work-board"}],
            role="resolver",
            reply_hint="Intent: open Work board.",
        )
        assert wb["actions"] == [{"type": "navigate", "view": "work-board"}]

    assert _resolve_nav_for_role("tickets-list", "resolver") == "assigned"
    assert _resolve_nav_for_role("search", "resolver") == "search"
    assert _resolve_nav_for_role("team-inbox", "resolver") is None


def test_due_today_navigates_dashboard_not_overdue():
    due = resolve_ui_actions("due today?", page="Home")
    assert due["actions"] == []
    assert not any(
        str(a.get("status") or "").lower() == "overdue" for a in due["actions"]
    )
    overdue = resolve_ui_actions("show overdue tickets", page="Home")
    assert overdue["actions"] == []


def test_try_metrics_command_open_created_reassigned_due(monkeypatch):
    from app.tasks import catalog_commands as cc

    def _fake_phrase(**kwargs):
        ctx = kwargs.get("context") or {}
        # Surface facts so assertions don't depend on LLM.
        parts = [f"{k}={v}" for k, v in ctx.items() if k != "nextStep" and k != "listSummary"]
        return "metrics: " + ", ".join(parts) if parts else str(kwargs.get("fallback") or "")

    class _Scope:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(cc, "_phrase", _fake_phrase)
    monkeypatch.setattr(
        cc,
        "_actor_scope",
        lambda *a, **k: (
            type("A", (), {"user_id": "u1", "organization_id": "o1"})(),
            lambda _actor: _Scope(),
        ),
    )

    def _fake_get_metrics(**_kwargs):
        return {
            "success": True,
            "payload": {"openTickets": 102, "dueToday": 1, "overdue": 98},
        }

    def _fake_express(method, path, **kwargs):
        if path == "/api/agent/triage-stats":
            return {
                "success": True,
                "payload": {"createdByMe": 81, "reassignedOut": 0},
            }
        if path == "/api/tickets":
            assert kwargs.get("params", {}).get("scope") == "created"
            return {
                "success": True,
                "payload": [
                    {
                        "id": "#13001",
                        "subject": "Created ticket",
                        "status": "Open",
                        "priority": "high",
                        "assignee": "Resolver One",
                    }
                ],
            }
        raise AssertionError(path)

    monkeypatch.setattr(
        "app.tools.catalog_tools.get_metrics", _fake_get_metrics, raising=False
    )
    # try_metrics imports inside the function
    import app.tools.catalog_tools as ct
    import app.tools.express_client as ec
    import app.tools.ticket_read as tr

    monkeypatch.setattr(ct, "get_metrics", _fake_get_metrics)
    monkeypatch.setattr(ec, "express_request", _fake_express)
    monkeypatch.setattr(tr, "express_request", _fake_express)

    open_hit = cc.try_metrics_command(
        "how many open tickets are there?",
        org="o1",
        role="admin",
        user_id="u1",
        user_name="Jane",
        page="Home",
    )
    assert open_hit is None

    due_hit = cc.try_metrics_command(
        "due today?",
        org="o1",
        role="admin",
        user_id="u1",
        user_name="Jane",
        page="Home",
    )
    assert due_hit is None

    created = cc.try_metrics_command(
        "how many tickets created by me?",
        org="o1",
        role="admin",
        user_id="u1",
        user_name="Jane",
        page="Home",
    )
    assert created is None

    contextual_created = cc.try_metrics_command(
        "list that tickets",
        org="o1",
        role="admin",
        user_id="u1",
        user_name="Jane",
        page="All tickets",
    )
    assert contextual_created is None

    reassigned = cc.try_metrics_command(
        "how many tickets were reassigned",
        org="o1",
        role="admin",
        user_id="u1",
        user_name="Jane",
        page="Home",
    )
    assert reassigned is None

    # Imperative "reassign tickets" is escalate, not a reassigned-count metric.
    reassign_verb = cc.try_metrics_command(
        "reassign tickets",
        org="o1",
        role="agent",
        user_id="u1",
        user_name="Fazil",
        page="My Tickets",
    )
    assert reassign_verb is None


def test_try_recent_activity_command_is_retired():
    from app.tasks import catalog_commands as cc

    assert (
        cc.try_recent_activity_command(
            "show recent activity",
            org="o1",
            role="admin",
            user_id="u1",
            user_name="Jane",
            page="Home",
        )
        is None
    )


def test_try_metrics_command_denies_resolver_customer_count(monkeypatch):
    from app.tasks import catalog_commands as cc

    monkeypatch.setattr(
        cc,
        "_phrase",
        lambda **kwargs: str(kwargs.get("fallback") or ""),
    )
    monkeypatch.setattr(
        "app.tasks.chat_commands._llm_phrase",
        lambda **kwargs: str(kwargs.get("fallback") or "Role cannot use customers."),
    )

    class _Scope:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(
        cc,
        "_actor_scope",
        lambda *a, **k: (
            type("A", (), {"user_id": "u1", "organization_id": "o1"})(),
            lambda _actor: _Scope(),
        ),
    )

    hit = cc.try_metrics_command(
        "how many customers are there?",
        org="o1",
        role="resolver",
        user_id="u1",
        user_name="Yaswanth",
        page="Home",
    )
    assert hit is None


def test_write_macros_bypasses_data_question_gate():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        out = _wm_turn(
            "write macros",
            "admin",
            action="START_CREATE_MACRO",
            operation="CREATE_MACRO",
            tool="create_macro",
        )
        assert out.get("handled") is True or out.get("workflow_handled") is True
        actions = out.get("actions") or []
        types = [a.get("type") for a in actions]
        assert "create_macro" in types
        assert any(a.get("view") == "macros" for a in actions)
        assert out.get("macro_draft", {}).get("awaiting") == "title"
        assert not out.get("macro_draft", {}).get("title")
        assert out.get("macro_draft", {}).get("_intent_start_text") == "write macros"

        denied = _wm_turn(
            "write macros",
            "resolver",
            action="START_CREATE_MACRO",
            operation="CREATE_MACRO",
            tool="create_macro",
        )
        assert denied.get("handled") is True or denied.get("workflow_handled") is True
        assert "create_macro" not in [
            a.get("type") for a in (denied.get("actions") or [])
        ]


def test_creaye_macros_typo_and_title_followup():
    """START_CREATE_MACRO from Super Agent starts the flow; 'vip' is the title."""
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        start = _wm_turn(
            "creaye macros",
            "agent",
            action="START_CREATE_MACRO",
            operation="CREATE_MACRO",
            tool="create_macro",
        )
        assert start.get("handled") is True or start.get("workflow_handled") is True
        assert start.get("macro_draft", {}).get("awaiting") == "title"
        assert not start.get("macro_draft", {}).get("title")
        assert start.get("macro_draft", {}).get("_intent_start_text") == "creaye macros"
        assert any(
            a.get("type") == "create_macro" for a in (start.get("actions") or [])
        )
        assert any(
            a.get("type") == "navigate" and a.get("view") == "macros"
            for a in (start.get("actions") or [])
        )

        titled = resolve_chat_command(
            "vip",
            organization_id="org-1",
            page="Home",
            user_role="agent",
            macro_draft={"awaiting": "title"},
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "operation": "CREATE_MACRO",
                "fields": {"title": "vip"},
            },
        )
        assert titled.get("handled") is True
        assert titled.get("macro_draft", {}).get("awaiting") == "body"
        assert titled.get("macro_draft", {}).get("title") == "vip"
        assert "urgent" not in (titled.get("reply") or "").lower()


def test_macro_confirm_hands_off_to_specialist():
    """Confirm does not POST from continue_*; specialist bind_tools owns the write."""
    from app.tasks.chat_commands import resolve_chat_command

    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase):
        out = resolve_chat_command(
            "yes",
            organization_id="org-1",
            page="Macros",
            user_role="agent",
            user_id=None,
            macro_draft={
                "awaiting": "confirm",
                "title": "vip",
                "body": "Thanks for contacting VIP support.",
            },
            workflow_decision={"action": "CONFIRM_WORKFLOW", "operation": "CREATE_MACRO"},
        )
        assert out.get("handled") is False
        assert (out.get("macro_draft") or {}).get("awaiting") == "confirm"
        assert (out.get("macro_draft") or {}).get("title") == "vip"


def test_create_kb_and_priority_intents():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ):
        kb = _wm_turn(
            "create article",
            "admin",
            action="START_CREATE_KB",
            operation="CREATE_KB",
            tool="create_kb_article",
        )
        assert any(a.get("type") == "create_kb" for a in (kb.get("actions") or []))

        pri = _wm_turn(
            "add priority",
            "admin",
            action="START_CREATE_PRIORITY",
            operation="CREATE_PRIORITY",
            tool="create_priority",
        )
        assert any(
            a.get("type") == "create_priority" for a in (pri.get("actions") or [])
        )

        agent_pri = _wm_turn(
            "add priority",
            "agent",
            action="START_CREATE_PRIORITY",
            operation="CREATE_PRIORITY",
            tool="create_priority",
        )
        assert not any(
            a.get("type") == "create_priority"
            for a in (agent_pri.get("actions") or [])
        )


def _phrase(**kwargs):
    return str(kwargs.get("fallback") or kwargs.get("kind") or "ok")


def _action_types(out: dict) -> list:
    return [a.get("type") for a in (out.get("actions") or []) if isinstance(a, dict)]


def _has_action(out: dict, action_type: str) -> bool:
    return action_type in _action_types(out)


def _wm_turn(message, role, *, action, operation, tool="list_tickets", **extra):
    from app.agents.workflow_manager import (
        complete_specialist_handoff,
        workflow_manager_node,
    )

    decision = {
        "action": action,
        "intent": extra.pop("intent", "CREATE"),
        "operation": operation,
        "filters": extra.pop("filters", {}),
        "proposed_tool": tool,
        "fields": extra.pop("fields", {}),
        "entity_name": extra.pop("entity_name", None),
        "entity_type": extra.pop("entity_type", None),
        "confidence": 0.99,
    }
    state = {
        "messages": [HumanMessage(content=message)],
        "organization_id": extra.pop(
            "organization_id", "00000000-0000-4000-8000-000000000001"
        ),
        "user_role": role,
        "user_id": extra.pop("user_id", "00000000-0000-4000-8000-000000000002"),
        "user_name": extra.pop("user_name", role.title()),
        "page": extra.pop("page", "Home"),
        "workflow_decision": decision,
        **extra,
    }
    return complete_specialist_handoff(
        state, workflow_manager_node(state)  # type: ignore[arg-type]
    )


# role × chat-start: allowed True means draft/action starts; False means no mutate action
_CHAT_ROLE_MATRIX = [
    # create ticket
    ("create ticket", "admin", "create_ticket", True),
    ("create ticket", "agent", "create_ticket", True),
    ("create ticket", "customer", "create_ticket", False),
    ("create ticket", "resolver", "create_ticket", False),
    ("create ticket", "viewer", "create_ticket", False),
    # create team
    ("create team", "admin", "create_team", True),
    ("create team", "agent", "create_team", True),
    ("create team", "resolver", "create_team", False),
    ("create team", "customer", "create_team", False),
    ("create team", "viewer", "create_team", False),
    # create macro
    ("create macro", "admin", "create_macro", True),
    ("create macro", "agent", "create_macro", True),
    ("create macro", "resolver", "create_macro", False),
    ("create macro", "viewer", "create_macro", False),
    ("create macro", "customer", "create_macro", False),
    # create kb
    ("create kb article", "admin", "create_kb", True),
    ("create kb article", "agent", "create_kb", True),
    ("create kb article", "resolver", "create_kb", False),
    ("create kb article", "viewer", "create_kb", False),
    ("create kb article", "customer", "create_kb", False),
    # create priority — admin only
    ("add priority", "admin", "create_priority", True),
    ("add priority", "agent", "create_priority", False),
    ("add priority", "resolver", "create_priority", False),
    # add customer — admin only
    ("add customer", "admin", "create_customer", True),
    ("add customer", "agent", "create_customer", False),
    ("add customer", "resolver", "create_customer", False),
]


_START_OPS = {
    "create_ticket": ("START_CREATE_TICKET", "CREATE_TICKET", "create_ticket"),
    "create_team": ("START_CREATE_TEAM", "CREATE_TEAM", "create_queue"),
    "create_macro": ("START_CREATE_MACRO", "CREATE_MACRO", "create_macro"),
    "create_kb": ("START_CREATE_KB", "CREATE_KB", "create_kb_article"),
    "create_priority": ("START_CREATE_PRIORITY", "CREATE_PRIORITY", "create_priority"),
    "create_customer": ("START_CREATE_CUSTOMER", "CREATE_CUSTOMER", "create_customer"),
}


@pytest.mark.parametrize(
    "message,role,action,allowed",
    _CHAT_ROLE_MATRIX,
    ids=[f"{m}|{r}|{a}" for m, r, a, _ in _CHAT_ROLE_MATRIX],
)
def test_chat_start_intent_by_role(message, role, action, allowed):
    """Every login role × create/start intent — allow or deny matches RBAC."""
    start_action, operation, tool = _START_OPS[action]
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ):
        out = _wm_turn(
            message,
            role,
            action=start_action,
            operation=operation,
            tool=tool,
            user_id=f"{role}-1",
            user_name=role.title(),
        )
    assert out.get("workflow_handled") is True or out.get("handled") is True
    assert _has_action(out, action) is allowed
    if not allowed:
        assert out.get("macro_draft") in (None, {}) or action != "create_macro"
        if action == "create_ticket":
            assert not _has_action(out, "create_ticket")
        if action == "create_team":
            assert out.get("team_draft") in (None, {})
        if action == "create_kb":
            assert out.get("kb_draft") in (None, {})
        if action == "create_customer":
            assert out.get("customer_draft") in (None, {})


def test_reassign_is_escalate_kind():
    from app.tasks.chat_commands import _heuristic_kind

    # Keywords no longer choose escalate; Super Agent START_ESCALATE does.
    assert _heuristic_kind("reassign ticket")["kind"] == "none"
    assert _heuristic_kind("escalate")["kind"] == "none"
    assert _heuristic_kind("assign to resolver")["kind"] == "none"
    assert _heuristic_kind("assign Deva to Bug solvers team")["kind"] == "none"
    assert _heuristic_kind("escalate #12930 to Jane")["kind"] == "none"


def test_escalate_and_reassign_start_for_admin_and_agent():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.chat_commands._list_escalate_ticket_choices",
        return_value=[
            {"ticket_number": "#12840", "subject": "VPN", "priority": "high"}
        ],
    ):
        for role, msg in (
            ("admin", "escalate"),
            ("agent", "reassign ticket"),
        ):
            out = _wm_turn(
                msg,
                role,
                action="START_ESCALATE",
                operation="ESCALATE_TICKET",
                tool="escalate_ticket",
                intent="UPDATE",
                user_id=f"{role}-1",
                user_name=role.title(),
                page="Tickets",
            )
            assert out.get("handled") is True or out.get("workflow_handled") is True
            assert out.get("escalate_draft", {}).get("awaiting") == "ticket"
            assert "12840" in (out.get("reply") or "")


def test_add_members_admin_only_roles():
    from app.tasks.catalog_commands import start_or_continue_add_team_members

    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues",
        return_value={"success": True, "payload": {"data": []}},
    ):
        admin = start_or_continue_add_team_members(
            "add members",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
        )
        assert admin and admin.get("team_draft", {}).get("awaiting") == "members_team"

        for role in ("agent", "resolver", "viewer", "customer"):
            denied = start_or_continue_add_team_members(
                "add members",
                org="org-1",
                role=role,
                user_id=f"{role}-1",
                user_name=role.title(),
                page="Teams",
                intent_confirmed=True,
            )
            assert denied and denied.get("handled") is True
            assert denied.get("team_draft") is None
            assert not any(
                a.get("type") == "update_team"
                for a in (denied.get("actions") or [])
                if isinstance(a, dict)
            )


def test_delete_team_admin_only_and_agent_denied():
    from app.tasks.catalog_commands import start_or_continue_delete_team

    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase):
        denied = start_or_continue_delete_team(
            "delete team nlp",
            org="org-1",
            role="agent",
            user_id="a1",
            user_name="Agent",
            page="Teams",
            semantic_decision={"operation": "DELETE_TEAM", "entity_name": "nlp"},
        )
        assert denied and denied.get("handled") is True
        assert denied.get("team_draft") is None
        assert not any(
            a.get("type") == "delete_team" and a.get("done")
            for a in (denied.get("actions") or [])
            if isinstance(a, dict)
        )


def test_delete_macro_chat_asks_confirm(llm):
    """NLU DELETE_MACRO → confirm via last_query, not idle regex."""
    from app.messages_compat import HumanMessage

    from app.agents.workflow_manager import (
        complete_specialist_handoff,
        workflow_manager_node,
    )

    decision = {
        "action": "NORMAL_ROUTE",
        "intent": "MACRO",
        "operation": "DELETE_MACRO",
        "filters": {"query": "vip"},
        "proposed_tool": "delete_macro",
        "confidence": 0.97,
    }
    state = {
        "messages": [HumanMessage(content="delete macro vip")],
        "organization_id": "00000000-0000-4000-8000-000000000001",
        "user_id": "00000000-0000-4000-8000-000000000002",
        "user_name": "Admin",
        "user_role": "admin",
        "workflow_decision": decision,
        "page": "Macros",
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_macros",
        return_value={
            "success": True,
            "payload": [{"id": "m1", "title": "vip", "body": "hi"}],
        },
    ), patch(
        "app.tools.macro_write.delete_macro",
        return_value={"success": True, "payload": {}},
    ) as delete:
        out = complete_specialist_handoff(state, workflow_manager_node(state))  # type: ignore[arg-type]
    delete.assert_not_called()
    pending = (out.get("data") or {}).get("last_query", {}).get("pending_delete") or {}
    assert pending.get("id") == "m1"
    assert any(a.get("view") == "macros" for a in out.get("actions") or [])
    assert any(
        a.get("type") == "delete_macro" and a.get("step") == "confirm"
        for a in out.get("actions") or []
        if isinstance(a, dict)
    )


def test_full_create_ticket_transcript_posts_express(llm):
    from app.tasks.chat_commands import start_create_ticket_flow
    from app.agents.workflow_manager import (
        complete_specialist_handoff,
        resolve_active_workflow,
        workflow_manager_node,
    )

    def continue_ticket(text: str, draft: dict, fields: dict, action: str = "CONTINUE_WORKFLOW"):
        return resolve_active_workflow(
            text,
            page="Home",
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
            ticket_draft=draft,
            workflow_decision={
                "action": action,
                "operation": "CREATE_TICKET",
                "fields": fields,
                "values": [],
            },
        )

    directory = [
        {
            "id": "cust-ada",
            "name": "Ada Lovelace",
            "email": "ada@example.com",
            "phone": "5550100",
        }
    ]

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_customers",
        return_value={"success": True, "payload": {"data": directory}},
    ), patch(
        "app.tools.ticket_write.create_ticket",
        return_value={
            "success": True,
            "payload": {"ticketNumber": "#12999"},
        },
    ) as create:
        start = start_create_ticket_flow(
            "create ticket",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Home",
            semantic_decision={
                "action": "START_CREATE_TICKET",
                "operation": "CREATE_TICKET",
                "fields": {},
            },
        )
        assert start.get("ticket_draft", {}).get("awaiting") == "name"

        named = continue_ticket(
            "Ada Lovelace", start["ticket_draft"], {"customerName": "Ada Lovelace"}
        )
        assert named.get("ticket_draft", {}).get("awaiting") == "contact"

        contact = continue_ticket(
            "ada@example.com", named["ticket_draft"], {"customerEmail": "ada@example.com"}
        )
        assert contact.get("ticket_draft", {}).get("awaiting") == "issue"
        assert contact.get("ticket_draft", {}).get("customerEmail") == "ada@example.com"
        assert contact.get("ticket_draft", {}).get("customerId") == "cust-ada"
        create.assert_not_called()

        issue = continue_ticket(
            "VPN will not connect", contact["ticket_draft"], {"issue": "VPN will not connect"}
        )
        assert issue.get("ticket_draft", {}).get("awaiting") == "confirm"
        assert str(issue.get("ticket_draft", {}).get("priority") or "").lower() in {
            "urgent",
            "high",
            "medium",
            "low",
        }

        confirm_state = {
            "messages": [HumanMessage(content="confirm")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Home",
            "ticket_draft": issue.get("ticket_draft"),
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": {
                "action": "CONFIRM_WORKFLOW",
                "operation": "NONE",
                "fields": {},
                "values": [],
            },
        }
        orch = workflow_manager_node(confirm_state)  # type: ignore[arg-type]
        done = complete_specialist_handoff(confirm_state, orch)  # type: ignore[arg-type]
    assert done and done.get("workflow_handled") is True
    create.assert_called_once()
    assert done.get("ticket_draft") is None
    assert "#12999" in str((done.get("data") or {}).get("ticket_number") or "")


def test_create_ticket_unknown_email_continues_to_issue():
    from app.tasks.chat_commands import start_create_ticket_flow
    from app.agents.workflow_manager import resolve_active_workflow

    def continue_ticket(text: str, draft: dict, fields: dict):
        return resolve_active_workflow(
            text,
            page="Home",
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
            ticket_draft=draft,
            workflow_decision={
                "action": "CONTINUE_WORKFLOW",
                "operation": "CREATE_TICKET",
                "fields": fields,
                "values": [],
            },
        )

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.list_customers",
        return_value={"success": True, "payload": {"data": []}},
    ), patch(
        "app.tools.catalog_tools.create_customer",
    ) as add_cust, patch(
        "app.tools.ticket_write.create_ticket",
        return_value={"success": True, "payload": {"ticketNumber": "#1"}},
    ) as create:
        start = start_create_ticket_flow(
            "create ticket",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Home",
            semantic_decision={
                "action": "START_CREATE_TICKET",
                "operation": "CREATE_TICKET",
                "fields": {},
            },
        )
        named = continue_ticket(
            "Ada Lovelace", start["ticket_draft"], {"customerName": "Ada Lovelace"}
        )
        contact = continue_ticket(
            "unknown.person@example.com",
            named["ticket_draft"],
            {"customerEmail": "unknown.person@example.com"},
        )
    create.assert_not_called()
    add_cust.assert_not_called()
    assert contact.get("handled") is True
    cust = contact.get("customer_draft") or {}
    tix = contact.get("ticket_draft") or {}
    assert not cust.get("awaiting")
    assert tix.get("awaiting") == "issue"
    assert tix.get("customerEmail") == "unknown.person@example.com"


def test_add_customer_reuses_ticket_name_then_persists():
    from app.tasks.chat_commands import resolve_chat_command
    from app.agents.workflow_manager import resolve_active_workflow

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_customer",
        return_value={
            "success": True,
            "payload": {"customer": {"id": "cust-aashika", "name": "Aashika"}},
        },
    ) as create:
        start = resolve_active_workflow(
            "add customer",
            page="Create Ticket",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            user_name="Admin",
            escalate_draft=None,
            macro_draft=None,
            team_draft=None,
            kb_draft=None,
            parked_drafts=None,
            session_history=[
                {"role": "user", "text": "Aashika"},
                {
                    "role": "assistant",
                    "text": "Aashika is not in the directory. Add them first.",
                },
            ],
            ticket_draft={
                "awaiting": "contact",
                "customerName": "Aashika",
            },
            workflow_decision={
                "action": "START_CREATE_CUSTOMER",
                "intent": "CUSTOMER",
                "fields": {},
                "values": [],
                "confidence": 0.99,
            },
        )
        assert start and start.get("handled") is True
        draft = start.get("customer_draft") or {}
        assert draft.get("name") == "Aashika"
        assert draft.get("awaiting") == "email"
        assert any(
            a.get("type") == "create_customer" and a.get("name") == "Aashika"
            for a in (start.get("actions") or [])
            if isinstance(a, dict)
        )
        create.assert_not_called()

        asked = resolve_chat_command(
            "aashika@example.com",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Customers",
            customer_draft=draft,
        )
        create.assert_not_called()
        assert (asked.get("customer_draft") or {}).get("awaiting") == "phone"
        assert (asked.get("customer_draft") or {}).get("email") == "aashika@example.com"

        phoned = resolve_chat_command(
            "5551234567",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Customers",
            customer_draft=asked.get("customer_draft") or {},
        )
    create.assert_not_called()
    assert (phoned.get("customer_draft") or {}).get("awaiting") == "confirm"
    assert (phoned.get("customer_draft") or {}).get("email") == "aashika@example.com"
    assert (phoned.get("customer_draft") or {}).get("phone")

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_customer",
        return_value={
            "success": False,
            "message": "A customer with this email already exists. Search the directory to open their record.",
            "http_status": 409,
            "payload": {
                "customer": {
                    "id": "cust-existing",
                    "name": "Aashika",
                    "email": "aashika@example.com",
                }
            },
        },
    ):
        reused = resolve_chat_command(
            "5551234567",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Customers",
            customer_draft={
                "awaiting": "phone",
                "name": "Aashika",
                "email": "aashika@example.com",
            },
            ticket_draft={"awaiting": "contact", "customerName": "Aashika"},
        )
    assert reused.get("handled") is True
    assert (reused.get("customer_draft") or {}).get("awaiting") == "confirm"
    assert (reused.get("customer_draft") or {}).get("email") == "aashika@example.com"


def test_full_create_priority_transcript():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_priority",
        return_value={"success": True, "payload": {"id": "p1"}},
    ) as create:
        start = resolve_chat_command(
            "add priority",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            workflow_decision={
                "action": "START_CREATE_PRIORITY",
                "operation": "CREATE_PRIORITY",
            },
        )
        assert start.get("priority_draft", {}).get("awaiting") == "name"

        named = resolve_chat_command(
            "Critical",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            priority_draft=start["priority_draft"],
        )
        assert named.get("priority_draft", {}).get("awaiting") == "hours"

        asked = resolve_chat_command(
            "4",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            priority_draft=named["priority_draft"],
        )
    create.assert_not_called()
    assert (asked.get("priority_draft") or {}).get("awaiting") == "confirm"
    assert (asked.get("priority_draft") or {}).get("displayName") == "Critical"


def test_full_create_ticket_start_navigates():
    from app.tasks.chat_commands import start_create_ticket_flow

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        out = start_create_ticket_flow(
            "create ticket",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Home",
            semantic_decision={
                "action": "START_CREATE_TICKET",
                "operation": "CREATE_TICKET",
                "fields": {},
            },
        )
    assert _has_action(out, "create_ticket")
    assert any(
        a.get("type") == "navigate" and a.get("view") == "create-ticket"
        for a in (out.get("actions") or [])
        if isinstance(a, dict)
    )


def test_full_create_team_transcript_name_description_members():
    from app.tasks.chat_commands import resolve_chat_command

    def _members_phrase(**kwargs):
        ctx = kwargs.get("context") or {}
        members = ctx.get("availableMembers") or []
        listed = ",".join(str(m) for m in members)
        return f"{kwargs.get('kind')}|{listed}|{ctx.get('nextStep') or kwargs.get('fallback')}"

    agents = {
        "success": True,
        "payload": {
            "data": [
                {"id": "u1", "name": "Jane Smith"},
                {"id": "u2", "name": "Alex Rivera"},
            ]
        },
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_members_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_members_phrase
    ), patch(
        "app.tools.catalog_tools.list_agents", return_value=agents
    ), patch(
        "app.tools.catalog_tools.create_queue",
        return_value={"success": True, "payload": {"id": "q-night"}},
    ) as created:
        start = resolve_chat_command(
            "create team",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            workflow_decision={
                "action": "START_CREATE_TEAM",
                "operation": "CREATE_TEAM",
            },
        )
        assert start.get("team_draft") == {"awaiting": "name"}

        named = resolve_chat_command(
            "Night Shift",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            team_draft=start["team_draft"],
        )
        assert named.get("team_draft", {}).get("awaiting") == "description"
        assert named.get("team_draft", {}).get("name") == "Night Shift"

        described = resolve_chat_command(
            "Handles overnight contact-center routing",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            team_draft=named["team_draft"],
        )
        assert described.get("team_draft", {}).get("awaiting") == "create_members"
        assert "overnight" in str(described.get("team_draft", {}).get("description") or "")
        assert "Jane Smith" in str(described.get("reply") or "")
        assert "Alex Rivera" in str(described.get("reply") or "")
        assert any(
            isinstance(a, dict)
            and a.get("type") == "create_team"
            and a.get("availableMembers") == ["Jane Smith", "Alex Rivera"]
            for a in (described.get("actions") or [])
        )

        assert described.get("team_draft", {}).get("available_members") == [
            "Jane Smith",
            "Alex Rivera",
        ]
        assert described.get("team_draft", {}).get("tool_memory", {}).get("list_agents", {}).get(
            "names"
        ) == ["Jane Smith", "Alex Rivera"]
        ents = described.get("team_draft", {}).get("tool_memory", {}).get("list_agents", {}).get(
            "entities"
        )
        assert {"id": "u1", "name": "Jane Smith"} in (ents or [])
        assert {"id": "u2", "name": "Alex Rivera"} in (ents or [])
        assert (described.get("workflow_data") or {}).get("tool_memory", {}).get(
            "list_agents", {}
        ).get("names") == ["Jane Smith", "Alex Rivera"]

        from app.tasks.catalog_commands import continue_team_draft

        asked = continue_team_draft(
            "skip",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name=None,
            page="Teams",
            team_draft=described["team_draft"],
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "fields": {"members": [], "members_skipped": True},
            },
        )
        created.assert_not_called()
        assert (asked.get("team_draft") or {}).get("awaiting") == "confirm"
        assert (asked.get("team_draft") or {}).get("name") == "Night Shift"


def test_full_create_macro_transcript_title_body():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        start = resolve_chat_command(
            "create macro",
            organization_id="org-1",
            user_role="agent",
            user_id="a1",
            page="Macros",
            workflow_decision={
                "action": "START_CREATE_MACRO",
                "operation": "CREATE_MACRO",
            },
        )
        assert start.get("macro_draft", {}).get("awaiting") == "title"
        assert not start.get("macro_draft", {}).get("title")
        assert start.get("macro_draft", {}).get("_intent_start_text") == "create macro"

        titled = resolve_chat_command(
            "vip greeting",
            organization_id="org-1",
            user_role="agent",
            user_id="a1",
            page="Macros",
            macro_draft=start["macro_draft"],
        )
        assert titled.get("macro_draft", {}).get("awaiting") == "body"
        assert titled.get("macro_draft", {}).get("title") == "vip greeting"

        bodied = resolve_chat_command(
            "Thanks for contacting VIP support.",
            organization_id="org-1",
            user_role="agent",
            user_id="a1",
            page="Macros",
            macro_draft=titled["macro_draft"],
        )
        assert bodied.get("macro_draft", {}).get("awaiting") == "confirm"


def test_full_create_kb_transcript_title_step():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Help"],
    ):
        start = resolve_chat_command(
            "create kb article",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Knowledge Base",
            workflow_decision={
                "action": "START_CREATE_KB",
                "operation": "CREATE_KB",
            },
        )
        assert start.get("kb_draft") == {"awaiting": "title"}

        titled = resolve_chat_command(
            "Reset VPN",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Knowledge Base",
            kb_draft=start["kb_draft"],
        )
        assert titled.get("kb_draft", {}).get("awaiting") == "category"
        assert titled.get("kb_draft", {}).get("title") == "Reset VPN"


# ---- Strict hybrid transcripts (form actions completed via chat + Express) ----


def test_strict_delete_macro_confirm_calls_express_and_refreshes(llm):
    from app.messages_compat import HumanMessage

    from app.agents.workflow_manager import (
        complete_specialist_handoff,
        workflow_manager_node,
    )

    ask_decision = {
        "action": "NORMAL_ROUTE",
        "intent": "MACRO",
        "operation": "DELETE_MACRO",
        "filters": {"query": "vip"},
        "proposed_tool": "delete_macro",
        "confidence": 0.97,
    }
    ask_state = {
        "messages": [HumanMessage(content="delete macro vip")],
        "organization_id": "00000000-0000-4000-8000-000000000001",
        "user_id": "00000000-0000-4000-8000-000000000002",
        "user_name": "Admin",
        "user_role": "admin",
        "workflow_decision": ask_decision,
        "page": "Macros",
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_macros",
        return_value={
            "success": True,
            "payload": [{"id": "m1", "title": "vip", "body": "hi"}],
        },
    ), patch(
        "app.tools.macro_write.delete_macro",
        return_value={"success": True, "payload": {}},
    ) as delete:
        ask = complete_specialist_handoff(ask_state, workflow_manager_node(ask_state))  # type: ignore[arg-type]
        pending = (ask.get("data") or {}).get("last_query", {}).get("pending_delete")
        assert pending and pending.get("id") == "m1"

        confirm_decision = {**ask_decision, "action": "CONFIRM_WORKFLOW"}
        confirm_state = {
            **ask_state,
            "messages": [HumanMessage(content="confirm")],
            "workflow_decision": confirm_decision,
            "conversation_context": {"last_query": ask["data"]["last_query"]},
        }
        done = complete_specialist_handoff(
            confirm_state, workflow_manager_node(confirm_state)  # type: ignore[arg-type]
        )
    delete.assert_called_once_with("m1")
    assert done.get("data", {}).get("_tool_name") == "delete_macro"
    assert any(a.get("type") == "refresh_macros" for a in (done.get("actions") or []))


def test_strict_delete_macro_cancel_clears_draft_no_express():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tools.macro_write.delete_macro",
    ) as delete:
        out = resolve_chat_command(
            "cancel",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Macros",
            macro_draft={"awaiting": "delete_confirm", "title": "vip", "id": "m1"},
            workflow_decision={"action": "CANCEL_WORKFLOW", "operation": "DELETE_MACRO"},
        )
    assert out.get("macro_draft") is None
    delete.assert_not_called()


def test_strict_create_ticket_cancel_and_express_failure(llm):
    from app.agents.workflow_manager import resolve_active_workflow

    def ticket_turn(text: str, draft: dict, action: str):
        return resolve_active_workflow(
            text,
            page="Home",
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
            ticket_draft=draft,
            workflow_decision={
                "action": action,
                "operation": "CREATE_TICKET",
                "fields": {},
                "values": [],
            },
        )

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        cancelled = ticket_turn(
            "cancel",
            {"awaiting": "contact", "customerName": "Ada"},
            "CANCEL_WORKFLOW",
        )
    assert cancelled.get("ticket_draft") is None

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_customers",
        return_value={
            "success": True,
            "payload": {
                "data": [
                    {
                        "id": "cust-ada",
                        "name": "Ada",
                        "email": "a@t.test",
                        "phone": "",
                    }
                ]
            },
        },
    ), patch(
        "app.tools.ticket_write.create_ticket",
        return_value={"success": False, "message": "FORBIDDEN", "payload": {}},
    ) as create:
        confirm_state = {
            "messages": [HumanMessage(content="confirm")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "user_name": "Admin",
            "page": "Home",
            "ticket_draft": {
                "awaiting": "confirm",
                "customerName": "Ada",
                "customerEmail": "a@t.test",
                "customerId": "cust-ada",
                "subject": "VPN will not connect",
                "description": "VPN will not connect",
                "issue": "VPN will not connect",
                "priority": "medium",
            },
            "current_workflow": "create_ticket",
            "current_step": "confirm",
            "workflow_decision": {
                "action": "CONFIRM_WORKFLOW",
                "operation": "NONE",
                "fields": {},
                "values": [],
            },
        }
        from app.agents.workflow_manager import complete_specialist_handoff, workflow_manager_node

        orch = workflow_manager_node(confirm_state)  # type: ignore[arg-type]
        failed = complete_specialist_handoff(confirm_state, orch)  # type: ignore[arg-type]
    create.assert_called()
    assert failed and failed.get("workflow_handled") is True
    assert (failed.get("ticket_draft") or {}).get("awaiting") == "confirm"


def test_strict_create_status_transcript():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_status",
        return_value={"success": True, "payload": {"id": "s1"}},
    ) as create:
        start = resolve_chat_command(
            "create status",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            workflow_decision={
                "action": "START_CREATE_STATUS",
                "operation": "CREATE_STATUS",
            },
        )
        start_draft = start.get("priority_draft") or {}
        assert start_draft.get("awaiting") == "name"
        assert start_draft.get("kind") == "status"
        assert start_draft.get("_intent_start_text") == "create status"
        assert not start_draft.get("displayName")
        asked = resolve_chat_command(
            "Waiting on customer",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            priority_draft=start["priority_draft"],
        )
    create.assert_not_called()
    assert (asked.get("priority_draft") or {}).get("awaiting") == "confirm"
    assert (asked.get("priority_draft") or {}).get("displayName") == "Waiting on customer"


def test_strict_delete_priority_confirm_path():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.list_priorities",
        return_value={
            "success": True,
            "payload": [{"id": "p1", "displayName": "Critical"}],
        },
    ), patch(
        "app.tools.catalog_tools.delete_priority",
        return_value={"success": True, "payload": {}},
    ) as delete:
        ask = resolve_chat_command(
            "delete priority Critical",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            workflow_decision={
                "operation": "DELETE_PRIORITY",
                "entity_name": "Critical",
            },
        )
        assert ask.get("priority_draft", {}).get("awaiting") == "delete_confirm"
        assert any(
            a.get("type") == "delete_priority" and a.get("step") == "confirm"
            for a in (ask.get("actions") or [])
            if isinstance(a, dict)
        )
        asked = resolve_chat_command(
            "confirm",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            priority_draft=ask["priority_draft"],
            workflow_decision={"action": "CONFIRM_WORKFLOW", "operation": "DELETE_PRIORITY"},
        )
    delete.assert_not_called()
    assert (asked.get("priority_draft") or {}).get("awaiting") == "delete_confirm"


def test_strict_edit_team_rename_transcript():
    from app.tasks.chat_commands import resolve_chat_command

    queues = {
        "success": True,
        "payload": {
            "data": [
                {
                    "id": "q1",
                    "queueName": "nlp",
                    "name": "nlp",
                    "description": "old",
                }
            ]
        },
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch("app.tools.catalog_tools.list_queues", return_value=queues), patch(
        "app.tools.catalog_tools.update_queue",
        return_value={"success": True, "payload": {"id": "q1"}},
    ) as upd:
        start = resolve_chat_command(
            "edit team nlp",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            workflow_decision={"operation": "UPDATE_TEAM", "entity_name": "nlp"},
        )
        assert start.get("team_draft", {}).get("awaiting") == "edit_name"

        named = resolve_chat_command(
            "NLP L2",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            team_draft=start["team_draft"],
        )
        assert named.get("team_draft", {}).get("awaiting") == "edit_description"
        assert named.get("team_draft", {}).get("new_name") == "NLP L2"

        done = resolve_chat_command(
            "skip",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            team_draft=named["team_draft"],
        )
    assert done.get("team_draft") is None
    upd.assert_called_once()
    assert upd.call_args.kwargs.get("name") == "NLP L2"
    assert any(
        a.get("type") == "refresh_teams"
        for a in (done.get("actions") or [])
        if isinstance(a, dict)
    )


def test_strict_remove_members_via_chat_command():
    from app.tasks.chat_commands import resolve_chat_command

    queues = {
        "success": True,
        "payload": {
            "data": [
                {
                    "id": "q-nlp",
                    "queueName": "nlp",
                    "name": "nlp",
                    "members": ["Deva", "Fazil"],
                }
            ]
        },
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch("app.tools.catalog_tools.list_queues", return_value=queues), patch(
        "app.tools.catalog_tools.update_queue",
        return_value={"success": True, "payload": {"id": "q-nlp"}},
    ) as upd:
        out = resolve_chat_command(
            "remove members from team nlp",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            workflow_decision={
                "operation": "REMOVE_MEMBERS",
                "entity_name": "nlp",
            },
        )
        assert out.get("team_draft", {}).get("awaiting") == "remove_names"

        done = resolve_chat_command(
            "Deva",
            organization_id="org-1",
            user_role="admin",
            user_id="u1",
            page="Teams",
            team_draft=out["team_draft"],
        )
    assert done.get("team_draft") is None
    assert upd.call_args.kwargs.get("add_members") is False
    assert "Deva" not in (upd.call_args.kwargs.get("members") or [])
    assert any(
        a.get("type") == "refresh_teams"
        for a in (done.get("actions") or [])
        if isinstance(a, dict)
    )


def test_strict_remove_members_agent_denied():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch("app.tools.catalog_tools.update_queue") as upd:
        out = resolve_chat_command(
            "remove members from team nlp",
            organization_id="org-1",
            user_role="agent",
            user_id="a1",
            page="Teams",
            workflow_decision={
                "operation": "REMOVE_MEMBERS",
                "entity_name": "nlp",
            },
        )
    assert out.get("handled") is True
    assert out.get("team_draft") is None
    upd.assert_not_called()


def test_strict_create_priority_agent_denied_no_draft():
    from app.tasks.chat_commands import resolve_chat_command

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        out = resolve_chat_command(
            "add priority",
            organization_id="org-1",
            user_role="agent",
            user_id="a1",
            workflow_decision={
                "action": "START_CREATE_PRIORITY",
                "operation": "CREATE_PRIORITY",
            },
        )
    assert not _has_action(out, "create_priority")
    assert out.get("priority_draft") in (None, {})


def test_agent_turn_maps_navigate_without_staff_json_leak():
    from app.agent_turn import chat_result_to_agent_turn

    out = chat_result_to_agent_turn(
        {
            "reply": "Opening tickets.",
            "agent": "tickets",
            "intent": "NAVIGATE",
            "actions": [
                {"type": "navigate", "view": "assigned"},
                {"type": "set_filter", "module": "tickets", "query": "", "status": "Open"},
            ],
            "data": {"workflow": None},
        }
    )
    assert "intent" not in out
    assert out["assistantText"] == "Opening tickets."
    names = [p["name"] for p in out["toolProposals"]]
    assert "set_workspace" in names
    assert "set_filter" in names


_MODULE_CONFIRM_WRITES = [
    (
        "create_ticket",
        "ticket_draft",
        {
            "awaiting": "confirm",
            "customerName": "Ada Lovelace",
            "customerEmail": "ada@example.com",
            "customerId": "cust-ada",
            "issue": "VPN will not connect",
            "subject": "VPN will not connect",
            "description": "VPN will not connect",
            "priority": "medium",
        },
        "app.tools.ticket_write.create_ticket",
        {"success": True, "payload": {"ticketNumber": "#20001"}},
        "create_ticket",
    ),
    (
        "create_team",
        "team_draft",
        {
            "awaiting": "confirm",
            "name": "NetOps",
            "description": "handles network operations",
            "members_skipped": True,
        },
        "app.tools.catalog_tools.create_queue",
        {"success": True, "payload": {"id": "q-net", "name": "NetOps"}},
        "create_queue",
    ),
    (
        "add_team_members",
        "team_draft",
        {
            "awaiting": "confirm",
            "id": "q1",
            "team": "NetOps",
            "name": "NetOps",
            "members": ["Ada"],
            "flow": "add_team_members",
        },
        "app.tools.catalog_tools.update_queue",
        {"success": True, "payload": {"id": "q1"}},
        "update_queue",
    ),
    (
        "create_customer",
        "customer_draft",
        {"awaiting": "confirm", "name": "Ada", "email": "ada@t.test", "phone": "5551234567"},
        "app.tools.catalog_tools.create_customer",
        {"success": True, "payload": {"customer": {"id": "c1", "name": "Ada"}}},
        "create_customer",
    ),
    (
        "create_kb",
        "kb_draft",
        {
            "awaiting": "confirm",
            "title": "VPN reset",
            "category": "General",
            "body": "Reset the client and retry the tunnel.",
        },
        "app.tools.catalog_tools.create_kb_article",
        {"success": True, "payload": {"id": "kb1"}},
        "create_kb_article",
    ),
    (
        "create_macro",
        "macro_draft",
        {
            "awaiting": "confirm",
            "title": "vip",
            "body": "Thanks for contacting VIP support.",
        },
        "app.tools.macro_write.create_macro",
        {"success": True, "payload": {"id": "m1"}},
        "create_macro",
    ),
    (
        "create_priority",
        "priority_draft",
        {
            "awaiting": "confirm",
            "displayName": "Critical",
            "resolutionHours": 4,
        },
        "app.tools.catalog_tools.create_priority",
        {"success": True, "payload": {"id": "p1"}},
        "create_priority",
    ),
    (
        "create_status",
        "priority_draft",
        {
            "awaiting": "confirm",
            "kind": "status",
            "displayName": "Waiting on customer",
        },
        "app.tools.catalog_tools.create_status",
        {"success": True, "payload": {"id": "s1"}},
        "create_status",
    ),
    (
        "escalate",
        "escalate_draft",
        {
            "awaiting": "confirm",
            "ticket_number": "12930",
            "assignee": "Deva",
        },
        "app.tools.ticket_write.escalate_ticket",
        {"success": True, "payload": {"ticketNumber": "#12930"}},
        "escalate_ticket",
    ),
]


@pytest.mark.parametrize(
    "workflow,draft_key,draft,patch_target,payload,tool",
    _MODULE_CONFIRM_WRITES,
    ids=[row[0] for row in _MODULE_CONFIRM_WRITES],
)
def test_every_module_confirm_write_posts_express(
    llm, workflow, draft_key, draft, patch_target, payload, tool
):
    """Confirm on every guided module: specialist bind_tools → Express write."""
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(patch_target, return_value=payload) as write:
        out = _wm_turn(
            "yeah go ahead",
            "admin",
            action="CONTINUE_WORKFLOW",
            operation="NONE",
            tool=tool,
            intent="UPDATE" if workflow == "escalate" else "CREATE",
            current_workflow=workflow,
            current_step="confirm",
            **{draft_key: draft},
        )
    write.assert_called()
    assert out.get("workflow_handled") is True
    assert out.get(draft_key) in (None, {})


def test_informal_team_confirm_writes_without_magic_word(llm):
    """Live bug: 'yehh' re-asked. Specialist meaning — no confirm-word list."""
    draft = {
        "awaiting": "confirm",
        "name": "Java",
        "description": "this team used to solve backend issue",
        "members": [
            "Mohamed Fazil",
            "raghu ram",
            "sri annamalai",
            "Yaswanth mg",
            "Deva NS",
        ],
        "members_skipped": False,
    }
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_queue",
        return_value={"success": True, "payload": {"id": "q-java", "name": "Java"}},
    ) as write:
        out = _wm_turn(
            "yehh",
            "admin",
            action="CONTINUE_WORKFLOW",
            operation="NONE",
            tool="create_queue",
            intent="CHAT",
            fields={"name": "yehh"},
            entity_name="yehh",
            current_workflow="create_team",
            current_step="confirm",
            team_draft=draft,
        )
    write.assert_called()
    assert out.get("workflow_handled") is True
    assert out.get("team_draft") in (None, {})


def test_super_agent_confirm_does_not_keyword_map():
    """Test double Super Agent must not invent CONFIRM_WORKFLOW from phrase lists."""
    import json

    from tests.helpers import AdvancedFakeLLM

    llm = AdvancedFakeLLM(route_mode="heuristic")
    for text, workflow in (
        ("yeah go ahead", "create_team"),
        ("yehh", "create_ticket"),
        ("ok publish", "create_kb"),
        ("yes", "create_macro"),
    ):
        parsed = json.loads(
            llm._workflow_decision(
                json.dumps(
                    {
                        "user_message": text,
                        "current_workflow": workflow,
                        "current_step": "confirm",
                    }
                )
            )
        )
        assert parsed["action"] == "CONTINUE_WORKFLOW", text
        assert parsed.get("values") in (None, [])
        assert not parsed.get("entity_name")


def test_confirm_refuse_does_not_write(llm):
    """Specialist skips the write when this turn is a refusal, not agreement."""
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_queue",
        return_value={"success": True, "payload": {"id": "q-x", "name": "Ops"}},
    ) as write:
        out = _wm_turn(
            "no",
            "admin",
            action="CONTINUE_WORKFLOW",
            operation="NONE",
            tool="create_queue",
            intent="CHAT",
            current_workflow="create_team",
            current_step="confirm",
            team_draft={
                "awaiting": "confirm",
                "name": "Ops",
                "description": "operations team",
                "members_skipped": True,
            },
        )
    write.assert_not_called()
    assert (out.get("team_draft") or {}).get("awaiting") == "confirm"


def test_write_schema_audit_lists_required_present_fields():
    from app.workflow_schemas import write_schema_audit

    audit = write_schema_audit(
        {
            "team_draft": {
                "awaiting": "confirm",
                "name": "Ops",
                "description": "operations team",
                "members_skipped": True,
            }
        }
    )
    assert "create_queue" in audit
    assert "missing=[]" in audit
    incomplete = write_schema_audit(
        {
            "team_draft": {
                "awaiting": "name",
                "name": "",
            }
        }
    )
    assert incomplete == ""


def test_parse_inline_gemma_kb_tool_call():
    from app.agents.base import parse_inline_tool_calls

    raw = (
        "call:kb:create_kb_article{body: 'CRM is a system for customers', "
        "category: 'General', title: 'CRM'}"
    )
    calls = parse_inline_tool_calls(raw)
    assert len(calls) == 1
    assert calls[0]["name"] == "create_kb_article"
    args = calls[0]["args"]
    assert args["title"] == "CRM"
    assert args["category"] == "General"
    assert args["content"].startswith("CRM is a system")

    queued = (
        'call:agent-queues:create_queue{description: "sales and marketing", '
        'members: ["Yaswanth mg"], name: "Sales Team"}'
    )
    q_calls = parse_inline_tool_calls(queued)
    assert len(q_calls) == 1
    assert q_calls[0]["name"] == "create_queue"
    assert q_calls[0]["args"]["name"] == "Sales Team"
    assert q_calls[0]["args"]["description"] == "sales and marketing"


def test_confirm_prose_without_tool_calls_still_creates_team(monkeypatch, fresh_memory):
    """Gemma said 'creating now' with no bind_tools payload — still POST create_queue."""
    from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db

    patch_no_db(monkeypatch)
    llm = AdvancedFakeLLM(
        route_mode="heuristic",
        skip_write_tool_calls=True,
        reply="I'm on it! Creating the python team now.",
    )
    patch_llm(monkeypatch, llm)
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_queue",
        return_value={"success": True, "payload": {"id": "q-py", "name": "python team"}},
    ) as write:
        out = _wm_turn(
            "yes",
            "admin",
            action="CONTINUE_WORKFLOW",
            operation="NONE",
            tool="create_queue",
            intent="CHAT",
            current_workflow="create_team",
            current_step="confirm",
            team_draft={
                "awaiting": "confirm",
                "name": "python team",
                "description": "this team handling all the backend services",
                "members": ["Deva NS"],
            },
        )
    write.assert_called()
    assert out.get("team_draft") in (None, {})
    assert "call:" not in (out.get("reply") or "").lower()


def test_inline_kb_call_text_executes_and_is_not_painted(monkeypatch, fresh_memory):
    from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db

    dump = (
        "call:kb:create_kb_article{body: 'CRM is a system for customers "
        "across the lifecycle.', category: 'General', title: 'CRM'}"
    )

    patch_no_db(monkeypatch)
    llm = AdvancedFakeLLM(
        route_mode="heuristic",
        skip_write_tool_calls=True,
        reply=dump,
    )
    patch_llm(monkeypatch, llm)
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tools.catalog_tools.create_kb_article",
        return_value={"success": True, "payload": {"id": "kb-1", "title": "CRM"}},
    ) as write:
        out = _wm_turn(
            "yes proceed",
            "admin",
            action="CONTINUE_WORKFLOW",
            operation="NONE",
            tool="create_kb_article",
            intent="CHAT",
            current_workflow="create_kb",
            current_step="confirm",
            kb_draft={
                "awaiting": "confirm",
                "title": "CRM",
                "category": "General",
                "body": "CRM is a system for customers across the lifecycle.",
            },
        )
    write.assert_called()
    reply = (out.get("reply") or "").lower()
    assert "call:kb:create_kb_article" not in reply
    assert out.get("kb_draft") in (None, {})

