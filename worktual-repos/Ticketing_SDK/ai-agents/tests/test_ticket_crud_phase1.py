"""Phase 1 ticket CRUD tools — Express-only mutations."""

from __future__ import annotations

from unittest.mock import patch

from app.contracts import tool_ok
from app.tools.registry import tools_for_agent
from app.tools.ticket_write import (
    add_ticket_note,
    create_ticket,
    escalate_ticket,
    update_ticket,
)
from app.tasks.chat_commands import (
    _build_add_note,
    _build_update_ticket,
)


def test_registry_includes_ticket_crud():
    allowed = tools_for_agent("tickets")
    assert "create_ticket" in allowed
    assert "update_ticket" in allowed
    assert "add_ticket_note" in allowed
    assert "escalate_ticket" in allowed


def test_update_and_note_from_super_agent_operation():
    from app.agents.workflow_manager import (
        complete_specialist_handoff,
        workflow_manager_node,
    )
    from app.messages_compat import HumanMessage

    status_decision = {
        "action": "NORMAL_ROUTE",
        "intent": "TICKET",
        "operation": "UPDATE_TICKET",
        "fields": {"ticket_number": "12940", "status": "Pending"},
        "proposed_tool": "update_ticket",
        "confidence": 0.97,
    }
    note_decision = {
        "action": "NORMAL_ROUTE",
        "intent": "TICKET",
        "operation": "UPDATE_TICKET",
        "fields": {"ticket_number": "12942", "note": "customer called back"},
        "proposed_tool": "add_ticket_note",
        "confidence": 0.97,
    }

    def _state(decision, text):
        return {
            "messages": [HumanMessage(content=text)],
            "organization_id": "00000000-0000-4000-8000-000000000001",
            "user_id": "00000000-0000-4000-8000-000000000002",
            "user_name": "Admin",
            "user_role": "admin",
            "workflow_decision": decision,
            "page": "Tickets",
        }

    with patch(
        "app.tools.ticket_write.update_ticket",
        return_value={"success": True, "payload": {"id": "12940", "status": "Pending"}},
    ) as upd, patch(
        "app.tasks.chat_commands._llm_phrase", return_value="ok"
    ):
        out = complete_specialist_handoff(
            _state(status_decision, "set ticket 12940 status to pending"),
            workflow_manager_node(_state(status_decision, "set ticket 12940 status to pending")),
        )
    assert out.get("workflow_handled") is True or out.get("handled") is True
    assert upd.called

    with patch(
        "app.tools.ticket_write.add_ticket_note",
        return_value={"success": True, "payload": {"id": "n1"}},
    ) as note, patch(
        "app.agents.tickets.specialist_llm_or_query",
        return_value=None,
    ), patch(
        "app.tasks.chat_commands._llm_phrase", return_value="ok"
    ):
        noted = complete_specialist_handoff(
            _state(note_decision, "add note to ticket 12942: customer called back"),
            workflow_manager_node(
                _state(note_decision, "add note to ticket 12942: customer called back")
            ),
        )
    assert noted.get("workflow_handled") is True or noted.get("handled") is True
    assert note.called


def test_update_ticket_tool_calls_express_put():
    called = {}

    def fake_req(method, path, **kwargs):
        called["method"] = method
        called["path"] = path
        called["body"] = kwargs.get("json_body")
        return tool_ok({"id": "#12940", "status": "Pending"})

    with patch("app.tools.ticket_write.express_request", side_effect=fake_req):
        out = update_ticket("12940", status="Pending")
    assert out["success"] is True
    assert called["method"] == "PUT"
    assert "12940" in called["path"]
    assert called["body"]["status"] == "Pending"


def test_update_ticket_omits_null_assignee_token():
    called = {}

    def fake_req(method, path, **kwargs):
        called["method"] = method
        called["path"] = path
        called["body"] = kwargs.get("json_body")
        return tool_ok({"id": "#100", "resolver": "Ashika A"})

    with patch("app.tools.ticket_write.express_request", side_effect=fake_req):
        out = update_ticket("100", assignee="null", resolver="Ashika A")
    assert out["success"] is True
    assert "assignee" not in called["body"]
    assert called["body"]["resolver"] == "Ashika A"


def test_add_note_tool_calls_express_post():
    called = {}

    def fake_req(method, path, **kwargs):
        called["method"] = method
        called["path"] = path
        called["body"] = kwargs.get("json_body")
        return tool_ok({"id": "n1", "text": "hello"})

    with patch("app.tools.ticket_write.express_request", side_effect=fake_req):
        out = add_ticket_note("12940", "hello")
    assert out["success"] is True
    assert called["method"] == "POST"
    assert called["path"].endswith("/notes")
    assert called["body"]["text"] == "hello"


def test_create_ticket_tool_calls_express_post():
    called = {}

    def fake_req(method, path, **kwargs):
        called["method"] = method
        called["path"] = path
        called["body"] = kwargs.get("json_body")
        return tool_ok({"id": "#12999", "ticketNumber": "#12999"})

    with patch("app.tools.ticket_write.express_request", side_effect=fake_req):
        out = create_ticket(
            {
                "customerId": "cust-e2e",
                "customerName": "E2E Customer",
                "customerEmail": "e2e@example.com",
                "subject": "Phase1 create",
                "description": "via tool",
            }
        )
    assert out["success"] is True
    assert called["method"] == "POST"
    assert called["path"] == "/api/tickets"
    assert called["body"]["customerId"] == "cust-e2e"


def test_build_update_ticket_uses_tool():
    called = {}

    def fake_update(tn, **kwargs):
        called["tn"] = tn
        called["kwargs"] = kwargs
        return tool_ok({"status": "Pending"})

    def _phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with (
        patch("app.tools.ticket_write.update_ticket", side_effect=fake_update),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase),
    ):
        out = _build_update_ticket(
            "org-1",
            "12940",
            status="Pending",
            user_id="u1",
            user_name="Admin",
            user_role="admin",
            user_text="set ticket 12940 to pending",
        )

    assert out["handled"] is True
    assert called.get("tn") == "12940"
    types = [a.get("type") for a in (out.get("actions") or [])]
    assert "refresh_tickets" in types


def test_build_add_note_denies_customer():
    def _phrase(**kwargs):
        return str(kwargs.get("fallback") or "ok")

    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase):
        out = _build_add_note(
            "org-1",
            "12940",
            "hello",
            user_id="c1",
            user_role="customer",
            user_text="add note",
        )
    assert out["handled"] is True
    assert out.get("actions") == []


def test_escalate_still_exported():
    assert callable(escalate_ticket)
