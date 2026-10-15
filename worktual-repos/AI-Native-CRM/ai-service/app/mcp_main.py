"""Dedicated production ASGI entrypoint for the CRM MCP service.

Run separately from the agent API:
``uvicorn app.mcp_main:app --host 0.0.0.0 --port 8010``.
"""

from fastapi import FastAPI

from app.mcp.http_routes import router


def create_mcp_app() -> FastAPI:
    app = FastAPI(
        title="Worktual CRM MCP Service",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.include_router(router)
    return app


app = create_mcp_app()
