# ==============================================================================
# api.py — Clean FastAPI Endpoint for Knowledge Graph Agent
# ==============================================================================

import time
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .models import KnowledgeGraphRequest, KnowledgeGraphResponse
from .agent import run_knowledge_graph_agent
from .diagnostic import diagnose_from_metrics

router = APIRouter(prefix="", tags=["Knowledge Graph Agent"])


class DiagnosticRequest(BaseModel):
    query: str = Field(..., description="The 'why' diagnostic query")
    sql_metrics: List[Dict[str, Any]] = Field(default_factory=list, description="SQL metrics retrieved for the comparison")
    organization_id: Optional[str] = Field(None, description="Tenant organization ID")


@router.post("/query", response_model=KnowledgeGraphResponse)
async def query_endpoint(payload: KnowledgeGraphRequest, req: Request):
    """
    Main endpoint for super agents and orchestrators.
    Executes Knowledge Graph analytics with strict read-only guarantees,
    tenant allowlist enforcement, and structured audit logging.
    """
    # Header overrides if present
    org_id = (
        payload.organization_id
        or req.headers.get("x-organization-id")
        or req.headers.get("x-tenant-id")
    )
    user_id = payload.user_id or req.headers.get("x-user-id")

    return await run_knowledge_graph_agent(
        query=payload.query,
        organization_id=org_id,
        user_id=user_id,
        role=payload.role,
        scope=payload.scope,
        session_id=payload.session_id or payload.sessionID,
        debug=bool(payload.debug),
    )


@router.post("/diagnostic")
async def diagnostic_endpoint(payload: DiagnosticRequest):
    """
    Collaborative root-cause diagnostic endpoint for 'why' questions.
    Combines SQL metric distributions with Neo4j operational context.
    """
    explanation = await diagnose_from_metrics(
        query=payload.query,
        sql_rows=payload.sql_metrics,
        org_id=payload.organization_id,
    )
    return {
        "status": "ok",
        "explanation": explanation,
        "organization_id": payload.organization_id,
    }


@router.get("/health")
async def health_endpoint():
    """Health check endpoint for container orchestrators and supervisors."""
    return {"status": "healthy", "service": "knowledge_graph_agent"}


def get_knowledge_graph_router() -> APIRouter:
    """Return FastAPI APIRouter ready to mount on a super-agent application."""
    return router


# Standalone ASGI App instance for running independently
app = FastAPI(
    title="Knowledge Graph Agent Microservice",
    description="Headless analytics and graph reasoning endpoint for super agents.",
    version="1.0.0",
)
app.include_router(router)
