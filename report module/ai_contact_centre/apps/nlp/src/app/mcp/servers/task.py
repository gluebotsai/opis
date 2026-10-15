"""Task MCP server backed by authoritative cc-core workspace APIs."""

from datetime import UTC, datetime
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from app.mcp.context import CcCoreError, CcCoreHTTPAdapter, execute_once, get_tool_context


class TaskMCPServer:
    tool_names = ("list_tasks", "get_task", "update_task", "open_task_workspace")

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("task")
        descriptions = {
            "list_tasks": "List authoritative tasks for the signed-in agent.",
            "get_task": "Get a task by id or trusted selected-task context.",
            "update_task": "Complete, dismiss, or accept a selected task suggestion.",
            "open_task_workspace": (
                "Open the customer workspace linked to a selected task when the user "
                "explicitly asks to work on that task."
            ),
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    def _matches_tab(self, task: dict[str, Any], tab: str | None) -> bool:
        if tab is None:
            return True
        if tab == "done":
            return task.get("status") == "completed"
        if task.get("status") != "open":
            return False
        is_coworker = task.get("source") == "coworker" or task.get("type") == "suggestion"
        return is_coworker if tab == "coworker_assigned" else not is_coworker

    def _matches_due(self, task: dict[str, Any], due: str | None) -> bool:
        if due is None:
            return True
        due_at = task.get("dueAt")
        if not due_at:
            return False
        try:
            parsed = datetime.fromisoformat(str(due_at).replace("Z", "+00:00"))
        except ValueError:
            return False
        now = datetime.now(UTC)
        if due == "overdue":
            return task.get("status") == "open" and parsed < now
        return parsed.astimezone(UTC).date() == now.date()

    async def list_tasks(
        self,
        tab: Literal["admin_assigned", "coworker_assigned", "done"] | None = None,
        status: Literal["open", "completed"] | None = None,
        due: Literal["today", "overdue"] | None = None,
        search: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        payload = await self.http.request(
            "GET",
            "/api/v1/workspace/tasks",
            get_tool_context(),
        )
        query = (search or "").strip().casefold()
        effective_status = status or ("completed" if tab == "done" else "open")
        tasks = [
            task
            for task in payload.get("tasks", [])
            if task.get("status") == effective_status
            and self._matches_tab(task, tab)
            and self._matches_due(task, due)
            and (
                not query
                or query
                in " ".join(
                    str(task.get(key) or "")
                    for key in ("title", "summary", "customerName", "channel", "type")
                ).casefold()
            )
        ]
        return {
            "tasks": tasks[: max(1, min(limit, 100))],
            "count": len(tasks),
            "stats": payload.get("stats", {}),
            "filters": {"tab": tab, "status": effective_status, "due": due, "search": search},
        }

    async def get_task(self, taskId: str | None = None) -> dict[str, Any]:
        context = get_tool_context()
        task_id = taskId or context.task_id
        if not task_id:
            raise CcCoreError("Select a task or provide a task id")
        return await self.http.request(
            "GET",
            f"/api/v1/workspace/tasks/{task_id}",
            context,
        )

    async def update_task(
        self,
        action: Literal["complete", "dismiss", "accept_suggestion"],
        taskId: str | None = None,
    ) -> dict[str, Any]:
        arguments = {"action": action, "taskId": taskId}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            task_id = taskId or context.task_id
            if not task_id:
                raise CcCoreError("Select a task before updating it")
            return await self.http.request(
                "PATCH",
                f"/api/v1/workspace/tasks/{task_id}",
                context,
                json_body={"action": action},
            )

        return await execute_once("update_task", arguments, operation)

    async def open_task_workspace(self, taskId: str | None = None) -> dict[str, Any]:
        arguments = {"taskId": taskId}

        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            task_id = taskId or context.task_id
            if not task_id:
                raise CcCoreError("Select a task or provide a task id before opening its workspace")
            result = await self.http.request(
                "POST",
                f"/api/v1/workspace/tasks/{task_id}/open-workspace",
                context,
                json_body={},
            )
            conversation_id = result.get("conversationId")
            if not conversation_id:
                raise CcCoreError("The task workspace did not return a conversation")
            return {
                "conversationId": str(conversation_id),
                "path": f"/agent/workspace?conversationId={conversation_id}",
            }

        return await execute_once("open_task_workspace", arguments, operation)
