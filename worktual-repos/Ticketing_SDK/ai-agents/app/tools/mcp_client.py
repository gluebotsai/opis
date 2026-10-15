"""MCP transport client for domain tools (ai-agents → Ticketing MCP → Express).

Maps MCP /invoke results into existing tool_ok / tool_err shapes.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.config import get_settings
from app.contracts import tool_err, tool_ok
from app.llm_log import log_llm
from app.tools.express_client import get_tool_actor, resolve_portal_customer_id


def _mcp_base() -> str:
    settings = get_settings()
    return (settings.mcp_server_url or "http://127.0.0.1:8020").rstrip("/")


def _tasks_secret() -> str:
    settings = get_settings()
    secret = (settings.coworker_tasks_secret or "").strip()
    return secret or "worktual-tasks-dev-secret"


def _actor_headers() -> dict[str, str] | dict[str, Any]:
    actor = get_tool_actor()
    if not actor or not actor.user_id or not actor.organization_id:
        return tool_err("NO_ACTOR", "Tool actor (user/org) is required")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Coworker-Tasks-Key": _tasks_secret(),
        "X-Coworker-Actor-Id": actor.user_id,
        "X-Coworker-Org-Id": actor.organization_id,
    }
    if actor.user_role:
        headers["X-Coworker-Actor-Role"] = actor.user_role
    if actor.user_name:
        headers["X-Coworker-Actor-Name"] = actor.user_name
    if actor.request_id:
        headers["X-Request-Id"] = actor.request_id
    portal_cid = resolve_portal_customer_id(
        role=actor.user_role,
        actor_id=actor.user_id,
        portal_customer_id=actor.portal_customer_id,
    )
    if portal_cid:
        headers["X-Portal-Customer-Id"] = portal_cid
    return headers


def call_tool(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Call a Ticketing MCP tool by name.

    Uses POST /invoke on the MCP server (same Express mapping as MCP tools/call).
    """
    tool_name = (name or "").strip()
    if not tool_name:
        return tool_err("BAD_INPUT", "tool name is required")

    headers = _actor_headers()
    if headers.get("success") is False:
        return headers  # type: ignore[return-value]

    actor = get_tool_actor()
    url = f"{_mcp_base()}/invoke"
    payload = {"name": tool_name, "arguments": arguments or {}}
    t0 = time.perf_counter()
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json=payload, headers=headers)  # type: ignore[arg-type]
    except httpx.HTTPError as exc:
        log_llm(
            kind="mcp_tool_error",
            user_text=tool_name,
            response="",
            error=str(exc),
            ms=(time.perf_counter() - t0) * 1000,
            organization_id=getattr(actor, "organization_id", None),
            user_id=getattr(actor, "user_id", None),
        )
        return tool_err("TRANSPORT", f"MCP unreachable: {exc}")

    try:
        data = resp.json() if resp.content else {}
    except Exception:  # noqa: BLE001
        data = {}

    if isinstance(data, dict) and "success" in data:
        # Already tool_ok / tool_err from MCP /invoke
        return data

    if resp.status_code >= 400:
        msg = ""
        if isinstance(data, dict):
            msg = str(data.get("message") or data.get("error") or "")
        return tool_err(
            "HTTP_ERROR",
            msg or resp.reason_phrase or f"HTTP {resp.status_code}",
            http_status=resp.status_code,
            payload=data if isinstance(data, dict) else {},
        )

    return tool_ok(data if isinstance(data, dict) else {"data": data})
