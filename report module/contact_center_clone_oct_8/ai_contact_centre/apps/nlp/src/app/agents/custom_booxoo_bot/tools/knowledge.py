"""Organization knowledge search for custom_booxoo_bot."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor

from app.agents.custom_booxoo_bot.tools.base import Tool
from app.services.knowledge_search import search_knowledge_gateway

SCHEMA = {
    "type": "function",
    "function": {
        "name": "search_business_knowledge",
        "description": (
            "Search Booxoo's business knowledge. "
            "Use this for who Booxoo is, what it sells, clothes, prices, policies, and how-to. "
            "Call once. This tool searches the business module only."
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


def _search_sync(query: str, organization_id: str, module: str, channel: str) -> dict:
    coroutine = search_knowledge_gateway(
        query,
        organization_id=organization_id,
        module=module,
        channel=channel,
    )
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)

    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coroutine).result()


def _without_live_agent_offer(result: dict) -> dict:
    message = str(result.get("message") or "")
    if "live agent" not in message.lower():
        return result
    updated = dict(result)
    updated["message"] = "I don't have that information in the business knowledge yet. Say so. Do not offer a live agent."
    return updated


def search_business_knowledge(ctx, query: str, **_kwargs):
    channel = str(getattr(ctx.request, "channel", "") or "webchat")
    try:
        return _without_live_agent_offer(
            _search_sync(
                query,
                str(ctx.request.organization_id),
                "business",
                channel,
            )
        )
    except Exception as exc:
        return {
            "ok": False,
            "empty": True,
            "results": [],
            "message": "I don't have that information in the business knowledge yet. Say so. Do not offer a live agent.",
            "error": str(exc),
        }


def business_knowledge_tool() -> Tool:
    return Tool(SCHEMA, search_business_knowledge)
