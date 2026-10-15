"""Specialist handoff tool for custom_booxoo_bot."""

from __future__ import annotations

from app.agents.custom_booxoo_bot.tools.base import Tool

ROUTE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "route_to_agent",
        "description": "Hand the conversation to DiscoveryAgent or SupportAgent. Call this tool alone.",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_name": {
                    "type": "string",
                    "enum": ["DiscoveryAgent", "SupportAgent"],
                },
                "query": {"type": "string"},
            },
            "required": ["agent_name", "query"],
        },
    },
}


def route_to_agent(ctx, agent_name: str, query: str, **_kwargs):
    return {"ok": True, "agent_name": agent_name, "query": query}


def route_tool() -> Tool:
    return Tool(ROUTE_SCHEMA, route_to_agent)
