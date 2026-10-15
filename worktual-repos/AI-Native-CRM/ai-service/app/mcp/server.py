"""FastMCP coworker server — catalog/dispatch + optional HTTP mount.

In-process helpers (:func:`list_coworker_tools` / :func:`call_coworker_tool`)
power both the HTTP API (``/mcp/v1``) and unit-test fallbacks. When the
``fastmcp`` package is installed, :func:`get_fastmcp_server` also builds a
Streamable-HTTP ASGI app mounted at ``/mcp/fastmcp``.
"""

from __future__ import annotations

import logging
from typing import Any

from app.mcp.catalog import list_tools as catalog_list_tools
from app.mcp.context import McpRequestContext, get_ctx, reset_ctx, set_ctx
from app.mcp.dispatch import dispatch
from app.mcp.rbac import can_access_module, can_edit_module

log = logging.getLogger("ai-service.mcp")

_fastmcp_server = None


def get_fastmcp_server():
    """Build / return FastMCP instance when the package is installed."""
    global _fastmcp_server
    if _fastmcp_server is not None:
        return _fastmcp_server
    try:
        from fastmcp import FastMCP
    except ImportError:
        log.warning("fastmcp not installed — in-process dispatch only")
        return None

    mcp = FastMCP("worktual-crm-coworker")

    @mcp.tool(name="coworker_dispatch", description="Internal: prefer per-tool registration")
    async def _unused() -> str:
        return "use catalog tools"

    # Register each catalog tool as a FastMCP tool that forwards to dispatch.
    from app.mcp.catalog import COWORKER_TOOLS

    for tool_def in COWORKER_TOOLS:
        _register_fastmcp_tool(mcp, tool_def)

    _fastmcp_server = mcp
    return mcp


def _register_fastmcp_tool(mcp: Any, tool_def: dict[str, Any]) -> None:
    name = tool_def["name"]
    description = tool_def.get("description") or name

    async def _handler(**kwargs: Any) -> dict[str, Any]:
        return await dispatch(name, kwargs)

    _handler.__name__ = name
    _handler.__doc__ = description
    try:
        mcp.tool(name=name, description=description)(_handler)
    except Exception as exc:  # noqa: BLE001
        log.debug("skip FastMCP register %s: %s", name, exc)


async def list_coworker_tools(
    *,
    module: str | None = None,
    surface: str | None = None,
    entity_id: str | None = None,
    business_type: str | None = None,
    role: str | None = None,
    allowed_tools: list[str] | None = None,
) -> list[dict[str, Any]]:
    """MCP tools/list equivalent for agents."""
    if business_type and role and not can_access_module(module or "", business_type, role):
        return []
    tools = catalog_list_tools(module=module, surface=surface, entity_id=entity_id)
    if business_type and role and not can_edit_module(module or "", business_type, role):
        tools = [
            tool
            for tool in tools
            if not str(tool.get("name") or "").startswith(("propose_", "patch_"))
            and tool.get("name") not in {"remember_memory", "clear_memory"}
        ]
    if allowed_tools is not None:
        allowed = set(allowed_tools)
        tools = [tool for tool in tools if tool.get("name") in allowed]
    return tools


async def call_coworker_tool(
    name: str,
    arguments: dict[str, Any] | None = None,
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """MCP tools/call equivalent — runs handler (may write crm.*)."""
    ctx_in = context or {}
    existing = get_ctx()
    # Merge into existing turn context when already set by agent turn
    if existing.acting_user_id or existing.organization_id:
        if ctx_in.get("draft") and isinstance(ctx_in["draft"], dict):
            existing.draft = {**existing.draft, **ctx_in["draft"]}
        if ctx_in.get("entityId"):
            existing.entity_id = str(ctx_in["entityId"])
        if ctx_in.get("module"):
            existing.module = str(ctx_in["module"])
        if ctx_in.get("surface"):
            existing.surface = str(ctx_in["surface"])
        incoming_email = ctx_in.get("emailDraft")
        if isinstance(incoming_email, dict) and incoming_email.get("subject"):
            existing.email_draft = incoming_email
        result = await dispatch(name, arguments or {})
        return result

    ctx = McpRequestContext(
        agent_name=str(ctx_in.get("agentName") or ""),
        execution_mode=str(ctx_in.get("executionMode") or ""),
        acting_user_id=str(ctx_in.get("actingUserId") or ""),
        organization_id=str(ctx_in.get("organizationId") or ""),
        role=str(ctx_in.get("role") or ""),
        business_type=str(ctx_in.get("businessType") or ""),
        module=str(ctx_in.get("module") or ""),
        surface=str(ctx_in.get("surface") or "list"),
        policy_version=str(ctx_in.get("policyVersion") or ""),
        run_id=str(ctx_in.get("runId") or ""),
        trace_id=str(ctx_in.get("traceId") or ""),
        idempotency_key=str(ctx_in.get("idempotencyKey") or ""),
        execution_token=str(ctx_in.get("executionToken") or ""),
        entity_id=str(ctx_in.get("entityId") or "") or None,
        pathname=str(ctx_in.get("pathname") or "") or None,
        draft=ctx_in.get("draft") if isinstance(ctx_in.get("draft"), dict) else {},
        email_draft=ctx_in.get("emailDraft") if isinstance(ctx_in.get("emailDraft"), dict) else {},
    )
    set_ctx(ctx)
    try:
        return await dispatch(name, arguments or {})
    finally:
        # Keep ui_refresh on context for agent turn to read before reset
        pass


def begin_agent_mcp_context(
    *,
    acting_user_id: str,
    organization_id: str,
    role: str = "",
    agent_name: str = "",
    execution_mode: str = "",
    business_type: str = "",
    module: str = "",
    surface: str = "list",
    policy_version: str = "",
    run_id: str = "",
    trace_id: str = "",
    idempotency_key: str = "",
    execution_token: str = "",
    entity_id: str | None = None,
    pathname: str | None = None,
    draft: dict[str, Any] | None = None,
    email_draft: dict[str, Any] | None = None,
) -> McpRequestContext:
    ctx = McpRequestContext(
        agent_name=agent_name or "",
        execution_mode=execution_mode or "",
        acting_user_id=acting_user_id or "",
        organization_id=organization_id or "",
        role=role or "",
        business_type=business_type or "",
        module=module or "",
        surface=surface or "list",
        policy_version=policy_version or "",
        run_id=run_id or "",
        trace_id=trace_id or "",
        idempotency_key=idempotency_key or "",
        execution_token=execution_token or "",
        entity_id=entity_id,
        pathname=pathname,
        draft=draft if isinstance(draft, dict) else {},
        email_draft=email_draft if isinstance(email_draft, dict) else {},
    )
    set_ctx(ctx)
    return ctx


def end_agent_mcp_context() -> dict[str, Any]:
    """Return accumulated uiRefresh and clear context."""
    ctx = get_ctx()
    refresh = dict(ctx.ui_refresh) if ctx.ui_refresh else {}
    reset_ctx()
    return refresh


__all__ = [
    "begin_agent_mcp_context",
    "call_coworker_tool",
    "end_agent_mcp_context",
    "get_fastmcp_server",
    "list_coworker_tools",
]
