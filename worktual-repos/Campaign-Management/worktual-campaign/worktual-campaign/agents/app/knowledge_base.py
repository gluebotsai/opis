"""Campaign knowledge retrieve via context_layer (never Meili directly).

Used by create-campaign, template generate, template edit, and Phase 2 compose.
Failures return empty so generation still proceeds.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings
from app.integrations.context_layer import (
    MODULES,
    campaign_knowledge_query,
    search_campaign_knowledge,
    search_context_layer,
)

logger = logging.getLogger(__name__)


async def resolve_kb_organization_id(
    *,
    session: dict[str, Any] | None = None,
    token: str = "",
    organization_id: str = "",
) -> str:
    oid = str(organization_id or "").strip()
    if oid:
        return oid
    blob = session if isinstance(session, dict) else {}
    cached = blob.get("organization_id") or blob.get("tenant_id")
    if cached is not None and str(cached).strip():
        return str(cached).strip()
    if not token:
        return ""
    try:
        from app.agents.reports.org_context import resolve_organization_id

        return await resolve_organization_id(blob, token, persist=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("kb organization_id resolve failed: %s", exc)
        return ""


async def search_knowledge_for_agent(
    *,
    query: str,
    session: dict[str, Any] | None = None,
    token: str = "",
    organization_id: str = "",
    module: str = "auto",
) -> dict[str, Any]:
    """LLM-facing KB search. organization_id always from session/token, never tool args."""
    settings = get_settings()
    q = str(query or "").strip()
    if not q:
        return {"ok": False, "error": "query_required", "results": [], "snippets": ""}
    if not getattr(settings, "kb_enabled", True):
        return {"ok": True, "results": [], "snippets": "", "skipped": "kb_disabled"}

    org = await resolve_kb_organization_id(
        session=session,
        token=token,
        organization_id=organization_id,
    )
    if not org:
        return {
            "ok": False,
            "error": "organization_id_required",
            "results": [],
            "snippets": "",
            "message": "No organization on this session — cannot search knowledge.",
        }

    mod = str(module or "auto").strip().lower()
    if mod in ("auto", "all", ""):
        out = await search_campaign_knowledge(organization_id=org, query=q)
    else:
        if mod not in MODULES:
            mod = "product"
        single = await search_context_layer(
            organization_id=org,
            query=q,
            module=mod,
            product_ids="campaign",
        )
        rows = (
            single.get("results") if isinstance(single.get("results"), list) else []
        )
        hits = [r for r in rows if isinstance(r, dict)]
        lines: list[str] = []
        for row in hits:
            label = str(row.get("file_name") or row.get("module") or "kb").strip()
            text = str(row.get("text") or "").strip()
            if text:
                lines.append(f"[{label}] {text}")
        out = {
            "ok": bool(single.get("ok")),
            "results": hits,
            "count": len(hits),
            "snippets": "\n\n".join(lines).strip(),
            "organization_id": org,
            "query": q[:240],
            "module": mod,
            "error": single.get("error"),
        }

    snippets = str(out.get("snippets") or "").strip()
    count = int(out.get("count") or len(out.get("results") or []) or 0)
    message = (
        f"Found {count} knowledge snippet(s)."
        if count
        else "No knowledge snippets for this query. Continue with campaign facts only."
    )
    return {
        "ok": True,
        "results": list(out.get("results") or []),
        "count": count,
        "snippets": snippets,
        "module": out.get("module") or mod,
        "organization_id": org,
        "query": q[:240],
        "message": message,
        "error": out.get("error"),
    }


async def fetch_campaign_knowledge(
    campaign: dict[str, Any],
    *,
    limit: int = 2,
    organization_id: str = "",
    session: dict[str, Any] | None = None,
    token: str = "",
    query: str = "",
) -> str:
    """Pull tenant KB snippets for template copy. Empty string on failure."""
    _ = limit
    settings = get_settings()
    if not getattr(settings, "kb_enabled", True):
        return ""

    q = str(query or "").strip() or campaign_knowledge_query(campaign)
    out = await search_knowledge_for_agent(
        query=q,
        session=session,
        token=token,
        organization_id=organization_id,
        module="auto",
    )
    snippets = str(out.get("snippets") or "").strip()
    if snippets:
        return snippets
    if out.get("error"):
        logger.warning("campaign knowledge empty: %s", out.get("error"))
    return ""
