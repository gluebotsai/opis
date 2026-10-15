"""Enterprise Context Layer (Meilisearch backend) — never call Meili directly.

POST {CONTEXT_LAYER_URL}/search
Body: organization_id (str), module (business|product|support),
      query, product_ids ("campaign" or ["campaign"]).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

MODULES = frozenset({"business", "product", "support"})
DEFAULT_PRODUCT_IDS: str | list[str] = "campaign"


def campaign_knowledge_query(
    campaign: dict[str, Any] | None = None,
    extra: str = "",
) -> str:
    """Query for compose / generate — campaign meta plus optional idea text."""
    camp = campaign if isinstance(campaign, dict) else {}
    parts = [
        str(extra or "").strip(),
        str(camp.get("name") or "").strip(),
        str(camp.get("goal") or "").strip(),
        str(camp.get("objective") or "").strip(),
    ]
    seen: set[str] = set()
    ordered: list[str] = []
    for part in parts:
        if not part or part in seen:
            continue
        seen.add(part)
        ordered.append(part)
    return " | ".join(ordered) or "campaign product offer features"


def context_layer_configured(base_url: str | None = None) -> bool:
    settings = get_settings()
    url = (
        base_url
        if base_url is not None
        else str(getattr(settings, "context_layer_url", "") or "")
    )
    return bool(url.strip()) and bool(getattr(settings, "kb_enabled", True))


def _normalize_product_ids(product_ids: Any) -> str | list[str]:
    if isinstance(product_ids, list):
        cleaned = [str(x).strip() for x in product_ids if str(x).strip()]
        return cleaned or ["campaign"]
    text = str(product_ids or "").strip()
    return text or "campaign"


def _clip(text: Any, limit: int = 600) -> str:
    t = str(text or "").strip()
    if len(t) <= limit:
        return t
    return t[: max(0, limit - 1)].rstrip() + "…"


def format_search_hits(
    hits: list[dict[str, Any]],
    *,
    max_hits: int = 5,
    max_chars_each: int = 600,
) -> list[dict[str, Any]]:
    """Normalize API results for agents / workspace knowledge."""
    out: list[dict[str, Any]] = []
    for row in hits[: max(0, max_hits)]:
        if not isinstance(row, dict):
            continue
        text = _clip(row.get("text"), max_chars_each)
        if not text:
            continue
        item: dict[str, Any] = {
            "text": text,
            "module": str(row.get("module") or "").strip(),
            "file_name": str(row.get("file_name") or "").strip(),
            "source_type": str(row.get("source_type") or "").strip(),
            "page_number": row.get("page_number"),
            "document_id": str(row.get("document_id") or "").strip(),
        }
        score = row.get("_rankingScore")
        if score is not None:
            try:
                item["score"] = float(score)
            except (TypeError, ValueError):
                pass
        out.append({k: v for k, v in item.items() if v not in ("", None)})
    return out


async def search_context_layer(
    *,
    organization_id: str,
    query: str,
    module: str = "product",
    product_ids: Any = DEFAULT_PRODUCT_IDS,
    limit: int = 5,
    timeout_s: float | None = None,
) -> dict[str, Any]:
    """Search tenant KB via context_layer. Soft-fails to empty results."""
    settings = get_settings()
    if not getattr(settings, "kb_enabled", True):
        return {"ok": True, "results": [], "skipped": "kb_disabled"}

    org = str(organization_id or "").strip()
    q = str(query or "").strip()
    mod = str(module or "product").strip().lower()
    if mod not in MODULES:
        mod = "product"
    if not org:
        return {"ok": False, "error": "organization_id_required", "results": []}
    if not q:
        return {"ok": False, "error": "query_required", "results": []}

    base = str(getattr(settings, "context_layer_url", "") or "").strip().rstrip("/")
    if not base:
        return {"ok": False, "error": "context_layer_url_unset", "results": []}

    url = f"{base}/search"
    body = {
        "organization_id": org,
        "module": mod,
        "query": q,
        "product_ids": _normalize_product_ids(product_ids),
    }
    timeout = float(
        timeout_s
        if timeout_s is not None
        else getattr(settings, "context_layer_timeout_s", 12.0)
    )
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(url, json=body)
            res.raise_for_status()
            payload = res.json() if res.content else {}
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "context_layer search failed org=%s module=%s: %s", org, mod, exc
        )
        return {
            "ok": False,
            "error": "context_layer_unreachable",
            "detail": str(exc)[:200],
            "results": [],
        }

    raw = payload.get("results") if isinstance(payload, dict) else None
    hits = [r for r in raw if isinstance(r, dict)] if isinstance(raw, list) else []
    formatted = format_search_hits(hits, max_hits=max(1, int(limit or 5)))
    return {
        "ok": True,
        "results": formatted,
        "count": len(formatted),
        "module": mod,
        "organization_id": org,
        "query": q[:240],
    }


async def search_campaign_knowledge(
    *,
    organization_id: str,
    query: str,
    modules: tuple[str, ...] = ("product", "business"),
    limit_per_module: int = 3,
) -> dict[str, Any]:
    """Multi-module search for campaign create/compose. Soft-fail per module."""
    import asyncio

    org = str(organization_id or "").strip()
    q = str(query or "").strip()
    if not org or not q:
        return {
            "ok": False,
            "error": "organization_id_and_query_required",
            "results": [],
            "snippets": "",
        }

    async def one(mod: str) -> list[dict[str, Any]]:
        out = await search_context_layer(
            organization_id=org,
            query=q,
            module=mod,
            product_ids="campaign",
            limit=limit_per_module,
        )
        rows = out.get("results") if isinstance(out.get("results"), list) else []
        for row in rows:
            if isinstance(row, dict) and not row.get("module"):
                row["module"] = mod
        return [r for r in rows if isinstance(r, dict)]

    parts = await asyncio.gather(
        *[one(m) for m in modules if str(m).strip().lower() in MODULES]
    )
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for chunk in parts:
        for row in chunk:
            key = str(row.get("document_id") or "") + "|" + str(row.get("text") or "")[:80]
            if key in seen:
                continue
            seen.add(key)
            merged.append(row)

    lines: list[str] = []
    for row in merged[:8]:
        label = str(row.get("file_name") or row.get("module") or "kb").strip()
        text = str(row.get("text") or "").strip()
        if text:
            lines.append(f"[{label}] {text}")

    return {
        "ok": True,
        "results": merged,
        "count": len(merged),
        "snippets": "\n\n".join(lines).strip(),
        "organization_id": org,
        "query": q[:240],
    }
