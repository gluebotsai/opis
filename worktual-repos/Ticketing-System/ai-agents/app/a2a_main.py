"""A2A-only ASGI entrypoint (separate process from agent API and MCP)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.a2a.log import log_ready
from app.a2a.server import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log_ready()
    yield


app = FastAPI(
    title="Worktual Ticketing A2A",
    description="Hub-facing A2A spoke for Ticketing",
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
