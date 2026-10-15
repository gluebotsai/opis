"""HTTP routes for Campaign SFT agent catalog."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.sft_catalog.auth import require_internal_service_key
from app.sft_catalog.builder import export_agents, get_agent, list_agents

router = APIRouter(
    prefix="/internal/v1",
    tags=["sft-agent-catalog"],
    dependencies=[Depends(require_internal_service_key)],
)


@router.get("/agents")
async def agents_list():
    return list_agents()


@router.get("/agents/export")
async def agents_export():
    return export_agents()


@router.get("/agents/{agent_id}")
async def agents_detail(agent_id: str):
    # Reserve "export" for the collection route above (FastAPI matches static first).
    payload = get_agent(agent_id)
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent id: {agent_id}")
    return payload
