"""Load org product + business knowledge for a proposal generate job."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.llm_result import label_ai, label_fallback
from app.services.knowledge_base import KB_UNAVAILABLE_MESSAGE, KB_UNAVAILABLE_REASON
from app.services.proposal_knowledge import (
    JOB_KB_CAP,
    load_business_kb,
    load_product_catalog_kb,
    requirement_search_query,
)

logger = logging.getLogger(__name__)


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    products = body.get("products")
    product_rows = products if isinstance(products, list) else []
    org = str(body.get("organizationId") or body.get("organization_id") or "") or None
    requirement = str(body.get("requirementText") or "").strip()
    summary = str(body.get("requirementSummary") or "").strip()
    allowed = [
        str(p).strip()
        for p in (body.get("allowedProducts") or [])
        if str(p).strip()
    ]
    haystack = " ".join(part for part in (requirement, summary, *allowed) if part)
    logger.info(
        "[proposal-generate] kb retrieve start org=%s products=%s",
        org,
        [str(row.get("name") or "") for row in product_rows if isinstance(row, dict)][:12],
    )
    product_text, fail = await load_product_catalog_kb(
        [row for row in product_rows if isinstance(row, dict)],
        organization_id=org,
        requirement_summary=haystack,
    )
    if fail == KB_UNAVAILABLE_REASON:
        logger.warning("[proposal-generate] kb product transport failed org=%s", org)
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "knowledgeBase": "",
                "error": KB_UNAVAILABLE_MESSAGE,
                "reason": KB_UNAVAILABLE_REASON,
            },
            KB_UNAVAILABLE_REASON,
        )
    business_q = requirement_search_query(haystack)
    business_text, biz_fail = await load_business_kb(
        business_q,
        organization_id=org,
    )
    if biz_fail == KB_UNAVAILABLE_REASON:
        logger.warning("[proposal-generate] kb business transport failed org=%s", org)
        return label_fallback(
            {
                "ok": False,
                "status": "failed",
                "knowledgeBase": "",
                "error": KB_UNAVAILABLE_MESSAGE,
                "reason": KB_UNAVAILABLE_REASON,
            },
            KB_UNAVAILABLE_REASON,
        )
    parts = [t for t in (product_text, business_text) if t]
    context = "\n\n".join(parts)[:JOB_KB_CAP]
    logger.info(
        "[proposal-generate] kb retrieve done org=%s chars=%s product_chars=%s business_chars=%s",
        org,
        len(context),
        len(product_text or ""),
        len(business_text or ""),
    )
    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "knowledgeBase": context,
            "hitCount": 1 if context else 0,
        }
    )
