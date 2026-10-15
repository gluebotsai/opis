"""Conversation MCP server using trusted selected-conversation context."""

from mcp.server.fastmcp import FastMCP

from app.mcp.context import CcCoreError, CcCoreHTTPAdapter, get_tool_context


class ConversationMCPServer:
    tool_names = (
        "get_conversation_context",
        "suggest_reply",
        "summarize_conversation",
    )

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("conversation")
        descriptions = {
            "get_conversation_context": "Read bounded context for the selected conversation.",
            "suggest_reply": "Draft a grounded reply for review; never send it.",
            "summarize_conversation": "Summarize the selected conversation.",
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    async def _read(self, task: str) -> dict[str, object]:
        context = get_tool_context()
        if not context.conversation_id:
            raise CcCoreError("Select a conversation before using this inbox tool")
        payload = await self.http.request(
            "GET",
            f"/api/v1/workspace/conversations/{context.conversation_id}/context",
            context,
        )
        instructions = {
            "context": "Use this bounded, authoritative context to answer the agent.",
            "suggest_reply": (
                "Draft a concise customer-facing reply from this context. "
                "Prioritize agentSession, then botMemory/sessionMemory. "
                "Call get_organization_knowledge only if the latest customer ask needs "
                "product, policy, FAQ, or company facts — never invent knowledge. "
                "A live agent is already connected. Return only the exact customer message."
            ),
            "summary": (
                "Summarize the conversation for the agent using botMemory/sessionMemory and agentSession."
            ),
        }
        return {
            "task": task,
            "instruction": instructions[task],
            **payload["context"],
        }

    async def get_conversation_context(self) -> dict[str, object]:
        return await self._read("context")

    async def suggest_reply(self) -> dict[str, object]:
        return await self._read("suggest_reply")

    async def summarize_conversation(self) -> dict[str, object]:
        return await self._read("summary")
