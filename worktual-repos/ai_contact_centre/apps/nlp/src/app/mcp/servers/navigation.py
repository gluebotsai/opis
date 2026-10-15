"""Navigation MCP server for safe internal workspace paths."""

from typing import Any

from mcp.server.fastmcp import FastMCP


class NavigationMCPServer:
    tool_names = ("navigate",)

    def __init__(self) -> None:
        self.mcp = FastMCP("navigation")
        self.mcp.tool(
            name="navigate",
            description="Open an internal /admin/ or /agent/ contact-center page.",
        )(self.navigate)

    async def navigate(self, path: str) -> dict[str, Any]:
        if not path.startswith(("/admin/", "/agent/")):
            raise ValueError("Navigation path must stay inside the contact-center application")
        return {"path": path}
