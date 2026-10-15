"""Organization MCP server scoped only by trusted tenant context."""

from typing import Any

from mcp.server.fastmcp import FastMCP

from app.mcp.context import CcCoreHTTPAdapter, get_tool_context, get_trusted_context
from app.services.knowledge_search import search_knowledge_gateway


class OrganizationMCPServer:
    tool_names = (
        "get_organization_details",
        "get_organization_knowledge",
        "recommend_live_agent_handoff",
    )

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("organization")
        self.mcp.tool(
            name="get_organization_details",
            description="Fetch official details for the trusted tenant.",
        )(self.get_organization_details)
        self.mcp.tool(
            name="get_organization_knowledge",
            description=(
                "Search the organization knowledge base (business, product, or support). "
                "Pick exactly one module from the customer question: "
                "business (company/brand), product (features/plans), "
                "support (how-to, troubleshooting, policies). "
                "Do not use this for the customer's own name, city, company, phone, "
                "or prior chats — those come from the contact profile and channel summaries. "
                "Do not retry with a different module if results are empty."
            ),
        )(self.get_organization_knowledge)
        self.mcp.tool(
            name="recommend_live_agent_handoff",
            description=(
                "Call only when the customer explicitly asks to speak with a live agent, "
                "human, or representative."
            ),
        )(self.recommend_live_agent_handoff)

    async def get_organization_details(self) -> dict[str, Any]:
        context = get_tool_context()
        return await self.http.request(
            "GET",
            f"/internal/v1/organizations/{context.tenant_id}/details",
            context,
            internal=True,
        )

    async def get_organization_knowledge(self, query: str, module: str) -> dict[str, Any]:
        context = get_tool_context()
        # Surface lives on TrustedMCPContext (channel), not ToolContext.
        try:
            channel = get_trusted_context().surface
        except RuntimeError:
            channel = None
        return await search_knowledge_gateway(
            query,
            organization_id=context.tenant_id,
            module=module,
            channel=channel,
        )

    async def recommend_live_agent_handoff(self, reason: str | None = None) -> dict[str, Any]:
        return {"handoff_recommended": True, "reason": reason or "explicit_request"}
