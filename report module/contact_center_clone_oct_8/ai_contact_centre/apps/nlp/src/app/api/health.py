"""Service health and readiness endpoints."""

from datetime import timedelta

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from mcp.shared.memory import create_connected_server_and_client_session

from app.agents.definitions import validate_agent_dependencies
from app.config import Settings, get_settings
from app.mcp.registry import get_mcp_registry
from app.skills.registry import get_skill_registry


async def readiness_failures(settings: Settings) -> list[str]:
    missing: list[str] = []
    if not settings.chat_openai_api_key:
        missing.append("CHAT_OPENAI_API_KEY")
    if not settings.together_api_key:
        missing.append("TOGETHER_API_KEY")
    if settings.internal_service_key_required and not settings.internal_service_key:
        missing.append("INTERNAL_SERVICE_KEY")
    if not settings.debug and not settings.jwt_secret:
        missing.append("JWT_SECRET")
    registry = get_mcp_registry()
    skills = set(get_skill_registry().skills)
    metric_domains = {"performance", "workforce", "omnichannel"}
    missing.extend(
        validate_agent_dependencies(
            available_skills=skills,
            available_metric_domains=metric_domains,
        )
    )
    for server_name, server in registry.servers.items():
        try:
            async with create_connected_server_and_client_session(
                server.mcp,
                read_timeout_seconds=timedelta(seconds=3),
                raise_exceptions=True,
            ) as session:
                catalog = await session.list_tools()
            if {tool.name for tool in catalog.tools} != set(server.tool_names):
                missing.append(f"{server_name}: MCP tool catalog mismatch")
        except Exception as error:
            missing.append(f"{server_name}: MCP session failed: {error}")
    return missing


def create_health_router() -> APIRouter:
    router = APIRouter(tags=["Health"])

    @router.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "healthy"}

    @router.get("/health/ready")
    async def readiness() -> JSONResponse:
        missing = await readiness_failures(get_settings())
        if missing:
            return JSONResponse(
                status_code=503,
                content={
                    "status": "not_ready",
                    "reason": f"Missing: {', '.join(missing)}",
                },
            )
        return JSONResponse(content={"status": "ready"})

    return router
