"""MCP-only ASGI entrypoint (separate process from agent API)."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.mcp.routes import router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        yield
    finally:
        from app.db import close_pool

        close_pool()


app = FastAPI(
    title="Worktual Ticketing MCP",
    description="HTTP MCP catalog + dispatch for Ticketing tools",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://rebuild-ticketing.worktual.com",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "ticketing-mcp"}
