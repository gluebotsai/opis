"""Prospect search agent — multi-provider fan-out + merge (no CRM writes)."""

from __future__ import annotations

import logging
from typing import Any

from app.providers import search_providers
from app.providers.prospect_types import PROVIDERS, ProspectCriteria, ResearchProviderId

logger = logging.getLogger(__name__)

PROSPECT_SEARCH_AGENT = "prospect_search"


def _as_sources(raw: Any) -> list[ResearchProviderId]:
    allowed = set(PROVIDERS)
    if not isinstance(raw, list) or not raw:
        return list(PROVIDERS)
    out: list[ResearchProviderId] = []
    for item in raw:
        s = str(item).strip().lower()
        if s in allowed and s not in out:
            out.append(s)  # type: ignore[arg-type]
    return out or list(PROVIDERS)


def _as_criteria(raw: Any) -> ProspectCriteria:
    if not isinstance(raw, dict):
        return {}
    criteria: ProspectCriteria = {}
    for key in (
        "industries",
        "geos",
        "sizeTiers",
        "titles",
        "technographics",
    ):
        val = raw.get(key)
        if isinstance(val, list):
            criteria[key] = [str(x) for x in val if str(x).strip()]  # type: ignore[literal-required]
    for key in ("productFitHint", "freeText"):
        val = raw.get(key)
        if isinstance(val, str):
            criteria[key] = val  # type: ignore[literal-required]
    return criteria


def _as_credentials(raw: Any) -> dict[ResearchProviderId, dict[str, Any]]:
    out: dict[ResearchProviderId, dict[str, Any]] = {}
    if not isinstance(raw, list):
        return out
    for row in raw:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("provider") or "").strip().lower()
        if pid not in PROVIDERS:
            continue
        out[pid] = {  # type: ignore[index]
            "apiKey": row.get("apiKey"),
            "settings": row.get("settings")
            if isinstance(row.get("settings"), dict)
            else None,
        }
    return out


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    job_id = str(body.get("jobId") or "")
    organization_id = body.get("organizationId")
    sources = _as_sources(body.get("sources"))
    criteria = _as_criteria(body.get("criteria"))
    credentials = _as_credentials(body.get("credentials"))
    limit = int(body.get("fetchLimit") or body.get("limit") or 50)
    limit = max(1, min(100, limit))

    candidates, used, errors = await search_providers(
        sources=sources,
        credentials=credentials,
        criteria=criteria,
        fetch_limit=limit,
        organization_id=str(organization_id) if organization_id else None,
    )
    return {
        "ok": True,
        "jobId": job_id,
        "organizationId": organization_id,
        "agent": PROSPECT_SEARCH_AGENT,
        "sourcesRequested": sources,
        "sourcesUsed": used,
        "errors": errors,
        "candidates": candidates,
        "count": len(candidates),
    }
