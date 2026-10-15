"""End-to-end monitoring mutation flow through real MCP client + monitoring server."""

from __future__ import annotations

import pytest

from app.mcp.client import MCPClient
from app.mcp.registry import get_mcp_registry
from app.schemas.copilot import ToolContext


class MonitoringE2EHTTP:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict | None]] = []
        self.callback_tasks: list[dict] = []

    async def request(
        self,
        method: str,
        path: str,
        *_args: object,
        params: dict | None = None,
        json_body: dict | None = None,
        **_kwargs: object,
    ) -> dict:
        self.requests.append((method, path, json_body))
        if method == "GET" and path == "/api/v1/monitoring/snapshot":
            return {
                "generatedAt": "2026-08-28T10:00:00Z",
                "summary": {"waiting": 1, "readyAgents": 2},
                "queues": [],
                "agents": [
                    {
                        "id": "setup-user-9",
                        "agentId": "9009",
                        "name": "Riya",
                        "presence": "ready",
                        "attendanceToday": "present",
                        "capacity": [
                            {"channel": "whatsapp", "active": 0, "reserved": 0, "max": 2},
                        ],
                        "previousConversations": [],
                    }
                ],
                "conversations": [],
                "waiting": [
                    {
                        "id": "wait-9",
                        "conversationId": "conv-9",
                        "contactId": "contact-9",
                        "customerName": "E2E Customer",
                        "channel": "whatsapp",
                        "waitingSeconds": 420,
                    }
                ],
                "missed": [],
                "callbacks": [],
                "alerts": [],
            }
        if method == "GET" and path == "/api/v1/monitoring/contacts/contact-9/callback-channels":
            return {
                "preferredChannel": "whatsapp",
                "availableChannels": ["whatsapp"],
                "source": "explicit",
            }
        if method == "POST" and path == "/api/v1/monitoring/callback-tasks":
            assert json_body is not None
            task = {
                "id": "task-e2e-9",
                "assignedUserId": json_body["assignedUserId"],
                "contactId": json_body.get("contactId"),
                "conversationId": json_body.get("conversationId"),
                "channel": json_body.get("channel"),
            }
            self.callback_tasks.append(task)
            return {"task": task}
        if method == "POST" and path == "/api/v1/monitoring/agents/9009/logout":
            return {"ok": True}
        raise AssertionError(f"Unexpected monitoring request: {method} {path}")


@pytest.mark.asyncio
async def test_monitoring_snapshot_to_callback_assign_e2e() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    http = MonitoringE2EHTTP()
    original_http = server.http
    server.http = http
    client = MCPClient(timeout_seconds=5)
    admin_context = ToolContext(tenant_id="1000", user_id="admin-1", role="admin")

    try:
        snapshot = await client.call_tool(
            "monitoring",
            "get_monitoring_snapshot",
            admin_context,
            {},
            agent_name="monitoring",
            surface="monitoring",
        )
        assert snapshot["capability"] == "monitoring.snapshot.read"
        assert snapshot["summary"]["waiting"] == 1

        channels = await client.call_tool(
            "monitoring",
            "get_contact_callback_channels",
            admin_context,
            {"contactId": "contact-9", "hintChannel": "whatsapp"},
            agent_name="monitoring",
            surface="monitoring",
        )
        assert channels["availableChannels"] == ["whatsapp"]

        assign_args = {
            "assignedUserId": "setup-user-9",
            "contactId": "contact-9",
            "conversationId": "conv-9",
            "channel": "whatsapp",
            "title": None,
            "summary": None,
            "notes": None,
            "dueAt": None,
            "priority": None,
            "assigneeName": "Riya",
            "customerName": "E2E Customer",
        }
        created = await client.call_tool(
            "monitoring",
            "create_callback_task",
            admin_context,
            assign_args,
            agent_name="monitoring",
            surface="monitoring",
        )
        assert created["capability"] == "monitoring.callback.assign"
        assert created["taskId"] == "task-e2e-9"
        assert http.callback_tasks[0]["contactId"] == "contact-9"

        logout_args = {"agentId": "9009", "agentName": "Riya"}
        logout = await client.call_tool(
            "monitoring",
            "force_agent_logout",
            admin_context,
            logout_args,
            agent_name="monitoring",
            surface="monitoring",
        )
        assert logout["capability"] == "monitoring.agent.logout"
        assert logout["ok"] is True
    finally:
        server.http = original_http

    assert ("POST", "/api/v1/monitoring/callback-tasks", {
        "assignedUserId": "setup-user-9",
        "contactId": "contact-9",
        "conversationId": "conv-9",
        "channel": "whatsapp",
    }) in [
        (method, path, body)
        for method, path, body in http.requests
        if method == "POST" and path == "/api/v1/monitoring/callback-tasks"
    ]
