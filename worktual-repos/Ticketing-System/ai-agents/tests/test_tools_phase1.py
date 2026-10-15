"""Unit tests for domain tool contracts and escalate write tool shape."""

from __future__ import annotations

import json
from unittest.mock import patch
from uuid import uuid4

from app.contracts import format_chat_response, tool_err, tool_ok
from app.tools.express_client import ToolActor, express_request, tool_actor_scope
from app.tools.registry import assert_tool_allowed, tools_for_agent
from app.tools.ticket_write import escalate_ticket


def test_tool_ok_err_shapes():
    assert tool_ok({"a": 1})["success"] is True
    err = tool_err("FORBIDDEN", "nope", http_status=403)
    assert err["success"] is False
    assert err["error_code"] == "FORBIDDEN"
    assert err["retryable"] is False
    conflict = tool_err("CONFLICT", "exists", http_status=409)
    assert conflict["retryable"] is False
    retry = tool_err("TRANSPORT", "down")
    assert retry["error_code"] == "RETRYABLE"
    assert retry["retryable"] is True


def test_large_tool_payload_stays_valid_json_with_live_rows():
    from app.tools.bound import _json_dump

    rows = [
        {"id": str(uuid4()), "description": str(uuid4()) * 20}
        for _ in range(200)
    ]
    raw = _json_dump(tool_ok({"data": rows}))
    parsed = json.loads(raw)
    assert len(raw) <= 8000
    assert parsed["success"] is True
    assert parsed["payload"]["totalRows"] == len(rows)
    assert parsed["payload"]["truncated"] is True
    assert parsed["payload"]["data"]


def test_format_chat_response():
    out = format_chat_response(
        reply="hi",
        agent="tickets",
        ui_actions=[{"type": "refresh_tickets"}],
        request_id="req_1",
    )
    assert out["schema_version"] == "1.0"
    assert out["request_id"] == "req_1"
    assert out["ui_actions"][0]["type"] == "refresh_tickets"


def test_tool_registry_tickets_allowlist():
    assert "escalate_ticket" in tools_for_agent("tickets")
    assert "update_ticket" in tools_for_agent("tickets")
    assert "add_ticket_note" in tools_for_agent("tickets")
    assert "create_ticket" in tools_for_agent("tickets")
    assert "auto_assign_ticket" in tools_for_agent("tickets")
    assert_tool_allowed("tickets", "escalate_ticket")
    try:
        assert_tool_allowed("general", "escalate_ticket")
        assert False, "expected PermissionError"
    except PermissionError:
        pass


def test_escalate_ticket_calls_express_path():
    calls = []

    def fake_request(method, path, **kwargs):
        calls.append((method, path, kwargs.get("json_body")))
        return tool_ok({"resolver": "Ann", "unchanged": False})

    with patch("app.tools.ticket_write.express_request", side_effect=fake_request):
        out = escalate_ticket(
            "12935",
            assignee_id="u1",
            assignee="Ann",
            agent_id="a1",
            agent="Agent A",
            rationale="skill",
        )
    assert out["success"] is True
    assert calls[0][0] == "POST"
    assert "/escalate" in calls[0][1]
    assert "12935" in calls[0][1]
    assert calls[0][2]["assigneeId"] == "u1"
    assert calls[0][2]["agentId"] == "a1"


def test_express_request_requires_actor():
    with tool_actor_scope(None):
        out = express_request("GET", "/api/tickets/1")
    assert out["success"] is False
    assert out["error_code"] == "FORBIDDEN"


def test_express_request_blocks_chat_recursion():
    actor = ToolActor(user_id="u1", organization_id="org1")
    with tool_actor_scope(actor):
        out = express_request("POST", "/api/coworker/chat")
    assert out["success"] is False
    assert out["error_code"] == "FORBIDDEN"


def test_mcp_transport_routes_escalate_to_call_tool():
    actor = ToolActor(user_id="u1", organization_id="org1", user_role="agent")
    with (
        patch("app.tools.transport.get_settings") as gs,
        patch("app.tools.mcp_client.call_tool") as call_tool,
        tool_actor_scope(actor),
    ):
        gs.return_value.tools_transport = "mcp"
        call_tool.return_value = tool_ok({"resolver": "Ann"})
        out = escalate_ticket("12935", assignee="Ann", assignee_id="u1")
    assert out["success"] is True
    call_tool.assert_called_once()
    name, args = call_tool.call_args[0][0], call_tool.call_args[0][1]
    assert name == "escalate_ticket"
    assert args["ticket_number"] == "12935"
    assert args["assignee"] == "Ann"


def test_mcp_client_invoke_maps_tool_ok_shape():
    from app.tools.mcp_client import call_tool

    actor = ToolActor(user_id="u1", organization_id="org1")

    class _Resp:
        status_code = 200
        content = b'{"success":true,"error_code":null,"payload":{"ok":1}}'

        def json(self):
            return {"success": True, "error_code": None, "payload": {"ok": 1}}

    with (
        patch("app.tools.mcp_client.get_settings") as gs,
        patch("app.tools.mcp_client.httpx.Client") as client_cls,
        tool_actor_scope(actor),
    ):
        gs.return_value.mcp_server_url = "http://127.0.0.1:8020"
        gs.return_value.coworker_tasks_secret = "secret"
        client = client_cls.return_value.__enter__.return_value
        client.post.return_value = _Resp()
        out = call_tool("list_queues", {})

    assert out["success"] is True
    assert out["payload"]["ok"] == 1
    client.post.assert_called_once()
    url = client.post.call_args[0][0]
    assert url.endswith("/invoke")


def test_catalog_contract_matches_registry_core_tools():
    import json
    from pathlib import Path

    catalog_path = (
        Path(__file__).resolve().parents[2] / "shared" / "ticketing_tool_catalog.json"
    )
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    names = {t["name"] for t in catalog["tools"]}
    for tool in tools_for_agent("tickets"):
        assert tool in names, f"{tool} missing from shared catalog"


# ---- Strict MCP migration contracts ----


def _catalog_names() -> set[str]:
    import json
    from pathlib import Path

    catalog_path = (
        Path(__file__).resolve().parents[2] / "shared" / "ticketing_tool_catalog.json"
    )
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    return {t["name"] for t in catalog["tools"]}


def test_strict_every_allowlisted_tool_is_in_catalog():
    """No agent may call a tool name that MCP/catalog does not expose."""
    names = _catalog_names()
    for agent, tools in (
        ("tickets", tools_for_agent("tickets")),
        ("teams", tools_for_agent("teams")),
        ("customers", tools_for_agent("customers")),
        ("kb", tools_for_agent("kb")),
        ("macros", tools_for_agent("macros")),
        ("admin", tools_for_agent("admin")),
        ("general", tools_for_agent("general")),
    ):
        missing = sorted(t for t in tools if t not in names)
        assert not missing, f"{agent} allowlist missing from catalog: {missing}"


def test_strict_mcp_transport_never_hits_express_for_domain_tools():
    """TOOLS_TRANSPORT=mcp → all domain modules call mcp_client, not express_request."""
    from app.tools import catalog_tools, macro_write, ticket_read, ticket_write

    actor = ToolActor(user_id="u1", organization_id="org1", user_role="admin")
    calls: list[tuple[str, dict]] = []

    def fake_mcp(name, arguments=None):
        calls.append((name, arguments or {}))
        return tool_ok({"echo": name})

    with (
        patch("app.tools.transport.get_settings") as gs,
        patch("app.tools.mcp_client.call_tool", side_effect=fake_mcp),
        patch("app.tools.ticket_write.express_request") as ex_tw,
        patch("app.tools.ticket_read.express_request") as ex_tr,
        patch("app.tools.catalog_tools.express_request") as ex_cat,
        patch("app.tools.macro_write.express_request") as ex_mac,
        tool_actor_scope(actor),
    ):
        gs.return_value.tools_transport = "mcp"

        assert ticket_read.list_tickets(scope="org", limit=5)["success"]
        assert ticket_read.get_ticket("12940")["success"]
        assert ticket_write.create_ticket(
            {"customerName": "Ada", "subject": "VPN"}
        )["success"]
        assert ticket_write.update_ticket("12940", status="Open")["success"]
        assert ticket_write.add_ticket_note("12940", "note")["success"]
        assert ticket_write.escalate_ticket("12940", assignee="Ada")["success"]
        assert catalog_tools.list_queues()["success"]
        assert catalog_tools.create_queue(name="NetOps")["success"]
        assert catalog_tools.update_queue("1901", name="NetOps2")["success"]
        assert catalog_tools.delete_queue("1901")["success"]
        assert catalog_tools.list_kb()["success"]
        assert catalog_tools.create_kb_article(
            title="T", content="C", category="How-to"
        )["success"]
        assert catalog_tools.list_customers()["success"]
        assert catalog_tools.list_macros()["success"]
        assert catalog_tools.list_agents()["success"]
        assert catalog_tools.list_priorities()["success"]
        assert catalog_tools.create_priority(
            display_name="P1", resolution_hours=4
        )["success"]
        assert catalog_tools.delete_priority("1901")["success"]
        assert catalog_tools.list_statuses()["success"]
        assert catalog_tools.create_status(display_name="Waiting")["success"]
        assert catalog_tools.delete_status("1902")["success"]
        assert catalog_tools.get_metrics()["success"]
        assert catalog_tools.get_analytics()["success"]
        assert catalog_tools.export_analytics(chart_range="7days")["success"]
        assert catalog_tools.get_csat_reports(chart_range="30days")["success"]
        assert catalog_tools.list_audit(limit=20, action="Escalated")["success"]
        assert catalog_tools.list_escalation_directory(skill="frontend")["success"]
        assert catalog_tools.list_widgets()["success"]
        assert catalog_tools.create_widget(name="Website Help")["success"]
        assert catalog_tools.list_integration_keys()["success"]
        assert catalog_tools.update_priority("1901", resolution_hours=6)["success"]
        assert catalog_tools.update_status("1902", active=False)["success"]
        assert catalog_tools.get_org_preferences()["success"]
        assert catalog_tools.update_org_preferences(
            ticket_prefix="WT", portal_auth_mode="otp", business_type="b2b"
        )["success"]
        assert catalog_tools.list_notifications()["success"]
        assert catalog_tools.mark_all_notifications_read()["success"]
        assert catalog_tools.mark_notification_read("n1")["success"]
        assert macro_write.create_macro(title="Hi", body="Hello")["success"]
        assert macro_write.update_macro("1903", body="Updated")["success"]
        assert macro_write.delete_macro("1903")["success"]

    assert ex_tw.call_count == 0
    assert ex_tr.call_count == 0
    assert ex_cat.call_count == 0
    assert ex_mac.call_count == 0

    called = {name for name, _ in calls}
    required = {
        "list_tickets",
        "get_ticket",
        "create_ticket",
        "update_ticket",
        "add_ticket_note",
        "escalate_ticket",
        "list_queues",
        "create_queue",
        "update_queue",
        "delete_queue",
        "list_kb",
        "create_kb_article",
        "list_customers",
        "list_macros",
        "list_agents",
        "list_priorities",
        "create_priority",
        "delete_priority",
        "list_statuses",
        "create_status",
        "delete_status",
        "get_metrics",
        "get_analytics",
        "export_analytics",
        "get_csat_reports",
        "list_audit",
        "list_escalation_directory",
        "list_widgets",
        "create_widget",
        "list_integration_keys",
        "update_priority",
        "update_status",
        "get_org_preferences",
        "update_org_preferences",
        "list_notifications",
        "mark_all_notifications_read",
        "mark_notification_read",
        "create_macro",
        "update_macro",
        "delete_macro",
    }
    missing = sorted(required - called)
    assert not missing, f"MCP transport missed tools: {missing}"
    unknown = sorted(called - _catalog_names())
    assert not unknown, f"MCP called unknown tools: {unknown}"


def test_strict_mcp_client_forwards_actor_headers_on_invoke():
    from app.tools.mcp_client import call_tool

    actor = ToolActor(
        user_id="user-42",
        organization_id="org-99",
        user_role="agent",
        user_name="Ada",
        request_id="req-7",
    )
    captured: dict = {}

    class _Resp:
        status_code = 200
        content = b'{"success":true,"error_code":null,"payload":{}}'

        def json(self):
            return {"success": True, "error_code": None, "payload": {}}

    with (
        patch("app.tools.mcp_client.get_settings") as gs,
        patch("app.tools.mcp_client.httpx.Client") as client_cls,
        tool_actor_scope(actor),
    ):
        gs.return_value.mcp_server_url = "http://mcp.test:8020"
        gs.return_value.coworker_tasks_secret = "tasks-secret"
        client = client_cls.return_value.__enter__.return_value

        def _post(url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _Resp()

        client.post.side_effect = _post
        out = call_tool("list_tickets", {"scope": "team", "limit": 5})

    assert out["success"] is True
    assert captured["url"] == "http://mcp.test:8020/invoke"
    assert captured["json"] == {
        "name": "list_tickets",
        "arguments": {"scope": "team", "limit": 5},
    }
    h = captured["headers"]
    assert h["X-Coworker-Actor-Id"] == "user-42"
    assert h["X-Coworker-Org-Id"] == "org-99"
    assert h["X-Coworker-Actor-Role"] == "agent"
    assert h["X-Coworker-Actor-Name"] == "Ada"
    assert h["X-Coworker-Tasks-Key"] == "tasks-secret"
    assert h["X-Request-Id"] == "req-7"


def test_strict_mcp_client_requires_actor_and_preserves_tool_err():
    from app.tools.mcp_client import call_tool

    with tool_actor_scope(None):
        out = call_tool("list_queues", {})
    assert out["success"] is False
    assert out["error_code"] == "FORBIDDEN"

    actor = ToolActor(user_id="u1", organization_id="org1")

    class _Resp:
        status_code = 403
        content = b'{"success":false,"error_code":"FORBIDDEN","message":"nope","payload":{}}'

        def json(self):
            return {
                "success": False,
                "error_code": "FORBIDDEN",
                "message": "nope",
                "payload": {},
            }

    with (
        patch("app.tools.mcp_client.get_settings") as gs,
        patch("app.tools.mcp_client.httpx.Client") as client_cls,
        tool_actor_scope(actor),
    ):
        gs.return_value.mcp_server_url = "http://127.0.0.1:8020"
        gs.return_value.coworker_tasks_secret = "secret"
        client_cls.return_value.__enter__.return_value.post.return_value = _Resp()
        out = call_tool("delete_queue", {"queue_id": "q1"})
    assert out["success"] is False
    assert out["error_code"] == "FORBIDDEN"
    assert out["message"] == "nope"


def test_strict_express_transport_default_still_uses_express():
    """Default transport remains express (migration flag off)."""
    from app.tools.ticket_read import list_tickets

    actor = ToolActor(user_id="u1", organization_id="org1")
    with (
        patch("app.tools.transport.get_settings") as gs,
        patch(
            "app.tools.ticket_read.express_request",
            return_value=tool_ok({"data": []}),
        ) as ex,
        patch("app.tools.mcp_client.call_tool") as mcp,
        tool_actor_scope(actor),
    ):
        gs.return_value.tools_transport = "express"
        out = list_tickets()
    assert out["success"] is True
    assert ex.call_count == 1
    assert mcp.call_count == 0

