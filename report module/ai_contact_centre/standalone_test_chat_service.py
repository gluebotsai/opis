"""Standalone Chat Test Service for Worktual Contact Center & Reports Analytics Agent.

This service is a completely isolated testbench created exclusively for local testing.
- Bypasses UI login flows (no session rows or audit records written to the CCaaS DB).
- Accepts strictly: query, session_id, organization_id, user_id (with optional role & mode).
- Outputs 100% comprehensive agent results (agent routed, reply, card, grounded facts, trace, latency).
- Logs all operations to a dedicated file: `test_chat_service.log`.
- Completely independent: DELETING THIS FILE AND ITS LOG DOES NOT AFFECT THE PRODUCT.
"""

from __future__ import annotations

import logging
import os
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ensure apps/nlp/src is in python path
WORKSPACE_ROOT = Path(__file__).resolve().parent
NLP_SRC = WORKSPACE_ROOT / "apps" / "nlp" / "src"
if str(NLP_SRC) not in sys.path:
    sys.path.insert(0, str(NLP_SRC))

from app.agents.coworker import create_coworker_agent
from app.config import get_settings
from app.llm.assist_client import get_assist_llm_client
from app.llm.client import get_llm_client
from app.runtime.context import RunContext
from app.runtime.router import AgentRouter

# ---------------------------------------------------------------------------
# Dedicated Logging Configuration
# ---------------------------------------------------------------------------
LOG_FILE = WORKSPACE_ROOT / "test_chat_service.log"

logger = logging.getLogger("standalone_test_chat")
logger.setLevel(logging.INFO)
logger.propagate = False  # Do not pollute root logger

# Clear existing handlers if reloaded
if logger.hasHandlers():
    logger.handlers.clear()

file_formatter = logging.Formatter(
    fmt="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
file_handler = logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(file_formatter)
logger.addHandler(file_handler)

stream_formatter = logging.Formatter(
    fmt="\033[36m%(asctime)s\033[0m [\033[32m%(levelname)s\033[0m] %(message)s",
    datefmt="%H:%M:%S",
)
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setLevel(logging.INFO)
stream_handler.setFormatter(stream_formatter)
logger.addHandler(stream_handler)


# ---------------------------------------------------------------------------
# FastAPI App Definition
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Contact Center Chat - Standalone Test Service",
    description=(
        "Isolated testbench for querying Contact Center Agents & Reports Analytics Module.\n\n"
        "**Zero DB Side Effects:** Bypasses login tokens and UI session recording.\n"
        "**Dedicated Log:** All requests and execution traces are recorded to `test_chat_service.log`."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global router instance
_agent_router: AgentRouter | None = None


def get_router() -> AgentRouter:
    global _agent_router
    if _agent_router is None:
        logger.info("Initializing AgentRouter (Contact Center Super + Domain Spokes)...")
        _agent_router = create_coworker_agent(
            llm=get_llm_client(),
            assist_llm=get_assist_llm_client(),
        )
        logger.info(f"AgentRouter ready. Active agents: {list(_agent_router.agents.keys())}")
    return _agent_router


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ChatTestRequest(BaseModel):
    query: str = Field(
        ...,
        description="The user's question, metric query, or prompt",
        example="What is our CSAT and Average Handle Time this week?",
    )
    session_id: str = Field(
        ...,
        description="Session identifier for tracking turns (e.g. 'test-session-001')",
        example="test-session-001",
    )
    organization_id: str = Field(
        ...,
        description="Tenant / Organization ID (e.g. '1001')",
        example="1001",
    )
    user_id: str = Field(
        ...,
        description="User identifier (e.g. '101')",
        example="101",
    )
    role: str = Field(
        default="admin",
        description="User access role: 'admin', 'supervisor', or 'agent'",
        example="admin",
    )
    mode: Literal["auto", "reports_direct"] = Field(
        default="auto",
        description=(
            "'auto': Routes through Contact Center Super Agent (tests full routing pipeline).\n"
            "'reports_direct': Routes directly to Reports Analytics Domain Agent."
        ),
        example="auto",
    )


class ChatTestResponse(BaseModel):
    status: Literal["success", "error"]
    query: str
    session_id: str
    organization_id: str
    user_id: str
    role: str
    mode: str
    agent_routed: str
    reply: str
    card: str | None = None
    grounded: bool | None = None
    trace: dict[str, Any] | None = None
    latency_ms: float
    error: str | None = None


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "service": "Contact Center Standalone Chat Test Service",
        "status": "online",
        "docs_url": "/docs",
        "log_file": str(LOG_FILE),
    }


@app.get("/health")
async def health_check():
    router = get_router()
    return {
        "status": "healthy",
        "registered_agents": list(router.agents.keys()),
        "reports_analytics_active": "reports_analytics_agent" in router.agents,
        "super_agent_active": "contact_center_super" in router.agents,
        "log_location": str(LOG_FILE),
    }


@app.post("/chat", response_model=ChatTestResponse)
async def chat_test_endpoint(req: ChatTestRequest):
    """Execute a query against the contact center chat pipeline without frontend login."""
    start_time = time.perf_counter()
    logger.info(
        f"[REQUEST] session_id={req.session_id} org={req.organization_id} "
        f"user={req.user_id} role={req.role} mode={req.mode} query={req.query!r}"
    )

    context = RunContext(
        tenant_id=req.organization_id,
        user_id=req.user_id,
        role=req.role,
        conversation_id=req.session_id,
        surface="dashboard" if req.mode == "auto" else "reports",
        path="/test",
    )
    messages = [{"role": "user", "content": req.query}]

    try:
        router = get_router()
        if req.mode == "reports_direct":
            # Direct execution on the reports_analytics_agent domain spoke
            result = await router.run_agent("reports_analytics_agent", messages, context)
        else:
            # Full Super Agent routing pipeline
            result = await router.route_and_run(messages, context)

        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        agent_routed = str(result.get("agent") or "unknown")
        reply = str(result.get("reply") or "")
        card = result.get("card")
        grounded = result.get("grounded")
        trace = result.get("trace")

        logger.info(
            f"[RESPONSE] session_id={req.session_id} agent={agent_routed} "
            f"latency={latency_ms}ms grounded={grounded} reply_snippet={reply[:120]!r}"
        )

        return ChatTestResponse(
            status="success",
            query=req.query,
            session_id=req.session_id,
            organization_id=req.organization_id,
            user_id=req.user_id,
            role=req.role,
            mode=req.mode,
            agent_routed=agent_routed,
            reply=reply,
            card=card,
            grounded=grounded,
            trace=trace,
            latency_ms=latency_ms,
        )

    except Exception as exc:
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        logger.error(
            f"[ERROR] session_id={req.session_id} latency={latency_ms}ms error={str(exc)}",
            exc_info=True,
        )
        return ChatTestResponse(
            status="error",
            query=req.query,
            session_id=req.session_id,
            organization_id=req.organization_id,
            user_id=req.user_id,
            role=req.role,
            mode=req.mode,
            agent_routed="error",
            reply=f"<p>Execution failed: {exc}</p>",
            latency_ms=latency_ms,
            error=str(exc),
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8008"))
    print("\n" + "=" * 65)
    print(f"🚀 Standalone Chat Test Service starting on http://0.0.0.0:{port}")
    print(f"📖 Swagger UI (Interactive Test IDE): http://localhost:{port}/docs")
    print(f"📝 Dedicated Log File: {LOG_FILE}")
    print("=" * 65 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=port)
