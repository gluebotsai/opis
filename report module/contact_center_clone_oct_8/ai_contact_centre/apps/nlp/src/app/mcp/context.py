"""Trusted execution context and shared MCP safety helpers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.schemas.copilot import ToolContext

MAX_ARGUMENT_BYTES = 64 * 1024
MAX_RESULT_BYTES = 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 15.0

TRUSTED_ARGUMENT_NAMES = {
    "agent",
    "agent_name",
    "authorization",
    "contact_id",
    "contactId",
    "confirmed_actions",
    "conversation_id",
    "conversationId",
    "organization",
    "organization_id",
    "organizationId",
    "role",
    "queue_id",
    "queueId",
    "surface",
    "tenant",
    "tenant_id",
    "tenantId",
    "task_id",
    "taskId",
    "incident_id",
    "incidentId",
    "user",
    "user_id",
    "userId",
}


@dataclass(frozen=True)
class TrustedMCPContext:
    tool_context: ToolContext
    agent_name: str
    surface: str
    request_id: str

    @property
    def tenant_id(self) -> str:
        return self.tool_context.tenant_id

    @property
    def user_id(self) -> str | None:
        return self.tool_context.user_id

    @property
    def role(self) -> str:
        return self.tool_context.role


_current_context: ContextVar[TrustedMCPContext | None] = ContextVar(
    "current_mcp_context",
    default=None,
)


class CcCoreError(RuntimeError):
    """Safe cc-core error suitable for tool responses."""


class CcCoreHTTPAdapter:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self.settings = get_settings()
        self.client = client

    def _headers(
        self,
        context: ToolContext,
        internal: bool,
        *,
        has_json_body: bool,
    ) -> dict[str, str]:
        headers = {
            "accept": "application/json",
            "x-tenant-id": context.tenant_id,
        }
        if has_json_body:
            headers["content-type"] = "application/json"
        if internal:
            if self.settings.internal_service_key:
                headers["x-internal-service-key"] = self.settings.internal_service_key
        else:
            if context.user_id:
                headers["x-user-id"] = context.user_id
            if context.authorization:
                headers["authorization"] = context.authorization
        return headers

    async def request(
        self,
        method: str,
        path: str,
        context: ToolContext,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        internal: bool = False,
        timeout: float | None = None,
    ) -> Any:
        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(
            base_url=self.settings.cc_core_url.rstrip("/"),
            timeout=timeout if timeout is not None else self.settings.cc_core_timeout_seconds,
        )
        attempts = 2 if method.upper() == "GET" else 1
        request_kwargs: dict[str, Any] = {
            "headers": self._headers(context, internal, has_json_body=json_body is not None),
            "params": params,
        }
        if json_body is not None:
            request_kwargs["json"] = json_body
        try:
            for attempt in range(attempts):
                try:
                    response = await client.request(method, path, **request_kwargs)
                    if response.status_code == 204 or not response.content:
                        return None
                    response.raise_for_status()
                    return response.json()
                except (httpx.TimeoutException, httpx.NetworkError) as error:
                    if attempt + 1 < attempts:
                        await asyncio.sleep(0.2)
                        continue
                    raise CcCoreError("cc-core is temporarily unavailable") from error
                except httpx.HTTPStatusError as error:
                    message: Any = None
                    try:
                        payload = error.response.json()
                        if isinstance(payload, dict):
                            message = payload.get("message") or payload.get("error")
                    except ValueError:
                        pass
                    raise CcCoreError(
                        str(message or f"cc-core returned {error.response.status_code}")
                    ) from error
        finally:
            if owns_client:
                await client.aclose()
        raise CcCoreError("cc-core request failed")


def infer_surface(server_name: str, context: ToolContext) -> str:
    if context.task_id:
        return "tasks-detail"
    if context.conversation_id and server_name in {"contact", "conversation"}:
        return "inbox"
    if context.contact_id:
        return "contacts-detail"
    defaults = {
        "analytics": "performance",
        "contact": "contacts-list",
        "conversation": "inbox",
        "metric": "performance",
        "navigation": "other",
        "organization": "other",
        "queue": "queues-list",
        "skill": "performance",
        "task": "tasks-list",
        "monitoring": "monitoring",
    }
    return defaults.get(server_name, "other")


def infer_agent(server_name: str, surface: str) -> str:
    if surface == "inbox":
        return "inbox"
    defaults = {
        "analytics": "analytics",
        "contact": "contact",
        "conversation": "inbox",
        "metric": "analytics",
        "navigation": "general",
        "organization": "general",
        "queue": "queue",
        "skill": "analytics",
        "task": "task",
        "monitoring": "monitoring",
    }
    return defaults.get(server_name, "general")


def build_trusted_context(
    server_name: str,
    context: ToolContext,
    *,
    agent_name: str | None = None,
    surface: str | None = None,
    request_id: str | None = None,
) -> TrustedMCPContext:
    trusted_surface = surface or infer_surface(server_name, context)
    return TrustedMCPContext(
        tool_context=context,
        agent_name=agent_name or infer_agent(server_name, trusted_surface),
        surface=trusted_surface,
        request_id=request_id or uuid.uuid4().hex,
    )


@contextmanager
def bind_trusted_context(context: TrustedMCPContext) -> Any:
    token = _current_context.set(context)
    try:
        yield context
    finally:
        _current_context.reset(token)


def get_trusted_context() -> TrustedMCPContext:
    context = _current_context.get()
    if context is None:
        raise RuntimeError("MCP tool called without trusted execution context")
    return context


def get_tool_context() -> ToolContext:
    return get_trusted_context().tool_context


CONTEXT_ENTITY_ARGUMENTS = (
    ("contactId", "contact_id"),
    ("contact_id", "contact_id"),
    ("conversationId", "conversation_id"),
    ("conversation_id", "conversation_id"),
    ("queueId", "queue_id"),
    ("queue_id", "queue_id"),
    ("taskId", "task_id"),
    ("task_id", "task_id"),
)


def reject_trusted_arguments(arguments: dict[str, Any]) -> None:
    forbidden = sorted(name for name in arguments if name in TRUSTED_ARGUMENT_NAMES)
    if forbidden:
        names = ", ".join(forbidden)
        raise ValueError(f"Trusted context fields cannot be supplied as tool arguments: {names}")


def validate_tool_arguments(context: ToolContext, arguments: dict[str, Any]) -> None:
    """Reject spoofed trusted fields while allowing entity ids when page context is unset."""
    remaining = dict(arguments)
    for arg_name, context_attr in CONTEXT_ENTITY_ARGUMENTS:
        if arg_name not in remaining:
            continue
        trusted_value = getattr(context, context_attr, None)
        llm_value = remaining[arg_name]
        if trusted_value is not None:
            if str(llm_value) != str(trusted_value):
                raise ValueError(f"Trusted context fields cannot be overridden: {arg_name}")
            remaining.pop(arg_name)
        else:
            remaining.pop(arg_name)
    reject_trusted_arguments(remaining)


def payload_size(value: Any) -> int:
    encoded = json.dumps(value, separators=(",", ":"), default=str).encode("utf-8")
    return len(encoded)


def ensure_payload_limit(value: Any, limit: int, label: str) -> int:
    size = payload_size(value)
    if size > limit:
        raise ValueError(f"{label} exceeds the {limit}-byte limit")
    return size


def operation_id(tool_name: str, arguments: dict[str, Any]) -> str:
    payload = json.dumps(
        {"tool": tool_name, "args": arguments},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def confirmation_preview(
    tool_name: str,
    arguments: dict[str, Any],
    message: str,
    preview: dict[str, Any],
) -> dict[str, Any] | None:
    context = get_tool_context()
    confirmation_id = operation_id(tool_name, arguments)
    if confirmation_id in context.confirmed_actions:
        return None
    return {
        "_confirmation_required": True,
        "id": confirmation_id,
        "tool": tool_name,
        "args": arguments,
        "message": message,
        "preview": preview,
    }


async def execute_once(
    tool_name: str,
    arguments: dict[str, Any],
    operation: Callable[[], Awaitable[Any]],
) -> dict[str, Any]:
    context = get_tool_context()
    cache_key = operation_id(tool_name, arguments)
    cached = context.executed_tool_results.get(cache_key)
    if cached is not None:
        return dict(cached)
    result = await operation()
    if not isinstance(result, dict):
        result = {"result": result}
    context.executed_tool_results[cache_key] = dict(result)
    return result
