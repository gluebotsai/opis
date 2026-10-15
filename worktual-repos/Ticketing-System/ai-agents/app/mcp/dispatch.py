"""Dispatch MCP tool calls to Express / in-process executors."""

from __future__ import annotations

import json
from typing import Any

from app.contracts.errors import ToolArgumentError, ToolNotAllowed
from app.mcp.authorization import assert_tool_authorized, verify_mcp_token
from app.mcp.catalog import catalog_by_name
from app.tools.bound import execute_tool_call
from app.tools.express_client import ToolActor, tool_actor_scope


def dispatch_tool(
    name: str,
    arguments: dict[str, Any] | None,
    *,
    agent: str,
    actor: ToolActor,
    module: str | None = None,
    surface: str | None = None,
    mcp_token: str | None = None,
    operation: str | None = None,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
    trusted_approval: str | None = None,
) -> dict[str, Any]:
    tool_name = (name or "").strip()
    if not tool_name:
        raise ToolArgumentError("tool name is required")
    if tool_name == "route_to_agent":
        raise ToolNotAllowed("route_to_agent is handled by the supervisor, not MCP")

    catalog = catalog_by_name()
    if tool_name not in catalog:
        raise ToolNotAllowed(f"Unknown tool: {tool_name}")

    claims = verify_mcp_token(mcp_token) if mcp_token else None
    assert_tool_authorized(
        tool_name=tool_name,
        agent=agent,
        role=actor.user_role,
        module=module,
        surface=surface,
        token_claims=claims,
        operation=operation,
    )

    args = dict(arguments or {})
    if claims:
        claim_org = str(claims.get("organization_id") or "").strip()
        for key in ("organization_id", "organizationId", "org_id", "tenant_id"):
            supplied = str(args.get(key) or "").strip()
            if supplied and claim_org and supplied != claim_org:
                raise ToolNotAllowed("Tool arguments cannot override token organization")
        if claim_org and any(
            key in args
            for key in ("organization_id", "organizationId", "org_id", "tenant_id")
        ):
            args["organization_id"] = claim_org
            args.pop("organizationId", None)
            args.pop("org_id", None)
            args.pop("tenant_id", None)
    with tool_actor_scope(actor):
        raw = execute_tool_call(
            agent,
            tool_name,
            args,
            operation=operation,
            role=actor.user_role,
            draft=draft,
            workflow_id=workflow_id,
            draft_key=draft_key,
            last_query=(
                {"pending_update": {"approval_mode": trusted_approval}}
                if trusted_approval in {"proactive_asga", "trusted_structured"}
                else None
            ),
        )
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else {"payload": raw}
        return parsed if isinstance(parsed, dict) else {"success": True, "payload": parsed}
    except json.JSONDecodeError:
        return {"success": True, "payload": {"raw": str(raw)[:4000]}}
