"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import logging

from app.logging.setup import setup_logging
from app.observability.turn_log import ensure_turn_log_directory, log_startup_probe, turn_log_file_paths
from app.websocket.router import router as ws_router
from app.routes.chat import router as chat_router
from app.routes.insights import router as insights_router
from config import get_settings

_startup_log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_logging()
    log_dir = ensure_turn_log_directory()
    _startup_log.info("Co-worker turn logs: %s", log_dir)
    _startup_log.info("Co-worker turn log files: %s", [str(p) for p in turn_log_file_paths()])
    log_startup_probe()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Worktual AI Analytics Chat",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ws_router)
    app.include_router(chat_router)
    app.include_router(insights_router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        paths = turn_log_file_paths()
        return {
            "status": "ok",
            "service": "ai-analytics-chat",
            "turn_log_primary": str(paths[0]) if paths else "",
            "turn_log_mirror": str(paths[1]) if len(paths) > 1 else "",
        }

    return app


app = create_app()
