"""Monitoring MCP server backed by authoritative cc-core monitoring APIs."""

from typing import Any, Literal
from urllib.parse import quote

from mcp.server.fastmcp import FastMCP

from app.mcp.agent_presence import annotate_presence_agents
from app.mcp.context import (
    CcCoreError,
    CcCoreHTTPAdapter,
    execute_once,
    get_tool_context,
)


class MonitoringMCPServer:
    tool_names = (
        "get_monitoring_snapshot",
        "get_agent_attendance",
        "get_not_ready_escalation_insight",
        "get_contact_callback_channels",
        "create_callback_task",
        "force_agent_logout",
        "set_agent_presence",
        "acknowledge_not_ready_escalation",
        "acknowledge_proactive_callback",
    )

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("monitoring")
        descriptions = {
            "get_monitoring_snapshot": (
                "Load the live monitoring snapshot: queues, waiting contacts, missed "
                "contacts, callbacks, alerts, agents, presence, channel capacity, and "
                "summary KPIs. For who is online/offline/not ready, use agentPresence: "
                "session=offline means logged out; presence=not_ready means logged in "
                "and Not Ready. Never treat Not Ready as Offline."
            ),
            "get_agent_attendance": (
                "Read an agent's attendance for a specific day or date range."
            ),
            "get_not_ready_escalation_insight": (
                "Read the supervisor insight for a not-ready escalation alert."
            ),
            "get_contact_callback_channels": (
                "List callback channels available for a contact before assigning a callback."
            ),
            "create_callback_task": (
                "Assign a callback task to an agent for a contact or conversation. "
                "Requires assignedUserId from snapshot agent id (setup user id), plus "
                "contactId and/or conversationId. Call get_contact_callback_channels first "
                "when channel is not obvious."
            ),
            "force_agent_logout": (
                "Force-logout a logged-in agent. Provide agent.agentId from the monitoring "
                "snapshot, or agentName to resolve from the live snapshot automatically. "
                "Requires supervisor confirmation."
            ),
            "set_agent_presence": (
                "Set a logged-in agent's presence to ready or not_ready. Provide agent.agentId "
                "from the monitoring snapshot, or agentName to resolve from the live snapshot. "
                "Requires supervisor confirmation."
            ),
            "acknowledge_not_ready_escalation": (
                "Acknowledge a not-ready escalation alert after supervisor review."
            ),
            "acknowledge_proactive_callback": (
                "Acknowledge a proactive callback alert on the monitoring board."
            ),
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    async def get_monitoring_snapshot(self) -> dict[str, Any]:
        arguments: dict[str, Any] = {}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError("Live monitoring is available to supervisors and admins only")
            snapshot = await self.http.request(
                "GET",
                "/api/v1/monitoring/snapshot",
                context,
            )
            if not isinstance(snapshot, dict):
                raise CcCoreError("Monitoring snapshot was not returned")
            raw_agents = snapshot.get("agents", [])
            agents, agent_presence = annotate_presence_agents(
                raw_agents if isinstance(raw_agents, list) else []
            )
            return {
                "capability": "monitoring.snapshot.read",
                "status": "completed",
                "generatedAt": snapshot.get("generatedAt"),
                "summary": snapshot.get("summary", {}),
                "queues": snapshot.get("queues", []),
                "agents": agents,
                "agentPresence": agent_presence,
                "conversations": snapshot.get("conversations", []),
                "waiting": snapshot.get("waiting", []),
                "missed": snapshot.get("missed", []),
                "callbacks": snapshot.get("callbacks", []),
                "alerts": snapshot.get("alerts", []),
            }

        return await execute_once("get_monitoring_snapshot", arguments, operation)

    async def get_agent_attendance(
        self,
        agentId: str,
        date: str | None = None,
        fromDate: str | None = None,
        toDate: str | None = None,
    ) -> dict[str, Any]:
        arguments = {
            "agentId": agentId,
            "date": date,
            "fromDate": fromDate,
            "toDate": toDate,
        }

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError("Agent attendance is available to supervisors and admins only")
            if not agentId:
                raise CcCoreError("Provide an agent id before reading attendance")
            params: dict[str, str] = {}
            if date:
                params["date"] = date
            if fromDate:
                params["from"] = fromDate
            if toDate:
                params["to"] = toDate
            result = await self.http.request(
                "GET",
                f"/api/v1/monitoring/agents/{agentId}/attendance",
                context,
                params=params or None,
            )
            if not isinstance(result, dict):
                raise CcCoreError("Agent attendance was not returned")
            return {
                "capability": "monitoring.agent.attendance.read",
                "status": "completed",
                "agentId": agentId,
                **result,
            }

        return await execute_once("get_agent_attendance", arguments, operation)

    async def get_not_ready_escalation_insight(self, escalationId: str) -> dict[str, Any]:
        arguments = {"escalationId": escalationId}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError(
                    "Not-ready escalation insight is available to supervisors and admins only"
                )
            if not escalationId:
                raise CcCoreError("Provide an escalation id before reading the insight")
            result = await self.http.request(
                "GET",
                f"/api/v1/monitoring/not-ready-escalations/{escalationId}/insight",
                context,
            )
            if not isinstance(result, dict):
                raise CcCoreError("Escalation insight was not returned")
            return {
                "capability": "monitoring.escalation.insight.read",
                "status": "completed",
                "escalationId": escalationId,
                **result,
            }

        return await execute_once("get_not_ready_escalation_insight", arguments, operation)

    async def get_contact_callback_channels(
        self,
        contactId: str,
        hintChannel: Literal["whatsapp", "instagram", "facebook", "email"] | None = None,
    ) -> dict[str, Any]:
        arguments = {"contactId": contactId, "hintChannel": hintChannel}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError(
                    "Callback channel lookup is available to supervisors and admins only"
                )
            if not contactId:
                raise CcCoreError("Provide a contact id before reading callback channels")
            params = {"hintChannel": hintChannel} if hintChannel else None
            result = await self.http.request(
                "GET",
                f"/api/v1/monitoring/contacts/{quote(contactId, safe='')}/callback-channels",
                context,
                params=params,
            )
            if not isinstance(result, dict):
                raise CcCoreError("Callback channels were not returned")
            return {
                "capability": "monitoring.contact.callback_channels.read",
                "status": "completed",
                "contactId": contactId,
                **result,
            }

        return await execute_once("get_contact_callback_channels", arguments, operation)

    async def create_callback_task(
        self,
        assignedUserId: str,
        contactId: str | None = None,
        conversationId: str | None = None,
        channel: Literal["whatsapp", "instagram", "facebook", "email"] | None = None,
        title: str | None = None,
        summary: str | None = None,
        notes: str | None = None,
        dueAt: str | None = None,
        priority: Literal["low", "normal", "high", "critical"] | None = None,
        assigneeName: str | None = None,
        customerName: str | None = None,
    ) -> dict[str, Any]:
        arguments = {
            "assignedUserId": assignedUserId,
            "contactId": contactId,
            "conversationId": conversationId,
            "channel": channel,
            "title": title,
            "summary": summary,
            "notes": notes,
            "dueAt": dueAt,
            "priority": priority,
            "assigneeName": assigneeName,
            "customerName": customerName,
        }

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError("Callback assignment is available to supervisors and admins only")
            if not assignedUserId:
                raise CcCoreError("Provide assignedUserId from the monitoring snapshot agent id")
            if not contactId and not conversationId:
                raise CcCoreError("Provide contactId and/or conversationId before assigning a callback")

            payload: dict[str, Any] = {"assignedUserId": assignedUserId}
            if contactId:
                payload["contactId"] = contactId
            if conversationId:
                payload["conversationId"] = conversationId
            if channel:
                payload["channel"] = channel
            if title:
                payload["title"] = title
            if summary:
                payload["summary"] = summary
            if notes:
                payload["notes"] = notes
            if dueAt:
                payload["dueAt"] = dueAt
            if priority:
                payload["priority"] = priority

            result = await self.http.request(
                "POST",
                "/api/v1/monitoring/callback-tasks",
                context,
                json_body=payload,
            )
            if not isinstance(result, dict):
                raise CcCoreError("Callback task was not created")
            task = result.get("task")
            if not isinstance(task, dict):
                raise CcCoreError("Callback task was not created")
            return {
                "capability": "monitoring.callback.assign",
                "status": "completed",
                "taskId": task.get("id"),
                "task": task,
            }

        return await execute_once("create_callback_task", arguments, operation)

    async def _snapshot_agents(self) -> list[dict[str, Any]]:
        context = get_tool_context()
        snapshot = await self.http.request(
            "GET",
            "/api/v1/monitoring/snapshot",
            context,
        )
        if not isinstance(snapshot, dict):
            raise CcCoreError("Monitoring snapshot was not returned")
        agents = snapshot.get("agents", [])
        if not isinstance(agents, list):
            return []
        return [agent for agent in agents if isinstance(agent, dict)]

    def _match_agents_by_name(
        self,
        agents: list[dict[str, Any]],
        agent_name: str,
    ) -> list[dict[str, Any]]:
        needle = agent_name.strip().casefold()
        if not needle:
            return []
        matches: list[dict[str, Any]] = []
        for agent in agents:
            labels = [
                str(agent.get("name") or ""),
                str(agent.get("firstName") or ""),
                str(agent.get("lastName") or ""),
                " ".join(
                    part
                    for part in [agent.get("firstName"), agent.get("lastName")]
                    if part
                ),
                str(agent.get("employeeId") or ""),
            ]
            for label in labels:
                candidate = label.strip().casefold()
                if not candidate:
                    continue
                if needle in candidate or candidate in needle:
                    matches.append(agent)
                    break
        return matches

    @staticmethod
    def _is_entity_id(value: str) -> bool:
        return value.strip().isdigit()

    def _pick_snapshot_agent(
        self,
        agent: dict[str, Any],
        fallback_name: str | None = None,
    ) -> tuple[str, str | None]:
        resolved_id = str(agent.get("agentId") or "").strip()
        if not resolved_id or not self._is_entity_id(resolved_id):
            raise CcCoreError("Agent id from the monitoring snapshot is invalid")
        resolved_name = str(agent.get("name") or fallback_name or resolved_id)
        return resolved_id, resolved_name

    async def _resolve_snapshot_agent(
        self,
        agent_id: str | None,
        agent_name: str | None,
    ) -> tuple[str, str | None]:
        agents = await self._snapshot_agents()

        if agent_id and self._is_entity_id(agent_id):
            match = next(
                (agent for agent in agents if str(agent.get("agentId") or "").strip() == agent_id),
                None,
            )
            if match is not None:
                return self._pick_snapshot_agent(match, agent_name)
            raise CcCoreError(
                f'Agent id "{agent_id}" was not found on the live monitoring board. '
                "Refresh the snapshot or use agentName."
            )

        if agent_id and not self._is_entity_id(agent_id):
            if not agent_name:
                raise CcCoreError(
                    f'"{agent_id}" is not a valid agent id. Use the numeric agentId from '
                    "get_monitoring_snapshot or pass agentName."
                )
            agent_id = None

        if not agent_name:
            raise CcCoreError(
                "Provide agentId or agentName from the monitoring snapshot before acting on an agent"
            )

        matches = self._match_agents_by_name(agents, agent_name)
        if not matches:
            raise CcCoreError(f'Agent "{agent_name}" was not found on the live monitoring board')
        if len(matches) > 1:
            labels = ", ".join(
                str(agent.get("name") or agent.get("agentId") or "agent") for agent in matches[:3]
            )
            raise CcCoreError(
                f'Multiple agents match "{agent_name}" ({labels}). '
                "Ask one focused clarification question, then retry with agentId."
            )
        return self._pick_snapshot_agent(matches[0], agent_name)

    async def _resolve_logout_agent(
        self,
        agent_id: str | None,
        agent_name: str | None,
    ) -> tuple[str, str | None]:
        return await self._resolve_snapshot_agent(agent_id, agent_name)

    async def force_agent_logout(
        self,
        agentId: str | None = None,
        agentName: str | None = None,
    ) -> dict[str, Any]:
        resolved_id, resolved_name = await self._resolve_logout_agent(agentId, agentName)
        arguments = {"agentId": resolved_id, "agentName": resolved_name}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError("Force logout is available to supervisors and admins only")
            if not resolved_id:
                raise CcCoreError("Provide agentId from the monitoring snapshot before force logout")
            result = await self.http.request(
                "POST",
                f"/api/v1/monitoring/agents/{resolved_id}/logout",
                context,
                json_body={},
            )
            if not isinstance(result, dict):
                raise CcCoreError("Agent logout did not complete")
            return {
                "capability": "monitoring.agent.logout",
                "status": "completed",
                "agentId": resolved_id,
                "ok": result.get("ok", True),
            }

        return await execute_once("force_agent_logout", arguments, operation)

    async def set_agent_presence(
        self,
        presence: Literal["ready", "not_ready"],
        agentId: str | None = None,
        agentName: str | None = None,
    ) -> dict[str, Any]:
        resolved_id, resolved_name = await self._resolve_snapshot_agent(agentId, agentName)
        arguments = {
            "agentId": resolved_id,
            "agentName": resolved_name,
            "presence": presence,
        }

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError("Agent presence changes are available to supervisors and admins only")
            if not resolved_id:
                raise CcCoreError("Provide agentId from the monitoring snapshot before changing presence")
            result = await self.http.request(
                "POST",
                f"/api/v1/monitoring/agents/{resolved_id}/presence",
                context,
                json_body={"presence": presence},
            )
            if not isinstance(result, dict):
                raise CcCoreError("Agent presence was not updated")
            return {
                "capability": "monitoring.agent.presence.set",
                "status": "completed",
                "agentId": resolved_id,
                "presence": presence,
                "ok": result.get("ok", True),
            }

        return await execute_once("set_agent_presence", arguments, operation)

    async def acknowledge_not_ready_escalation(self, escalationId: str) -> dict[str, Any]:
        arguments = {"escalationId": escalationId}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError(
                    "Escalation acknowledgement is available to supervisors and admins only"
                )
            if not escalationId:
                raise CcCoreError("Provide an escalation id before acknowledging")
            result = await self.http.request(
                "POST",
                f"/api/v1/monitoring/not-ready-escalations/{escalationId}/acknowledge",
                context,
                json_body={},
            )
            if not isinstance(result, dict):
                raise CcCoreError("Escalation was not acknowledged")
            return {
                "capability": "monitoring.escalation.acknowledge",
                "status": "completed",
                "escalationId": escalationId,
                "ok": result.get("ok", True),
            }

        return await execute_once("acknowledge_not_ready_escalation", arguments, operation)

    async def acknowledge_proactive_callback(self, attemptId: str) -> dict[str, Any]:
        arguments = {"attemptId": attemptId}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                raise CcCoreError(
                    "Proactive callback acknowledgement is available to supervisors and admins only"
                )
            if not attemptId:
                raise CcCoreError("Provide an attempt id before acknowledging")
            result = await self.http.request(
                "POST",
                f"/api/v1/monitoring/proactive-callbacks/{attemptId}/acknowledge",
                context,
                json_body={},
            )
            if not isinstance(result, dict):
                raise CcCoreError("Proactive callback was not acknowledged")
            return {
                "capability": "monitoring.proactive_callback.acknowledge",
                "status": "completed",
                "attemptId": attemptId,
                "ok": result.get("ok", True),
            }

        return await execute_once("acknowledge_proactive_callback", arguments, operation)
