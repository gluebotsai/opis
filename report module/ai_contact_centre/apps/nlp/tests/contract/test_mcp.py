from datetime import timedelta

import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from app.mcp.client import MCPClient
from app.mcp.context import CcCoreError
from app.mcp.registry import get_mcp_registry
from app.schemas.copilot import ToolContext


def _ready_queue_draft(**fields: object) -> dict:
    return {
        "mode": "create",
        "nextField": "review",
        "ready": True,
        "fields": {
            "staffingComplete": True,
            **fields,
        },
    }


class FakeQueueHTTP:
    def __init__(self, *, fail_agents: bool = False) -> None:
        self.create_bodies: list[dict] = []
        self.agent_bodies: list[dict] = []
        self.deleted_ids: list[str] = []
        self.get_paths: list[str] = []
        self.fail_agents = fail_agents

    async def request(
        self,
        method: str,
        path: str,
        *_args: object,
        json_body: dict | None = None,
        **_kwargs: object,
    ) -> dict:
        if method == "POST" and path == "/api/v1/setup/ccaas/queues":
            body = json_body or {}
            self.create_bodies.append(body)
            return {
                "queue": {
                    "id": "queue-1",
                    "name": body.get("name", "Billing"),
                    "status": body.get("status", "active"),
                    "createdAt": "2026-01-01T00:00:00Z",
                }
            }
        if method == "PUT" and path.endswith("/agents"):
            body = json_body or {}
            self.agent_bodies.append(body)
            if self.fail_agents:
                raise CcCoreError("agents put failed")
            return {"ok": True}
        if method == "DELETE" and path.startswith("/api/v1/setup/ccaas/queues/"):
            self.deleted_ids.append(path.rsplit("/", 1)[-1])
            return {"ok": True}
        assert method == "GET"
        self.get_paths.append(path)
        if path == "/api/v1/setup/ccaas/teams":
            return {
                "teams": [
                    {"id": "team-1", "name": "Support", "status": "active"},
                    {"id": "team-nlp", "name": "nlp", "status": "active"},
                ]
            }
        if path == "/api/v1/setup/ccaas/business-hours":
            return {
                "schedules": [
                    {
                        "id": "hours-1",
                        "name": "Standard Hours",
                        "timezone": "Asia/Kolkata",
                        "workingDays": ["Monday", "Tuesday", "Wednesday"],
                        "openTime": "09:00:00",
                        "closeTime": "18:00:00",
                        "shifts": [
                            {"shiftType": "Morning"},
                            {"shiftType": "Afternoon"},
                            {"shiftType": "Evening"},
                        ],
                    },
                    {
                        "id": "hours-support",
                        "name": "Support Hours",
                        "timezone": "Asia/Kolkata",
                        "workingDays": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
                        "openTime": "00:00:00",
                        "closeTime": "23:59:00",
                        "shifts": [
                            {"shiftType": "Regular"},
                        ],
                    },
                ]
            }
        if path == "/api/v1/setup/ccaas/eligible-agents":
            return {
                "agents": [
                    {
                        "id": "agent-1",
                        "firstName": "bharathi",
                        "lastName": "sivakumar",
                        "workEmail": "bharathi@example.com",
                        "teamId": "team-1",
                        "skills": [],
                        "shiftTypes": ["Afternoon"],
                    },
                    {
                        "id": "agent-2",
                        "firstName": "Test",
                        "lastName": "Admin",
                        "workEmail": "admin@example.com",
                        "teamId": "team-1",
                        "skills": [],
                        "shiftTypes": ["Night"],
                    },
                    {
                        "id": "agent-3",
                        "firstName": "Priya",
                        "lastName": "Kumar",
                        "workEmail": "priya@example.com",
                        "teamId": "team-1",
                        "skills": [],
                        "shiftTypes": ["Afternoon"],
                        "currentQueueId": "queue-billing",
                        "currentQueueName": "Billing",
                        "currentQueueStatus": "inactive",
                    },
                ]
            }
        raise AssertionError(f"Unexpected path: {path}")


class FakeContactHTTP:
    async def request(
        self,
        method: str,
        path: str,
        *_args: object,
        json_body: dict | None = None,
        **_kwargs: object,
    ) -> dict:
        assert method == "POST"
        assert path == "/api/v1/cdp/contacts"
        return {
            "contact": {
                "id": "contact-1",
                **(json_body or {}),
                "isActive": True,
            }
        }


class FakeTaskHTTP:
    async def request(self, method: str, path: str, *_args: object, **kwargs: object) -> dict:
        assert method == "POST"
        assert path == "/api/v1/workspace/tasks/task-1/open-workspace"
        assert kwargs.get("json_body") == {}
        return {
            "conversationId": "conversation-1",
            "conversation": {"id": "conversation-1"},
        }


class FakeTaskHTTP:
    async def request(self, method: str, path: str, *_args: object, **kwargs: object) -> dict:
        assert method == "POST"
        assert path == "/api/v1/workspace/tasks/task-1/open-workspace"
        assert kwargs.get("json_body") == {}
        return {
            "conversationId": "conversation-1",
            "conversation": {"id": "conversation-1"},
        }


class FakeMonitoringHTTP:
    async def request(
        self,
        method: str,
        path: str,
        *_args: object,
        params: dict | None = None,
        **_kwargs: object,
    ) -> dict:
        if method == "GET" and path == "/api/v1/monitoring/snapshot":
            return {
                "generatedAt": "2026-08-28T10:00:00Z",
                "summary": {"waiting": 2, "slaAtRisk": 1, "readyAgents": 3},
                "queues": [{"id": "queue-1", "name": "Support", "waiting": 2}],
                "agents": [
                    {
                        "id": "setup-user-1",
                        "agentId": "1001",
                        "name": "Bharathi",
                        "presence": "ready",
                        "attendanceToday": "present",
                        "capacity": [{"channel": "whatsapp", "active": 1, "reserved": 0, "max": 2}],
                        "previousConversations": [],
                    }
                ],
                "conversations": [],
                "waiting": [{"id": "wait-1", "customerName": "Customer", "waitingSeconds": 360}],
                "missed": [],
                "callbacks": [],
                "alerts": [],
            }
        if method == "GET" and path == "/api/v1/monitoring/agents/1001/attendance":
            return {
                "timeZone": "Asia/Kolkata",
                "day": {
                    "date": "2026-08-28",
                    "attendance": "present",
                    "hasHistory": True,
                    "durationsSeconds": {"ready": 3600},
                },
            }
        if method == "POST" and path == "/api/v1/monitoring/callback-tasks":
            json_body = _kwargs.get("json_body")
            assert isinstance(json_body, dict)
            return {
                "task": {
                    "id": "task-callback-1",
                    "assignedUserId": json_body.get("assignedUserId"),
                    "contactId": json_body.get("contactId"),
                },
            }
        if method == "POST" and path == "/api/v1/monitoring/agents/1001/logout":
            return {"ok": True}
        if method == "POST" and path == "/api/v1/monitoring/agents/1001/presence":
            json_body = _kwargs.get("json_body")
            assert isinstance(json_body, dict)
            return {"ok": True, "presence": json_body.get("presence")}
        raise AssertionError(f"Unexpected monitoring request: {method} {path} {params}")


@pytest.mark.asyncio
async def test_get_monitoring_snapshot_returns_structured_capability() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    original_http = server.http
    server.http = FakeMonitoringHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            "get_monitoring_snapshot",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {},
            agent_name="monitoring",
            surface="monitoring",
        )
    finally:
        server.http = original_http

    assert result["capability"] == "monitoring.snapshot.read"
    assert result["summary"]["waiting"] == 2
    assert result["waiting"][0]["waitingSeconds"] == 360


@pytest.mark.asyncio
async def test_monitoring_tools_denied_for_agent_role() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "monitoring",
        "get_monitoring_snapshot",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
        {},
        agent_name="monitoring",
        surface="monitoring",
    )
    assert "not allowed" in result["error"]


@pytest.mark.asyncio
async def test_create_callback_task_executes_immediately() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    original_http = server.http
    server.http = FakeMonitoringHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            "create_callback_task",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "assignedUserId": "setup-user-1",
                "contactId": "contact-1",
                "channel": "whatsapp",
                "assigneeName": "Bharathi",
                "customerName": "Customer",
            },
            agent_name="monitoring",
            surface="monitoring",
        )
    finally:
        server.http = original_http

    assert result["capability"] == "monitoring.callback.assign"
    assert result["taskId"] == "task-callback-1"


@pytest.mark.asyncio
async def test_force_agent_logout_executes_immediately() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    original_http = server.http
    server.http = FakeMonitoringHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            "force_agent_logout",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"agentId": "1001", "agentName": "Bharathi"},
            agent_name="monitoring",
            surface="monitoring",
        )
    finally:
        server.http = original_http

    assert result["capability"] == "monitoring.agent.logout"
    assert result["agentId"] == "1001"


@pytest.mark.asyncio
async def test_force_agent_logout_resolves_agent_name_from_snapshot() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    original_http = server.http
    server.http = FakeMonitoringHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            "force_agent_logout",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"agentName": "Bharathi"},
            agent_name="monitoring",
            surface="monitoring",
        )
    finally:
        server.http = original_http

    assert result["capability"] == "monitoring.agent.logout"
    assert result["agentId"] == "1001"


@pytest.mark.asyncio
async def test_force_agent_logout_rejects_invalid_agent_id() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    original_http = server.http
    server.http = FakeMonitoringHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            "force_agent_logout",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"agentId": "ccass-agent-9a9e6a2c-9f9f-4b3e-b1f6-4e3d5c7a9b2d"},
            agent_name="monitoring",
            surface="monitoring",
        )
    finally:
        server.http = original_http

    assert "error" in result
    assert "not a valid agent id" in result["error"]


@pytest.mark.asyncio
async def test_set_agent_presence_executes_immediately() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("monitoring")
    original_http = server.http
    server.http = FakeMonitoringHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            "set_agent_presence",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"agentName": "Bharathi", "presence": "not_ready"},
            agent_name="monitoring",
            surface="monitoring",
        )
    finally:
        server.http = original_http

    assert result["capability"] == "monitoring.agent.presence.set"
    assert result["agentId"] == "1001"
    assert result["presence"] == "not_ready"


@pytest.mark.asyncio
async def test_monitoring_mutations_denied_for_agent_role() -> None:
    for tool_name in ("create_callback_task", "force_agent_logout", "set_agent_presence"):
        result = await MCPClient(timeout_seconds=5).call_tool(
            "monitoring",
            tool_name,
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
            {"assignedUserId": "setup-user-1", "contactId": "contact-1", "channel": "whatsapp"}
            if tool_name == "create_callback_task"
            else {"agentId": "1001", "presence": "not_ready"}
            if tool_name == "set_agent_presence"
            else {"agentId": "1001"},
            agent_name="monitoring",
            surface="monitoring",
        )
        assert "not allowed" in result["error"]


@pytest.mark.asyncio
async def test_every_mcp_server_exposes_declared_tools() -> None:
    registry = get_mcp_registry()
    for server in registry.servers.values():
        async with create_connected_server_and_client_session(
            server.mcp,
            read_timeout_seconds=timedelta(seconds=5),
            raise_exceptions=True,
        ) as session:
            response = await session.list_tools()
        assert {tool.name for tool in response.tools} == set(server.tool_names)


@pytest.mark.asyncio
async def test_real_mcp_session_returns_skill() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "skill",
        "get_skill",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
        {"skill_id": "performance-analytics"},
        agent_name="analytics",
        surface="performance",
    )
    assert result["id"] == "performance-analytics"


@pytest.mark.asyncio
async def test_mcp_rejects_trusted_llm_arguments() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "contact",
        "list_contacts",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
        {"tenant_id": "attacker-tenant"},
        agent_name="contact",
        surface="contacts-list",
    )
    assert "Trusted context fields" in result["error"]


@pytest.mark.asyncio
async def test_mcp_allows_task_id_when_page_context_unset() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("task")
    original_http = server.http
    server.http = FakeTaskHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "task",
            "open_task_workspace",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
            {"taskId": "task-1"},
            agent_name="task",
            surface="tasks-list",
        )
    finally:
        server.http = original_http

    assert result == {
        "conversationId": "conversation-1",
        "path": "/agent/workspace?conversationId=conversation-1",
    }


@pytest.mark.asyncio
async def test_mcp_rejects_conflicting_task_id_when_page_context_set() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "task",
        "open_task_workspace",
        ToolContext(
            tenant_id="tenant-1",
            user_id="user-1",
            role="agent",
            task_id="task-1",
        ),
        {"taskId": "task-2"},
        agent_name="task",
        surface="tasks-detail",
    )
    assert "cannot be overridden" in result["error"]


@pytest.mark.asyncio
async def test_surface_and_role_allowlist_is_enforced() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "queue",
        "delete_queue",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
        {"queue_name": "Billing"},
        agent_name="queue",
        surface="queue-edit",
    )
    assert "not allowed" in result["error"]


@pytest.mark.asyncio
async def test_contact_skill_allowed_after_handoff_from_foreign_surface() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "skill",
        "update_skill_in_system",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="agent"),
        {"skill_id": "contact-identity-resolution", "mode": "append"},
        agent_name="contact",
        surface="tasks-list",
    )
    assert result.get("status") == "updated"
    assert "contact-identity-resolution" in result.get("active_skills", [])


@pytest.mark.asyncio
async def test_inbox_agent_can_search_organization_knowledge() -> None:
    registry = get_mcp_registry()
    assert registry.is_authorized(
        server_name="organization",
        tool_name="get_organization_knowledge",
        agent_name="inbox",
        surface="inbox",
        role="agent",
    )
    assert "get_organization_knowledge" in registry.allowed_tools_for("inbox", "inbox")


def test_custom_lola_can_enrich_contacts_on_customer_channels() -> None:
    registry = get_mcp_registry()
    for surface in ("webchat", "whatsapp", "instagram", "facebook", "social"):
        assert registry.is_authorized(
            server_name="contact",
            tool_name="contact_enrich",
            agent_name="custom_lola_worktual",
            surface=surface,
            role="agent",
        )


@pytest.mark.asyncio
async def test_contact_tools_allowed_after_handoff_from_performance() -> None:
    registry = get_mcp_registry()
    assert registry.is_authorized(
        server_name="contact",
        tool_name="list_contacts",
        agent_name="contact",
        surface="performance",
        role="agent",
    )
    assert registry.is_authorized(
        server_name="contact",
        tool_name="count_contacts_created",
        agent_name="contact",
        surface="performance",
        role="agent",
    )
    assert registry.is_authorized(
        server_name="skill",
        tool_name="update_skill_in_system",
        agent_name="contact",
        surface="performance",
        role="agent",
    )


@pytest.mark.asyncio
async def test_count_contacts_created_uses_inclusive_period_endpoint() -> None:
    class FakeCountHTTP:
        async def request(
            self,
            method: str,
            path: str,
            *_args: object,
            params: dict | None = None,
            **_kwargs: object,
        ) -> dict:
            assert method == "GET"
            assert path == "/api/v1/cdp/contacts/stats/created"
            assert params == {"startDate": "2026-09-14", "endDate": "2026-09-14"}
            return {"count": 17, **(params or {})}

    registry = get_mcp_registry()
    server = registry.get_server("contact")
    original_http = server.http
    server.http = FakeCountHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "contact",
            "count_contacts_created",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"startDate": "2026-09-14", "endDate": "2026-09-14"},
            agent_name="contact",
            surface="contacts-list",
        )
    finally:
        server.http = original_http

    assert result == {
        "count": 17,
        "startDate": "2026-09-14",
        "endDate": "2026-09-14",
    }


@pytest.mark.asyncio
async def test_contact_draft_keeps_frontend_payload_shape() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "contact",
        "stage_contact_draft",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
        {
            "mode": "create",
            "firstName": "Asha",
            "nextField": "primaryEmail",
            "nextQuestion": "What is the email or phone number?",
            "skippedFields": ["lastName"],
            "ready": False,
        },
        agent_name="contact",
        surface="contacts-list",
    )
    draft = result["_contact_draft"]
    assert draft == {
        "mode": "create",
        "contactId": None,
        "fields": {"firstName": "Asha"},
        "nextField": "primaryEmail",
        "nextQuestion": "What is the email or phone number?",
        "skippedFields": ["lastName"],
        "ready": False,
    }


@pytest.mark.asyncio
async def test_contact_create_draft_asks_city_after_gender() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "contact",
        "stage_contact_draft",
        ToolContext(
            tenant_id="tenant-1",
            user_id="user-1",
            role="admin",
            contact_draft={
                "mode": "create",
                "fields": {
                    "firstName": "parathaa",
                    "primaryEmail": "parthaa123@gmail.com",
                    "primaryPhone": "8478485794",
                    "secondaryPhone": "8478485794",
                    "gender": "male",
                },
                "skippedFields": ["lastName"],
                "nextField": "gender",
                "ready": False,
            },
        ),
        {
            "mode": "create",
            "gender": "male",
            "nextField": None,
            "nextQuestion": None,
            "skippedFields": ["lastName"],
            "ready": True,
        },
        agent_name="contact",
        surface="contacts-list",
    )
    draft = result["_contact_draft"]
    assert draft["nextField"] == "city"
    assert draft["ready"] is False
    assert draft["fields"]["firstName"] == "parathaa"
    assert draft["fields"]["gender"] == "male"
    assert "city" in str(draft.get("nextQuestion") or "").casefold()
    assert result.get("guidance")


@pytest.mark.asyncio
async def test_contact_create_draft_cannot_jump_to_country_before_city() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "contact",
        "stage_contact_draft",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
        {
            "mode": "create",
            "firstName": "Asha",
            "primaryEmail": "asha@example.com",
            "primaryPhone": "8478485794",
            "secondaryPhone": "8478485794",
            "gender": "male",
            "nextField": "country",
            "nextQuestion": "What country?",
            "skippedFields": ["lastName"],
            "ready": False,
        },
        agent_name="contact",
        surface="contacts-list",
    )
    draft = result["_contact_draft"]
    assert draft["nextField"] == "city"
    assert draft["ready"] is False


@pytest.mark.asyncio
async def test_contact_create_draft_asks_country_after_city_skip() -> None:
    result = await MCPClient(timeout_seconds=5).call_tool(
        "contact",
        "stage_contact_draft",
        ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
        {
            "mode": "create",
            "firstName": "Asha",
            "primaryEmail": "asha@example.com",
            "primaryPhone": "8478485794",
            "secondaryPhone": "8478485794",
            "gender": "male",
            "nextField": None,
            "skippedFields": ["lastName", "city"],
            "ready": True,
        },
        agent_name="contact",
        surface="contacts-list",
    )
    draft = result["_contact_draft"]
    assert draft["nextField"] == "country"
    assert draft["ready"] is False
    assert "country" in str(draft.get("nextQuestion") or "").casefold()


@pytest.mark.asyncio
async def test_queue_draft_keeps_frontend_payload_shape() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "Billing",
                "teamName": "Support",
                "status": "inactive",
                "nextField": "description",
                "nextQuestion": "Want to add a short description?",
                "ready": False,
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    draft = result["_queue_draft"]
    assert draft == {
        "mode": "create",
        "fields": {
            "name": "Billing",
            "teamName": "Support",
            "teamId": "team-1",
            "status": "inactive",
        },
        "nextField": "description",
        "nextQuestion": "Want to add a short description?",
        "ready": False,
    }


@pytest.mark.asyncio
async def test_queue_draft_snaps_ahead_of_missing_required_fields() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        missing_team = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "Billing",
                "staffingSkipped": True,
                "nextField": "review",
                "nextQuestion": "Create this queue now?",
            },
            agent_name="queue",
            surface="queue-create",
        )
        team_draft = missing_team["_queue_draft"]
        assert team_draft["nextField"] == "team"
        assert team_draft["ready"] is False
        assert "team" in str(team_draft.get("nextQuestion") or "").casefold()
        assert team_draft.get("choicesLabel") == "Available teams"

        missing_hours = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "Billing",
                "teamName": "Support",
                "status": "inactive",
                "staffingSkipped": True,
                "nextField": "review",
            },
            agent_name="queue",
            surface="queue-create",
        )
        hours_draft = missing_hours["_queue_draft"]
        assert hours_draft["nextField"] == "businessHours"
        assert hours_draft["ready"] is False
        assert hours_draft.get("choicesLabel") == "Available schedules"

        ready = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "Billing",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursSkipped": True,
                "shiftTypes": ["Regular"],
                "staffingSkipped": True,
                "nextField": "staffing",
            },
            agent_name="queue",
            surface="queue-create",
        )
        ready_draft = ready["_queue_draft"]
        assert ready_draft["nextField"] == "review"
        assert ready_draft["ready"] is True
    finally:
        server.http = original_http


@pytest.mark.asyncio
async def test_queue_draft_normalizes_status_typos() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "tes",
                "teamName": "nlp",
                "description": "test",
                "status": "acitve",
                "nextField": "businessHours",
                "nextQuestion": "Which business hours schedule should we use?",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    draft = result["_queue_draft"]
    assert draft["fields"]["status"] == "active"
    assert draft["nextField"] == "businessHours"


@pytest.mark.asyncio
async def test_queue_draft_keeps_status_when_model_does_not_advance() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "sales queue",
                "teamName": "Support",
                "status": "active",
                "nextField": "status",
                "nextQuestion": "What should the status of this queue be?",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    draft = result["_queue_draft"]
    assert draft["fields"]["status"] == "active"
    assert draft["nextField"] == "businessHours"
    assert draft["choicesLabel"] == "Available schedules"


@pytest.mark.asyncio
async def test_queue_draft_keeps_staged_status_when_model_omits_it() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft={
                    "mode": "create",
                    "fields": {
                        "name": "sales queue",
                        "teamName": "Support",
                        "teamId": "team-1",
                        "status": "active",
                    },
                    "nextField": "status",
                },
            ),
            {
                "mode": "create",
                "name": "sales queue",
                "teamName": "Support",
                "nextField": "status",
                "nextQuestion": "What should the status of this queue be?",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    draft = result["_queue_draft"]
    assert draft["fields"]["status"] == "active"
    assert draft["nextField"] == "businessHours"
    assert draft["choicesLabel"] == "Available schedules"


@pytest.mark.asyncio
async def test_queue_draft_includes_team_choices() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "Billing",
                "nextField": "team",
                "nextQuestion": "Which team should own Billing?",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    draft = result["_queue_draft"]
    assert draft["choicesLabel"] == "Available teams"
    assert "Support" in draft["choices"][0]
    assert "nlp" in draft["choices"][1]


@pytest.mark.asyncio
async def test_queue_draft_resolves_shift_assignments_and_agent_choices() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "test_queue",
                "teamName": "Support",
                "teamId": "team-1",
                "status": "inactive",
                "businessHoursSkipped": True,
                "shiftTypes": ["Regular", "Morning", "Afternoon", "Night"],
                "currentShift": "Afternoon",
                "nextField": "shiftAgents",
                "nextQuestion": "Who should cover Afternoon?",
                "shiftAgentAssignments": {
                    "Afternoon": {
                        "agents": [{"name": "bharathi sivakumar", "channels": ["email", "chat"]}],
                    },
                    "Night": {
                        "agentNames": ["Test Admin"],
                        "agentIds": [],
                    },
                },
            },
            agent_name="queue",
            surface="queue-create",
        )
        draft = result["_queue_draft"]
        assignments = draft["fields"]["shiftAgentAssignments"]
        assert assignments["Afternoon"]["agentIds"] == ["agent-1"]
        assert assignments["Afternoon"]["agentNames"] == ["bharathi sivakumar"]
        assert assignments["Afternoon"]["channelByAgentId"]["agent-1"] == ["email", "chat"]
        assert assignments["Night"]["agentIds"] == ["agent-2"]
        assert draft["nextField"] == "staffing"
        assert "channelChoices" not in draft
        assert "staffingActions" not in draft
        form = draft["staffingForm"]
        assert form["shiftTypes"] == ["Regular", "Morning", "Afternoon", "Night"]
        assert {item["name"] for item in form["elsewhere"]} == {"Priya Kumar"}
        assert {item["name"] for item in form["available"]} == {"bharathi sivakumar", "Test Admin"}

        channels = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "test_queue",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursSkipped": True,
                "shiftTypes": ["Regular", "Morning", "Afternoon", "Night"],
                "currentShift": "Afternoon",
                "currentAgentName": "bharathi sivakumar",
                "currentAgentId": "agent-1",
                "nextField": "agentChannels",
            },
            agent_name="queue",
            surface="queue-create",
        )
        assert "channelChoices" not in channels["_queue_draft"]
        assert channels["_queue_draft"]["nextField"] == "staffing"
        assert channels["_queue_draft"]["staffingForm"]["shiftTypes"]

        another = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "test_queue",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursSkipped": True,
                "shiftTypes": ["Afternoon", "Evening", "Night"],
                "currentShift": "Afternoon",
                "nextField": "addAnotherAgent",
            },
            agent_name="queue",
            surface="queue-create",
        )
        assert "staffingActions" not in another["_queue_draft"]
        assert another["_queue_draft"]["nextField"] == "staffing"
        assert another["_queue_draft"]["staffingForm"]["shiftTypes"] == [
            "Afternoon",
            "Evening",
            "Night",
        ]
    finally:
        server.http = original_http


@pytest.mark.asyncio
async def test_queue_draft_asks_business_hours_before_shifts() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        jumped = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "marketing",
                "teamName": "Support",
                "status": "inactive",
                "nextField": "shifts",
                "nextQuestion": "Which shifts should this queue cover?",
            },
            agent_name="queue",
            surface="queue-create",
        )
        draft = jumped["_queue_draft"]
        assert draft["nextField"] == "businessHours"
        assert draft["choicesLabel"] == "Available schedules"
        assert any("Support Hours" in choice for choice in draft["choices"])
        assert jumped["guidance"]

        listed = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "list_business_hours",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {},
            agent_name="queue",
            surface="queue-create",
        )
        support = next(item for item in listed["schedules"] if item["name"] == "Support Hours")
        assert support["shiftTypes"] == ["Regular"]
    finally:
        server.http = original_http


@pytest.mark.asyncio
async def test_queue_draft_uses_schedule_shifts_not_generic_catalog() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "marketing",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursName": "Support Hours",
                "nextField": "shifts",
                "nextQuestion": "Which shifts should this queue cover? Regular, Morning, Afternoon, Evening, Night, or Custom.",
            },
            agent_name="queue",
            surface="queue-create",
        )
        draft = result["_queue_draft"]
        assert draft["fields"]["businessHoursName"] == "Support Hours"
        assert draft["fields"]["shiftTypes"] == ["Regular"]
        assert draft["nextField"] == "staffing"
        assert "channelChoices" not in draft
        assert "staffingActions" not in draft
        assert draft["staffingForm"]["shiftTypes"] == ["Regular"]
        assert "Regular" in result["guidance"]

        skipped = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "marketing",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursSkipped": True,
                "nextField": "shifts",
                "nextQuestion": "Which shifts should this queue cover?",
            },
            agent_name="queue",
            surface="queue-create",
        )
        assert skipped["_queue_draft"]["nextField"] == "shifts"
        assert skipped["_queue_draft"]["choices"] == [
            "Regular",
            "Morning",
            "Afternoon",
            "Evening",
            "Night",
            "Custom",
        ]

        staff = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "mode": "create",
                "name": "marketing",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursName": "Support Hours",
                "shiftTypes": ["Morning", "Afternoon", "Night"],
                "currentShift": "Afternoon",
                "nextField": "shiftAgents",
                "nextQuestion": "Who should cover Afternoon?",
            },
            agent_name="queue",
            surface="queue-create",
        )
        staff_draft = staff["_queue_draft"]
        assert staff_draft["fields"]["shiftTypes"] == ["Regular"]
        assert staff_draft["fields"]["currentShift"] == "Regular"
        assert staff_draft["nextField"] == "staffing"
        assert "channelChoices" not in staff_draft
        assert staff_draft["staffingForm"]["shiftTypes"] == ["Regular"]
    finally:
        server.http = original_http


@pytest.mark.asyncio
async def test_create_queue_executes_immediately() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    ready_draft = _ready_queue_draft(
        name="Billing",
        teamName="Support",
        status="active",
        description="Billing questions",
        staffingSkipped=True,
    )
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=ready_draft,
                queue_draft_at_turn_start=ready_draft,
            ),
            {
                "name": "Billing",
                "teamName": "Support",
                "status": "active",
                "description": "Billing questions",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert "_confirmation_required" not in result
    assert result["name"] == "Billing"
    assert result["teamName"] == "Support"
    assert result["status"] == "active"
    assert result["id"] == "queue-1"


@pytest.mark.asyncio
async def test_create_queue_returns_already_created_when_draft_is_persisted() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeQueueHTTP()
    server.http = fake
    ready_draft = _ready_queue_draft(
        name="Billing",
        teamName="Support",
        status="active",
        persistedQueueId="queue-1",
    )
    ready_draft["persistedQueueId"] = "queue-1"
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=ready_draft,
                queue_draft_at_turn_start=ready_draft,
            ),
            {"name": "Billing", "teamName": "Support"},
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert result["alreadyCreated"] is True
    assert result["id"] == "queue-1"
    assert fake.create_bodies == []


@pytest.mark.asyncio
async def test_create_queue_persists_hours_and_shift_assignments() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeQueueHTTP()
    server.http = fake
    ready_draft = _ready_queue_draft(
        name="Hours Flow Test",
        teamName="Support",
        status="inactive",
        businessHoursName="Support Hours",
    )
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=ready_draft,
                queue_draft_at_turn_start=ready_draft,
            ),
            {
                "name": "Hours Flow Test",
                "teamName": "Support",
                "status": "inactive",
                "businessHoursName": "Support Hours",
                "shiftAgentAssignments": {
                    "Regular": {
                        "agents": [
                            {
                                "name": "Test Admin",
                                "channels": ["email", "chat", "calls"],
                            }
                        ],
                    }
                },
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert result["businessHoursName"] == "Support Hours"
    assert result["businessHoursId"] == "hours-support"
    assert result["shiftTypes"] == ["Regular"]
    assert result["agentCount"] == 1
    assert fake.create_bodies[0]["businessHoursId"] == "hours-support"
    assert fake.create_bodies[0]["shiftTypes"] == ["Regular"]
    assert fake.agent_bodies[0]["agents"][0]["userId"] == "agent-2"
    assert fake.agent_bodies[0]["agents"][0]["shiftType"] == "Regular"
    assert fake.agent_bodies[0]["agents"][0]["handlesEmail"] is True
    assert fake.agent_bodies[0]["agents"][0]["handlesChat"] is True
    assert fake.agent_bodies[0]["agents"][0]["handlesCalls"] is True


@pytest.mark.asyncio
async def test_create_queue_uses_staged_draft_when_llm_omits_assignments() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeQueueHTTP()
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft={
                    "mode": "create",
                    "nextField": "review",
                    "ready": True,
                    "fields": {
                        "name": "Hours Flow Test",
                        "teamName": "Support",
                        "status": "inactive",
                        "businessHoursName": "Support Hours",
                        "shiftTypes": ["Regular"],
                        "staffingComplete": True,
                        "shiftAgentAssignments": {
                            "Regular": {
                                "agentIds": ["agent-2"],
                                "agentNames": ["Test Admin"],
                                "channelByAgentId": {
                                    "agent-2": ["email", "chat", "whatsapp"],
                                },
                            }
                        },
                    },
                },
                queue_draft_at_turn_start={
                    "mode": "create",
                    "nextField": "review",
                    "ready": True,
                    "fields": {
                        "name": "Hours Flow Test",
                        "teamName": "Support",
                        "status": "inactive",
                        "businessHoursName": "Support Hours",
                        "shiftTypes": ["Regular"],
                        "staffingComplete": True,
                        "shiftAgentAssignments": {
                            "Regular": {
                                "agentIds": ["agent-2"],
                                "agentNames": ["Test Admin"],
                                "channelByAgentId": {
                                    "agent-2": ["email", "chat", "whatsapp"],
                                },
                            }
                        },
                    },
                },
            ),
            {
                "name": "Hours Flow Test",
                "teamName": "Support",
                "status": "inactive",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert result["businessHoursName"] == "Support Hours"
    assert result["agentCount"] == 1
    assert fake.create_bodies[0]["businessHoursId"] == "hours-support"
    assert fake.agent_bodies[0]["agents"][0]["userId"] == "agent-2"
    assert fake.agent_bodies[0]["agents"][0]["handlesWhatsapp"] is True


@pytest.mark.asyncio
async def test_queue_draft_coerces_legacy_staffing_fields() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    try:
        for next_field in ("staffingMode", "shiftAgents", "agentChannels", "addAnotherAgent"):
            result = await MCPClient(timeout_seconds=5).call_tool(
                "queue",
                "stage_queue_draft",
                ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
                {
                    "mode": "create",
                    "name": "marketing",
                    "teamName": "Support",
                    "status": "inactive",
                    "businessHoursName": "Support Hours",
                    "nextField": next_field,
                },
                agent_name="queue",
                surface="queue-create",
            )
            draft = result["_queue_draft"]
            assert draft["nextField"] == "staffing"
            assert "channelChoices" not in draft
            assert "staffingActions" not in draft
            assert draft["staffingForm"]["shiftTypes"] == ["Regular"]
    finally:
        server.http = original_http


@pytest.mark.asyncio
async def test_queue_draft_keeps_assignments_on_partial_restage() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    server.http = FakeQueueHTTP()
    staged = {
        "mode": "create",
        "nextField": "staffing",
        "fields": {
            "name": "Hours Flow Test",
            "teamName": "Support",
            "teamId": "team-1",
            "status": "inactive",
            "businessHoursName": "Support Hours",
            "businessHoursId": "hours-support",
            "shiftTypes": ["Regular"],
            "shiftAgentAssignments": {
                "Regular": {
                    "agentIds": ["agent-2"],
                    "agentNames": ["Test Admin"],
                    "channelByAgentId": {"agent-2": ["email", "chat"]},
                }
            },
        },
    }
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "stage_queue_draft",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=staged,
            ),
            {
                "mode": "create",
                "name": "Hours Flow Test",
                "teamName": "Support",
                "status": "inactive",
                "nextField": "review",
                "shiftAgentAssignments": {},
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assignments = result["_queue_draft"]["fields"]["shiftAgentAssignments"]
    assert assignments["Regular"]["agentIds"] == ["agent-2"]
    assert assignments["Regular"]["agentNames"] == ["Test Admin"]


@pytest.mark.asyncio
async def test_create_queue_uses_numeric_agent_ids_without_lookup() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeQueueHTTP()
    server.http = fake
    ready_draft = _ready_queue_draft(
        name="sales queue",
        teamName="Support",
        teamId="1000",
        status="active",
        businessHoursId="1000",
        businessHoursName="Support Hours",
        shiftTypes=["Morning"],
        shiftAgentAssignments={
            "Morning": {
                "agentIds": ["1001"],
                "agentNames": ["Bharathi S"],
                "channelByAgentId": {"1001": ["calls", "chat", "whatsapp"]},
            },
            "Night": {
                "agentIds": [],
                "agentNames": [],
                "channelByAgentId": {},
            },
        },
    )
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=ready_draft,
                queue_draft_at_turn_start=ready_draft,
            ),
            {"name": "sales queue", "teamName": "Support"},
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert result["name"] == "sales queue"
    assert fake.create_bodies[0]["teamId"] == "1000"
    assert fake.create_bodies[0]["businessHoursId"] == "1000"
    assert fake.create_bodies[0]["status"] == "active"
    assert fake.agent_bodies[0]["agents"][0]["userId"] == "1001"
    assert fake.agent_bodies[0]["agents"][0]["handlesWhatsapp"] is True
    assert fake.get_paths == []


@pytest.mark.asyncio
async def test_create_queue_skips_lookups_when_ids_are_already_staged() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http

    class ExplodingLookupHTTP(FakeQueueHTTP):
        async def request(self, method: str, path: str, *args: object, **kwargs: object) -> dict:
            if method == "GET":
                raise CcCoreError(f"lookup should be skipped: {path}")
            return await super().request(method, path, *args, **kwargs)

    fake = ExplodingLookupHTTP()
    server.http = fake
    ready_draft = _ready_queue_draft(
        name="sales queue",
        teamName="Sales Team",
        teamId="1000",
        status="active",
        businessHoursId="1000",
        businessHoursName="Support Hours",
        shiftTypes=["Morning", "Night"],
        shiftAgentAssignments={
            "Morning": {
                "agentIds": ["1001"],
                "agentNames": ["Bharathi s"],
                "channelByAgentId": {
                    "1001": ["calls", "chat", "whatsapp"],
                    "Bharathi s": ["calls", "chat", "whatsapp"],
                },
            }
        },
    )
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=ready_draft,
                queue_draft_at_turn_start=ready_draft,
            ),
            {"name": "sales queue", "teamName": "Sales Team"},
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert result["name"] == "sales queue"
    assert result["agentCount"] == 1
    assert fake.create_bodies[0]["teamId"] == "1000"
    assert fake.create_bodies[0]["shiftTypes"] == ["Morning", "Night"]
    assert fake.agent_bodies[0]["agents"][0]["handlesCalls"] is True
    assert fake.agent_bodies[0]["agents"][0]["handlesChat"] is True
    assert fake.agent_bodies[0]["agents"][0]["handlesWhatsapp"] is True


@pytest.mark.asyncio
async def test_create_queue_refuses_when_turn_start_draft_is_not_ready() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeQueueHTTP()
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft={
                    "mode": "create",
                    "nextField": "staffing",
                    "fields": {
                        "name": "Billing",
                        "teamName": "Support",
                        "status": "inactive",
                    },
                },
                queue_draft_at_turn_start={
                    "mode": "create",
                    "nextField": "staffing",
                    "fields": {
                        "name": "Billing",
                        "teamName": "Support",
                        "status": "inactive",
                    },
                },
            ),
            {"name": "Billing", "teamName": "Support"},
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert "not ready" in str(result["error"]).lower()
    assert fake.create_bodies == []


@pytest.mark.asyncio
async def test_create_queue_deletes_queue_when_agents_put_fails() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeQueueHTTP(fail_agents=True)
    server.http = fake
    ready_draft = _ready_queue_draft(
        name="Hours Flow Test",
        teamName="Support",
        status="inactive",
        businessHoursName="Support Hours",
        shiftAgentAssignments={
            "Regular": {
                "agentIds": ["agent-2"],
                "agentNames": ["Test Admin"],
                "channelByAgentId": {"agent-2": ["email"]},
            }
        },
    )
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "create_queue",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                queue_draft=ready_draft,
                queue_draft_at_turn_start=ready_draft,
            ),
            {
                "name": "Hours Flow Test",
                "teamName": "Support",
                "status": "inactive",
            },
            agent_name="queue",
            surface="queue-create",
        )
    finally:
        server.http = original_http

    assert "not published" in str(result["error"]).lower()
    assert fake.create_bodies
    assert fake.agent_bodies
    assert fake.deleted_ids == ["queue-1"]


def _assigned_agent(user_id: str, shift: str = "Morning") -> dict:
    return {
        "userId": user_id,
        "shiftType": shift,
        "handlesCalls": True,
        "handlesEmail": False,
        "handlesChat": True,
        "handlesWhatsapp": True,
        "handlesInstagram": False,
        "handlesFacebook": False,
        "chatConcurrency": 1,
        "emailConcurrency": 1,
        "socialConcurrency": 1,
        "whatsappConcurrency": 1,
        "instagramConcurrency": 1,
        "facebookConcurrency": 1,
        "callType": "both",
    }


class FakeUpdateQueueHTTP(FakeQueueHTTP):
    def __init__(self, queues: list[dict]) -> None:
        super().__init__()
        self.queues = [dict(queue) for queue in queues]
        self.patch_bodies: list[tuple[str, dict]] = []

    def _queue(self, queue_id: str) -> dict:
        for queue in self.queues:
            if str(queue["id"]) == queue_id:
                return queue
        raise AssertionError(f"missing queue {queue_id}")

    async def request(
        self,
        method: str,
        path: str,
        *_args: object,
        json_body: dict | None = None,
        **_kwargs: object,
    ) -> dict:
        if method == "GET" and path == "/api/v1/setup/ccaas/queues":
            return {"queues": self.queues}
        if method == "GET" and path.startswith("/api/v1/setup/ccaas/queues/"):
            return {"queue": self._queue(path.rsplit("/", 1)[-1])}
        if method == "PATCH" and "/queues/" in path:
            queue_id = path.rsplit("/", 1)[-1]
            body = json_body or {}
            self.patch_bodies.append((queue_id, body))
            queue = self._queue(queue_id)
            queue.update(body)
            return {"queue": queue}
        if method == "PUT" and path.endswith("/agents"):
            queue_id = path.rsplit("/", 2)[-2]
            body = json_body or {}
            self.agent_bodies.append(body)
            self._queue(queue_id)["agents"] = list(body.get("agents") or [])
            return {"ok": True}
        return await super().request(method, path, *_args, json_body=json_body, **_kwargs)


def _duplicate_sales_queues() -> list[dict]:
    return [
        {
            "id": "old-sales",
            "name": "sales queue",
            "status": "active",
            "teamId": "team-1",
            "updatedAt": "2026-09-01T00:00:00Z",
            "agents": [],
        },
        {
            "id": "new-sales",
            "name": "sales queue",
            "status": "active",
            "teamId": "team-1",
            "updatedAt": "2026-09-07T00:00:00Z",
            "agents": [_assigned_agent("agent-1"), _assigned_agent("agent-2")],
        },
    ]


@pytest.mark.asyncio
async def test_update_queue_status_targets_latest_duplicate_name() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_duplicate_sales_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue_status",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"queueName": "sales queue", "status": "inactive"},
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert result["id"] == "new-sales"
    assert result["status"] == "inactive"
    assert fake.patch_bodies == [("new-sales", {"status": "inactive"})]


@pytest.mark.asyncio
async def test_update_queue_sets_inactive_and_removes_named_agent() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_duplicate_sales_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "queueName": "sales queue",
                "status": "inactive",
                "removeAgentNames": ["bharathi"],
            },
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert result["id"] == "new-sales"
    assert result["status"] == "inactive"
    assert result["removedAgents"] == ["bharathi sivakumar"]
    assert result["remainingAgents"] == ["Test Admin"]
    assert result["agentCount"] == 1
    assert fake.patch_bodies == [("new-sales", {"status": "inactive"})]
    assert [agent["userId"] for agent in fake.agent_bodies[0]["agents"]] == ["agent-2"]


@pytest.mark.asyncio
async def test_update_queue_errors_when_agent_is_not_assigned() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_duplicate_sales_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"queueName": "sales queue", "removeAgentNames": ["Priya Kumar"]},
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert "not assigned" in str(result["error"]).lower()
    assert fake.patch_bodies == []
    assert fake.agent_bodies == []


@pytest.mark.asyncio
async def test_update_queue_adds_agent_and_changes_capacity() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_duplicate_sales_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "queueName": "sales queue",
                "addAgents": [{"name": "Priya Kumar", "shiftType": "Morning", "channels": ["chat"]}],
                "agentUpdates": [{"name": "Test Admin", "chatConcurrency": 4}],
            },
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert result["addedAgents"] == ["Priya Kumar"]
    assert result["updatedAgents"] == ["Test Admin"]
    assert result["agentCount"] == 3
    saved = {agent["userId"]: agent for agent in fake.agent_bodies[0]["agents"]}
    assert saved["agent-3"]["handlesChat"] is True
    assert saved["agent-3"]["shiftType"] == "Morning"
    assert saved["agent-2"]["chatConcurrency"] == 4


def _support_shift_queues() -> list[dict]:
    queues = _duplicate_sales_queues()
    queues[1]["shiftTypes"] = ["Evening", "Morning", "Night"]
    return queues


@pytest.mark.asyncio
async def test_update_queue_does_not_default_a_missing_shift() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_support_shift_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"queueName": "sales queue", "addAgents": [{"name": "Priya Kumar"}]},
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert "choose a shift" in str(result["error"]).lower()
    assert "Evening, Morning, Night" in str(result["error"])
    assert fake.agent_bodies == []


@pytest.mark.asyncio
async def test_update_queue_rejects_a_shift_the_queue_does_not_have() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_support_shift_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "queueName": "sales queue",
                "addAgents": [{"name": "Priya Kumar", "shiftType": "Regular"}],
            },
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert "not a shift" in str(result["error"]).lower()
    assert "Regular" in str(result["error"])
    assert fake.agent_bodies == []


@pytest.mark.asyncio
async def test_update_queue_changes_settings_without_touching_agents() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_duplicate_sales_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "update_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {
                "queueName": "sales queue",
                "newName": "Enterprise Sales",
                "description": "Outbound enterprise",
                "skills": ["english"],
                "missedCallbackGraceMinutes": 10,
            },
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert result["name"] == "Enterprise Sales"
    assert fake.patch_bodies[0][0] == "new-sales"
    assert fake.patch_bodies[0][1]["name"] == "Enterprise Sales"
    assert fake.patch_bodies[0][1]["skills"] == ["english"]
    assert fake.patch_bodies[0][1]["missedCallbackGraceMinutes"] == 10
    assert fake.agent_bodies == []


@pytest.mark.asyncio
async def test_delete_queue_persists_and_marks_deleted() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("queue")
    original_http = server.http
    fake = FakeUpdateQueueHTTP(_duplicate_sales_queues())
    server.http = fake
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "queue",
            "delete_queue",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"queueName": "sales queue"},
            agent_name="queue",
            surface="queues-list",
        )
    finally:
        server.http = original_http

    assert result["id"] == "new-sales"
    assert result["name"] == "sales queue"
    assert result["deleted"] is True
    assert fake.deleted_ids == ["new-sales"]


def test_cc_core_headers_omit_json_content_type_without_body() -> None:
    from app.mcp.context import CcCoreHTTPAdapter

    adapter = CcCoreHTTPAdapter()
    context = ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin")
    without_body = adapter._headers(context, False, has_json_body=False)
    with_body = adapter._headers(context, False, has_json_body=True)
    assert "content-type" not in without_body
    assert with_body["content-type"] == "application/json"


@pytest.mark.asyncio
async def test_natural_language_contact_confirmation_executes_without_ui_confirmation() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("contact")
    original_http = server.http
    server.http = FakeContactHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "contact",
            "create_contact",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"firstName": "Asha", "primaryEmail": "asha@example.com"},
            agent_name="contact",
            surface="contacts-list",
        )
    finally:
        server.http = original_http

    assert "_confirmation_required" not in result
    assert result["contact"]["id"] == "contact-1"


@pytest.mark.asyncio
async def test_update_contact_applies_staged_draft_when_fields_omitted() -> None:
    class FakeContactUpdateHTTP:
        def __init__(self) -> None:
            self.patch: dict | None = None

        async def request(
            self,
            method: str,
            path: str,
            *_args: object,
            json_body: dict | None = None,
            **_kwargs: object,
        ) -> dict:
            if method == "GET":
                assert path == "/api/v1/cdp/contacts/sanju-1"
                return {
                    "contact": {
                        "id": "sanju-1",
                        "firstName": "Sanju",
                        "primaryEmail": "sanju@worktual.local",
                        "isActive": True,
                    }
                }
            assert method == "PATCH"
            assert path == "/api/v1/cdp/contacts/sanju-1"
            self.patch = json_body
            return {
                "contact": {
                    "id": "sanju-1",
                    "firstName": "Sanju",
                    **(json_body or {}),
                    "isActive": True,
                }
            }

    registry = get_mcp_registry()
    server = registry.get_server("contact")
    original_http = server.http
    fake_http = FakeContactUpdateHTTP()
    server.http = fake_http
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "contact",
            "update_contact",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                contact_id="sanju-1",
                contact_draft={
                    "mode": "update",
                    "contactId": "sanju-1",
                    "ready": True,
                    "fields": {
                        "lastName": "Ravi",
                        "company": "Worktual",
                        "city": "Chennai",
                    },
                },
                contact_draft_at_turn_start={
                    "mode": "update",
                    "contactId": "sanju-1",
                    "ready": True,
                    "fields": {
                        "lastName": "Ravi",
                        "company": "Worktual",
                        "city": "Chennai",
                    },
                },
            ),
            {"contactId": "sanju-1"},
            agent_name="contact",
            surface="contacts-detail",
        )
    finally:
        server.http = original_http

    assert fake_http.patch == {
        "lastName": "Ravi",
        "company": "Worktual",
        "city": "Chennai",
    }
    assert result["contact"]["lastName"] == "Ravi"
    assert result["changes"] == ["lastName", "company", "city"]


@pytest.mark.asyncio
async def test_update_contact_drops_equivalent_phone_prefix() -> None:
    class FakeContactPhoneHTTP:
        def __init__(self) -> None:
            self.patch: dict | None = None

        async def request(
            self,
            method: str,
            path: str,
            *_args: object,
            json_body: dict | None = None,
            **_kwargs: object,
        ) -> dict:
            if method == "GET":
                return {
                    "contact": {
                        "id": "kavya-1",
                        "firstName": "Kavya",
                        "lastName": "Flowtest",
                        "primaryPhone": "9007788990",
                        "city": "Chennai",
                        "isActive": True,
                    }
                }
            self.patch = json_body
            return {"contact": {"id": "kavya-1", **(json_body or {}), "isActive": True}}

    registry = get_mcp_registry()
    server = registry.get_server("contact")
    original_http = server.http
    fake_http = FakeContactPhoneHTTP()
    server.http = fake_http
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "contact",
            "update_contact",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                contact_id="kavya-1",
                contact_draft={
                    "mode": "update",
                    "contactId": "kavya-1",
                    "ready": True,
                    "fields": {"city": "Bengaluru", "primaryPhone": "919007788990"},
                },
                contact_draft_at_turn_start={
                    "mode": "update",
                    "contactId": "kavya-1",
                    "ready": True,
                    "fields": {"city": "Bengaluru", "primaryPhone": "919007788990"},
                },
            ),
            {"contactId": "kavya-1", "city": "Bengaluru", "primaryPhone": "919007788990"},
            agent_name="contact",
            surface="contacts-detail",
        )
    finally:
        server.http = original_http

    assert fake_http.patch == {"city": "Bengaluru"}
    assert result["changes"] == ["city"]


@pytest.mark.asyncio
async def test_get_contact_returns_emails_when_same_name_is_ambiguous() -> None:
    class FakeAmbiguousContactHTTP:
        async def request(
            self,
            method: str,
            path: str,
            *_args: object,
            params: dict | None = None,
            **_kwargs: object,
        ) -> dict:
            assert method == "GET"
            assert path == "/api/v1/cdp/contacts"
            assert "Sanju Ravi" in str(params)
            return {
                "contacts": [
                    {
                        "id": "sanju-1",
                        "firstName": "Sanju",
                        "lastName": "Ravi",
                        "fullName": "Sanju Ravi",
                        "primaryEmail": "sanju@worktual.local",
                    },
                    {
                        "id": "sanju-2",
                        "firstName": "Sanju",
                        "lastName": "Ravi",
                        "fullName": "Sanju Ravi",
                        "primaryEmail": "sanju.ops@worktual.local",
                    },
                ]
            }

    registry = get_mcp_registry()
    server = registry.get_server("contact")
    original_http = server.http
    server.http = FakeAmbiguousContactHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "contact",
            "get_contact",
            ToolContext(tenant_id="tenant-1", user_id="user-1", role="admin"),
            {"name": "Sanju Ravi"},
            agent_name="contact",
            surface="contacts-list",
        )
    finally:
        server.http = original_http

    assert result["ambiguous"] is True
    assert result["emails"] == ["sanju@worktual.local", "sanju.ops@worktual.local"]
    assert len(result["contacts"]) == 2


@pytest.mark.asyncio
async def test_update_contact_refuses_before_ready_preview_is_confirmed() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("contact")
    original_http = server.http
    server.http = object()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "contact",
            "update_contact",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="admin",
                contact_id="sanju-1",
                contact_draft={
                    "mode": "update",
                    "contactId": "sanju-1",
                    "ready": True,
                    "fields": {"primaryPhone": "9289895839"},
                },
                contact_draft_at_turn_start=None,
            ),
            {"contactId": "sanju-1", "primaryPhone": "9289895839"},
            agent_name="contact",
            surface="contacts-detail",
        )
    finally:
        server.http = original_http

    assert "error" in result
    assert "Confirmation is required" in str(result["error"])


@pytest.mark.asyncio
async def test_open_task_workspace_returns_exact_conversation_path() -> None:
    registry = get_mcp_registry()
    server = registry.get_server("task")
    original_http = server.http
    server.http = FakeTaskHTTP()
    try:
        result = await MCPClient(timeout_seconds=5).call_tool(
            "task",
            "open_task_workspace",
            ToolContext(
                tenant_id="tenant-1",
                user_id="user-1",
                role="agent",
                task_id="task-1",
            ),
            {},
            agent_name="task",
            surface="tasks-detail",
        )
    finally:
        server.http = original_http

    assert result == {
        "conversationId": "conversation-1",
        "path": "/agent/workspace?conversationId=conversation-1",
    }
