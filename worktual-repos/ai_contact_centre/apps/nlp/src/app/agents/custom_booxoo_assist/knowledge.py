"""Product knowledge search for the passive Booxoo assist.

Uses the same knowledge gateway as the customer bot. The customer bot's business
search stays on the business module.
"""

from __future__ import annotations

from app.agents.custom_booxoo_bot.tools.base import Tool
from app.agents.custom_booxoo_bot.tools.knowledge import _search_sync, _without_live_agent_offer

SCHEMA = {
    "type": "function",
    "function": {
        "name": "search_product_knowledge",
        "description": (
            "Search Booxoo product knowledge for an item, fabric, size, or price. "
            "Call once. This searches the product module only. "
            "It is not a product catalog, product list, or recommendation."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
            },
            "required": ["query"],
        },
    },
}


def search_product_knowledge(ctx, query: str, **_kwargs):
    channel = str(getattr(ctx.request, "channel", "") or "webchat")
    try:
        result = _without_live_agent_offer(
            _search_sync(
                query,
                str(ctx.request.organization_id),
                "product",
                channel,
            )
        )
    except Exception as exc:
        return {
            "ok": False,
            "empty": True,
            "module": "product",
            "results": [],
            "message": "I don't have that product information yet. Say so. Do not offer a live agent.",
            "error": str(exc),
        }
    if isinstance(result, dict) and result.get("empty"):
        updated = dict(result)
        updated["message"] = (
            "I don't have that product information yet. Say so. Do not offer a live agent."
        )
        return updated
    return result


def product_knowledge_tool() -> Tool:
    return Tool(SCHEMA, search_product_knowledge)
