"""MCP-only ASGI entrypoint (separate process from agent API)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.mcp.routes import router

app = FastAPI(
    title="Worktual Ticketing MCP",
    description="HTTP MCP catalog + dispatch for Ticketing tools",
    version="1.0.0",
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
