"""Authenticated HTTP MCP surface for agents and future internal hubs."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.mcp.security import (
    ExecutionClaims,
    authenticate_mcp_request,
    verify_context_matches_claims,
)
from app.mcp.server import (
    begin_agent_mcp_context,
    call_coworker_tool,
    end_agent_mcp_context,
    list_coworker_tools,
)

router = APIRouter(prefix="/mcp/v1", tags=["mcp"])


class McpContextBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    agentName: Optional[str] = None
    executionMode: Optional[str] = None
    actingUserId: Optional[str] = None
    organizationId: Optional[str] = None
    role: Optional[str] = None
    businessType: Optional[str] = None
    module: Optional[str] = None
    surface: Optional[str] = "list"
    policyVersion: Optional[str] = None
    runId: Optional[str] = None
    traceId: Optional[str] = None
    idempotencyKey: Optional[str] = None
    entityId: Optional[str] = None
    pathname: Optional[str] = None
    draft: Optional[dict[str, Any]] = None
    emailDraft: Optional[dict[str, Any]] = None
    contentAgent: Optional[bool] = None


class ToolsListRequest(BaseModel):
    module: Optional[str] = None
    surface: Optional[str] = "list"
    entityId: Optional[str] = None
    context: Optional[McpContextBody] = None


class ToolsCallRequest(BaseModel):
    name: str = Field(min_length=1)
    arguments: Optional[dict[str, Any]] = None
    context: Optional[McpContextBody] = None


def _ctx_dict(
    body_ctx: Optional[McpContextBody],
) -> dict[str, Any]:
    return body_ctx.model_dump(exclude_none=True) if body_ctx else {}


@router.get("/health")
async def mcp_health(
    _claims: ExecutionClaims | None = Depends(authenticate_mcp_request),
) -> dict[str, str]:
    return {"status": "ok", "server": "worktual-crm-coworker"}


@router.post("/tools/list")
async def tools_list(
    body: ToolsListRequest,
    claims: ExecutionClaims | None = Depends(authenticate_mcp_request),
) -> dict[str, Any]:
    ctx = _ctx_dict(body.context)
    module = body.module or ctx.get("module")
    surface = body.surface or ctx.get("surface") or "list"
    entity_id = body.entityId or ctx.get("entityId")
    if ctx.get("module") and body.module and ctx["module"] != body.module:
        raise HTTPException(status_code=403, detail="MCP scope mismatch: module")
    if ctx.get("surface") and body.surface and ctx["surface"] != body.surface:
        raise HTTPException(status_code=403, detail="MCP scope mismatch: surface")
    ctx["module"] = module
    ctx["surface"] = surface
    verify_context_matches_claims(ctx, claims)
    tools = await list_coworker_tools(
        module=module,
        surface=surface,
        entity_id=entity_id,
        business_type=str(ctx.get("businessType") or ""),
        role=str(ctx.get("role") or ""),
        allowed_tools=claims.allowed_tools if claims else None,
    )
    return {"tools": tools}


@router.post("/tools/call")
async def tools_call(
    body: ToolsCallRequest,
    claims: ExecutionClaims | None = Depends(authenticate_mcp_request),
    authorization: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    ctx = _ctx_dict(body.context)
    verify_context_matches_claims(ctx, claims)
    effective = await list_coworker_tools(
        module=str(ctx.get("module") or ""),
        surface=str(ctx.get("surface") or "list"),
        entity_id=str(ctx.get("entityId") or "") or None,
        business_type=str(ctx.get("businessType") or ""),
        role=str(ctx.get("role") or ""),
        allowed_tools=claims.allowed_tools if claims else None,
    )
    if body.name.strip() not in {str(tool.get("name")) for tool in effective}:
        raise HTTPException(status_code=403, detail="Tool is outside the effective MCP scope")
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    begin_agent_mcp_context(
        agent_name=str(ctx.get("agentName") or ""),
        execution_mode=str(ctx.get("executionMode") or ""),
        acting_user_id=str(ctx.get("actingUserId") or ""),
        organization_id=str(ctx.get("organizationId") or ""),
        role=str(ctx.get("role") or ""),
        business_type=str(ctx.get("businessType") or ""),
        module=str(ctx.get("module") or ""),
        surface=str(ctx.get("surface") or "list"),
        policy_version=str(ctx.get("policyVersion") or ""),
        run_id=str(ctx.get("runId") or ""),
        trace_id=str(ctx.get("traceId") or ""),
        idempotency_key=str(ctx.get("idempotencyKey") or ""),
        execution_token=token,
        entity_id=str(ctx.get("entityId") or "") or None,
        pathname=str(ctx.get("pathname") or "") or None,
        draft=ctx.get("draft") if isinstance(ctx.get("draft"), dict) else {},
        email_draft=ctx.get("emailDraft") if isinstance(ctx.get("emailDraft"), dict) else {},
    )
    try:
        result = await call_coworker_tool(
            body.name.strip(), body.arguments or {}, context=ctx
        )
    finally:
        ui_refresh = end_agent_mcp_context()
    if not isinstance(result, dict):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Tool returned no result",
        )
    if ui_refresh:
        result = {**result, "uiRefresh": ui_refresh}
    return result
