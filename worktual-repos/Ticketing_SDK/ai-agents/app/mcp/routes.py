"""HTTP MCP routes: /mcp/v1/tools/list and /call."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.contracts.errors import NativeAIError, ToolNotAllowed
from app.mcp.authorization import authorized_tool_names, verify_mcp_token
from app.mcp.catalog import list_catalog_public
from app.mcp.dispatch import dispatch_tool
from app.tools.express_client import ToolActor, resolve_portal_customer_id


router = APIRouter(prefix="/mcp/v1")


class ToolCallBody(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    agent: str | None = None
    module: str | None = None
    surface: str | None = None
    operation: str | None = None
    draft: dict[str, Any] | None = None
    workflow_id: str | None = None
    draft_key: str | None = None
    trusted_approval: str | None = None


def _claim_bound(
    claims: dict[str, Any],
    key: str,
    requested: str | None,
    *,
    default: str | None = None,
) -> str | None:
    pinned = str(claims.get(key) or "").strip()
    supplied = str(requested or "").strip()
    if pinned and supplied and pinned.lower() != supplied.lower():
        raise ToolNotAllowed(f"MCP token {key} mismatch")
    return pinned or supplied or default


def _actor_from_claims(claims: dict[str, Any], request: Request) -> ToolActor:
    role = str(claims.get("role") or request.headers.get("X-Coworker-Actor-Role") or "")
    actor_id = str(
        claims.get("actor_id") or request.headers.get("X-Coworker-Actor-Id") or ""
    )
    return ToolActor(
        user_id=actor_id,
        organization_id=str(
            claims.get("organization_id")
            or request.headers.get("X-Coworker-Organization-Id")
            or ""
        ),
        user_role=role,
        user_name=str(request.headers.get("X-Coworker-Actor-Name") or ""),
        request_id=str(claims.get("run_id") or request.headers.get("X-Request-Id") or ""),
        portal_customer_id=resolve_portal_customer_id(
            role=role,
            actor_id=actor_id,
            portal_customer_id=request.headers.get("X-Portal-Customer-Id"),
        ),
    )


@router.get("/tools/list")
def tools_list(
    authorization: str | None = Header(default=None),
    agent: str | None = None,
    module: str | None = None,
    surface: str | None = None,
) -> dict[str, Any]:
    token = _bearer(authorization)
    claims = verify_mcp_token(token)
    try:
        selected_agent = _claim_bound(
            claims, "agent_id", agent, default="general"
        ) or "general"
        selected_module = _claim_bound(claims, "module", module)
        selected_surface = _claim_bound(claims, "surface", surface)
        allowed = authorized_tool_names(
            agent=selected_agent,
            module=selected_module,
            surface=selected_surface,
            token_claims=claims,
        )
        tools = list_catalog_public(allowed_names=allowed)
        return {"tools": tools}
    except NativeAIError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.to_dict()) from exc


@router.post("/tools/call")
def tools_call(
    body: ToolCallBody,
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    try:
        token = _bearer(authorization)
        claims = verify_mcp_token(token)
        actor = _actor_from_claims(claims, request)
        if not actor.user_id or not actor.organization_id:
            raise ToolNotAllowed("MCP token missing actor/org")
        selected_agent = _claim_bound(
            claims, "agent_id", body.agent, default="general"
        ) or "general"
        selected_module = _claim_bound(claims, "module", body.module)
        selected_surface = _claim_bound(claims, "surface", body.surface)
        trusted = body.trusted_approval
        if trusted not in {"proactive_asga", "trusted_structured"}:
            trusted = (
                "proactive_asga"
                if str(claims.get("route_mode") or "") == "proactive"
                else None
            )
        return dispatch_tool(
            body.name,
            body.arguments,
            agent=selected_agent,
            actor=actor,
            module=selected_module,
            surface=selected_surface,
            mcp_token=token,
            operation=body.operation,
            draft=body.draft if isinstance(body.draft, dict) else None,
            workflow_id=body.workflow_id,
            draft_key=body.draft_key,
            trusted_approval=trusted,
        )
    except NativeAIError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.to_dict()) from exc


def _bearer(authorization: str | None) -> str:
    raw = (authorization or "").strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    if raw:
        return raw
    raise HTTPException(status_code=401, detail="MCP bearer token required")
