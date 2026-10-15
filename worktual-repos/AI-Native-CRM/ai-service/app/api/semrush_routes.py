"""Internal Semrush MCP sync — credentials come from Fastify (never invent tenants)."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_internal_secret
from app.integrations.semrush.sync import run_semrush_sync
from app.integrations.semrush.keywords import research_keywords_live
from app.integrations.semrush_gateway import is_semrush_gateway_configured

router = APIRouter()


def _semrush_mcp_enabled() -> bool:
    raw = (os.environ.get("SEMRUSH_MCP_ENABLED") or "").strip().lower()
    return raw in ("true", "1", "on")


class SemrushConnectionPayload(BaseModel):
    mcpUrl: str | None = None
    tokenUrl: str | None = None
    oauthClientId: str | None = None
    scopes: str | None = None
    accessToken: str | None = None
    refreshToken: str | None = None
    tokenType: str | None = "Bearer"


class SemrushSyncRequest(BaseModel):
    organizationId: str = Field(min_length=1)
    connection: SemrushConnectionPayload
    adHocDomain: str | None = None


class SemrushKeywordRequest(BaseModel):
    organizationId: str = Field(min_length=1)
    seed: str = Field(min_length=1)
    location: str | None = "us"
    language: str | None = "en"
    connection: SemrushConnectionPayload | None = None


@router.post("/ai/v1/internal/semrush/sync")
async def semrush_sync(
    body: SemrushSyncRequest,
    _: None = Depends(require_internal_secret),
) -> dict[str, Any]:
    if not _semrush_mcp_enabled():
        return {
            "organizationId": body.organizationId,
            "ok": False,
            "error": (
                "Semrush MCP is disconnected. Live Semrush calls are disabled until "
                "explicitly re-enabled (SEMRUSH_MCP_ENABLED) with owner permission."
            ),
            "projects": [],
            "snapshots": [],
            "tokens": None,
            "mcpError": True,
        }
    result = run_semrush_sync(
        body.connection.model_dump(),
        ad_hoc_domain=body.adHocDomain,
    )
    return {"organizationId": body.organizationId, **result}


@router.post("/ai/v1/internal/semrush/keywords")
async def semrush_keywords(
    body: SemrushKeywordRequest,
    _: None = Depends(require_internal_secret),
) -> dict[str, Any]:
    if not is_semrush_gateway_configured() and not _semrush_mcp_enabled():
        return {
            "organizationId": body.organizationId,
            "ok": False,
            "rows": [],
            "error": (
                "Semrush gateway is not configured. Set SEMRUSH_GATEWAY_TOKEN "
                "(or SEMRUSH_MCP_ENABLED for the legacy MCP path)."
            ),
            "budgetSkipped": False,
        }
    result = research_keywords_live(
        body.connection.model_dump() if body.connection else {},
        organization_id=body.organizationId,
        seed=body.seed,
        location=body.location or "us",
        language=body.language or "en",
    )
    return {"organizationId": body.organizationId, **result}
