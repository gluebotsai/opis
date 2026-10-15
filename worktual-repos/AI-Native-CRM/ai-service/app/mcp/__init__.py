"""Coworker MCP package — agent-only FastMCP + direct crm.* writes.

Import submodules directly (``app.mcp.catalog``, ``app.mcp.server``, …) to
avoid pulling asyncpg/settings at catalog-import time.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "begin_agent_mcp_context",
    "call_coworker_tool",
    "end_agent_mcp_context",
    "get_fastmcp_server",
    "list_coworker_tools",
]


def __getattr__(name: str) -> Any:
    if name in __all__:
        from app.mcp import server as _server

        return getattr(_server, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
