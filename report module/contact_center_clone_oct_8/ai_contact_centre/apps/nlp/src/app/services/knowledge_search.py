"""Knowledge-base search gateway (Setup KB context layer).

POST {KNOWLEDGE_SEARCH_URL}/search

Request::
    {
      "organization_id": "1000",
      "module": "business" | "product" | "support",
      "query": "...",
      "max_no_result": 5,
      "product_ids": "contact-center",
      "ccaas_audience": "both"
    }

Success::
    {"results": [{"id": "...", "text": "...", "_rankingScore": 0.8, ...}, ...]}
"""

from __future__ import annotations

import re
import time
from typing import Any, Literal

import httpx

from app.config import Settings, get_settings
from app.logging import get_logger

logger = get_logger("nlp.knowledge_search")

KnowledgeModule = Literal["business", "product", "support"]

KNOWLEDGE_MODULES: frozenset[str] = frozenset({"business", "product", "support"})

# Setup KB category → search module
SETUP_CATEGORY_TO_MODULE: dict[str, KnowledgeModule] = {
    "business": "business",
    "product": "product",
    "support": "support",
    "customer_support": "support",
}

# Customer-channel surfaces that may offer live-agent connect when KB is empty.
CUSTOMER_SUPPORT_SURFACES = frozenset(
    {"webchat", "whatsapp", "instagram", "facebook", "social", "email"}
)

EMPTY_KNOWLEDGE_REPLY = (
    "I don't have enough knowledge to answer this query right now. "
    "Would you like me to connect you with a live agent?"
)

EMPTY_KNOWLEDGE_REPLY_AGENT = (
    "I don't have enough knowledge to answer this query right now."
)


def empty_knowledge_message(*, channel: str | None = None) -> str:
    """Live-agent offer is customer-bot only; coworker/inbox get a knowledge miss only."""
    surface = (channel or "").strip().lower()
    if surface in CUSTOMER_SUPPORT_SURFACES:
        return EMPTY_KNOWLEDGE_REPLY
    return EMPTY_KNOWLEDGE_REPLY_AGENT

# organizations.id is bigint; KB gateway expects a decimal string (e.g. "1000").
_ENTITY_ID_RE = re.compile(r"^\d+$")


def normalize_organization_entity_id(value: str | int | None) -> str | None:
    """Coerce int/str org ids to a decimal string; reject UUID / empty / bool."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        if value < 0:
            return None
        return str(value)
    cleaned = str(value).strip()
    if _ENTITY_ID_RE.fullmatch(cleaned):
        return cleaned
    return None


def is_organization_entity_id(value: str | int | None) -> bool:
    return normalize_organization_entity_id(value) is not None


class KnowledgeSearchError(RuntimeError):
    """Safe knowledge-search error suitable for tool responses."""


def knowledge_search_configured(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.knowledge_search_url.strip())


def normalize_knowledge_module(value: str | None) -> KnowledgeModule | None:
    if not value:
        return None
    key = value.strip().lower().replace("-", "_").replace(" ", "_")
    if key in SETUP_CATEGORY_TO_MODULE:
        return SETUP_CATEGORY_TO_MODULE[key]
    if key in KNOWLEDGE_MODULES:
        return key  # type: ignore[return-value]
    return None


def _snippet_from_result(item: dict[str, Any]) -> dict[str, Any]:
    text = str(item.get("text") or "").strip()
    score = item.get("_rankingScore")
    try:
        ranking_score = float(score) if score is not None else None
    except (TypeError, ValueError):
        ranking_score = None
    return {
        "id": item.get("id"),
        "text": text,
        "file_name": item.get("file_name"),
        "page_number": item.get("page_number"),
        "document_id": item.get("document_id"),
        "ranking_score": ranking_score,
    }


def adapt_knowledge_search_response(
    body: Any,
    *,
    module: KnowledgeModule,
    query: str,
    channel: str | None = None,
) -> dict[str, Any]:
    results_raw: list[Any] = []
    if isinstance(body, dict):
        raw = body.get("results")
        if isinstance(raw, list):
            results_raw = raw
    elif isinstance(body, list):
        results_raw = body

    snippets = [
        _snippet_from_result(item)
        for item in results_raw
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    ]

    if not snippets:
        return {
            "ok": False,
            "empty": True,
            "module": module,
            "query": query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
        }

    return {
        "ok": True,
        "empty": False,
        "module": module,
        "query": query,
        "results": snippets,
        "count": len(snippets),
    }


async def search_knowledge_gateway(
    query: str,
    *,
    organization_id: str | int,
    module: str,
    settings: Settings | None = None,
    client: httpx.AsyncClient | None = None,
    channel: str | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    resolved_module = normalize_knowledge_module(module)
    cleaned_query = query.strip()
    # KB API contract uses string organization_id (even when caller has int).
    org_id = normalize_organization_entity_id(organization_id)

    if not org_id:
        logger.warning(
            "knowledge search rejected non-numeric organization_id",
            extra={
                "event": "knowledge_search_error",
                "tenant_id": str(organization_id),
                "channel": channel,
                "knowledge_search": {
                    "error": "organization_id_must_be_numeric",
                },
            },
        )
        return {
            "ok": False,
            "empty": True,
            "module": resolved_module or module,
            "query": cleaned_query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
            "error": (
                "organization_id must be the numeric organizations.id "
                "(legacy UUID tenant ids are not supported)."
            ),
        }

    if not resolved_module:
        return {
            "ok": False,
            "empty": True,
            "module": module,
            "query": cleaned_query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
            "error": (
                "Invalid module. Use exactly one of: business, product, support "
                "(customer_support maps to support)."
            ),
        }

    if not cleaned_query:
        return {
            "ok": False,
            "empty": True,
            "module": resolved_module,
            "query": cleaned_query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
            "error": "Query is required.",
        }

    base_url = settings.knowledge_search_url.strip().rstrip("/")
    if not base_url:
        return {
            "ok": False,
            "empty": True,
            "module": resolved_module,
            "query": cleaned_query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
            "error": "Knowledge search URL is not configured.",
        }

    payload = {
        "organization_id": org_id,
        "module": resolved_module,
        "query": cleaned_query,
        "max_no_result": settings.knowledge_search_max_results,
        "product_ids": settings.knowledge_search_product_id,
        "ccaas_audience": settings.knowledge_search_ccaas_audience,
    }

    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=settings.knowledge_search_timeout_seconds)
    started = time.perf_counter()
    logger.info(
        "knowledge search request",
        extra={
            "event": "knowledge_search_request",
            "tenant_id": org_id,
            "channel": channel,
            "knowledge_search": {
                "module": resolved_module,
                "query": cleaned_query[:300],
                "gateway_url": base_url,
            },
        },
    )
    try:
        response = await http.post(f"{base_url}/search", json=payload)
        response.raise_for_status()
        body = response.json()
        elapsed_ms = (time.perf_counter() - started) * 1000
        adapted = adapt_knowledge_search_response(
            body,
            module=resolved_module,
            query=cleaned_query,
            channel=channel,
        )
        logger.info(
            "knowledge search response",
            extra={
                "event": "knowledge_search_response",
                "tenant_id": org_id,
                "channel": channel,
                "knowledge_search": {
                    "module": resolved_module,
                    "ok": adapted.get("ok"),
                    "empty": adapted.get("empty"),
                    "count": adapted.get("count") or 0,
                    "elapsed_ms": round(elapsed_ms, 2),
                },
            },
        )
        return adapted
    except httpx.TimeoutException as error:
        logger.warning(
            "knowledge search timeout",
            extra={
                "event": "knowledge_search_error",
                "tenant_id": org_id,
                "channel": channel,
                "knowledge_search": {"module": resolved_module, "error": str(error)},
            },
        )
        return {
            "ok": False,
            "empty": True,
            "module": resolved_module,
            "query": cleaned_query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
            "error": "Knowledge search request timed out.",
        }
    except Exception as error:
        logger.warning(
            "knowledge search failed",
            extra={
                "event": "knowledge_search_error",
                "tenant_id": org_id,
                "channel": channel,
                "knowledge_search": {"module": resolved_module, "error": str(error)},
            },
            exc_info=True,
        )
        return {
            "ok": False,
            "empty": True,
            "module": resolved_module,
            "query": cleaned_query,
            "results": [],
            "message": empty_knowledge_message(channel=channel),
            "error": "Knowledge search request failed.",
        }
    finally:
        if owns_client:
            await http.aclose()
