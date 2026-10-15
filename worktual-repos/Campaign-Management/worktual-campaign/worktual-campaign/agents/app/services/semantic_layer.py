"""Semantic layer /ask client for Campaign chat NL analytics.

CRM handoff pattern: POST {GATEWAY}/ask with
{ query, organization_id, product: "campaign" }.

Gateway may return either:
  - { "<question text>": [ { ok, metric_id, rows } … ] }
  - { "query": [ … ] }
  - a bare list
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


def flatten_semantic_results(body: Any, query: str) -> list[dict[str, Any]]:
    """Normalize gateway payload to a list of metric result dicts."""
    if isinstance(body, list):
        return [r for r in body if isinstance(r, dict)]
    if not isinstance(body, dict):
        return []
    query_key = str(query or "").strip()
    if query_key and isinstance(body.get(query_key), list):
        return [r for r in body[query_key] if isinstance(r, dict)]
    if isinstance(body.get("query"), list):
        return [r for r in body["query"] if isinstance(r, dict)]
    for value in body.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return [r for r in value if isinstance(r, dict)]
    return []


def semantic_layer_configured() -> bool:
    url = (get_settings().semantic_layer_gateway_url or "").strip()
    return bool(url)


async def ask_semantic_layer(
    query: str,
    *,
    organization_id: str,
    product: str | None = None,
) -> dict[str, Any]:
    """Call the gateway. Returns { ok, results, raw, error? }."""
    settings = get_settings()
    base = (settings.semantic_layer_gateway_url or "").strip().rstrip("/")
    q = str(query or "").strip()
    oid = str(organization_id or "").strip()
    prod = (product or settings.semantic_layer_product or "campaign").strip()

    if not base:
        return {
            "ok": False,
            "results": [],
            "raw": None,
            "error": "SEMANTIC_LAYER_GATEWAY_URL is not configured",
        }
    if not q:
        return {
            "ok": False,
            "results": [],
            "raw": None,
            "error": "query is required",
        }
    if not oid:
        return {
            "ok": False,
            "results": [],
            "raw": None,
            "error": "organization_id is required",
        }

    payload = {"query": q, "organization_id": oid, "product": prod}
    timeout = float(settings.semantic_layer_timeout_s or 30.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"{base}/ask", json=payload)
            resp.raise_for_status()
            raw = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("semantic_layer /ask failed: %s", exc)
        return {
            "ok": False,
            "results": [],
            "raw": None,
            "error": f"semantic_layer_transport: {exc}",
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("semantic_layer /ask unexpected: %s", exc)
        return {
            "ok": False,
            "results": [],
            "raw": None,
            "error": f"semantic_layer_error: {exc}",
        }

    results = flatten_semantic_results(raw, q)
    usable = [
        r
        for r in results
        if r.get("ok") is True and isinstance(r.get("rows"), list)
    ]
    return {
        "ok": bool(usable),
        "results": results,
        "usable": usable,
        "raw": raw,
        "error": None if usable else "no usable metric rows",
        "query": q,
        "organization_id": oid,
        "product": prod,
    }
