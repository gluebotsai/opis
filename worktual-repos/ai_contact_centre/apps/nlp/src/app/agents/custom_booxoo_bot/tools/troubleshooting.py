"""Troubleshooting article search for custom_booxoo_bot."""

from __future__ import annotations

from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
from app.agents.custom_booxoo_bot.tools.base import Tool

_client = TicketingClient()

SCHEMA = {
    "type": "function",
    "function": {
        "name": "search_troubleshooting_knowledge",
        "description": "Search help articles for the user's issue. Use this first and share useful steps before raising a ticket. Do not ask for an order, cart, or transaction id unless an order already exists.",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
}


def _article_from_knowledge(result: dict) -> dict | None:
    snippets = [
        str(item.get("text") or "").strip()
        for item in result.get("results") or []
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    ]
    if not snippets:
        return None
    return {
        "title": "",
        "symptoms": [],
        "steps": snippets,
        "text": "\n\n".join(snippets),
    }


def search_troubleshooting_knowledge(ctx, query: str, **_kwargs):
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "query_required", "article": None}
    from app.agents.custom_booxoo_bot.tools.knowledge import search_business_knowledge

    knowledge = search_business_knowledge(ctx, query)
    article = _article_from_knowledge(knowledge)
    if article:
        return {"ok": True, "found": True, "source": "knowledge", "article": article}
    status, payload = _client.search_articles(query)
    if status == 0:
        return {"ok": False, "configured": False, "article": None, "error": "ticketing_not_configured"}
    article = payload.get("article") if isinstance(payload, dict) else None
    if not isinstance(article, dict):
        return {"ok": status < 400, "http_status": status, "found": False, "article": None}
    slim = {
        "title": article.get("title") or "",
        "symptoms": article.get("symptoms") or [],
        "steps": article.get("steps") or [],
        "text": article.get("text") or "",
    }
    return {
        "ok": status < 400,
        "http_status": status,
        "found": bool(slim["title"] or slim["steps"] or slim["text"]),
        "article": slim,
    }


def troubleshooting_tool() -> Tool:
    return Tool(SCHEMA, search_troubleshooting_knowledge)
