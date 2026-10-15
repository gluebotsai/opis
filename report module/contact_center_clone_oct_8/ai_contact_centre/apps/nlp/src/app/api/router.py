"""Compose the new API boundary without mutating the FastAPI entrypoint."""

from fastapi import APIRouter

from app.api.bot import create_bot_router
from app.api.contact_entities import create_contact_entities_router
from app.api.copilot import create_copilot_router
from app.api.dashboard_analytics import create_dashboard_analytics_router
from app.api.health import create_health_router
from app.api.omnichannel import create_omnichannel_router
from app.api.proactive import create_proactive_router
from app.api.reports import create_reports_router
from app.api.supervisor import create_supervisor_router
from app.api.voice_routing import create_voice_routing_router
from app.api.workspace import create_workspace_router
from app.config import Settings, get_settings


def create_api_router(settings: Settings | None = None) -> APIRouter:
    settings = settings or get_settings()
    router = APIRouter()
    router.include_router(create_health_router())
    router.include_router(create_reports_router())
    router.include_router(create_supervisor_router())
    router.include_router(create_dashboard_analytics_router())
    router.include_router(create_voice_routing_router())
    for base in settings.api_v1_bases:
        router.include_router(create_copilot_router(base))
        router.include_router(create_bot_router(base))
        router.include_router(create_contact_entities_router(base))
        router.include_router(create_omnichannel_router(base))
        router.include_router(create_workspace_router(base))
        router.include_router(create_proactive_router(base))
    return router
