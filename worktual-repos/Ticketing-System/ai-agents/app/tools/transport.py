"""Route domain tools to Express or Ticketing MCP based on TOOLS_TRANSPORT."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.config import get_settings


def tools_transport() -> str:
    raw = (get_settings().tools_transport or "express").strip().lower()
    return "mcp" if raw == "mcp" else "express"


def invoke_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    express_call: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """Call MCP when tools_transport=mcp; otherwise run the Express path."""
    if tools_transport() == "mcp":
        from app.tools.mcp_client import call_tool

        return call_tool(name, arguments)
    return express_call()
