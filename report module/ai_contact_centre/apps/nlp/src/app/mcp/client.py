"""Secure in-process MCP client using real ClientSession/FastMCP transport."""

import asyncio
import json
import logging
import time
from datetime import timedelta
from typing import Any

from mcp.shared.memory import create_connected_server_and_client_session

from app.config import get_settings
from app.mcp.context import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_ARGUMENT_BYTES,
    MAX_RESULT_BYTES,
    CcCoreHTTPAdapter,
    bind_trusted_context,
    build_trusted_context,
    ensure_payload_limit,
    validate_tool_arguments,
)
from app.mcp.registry import get_mcp_registry
from app.schemas.copilot import ToolContext

logger = logging.getLogger("nlp.mcp_client")
_audit_tasks: set[asyncio.Task[None]] = set()

# Persist + publish can exceed the default 15s MCP window.
TOOL_TIMEOUT_SECONDS = {
    "create_queue": 60.0,
    "update_queue": 60.0,
    "update_queue_status": 60.0,
    "delete_queue": 60.0,
    "create_contact": 45.0,
    "update_contact": 45.0,
}


class MCPClient:
    def __init__(self, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.registry = get_mcp_registry()
        self.timeout_seconds = timeout_seconds
        self.audit_adapter = CcCoreHTTPAdapter()

    def _decode_result(self, result: Any) -> dict[str, Any]:
        structured = getattr(result, "structuredContent", None)
        if structured is None:
            structured = getattr(result, "structured_content", None)
        if isinstance(structured, dict):
            return structured

        content = getattr(result, "content", [])
        text_parts = [
            str(item.text)
            for item in content
            if getattr(item, "type", None) == "text" and hasattr(item, "text")
        ]
        text = "\n".join(text_parts)
        if not text:
            return {}
        try:
            decoded = json.loads(text)
        except json.JSONDecodeError:
            decoded = {"result": text}
        if isinstance(decoded, dict):
            return decoded
        return {"result": decoded}

    def _audit(
        self,
        trusted: Any,
        *,
        server_name: str,
        tool_name: str,
        argument_bytes: int,
        result_bytes: int = 0,
        elapsed_ms: float = 0.0,
        outcome: str,
        agent_layer: str = "executor",
    ) -> None:
        audit = {
            "event": "mcp_tool_call",
            "request_id": trusted.request_id,
            "tenant_id": trusted.tenant_id,
            "user_id": trusted.user_id,
            "agent": trusted.agent_name,
            "surface": trusted.surface,
            "role": trusted.role,
            "server": server_name,
            "tool": tool_name,
            "argument_bytes": argument_bytes,
            "result_bytes": result_bytes,
            "elapsed_ms": round(elapsed_ms, 2),
            "outcome": outcome,
            "agent_layer": agent_layer,
        }
        logger.info("MCP tool audit", extra={"audit": audit})
        if get_settings().agent_audit_persistence_enabled:
            task = asyncio.create_task(
                self._persist_audit(trusted.tool_context, audit)
            )
            _audit_tasks.add(task)
            task.add_done_callback(_audit_tasks.discard)

    async def _persist_audit(
        self,
        context: ToolContext,
        audit: dict[str, Any],
    ) -> None:
        try:
            await self.audit_adapter.request(
                "POST",
                "/internal/v1/agent-audit",
                context,
                json_body={
                    "organizationId": audit["tenant_id"],
                    "userId": audit.get("user_id"),
                    "agentName": audit["agent"],
                    "agentLayer": audit["agent_layer"],
                    "serverKey": audit["server"],
                    "toolKey": audit["tool"],
                    "outcome": audit["outcome"],
                    "argumentBytes": audit["argument_bytes"],
                    "resultBytes": audit["result_bytes"],
                    "latencyMs": round(float(audit["elapsed_ms"])),
                    "requestId": audit["request_id"],
                    "surface": audit["surface"],
                },
                internal=True,
            )
        except Exception:
            logger.exception("Non-blocking MCP audit persistence failed")

    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        context: ToolContext,
        kwargs: dict[str, Any],
        *,
        agent_name: str | None = None,
        agent_layer: str = "executor",
        surface: str | None = None,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        started = time.perf_counter()
        trusted = build_trusted_context(
            server_name,
            context,
            agent_name=agent_name,
            surface=surface,
            request_id=request_id,
        )
        argument_bytes = 0
        try:
            validate_tool_arguments(context, kwargs)
            argument_bytes = ensure_payload_limit(
                kwargs,
                MAX_ARGUMENT_BYTES,
                "MCP tool arguments",
            )
            actual_server_name = self.registry.server_for_tool(tool_name)
            if actual_server_name is None:
                raise ValueError(f"Tool '{tool_name}' is not registered")
            if actual_server_name != server_name:
                server_name = actual_server_name
                trusted = build_trusted_context(
                    server_name,
                    context,
                    agent_name=agent_name,
                    surface=surface,
                    request_id=trusted.request_id,
                )
            self.registry.authorize(
                server_name=server_name,
                tool_name=tool_name,
                agent_name=trusted.agent_name,
                surface=trusted.surface,
                role=trusted.role,
            )
            server = self.registry.get_server(server_name)
            if server is None:
                raise ValueError(f"MCP server '{server_name}' is not available")

            timeout_seconds = TOOL_TIMEOUT_SECONDS.get(tool_name, self.timeout_seconds)
            with bind_trusted_context(trusted):
                async with asyncio.timeout(timeout_seconds):
                    async with create_connected_server_and_client_session(
                        server.mcp,
                        read_timeout_seconds=timedelta(seconds=timeout_seconds),
                        raise_exceptions=True,
                    ) as session:
                        raw_result = await session.call_tool(tool_name, kwargs)

            result = self._decode_result(raw_result)
            result_bytes = ensure_payload_limit(
                result,
                MAX_RESULT_BYTES,
                "MCP tool result",
            )
            is_error = bool(getattr(raw_result, "isError", False))
            if is_error and "error" not in result:
                result = {"error": result.get("result", "MCP tool failed")}
            self._audit(
                trusted,
                server_name=server_name,
                tool_name=tool_name,
                argument_bytes=argument_bytes,
                result_bytes=result_bytes,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                outcome="error" if is_error else "success",
                agent_layer=agent_layer,
            )
            return result
        except TimeoutError:
            error = f"MCP tool '{tool_name}' timed out"
            self._audit(
                trusted,
                server_name=server_name,
                tool_name=tool_name,
                argument_bytes=argument_bytes,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                outcome="timeout",
                agent_layer=agent_layer,
            )
            return {"error": error}
        except Exception as exc:
            logger.exception("Error executing MCP tool %s.%s: %s", server_name, tool_name, exc)
            self._audit(
                trusted,
                server_name=server_name,
                tool_name=tool_name,
                argument_bytes=argument_bytes,
                elapsed_ms=(time.perf_counter() - started) * 1000,
                outcome="denied" if isinstance(exc, PermissionError) else "error",
                agent_layer=agent_layer,
            )
            return {"error": str(exc)}


_mcp_client: MCPClient | None = None


def get_mcp_client() -> MCPClient:
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client
