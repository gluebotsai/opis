from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.semrush_routes import router as semrush_router
from app.api.seo_keyword_estimate_routes import router as seo_estimate_router
from app.api.seo_social_generate_routes import router as seo_social_generate_router
from app.config import get_settings
from app.mcp.http_routes import router as mcp_router


def _try_fastmcp_http_app() -> tuple[Optional[Any], Optional[Any]]:
    """Return (asgi_app, lifespan) when fastmcp is installed (Python ≥3.10)."""
    try:
        from app.mcp.server import get_fastmcp_server

        mcp = get_fastmcp_server()
        if mcp is None:
            return None, None
        # Streamable HTTP ASGI app — mount at /mcp/fastmcp when available
        http_app = mcp.http_app(path="/")
        return http_app, getattr(http_app, "lifespan", None)
    except Exception:
        return None, None


def create_app() -> FastAPI:
    settings = get_settings()
    mount_mcp = settings.mcp_mount_in_api and settings.app_env.lower() != "production"
    fastmcp_app, fastmcp_lifespan = (
        _try_fastmcp_http_app() if mount_mcp else (None, None)
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        from app.agent_log import (
            coworker_log_path,
            fmt,
            logger,
            proactive_log_path,
            proactive_logger,
        )

        coworker_path = coworker_log_path()
        proactive_path = proactive_log_path()
        logger.info(
            fmt(
                agent="ai-service",
                step="ready",
                channel="coworker",
                path=str(coworker_path),
            )
        )
        proactive_logger.info(
            fmt(
                agent="ai-service",
                step="ready",
                channel="proactive",
                path=str(proactive_path),
            )
        )
        if fastmcp_lifespan is not None:
            async with fastmcp_lifespan(app):
                yield
        else:
            yield

    app = FastAPI(
        title="Worktual AI Service",
        version="1.0.0",
        lifespan=lifespan,
    )
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.include_router(semrush_router)
    app.include_router(seo_estimate_router)
    app.include_router(seo_social_generate_router)
    # Development compatibility only. Production runs app.mcp_main separately.
    if mount_mcp:
        app.include_router(mcp_router)
        if fastmcp_app is not None:
            app.mount("/mcp/fastmcp", fastmcp_app)
    return app


app = create_app()
