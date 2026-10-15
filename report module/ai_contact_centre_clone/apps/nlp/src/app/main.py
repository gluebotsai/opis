"""FastAPI entry point for Worktual's MCP-based NLP service."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import create_api_router
from app.config import Settings, get_settings
from app.logging import configure_logging, get_logger


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)

    application = FastAPI(
        title=settings.app_name,
        description="MCP and multi-agent NLP backend for Worktual Contact Center",
        version="1.0.0",
    )
    cors_origins = settings.cors_origin_list
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Accept",
            "X-Tenant-Id",
            "X-User-Id",
            "X-Internal-Service-Key",
        ],
    )
    application.include_router(create_api_router(settings))

    @application.get("/")
    async def root() -> dict[str, str]:
        return {"message": "Welcome to Worktual Contact Center NLP service!"}

    get_logger("nlp.service").info(
        "NLP service started",
        extra={"event": "service_started"},
    )
    return application


app = create_app()
