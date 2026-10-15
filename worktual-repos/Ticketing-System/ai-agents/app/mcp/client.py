"""Agent-side MCP HTTP client with in-process fallback when :8020 is down."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.contracts import tool_err, tool_ok


def mcp_base_url() -> str:
    settings = get_settings()
    return (settings.mcp_server_url or "http://127.0.0.1:8020").rstrip("/")


def _actor_from_token(token: str | None, actor_headers: dict[str, str] | None = None):
    from app.mcp.authorization import verify_mcp_token
    from app.tools.express_client import ToolActor

    claims = verify_mcp_token(token) if token else {}
    headers = actor_headers or {}
    return (
        ToolActor(
            user_id=str(claims.get("actor_id") or headers.get("X-Coworker-Actor-Id") or ""),
            organization_id=str(
                claims.get("organization_id")
                or headers.get("X-Coworker-Organization-Id")
                or ""
            ),
            user_role=str(claims.get("role") or headers.get("X-Coworker-Actor-Role") or ""),
            user_name=str(headers.get("X-Coworker-Actor-Name") or ""),
            request_id=str(claims.get("run_id") or headers.get("X-Request-Id") or ""),
        ),
        claims,
    )


def _list_tools_inprocess(
    *,
    token: str,
    agent: str | None = None,
    module: str | None = None,
    surface: str | None = None,
) -> list[dict[str, Any]]:
    """Same auth + catalog intersection as MCP HTTP /tools/list (no network)."""
    from app.mcp.authorization import authorized_tool_names, verify_mcp_token
    from app.mcp.catalog import list_catalog_public

    claims = verify_mcp_token(token)
    selected_agent = str(claims.get("agent_id") or agent or "general").strip() or "general"
    selected_module = str(claims.get("module") or module or "").strip() or None
    selected_surface = str(claims.get("surface") or surface or "").strip() or None
    allowed = authorized_tool_names(
        agent=selected_agent,
        module=selected_module,
        surface=selected_surface,
        token_claims=claims,
    )
    return list_catalog_public(allowed_names=allowed)


def _resolve_trusted_approval(
    token: str | None,
    trusted_approval: str | None,
) -> str | None:
    if trusted_approval in {"proactive_asga", "trusted_structured"}:
        return trusted_approval
    try:
        from app.mcp.authorization import verify_mcp_token

        claims = verify_mcp_token(token) if token else {}
    except Exception:  # noqa: BLE001
        claims = {}
    if str(claims.get("route_mode") or "") == "proactive":
        return "proactive_asga"
    return None


def _call_tool_inprocess(
    name: str,
    arguments: dict[str, Any] | None,
    *,
    token: str | None,
    actor_headers: dict[str, str] | None,
    agent: str | None,
    module: str | None,
    surface: str | None,
    operation: str | None,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
    trusted_approval: str | None = None,
) -> dict[str, Any]:
    """Same dispatch path as MCP HTTP /tools/call (no network)."""
    from app.mcp.dispatch import dispatch_tool

    actor, claims = _actor_from_token(token, actor_headers)
    if not actor.user_id or not actor.organization_id:
        return tool_err("FORBIDDEN", "MCP token missing actor/org")
    selected_agent = str(claims.get("agent_id") or agent or "general").strip() or "general"
    selected_module = str(claims.get("module") or module or "").strip() or None
    selected_surface = str(claims.get("surface") or surface or "").strip() or None
    return dispatch_tool(
        name,
        arguments,
        agent=selected_agent,
        actor=actor,
        module=selected_module,
        surface=selected_surface,
        mcp_token=token,
        operation=operation,
        draft=draft,
        workflow_id=workflow_id,
        draft_key=draft_key,
        trusted_approval=_resolve_trusted_approval(token, trusted_approval),
    )


def call_mcp_tool(
    name: str,
    arguments: dict[str, Any] | None = None,
    *,
    token: str | None = None,
    actor_headers: dict[str, str] | None = None,
    agent: str | None = None,
    module: str | None = None,
    surface: str | None = None,
    operation: str | None = None,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
    trusted_approval: str | None = None,
) -> dict[str, Any]:
    url = f"{mcp_base_url()}/mcp/v1/tools/call"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if actor_headers:
        headers.update(actor_headers)
    body: dict[str, Any] = {
        "name": name,
        "arguments": arguments or {},
        "agent": agent,
        "module": module,
        "surface": surface,
        "operation": operation,
    }
    if isinstance(draft, dict):
        body["draft"] = draft
    if workflow_id:
        body["workflow_id"] = workflow_id
    if draft_key:
        body["draft_key"] = draft_key
    resolved_trust = _resolve_trusted_approval(token, trusted_approval)
    if resolved_trust:
        body["trusted_approval"] = resolved_trust
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                url,
                json=body,
                headers=headers,
            )
    except httpx.HTTPError:
        # :8020 down / reloading — keep chat alive via in-process MCP dispatch.
        try:
            return _call_tool_inprocess(
                name,
                arguments,
                token=token,
                actor_headers=actor_headers,
                agent=agent,
                module=module,
                surface=surface,
                operation=operation,
                draft=draft,
                workflow_id=workflow_id,
                draft_key=draft_key,
                trusted_approval=resolved_trust,
            )
        except Exception as exc:  # noqa: BLE001
            return tool_err("TRANSPORT", f"MCP unreachable: {exc}")

    try:
        data = resp.json() if resp.content else {}
    except Exception:  # noqa: BLE001
        data = {}

    if isinstance(data, dict) and "success" in data:
        return data
    if resp.status_code >= 400:
        return _tool_err_from_mcp_http(resp.status_code, data)
    return tool_ok(data if isinstance(data, dict) else {"data": data})


def _tool_err_from_mcp_http(status_code: int, data: Any) -> dict[str, Any]:
    """Map MCP HTTP failures to structured tool errors (FastAPI wraps detail)."""
    msg = ""
    code_hint = ""
    if isinstance(data, dict):
        detail = data.get("detail")
        if isinstance(detail, dict):
            msg = str(detail.get("message") or detail.get("error") or "").strip()
            code_hint = str(detail.get("error") or "").strip().upper()
        elif isinstance(detail, str):
            msg = detail.strip()
        if not msg:
            msg = str(data.get("message") or data.get("error") or "").strip()
        if not code_hint:
            code_hint = str(data.get("error") or data.get("error_code") or "").strip().upper()
    if status_code in {401, 403} or code_hint in {
        "FORBIDDEN",
        "UNAUTHORIZED",
        "TOOL_NOT_ALLOWED",
    }:
        return tool_err(
            "FORBIDDEN",
            msg or "Tool not allowed for this skill",
            http_status=status_code,
            retryable=False,
        )
    if status_code == 404 or code_hint == "NOT_FOUND":
        return tool_err(
            "NOT_FOUND",
            msg or "Not found",
            http_status=status_code,
            retryable=False,
        )
    if status_code in {400, 422} or code_hint in {
        "VALIDATION_ERROR",
        "BAD_INPUT",
        "TOOL_ARGUMENT_ERROR",
    }:
        return tool_err(
            "VALIDATION_ERROR",
            msg or "Invalid tool arguments",
            http_status=status_code,
            retryable=False,
        )
    return tool_err(
        "HTTP_ERROR",
        msg or "Upstream tool call failed",
        http_status=status_code,
        retryable=status_code >= 500,
    )


def list_mcp_tools(
    *,
    token: str,
    agent: str | None = None,
    module: str | None = None,
    surface: str | None = None,
) -> list[dict[str, Any]]:
    """Discover the authenticated, fail-closed tool schema intersection."""
    from app.contracts.errors import NativeAIError

    url = f"{mcp_base_url()}/mcp/v1/tools/list"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    params = {
        key: value
        for key, value in {
            "agent": agent,
            "module": module,
            "surface": surface,
        }.items()
        if value
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, params=params, headers=headers)
    except httpx.HTTPError:
        try:
            return _list_tools_inprocess(
                token=token, agent=agent, module=module, surface=surface
            )
        except Exception as exc:  # noqa: BLE001
            err = NativeAIError(
                f"MCP tool discovery unreachable at {url}: {exc}",
                details={"url": url, "agent": agent},
            )
            err.http_status = 503
            raise err from exc
    if resp.status_code >= 400:
        err = NativeAIError(
            f"MCP tool discovery failed HTTP {resp.status_code} at {url}",
            details={"url": url, "status": resp.status_code, "agent": agent},
        )
        err.http_status = 503
        raise err
    data = resp.json() if resp.content else {}
    tools = data.get("tools") if isinstance(data, dict) else None
    return [item for item in (tools or []) if isinstance(item, dict)]
