"""Org + product Context Layer retrieve for proposal generate."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.config import get_settings
from app.services.knowledge_base import (
    KB_UNAVAILABLE_REASON,
    get_business_knowledge,
    get_sales_knowledge,
    is_kb_transport_failure,
    kb_product_slug,
    looks_like_inventory_id,
    resolve_kb_product_ids,
)

REQUIREMENT_QUERY_CAP = 600
PRODUCT_KB_CAP = 12_000
BUSINESS_KB_CAP = 6_000
JOB_KB_CAP = 16_000
SECTION_KB_CAP = 6_000
_SKIP_NAME_TOKENS = frozenset({"native", "with", "and", "the", "from", "for"})

logger = logging.getLogger(__name__)


def requirement_search_query(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())[:REQUIREMENT_QUERY_CAP]


def _normalized_haystack(text: str) -> str:
    return f" {re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()} "


def product_mentioned_in_requirement(product: dict[str, Any], haystack: str) -> bool:
    hay = _normalized_haystack(haystack)
    if hay == "  ":
        return False
    for cand in product_id_candidates(product):
        if looks_like_inventory_id(cand):
            continue
        slug = kb_product_slug(cand)
        if slug:
            slug_words = slug.replace("-", " ")
            if f" {slug_words} " in hay or slug.replace("-", "") in hay.replace(" ", ""):
                return True
        name_words = re.sub(r"[^a-z0-9]+", " ", cand.lower()).strip()
        if len(name_words) >= 4 and f" {name_words} " in hay:
            return True
        tokens = [t for t in name_words.split() if len(t) >= 4 and t not in _SKIP_NAME_TOKENS]
        if any(f" {t} " in hay for t in tokens):
            return True
    return False


def filter_products_for_requirement(
    products: list[dict[str, Any]],
    haystack: str,
) -> list[dict[str, Any]]:
    return [
        row
        for row in products
        if isinstance(row, dict) and product_mentioned_in_requirement(row, haystack)
    ]


def kb_slugs_for_requirement(
    products: list[dict[str, Any]],
    haystack: str,
) -> list[str]:
    matched = filter_products_for_requirement(products, haystack)
    candidates: list[str | None] = []
    for row in matched:
        candidates.extend(product_id_candidates(row))
    if not candidates:
        tokens = [t for t in _normalized_haystack(haystack).split() if t]
        candidates.extend(tokens)
    return resolve_kb_product_ids(*candidates)


async def load_kb_chunk(
    query: str,
    *,
    organization_id: str | None,
    product_ids: list[str],
    product_name: str = "",
    limit: int = 5,
) -> tuple[str, dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return "", {"status": "skipped"}
    job_timeout = float(get_settings().knowledge_base_job_timeout_s or 45)
    try:
        kb = await get_sales_knowledge(
            q,
            limit=limit,
            organization_id=organization_id,
            product_ids=product_ids or None,
            timeout=job_timeout,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("proposal KB failed: %s: %s", type(exc).__name__, exc)
        failed = {
            "status": "failure",
            "error": f"{type(exc).__name__}: {exc}",
            "errorType": type(exc).__name__,
        }
        return "", failed
    if not isinstance(kb, dict):
        return "", {"status": "failure", "errorType": "InvalidKbResponse"}
    if kb.get("status") == "success":
        text = str(kb.get("context") or "").strip()
        if text and product_name:
            return f"[{product_name}]\n{text}", kb
        return text, kb
    return "", kb


def product_id_candidates(product: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for key in ("sku", "category", "name", "id"):
        val = str(product.get(key) or "").strip()
        if val and val not in ids:
            ids.append(val)
    return ids


async def load_product_catalog_kb(
    products: list[dict[str, Any]],
    *,
    organization_id: str | None,
    requirement_summary: str,
    max_products: int = 20,
    allowed_product_names: list[str] | None = None,
) -> tuple[str, str | None]:
    rows = [row for row in products[: max(1, max_products)] if isinstance(row, dict)]
    extras = [
        str(name).strip()
        for name in (allowed_product_names or [])
        if str(name).strip()
    ]
    haystack = " ".join(part for part in (requirement_summary, *extras) if part)
    query = requirement_search_query(haystack or requirement_summary)
    if not query:
        return "", None
    ids = kb_slugs_for_requirement(rows, haystack)
    chunk, kb = await load_kb_chunk(
        query,
        organization_id=organization_id,
        product_ids=ids,
        limit=8,
    )
    if is_kb_transport_failure(kb):
        logger.warning(
            "proposal KB aborting: product transport failure org=%s",
            organization_id,
        )
        return "", KB_UNAVAILABLE_REASON
    return chunk[:PRODUCT_KB_CAP], None


async def load_business_kb(
    query: str,
    *,
    organization_id: str | None,
) -> tuple[str, str | None]:
    q = (query or "").strip()
    if not q:
        return "", None
    job_timeout = float(get_settings().knowledge_base_job_timeout_s or 45)
    try:
        kb = await get_business_knowledge(
            q,
            limit=4,
            organization_id=organization_id,
            timeout=job_timeout,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("proposal business KB failed: %s", exc)
        return "", KB_UNAVAILABLE_REASON
    if is_kb_transport_failure(kb if isinstance(kb, dict) else None):
        return "", KB_UNAVAILABLE_REASON
    if isinstance(kb, dict) and kb.get("status") == "success":
        return str(kb.get("context") or "").strip()[:BUSINESS_KB_CAP], None
    return "", None


async def load_section_kb(
    query: str,
    *,
    organization_id: str | None,
    product_ids: list[str],
) -> tuple[str, str | None]:
    chunk, kb = await load_kb_chunk(
        query,
        organization_id=organization_id,
        product_ids=product_ids,
    )
    if is_kb_transport_failure(kb):
        return "", KB_UNAVAILABLE_REASON
    return chunk[:SECTION_KB_CAP], None
