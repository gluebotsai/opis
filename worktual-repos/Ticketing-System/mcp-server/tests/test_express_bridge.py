"""Unit tests for catalog → Express mapping (no live Express required)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import express_bridge as bridge

_ROOT = Path(__file__).resolve().parents[2]
_CATALOG = _ROOT / "shared" / "ticketing_tool_catalog.json"


def test_catalog_loads_and_has_core_tools():
    catalog = bridge.load_catalog()
    names = {t["name"] for t in catalog["tools"]}
    for required in (
        "list_tickets",
        "get_ticket",
        "create_ticket",
        "update_ticket",
        "escalate_ticket",
        "add_ticket_note",
        "list_queues",
        "create_queue",
        "update_queue",
        "delete_queue",
    ):
        assert required in names


def test_catalog_every_tool_has_express_mapping():
    catalog = json.loads(_CATALOG.read_text(encoding="utf-8"))
    for tool in catalog["tools"]:
        assert tool.get("name")
        assert tool.get("express", {}).get("method")
        assert tool.get("express", {}).get("path")
        assert isinstance(tool.get("input_schema"), dict)


def test_build_express_call_escalate():
    catalog = bridge.load_catalog()
    tool = next(t for t in catalog["tools"] if t["name"] == "escalate_ticket")
    method, path, body, params = bridge.build_express_call(
        tool,
        {
            "ticket_number": "12938",
            "assignee": "Ada",
            "rationale": "busy",
        },
    )
    assert method == "POST"
    assert "/escalate" in path
    assert "12938" in path or "%2312938" in path or "#12938" in path
    assert body["assignee"] == "Ada"
    assert body["rationale"] == "busy"
    assert params is None


def test_update_queue_forwards_add_members_with_member_ids_only():
    catalog = bridge.load_catalog()
    tool = next(t for t in catalog["tools"] if t["name"] == "update_queue")
    method, path, body, _params = bridge.build_express_call(
        tool,
        {
            "queue_id": "1020",
            "member_ids": ["1007"],
            "add_members": True,
        },
    )
    assert method == "PATCH"
    assert "1020" in path
    assert body["memberIds"] == ["1007"]
    assert body["addMembers"] is True


def test_call_express_tool_forwards_actor_headers():
    captured: dict = {}

    def fake_request(method, url, json=None, params=None, headers=None):
        captured["method"] = method
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        resp = MagicMock()
        resp.status_code = 200
        resp.content = b'{"ok":true}'
        resp.json.return_value = {"ok": True}
        return resp

    with (
        patch("express_bridge.tasks_secret", return_value="secret"),
        patch("express_bridge.httpx.Client") as client_cls,
    ):
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.request.side_effect = fake_request
        client_cls.return_value = client

        result = bridge.call_express_tool(
            "list_queues",
            {},
            incoming_headers={
                "X-Coworker-Actor-Id": "u1",
                "X-Coworker-Org-Id": "o1",
                "X-Coworker-Tasks-Key": "secret",
            },
        )

    assert result["success"] is True
    assert captured["method"] == "GET"
    assert captured["url"].endswith("/api/queues")
    assert captured["headers"]["X-Coworker-Actor-Id"] == "u1"
    assert captured["headers"]["X-Coworker-Org-Id"] == "o1"
    assert "_mcp_key_id" not in captured["headers"]


def test_actor_headers_without_tasks_key_rejected():
    result = bridge.call_express_tool(
        "list_queues",
        {},
        incoming_headers={
            "X-Coworker-Actor-Id": "u1",
            "X-Coworker-Org-Id": "o1",
        },
    )
    assert result["success"] is False
    assert result["error_code"] == "UNAUTHORIZED"


def test_actor_headers_with_wrong_tasks_key_rejected():
    with patch("express_bridge.tasks_secret", return_value="expected"):
        result = bridge.call_express_tool(
            "list_queues",
            {},
            incoming_headers={
                "X-Coworker-Actor-Id": "u1",
                "X-Coworker-Org-Id": "o1",
                "X-Coworker-Tasks-Key": "wrong",
            },
        )
    assert result["success"] is False
    assert result["error_code"] == "UNAUTHORIZED"


def test_call_express_tool_api_key_session():
    calls: list[tuple] = []

    def fake_request(method, url, json=None, params=None, headers=None):
        calls.append((method, url, headers))
        resp = MagicMock()
        if "/api/mcp/session" in url:
            resp.status_code = 200
            resp.content = b"{}"
            resp.json.return_value = {
                "organizationId": "org-1",
                "actorId": "user-9",
                "actorRole": "admin",
                "actorName": "Admin",
            }
            return resp
        resp.status_code = 200
        resp.content = b'[]'
        resp.json.return_value = []
        return resp

    with patch("express_bridge.httpx.Client") as client_cls:
        client = MagicMock()
        client.__enter__.return_value = client
        client.__exit__.return_value = False
        client.request.side_effect = fake_request
        client.get.side_effect = lambda url, headers=None: fake_request(
            "GET", url, headers=headers
        )
        client_cls.return_value = client

        result = bridge.call_express_tool(
            "list_queues",
            {},
            incoming_headers={"Authorization": "Bearer wt_live_test"},
        )

    assert result["success"] is True
    assert any("/api/mcp/session" in u for _, u, _ in calls)
    tool_call = next(c for c in calls if c[1].endswith("/api/queues"))
    assert tool_call[2]["X-Coworker-Actor-Id"] == "user-9"
    assert tool_call[2]["X-Coworker-Org-Id"] == "org-1"


def test_strict_every_catalog_tool_builds_express_call():
    """Every catalog tool must map to a non-coworker Express path."""
    catalog = bridge.load_catalog()
    samples = {
        "get_ticket": {"ticket_number": "12940"},
        "list_tickets": {"scope": "org", "limit": 5},
        "create_ticket": {"customerName": "Ada", "subject": "VPN"},
        "update_ticket": {"ticket_number": "12940", "status": "Open"},
        "escalate_ticket": {"ticket_number": "12940", "assignee": "Ada"},
        "add_ticket_note": {
            "ticket_number": "12940",
            "text": "hello",
            "visibility": "internal",
        },
        "list_queues": {},
        "create_queue": {"name": "NetOps"},
        "update_queue": {"queue_id": "q1", "name": "NetOps", "add_members": True},
        "delete_queue": {"queue_id": "q1"},
        "list_kb": {},
        "create_kb_article": {
            "title": "T",
            "content": "C",
            "category": "How-to",
        },
        "list_customers": {},
        "list_macros": {},
        "create_macro": {"title": "Hi", "body": "Hello"},
        "delete_macro": {"macro_id": "m1"},
        "list_agents": {},
        "list_priorities": {"include_inactive": True},
        "create_priority": {"display_name": "P1", "resolution_hours": 4},
        "delete_priority": {"priority_id": "p1"},
        "list_statuses": {},
        "create_status": {"display_name": "Waiting"},
        "delete_status": {"status_id": "s1"},
        "get_metrics": {},
        "get_analytics": {},
        "get_org_preferences": {},
        "update_org_preferences": {"ticket_prefix": "WT"},
        "list_notifications": {},
        "mark_all_notifications_read": {},
        "mark_notification_read": {"notification_id": "n1"},
    }
    for tool in catalog["tools"]:
        name = tool["name"]
        assert name in samples, f"strict sample missing for {name}"
        method, path, body, params = bridge.build_express_call(tool, samples[name])
        assert method in {"GET", "POST", "PUT", "PATCH", "DELETE"}
        assert path.startswith("/api/")
        assert not path.startswith("/api/coworker/")
        assert "{" not in path, f"unresolved path template for {name}: {path}"


def test_strict_unknown_tool_and_missing_auth():
    err = bridge.call_express_tool("not_a_real_tool", {}, incoming_headers={})
    assert err["success"] is False
    assert err["error_code"] == "UNKNOWN_TOOL"

    err2 = bridge.call_express_tool("list_queues", {}, incoming_headers={})
    assert err2["success"] is False
    assert err2["error_code"] == "NO_ACTOR"


def test_strict_mcp_server_registers_all_catalog_tools():
    import asyncio

    from server import mcp

    catalog = bridge.load_catalog()
    expected = {t["name"] for t in catalog["tools"]}

    async def _list():
        return await mcp.list_tools()

    tools = asyncio.run(_list())
    registered = {t.name for t in tools}
    assert registered == expected


def test_strict_tool_ok_err_shape_parity_with_agents():
    ok = bridge.tool_ok({"a": 1})
    err = bridge.tool_err("FORBIDDEN", "nope", http_status=403)
    assert set(ok.keys()) >= {"success", "error_code", "payload"}
    assert ok["success"] is True and ok["error_code"] is None
    assert err["success"] is False
    assert err["error_code"] == "FORBIDDEN"
    assert err["message"] == "nope"
    assert err["http_status"] == 403


def test_rate_limit_blocks_after_max():
    import server as mcp_server

    headers = {
        "X-Coworker-Actor-Id": "rate-u",
        "X-Coworker-Org-Id": "rate-o",
        "X-Coworker-Tasks-Key": "secret",
    }
    with (
        patch.object(mcp_server, "_RATE_LIMIT_MAX", 3),
        patch.object(mcp_server, "_RATE_LIMIT_WINDOW_SEC", 60.0),
    ):
        mcp_server._rate_buckets.clear()
        assert mcp_server.check_rate_limit(headers) is None
        assert mcp_server.check_rate_limit(headers) is None
        assert mcp_server.check_rate_limit(headers) is None
        blocked = mcp_server.check_rate_limit(headers)
    assert blocked is not None
    assert blocked["error_code"] == "RATE_LIMITED"
    assert blocked["http_status"] == 429


def test_main_refuses_public_bind_without_override():
    import server as mcp_server

    with (
        patch.dict(
            "os.environ",
            {"MCP_HOST": "0.0.0.0", "MCP_ALLOW_PUBLIC_BIND": ""},
            clear=False,
        ),
        patch.object(mcp_server.mcp, "run", side_effect=AssertionError("should not run")),
    ):
        try:
            mcp_server.main()
            assert False, "expected SystemExit"
        except SystemExit as exc:
            assert "public interface" in str(exc).lower() or "Refusing" in str(exc)
