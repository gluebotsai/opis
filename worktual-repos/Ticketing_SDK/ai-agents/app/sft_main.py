"""SFT catalog ASGI entrypoint (separate process from coworker, MCP, and Hub A2A)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.sft.server import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        yield
    finally:
        from app.db import close_pool

        close_pool()


app = FastAPI(
    title="Worktual Ticketing SFT Catalog",
    description="Internal agent-definition APIs for the Ticketing SFT pipeline",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
