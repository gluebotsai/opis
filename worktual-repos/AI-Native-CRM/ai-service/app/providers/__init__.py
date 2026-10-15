"""Registry + fan-out helpers for prospect providers."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.providers.apollo import ApolloProvider
from app.providers.builtwith import BuiltWithProvider
from app.providers.lusha import LushaProvider
from app.providers.prospect_types import (
    PROVIDERS,
    ProspectCandidate,
    ProspectCriteria,
    ResearchProviderId,
    merge_candidates,
)
from app.providers.zoominfo import ZoomInfoProvider

logger = logging.getLogger(__name__)

_REGISTRY = {
    "apollo": ApolloProvider(),
    "zoominfo": ZoomInfoProvider(),
    "lusha": LushaProvider(),
    "builtwith": BuiltWithProvider(),
}


def get_provider(provider_id: ResearchProviderId):
    return _REGISTRY[provider_id]


async def search_providers(
    *,
    sources: list[ResearchProviderId],
    credentials: dict[ResearchProviderId, dict[str, Any]],
    criteria: ProspectCriteria,
    fetch_limit: int,
    organization_id: str | None = None,
) -> tuple[list[ProspectCandidate], list[ResearchProviderId], list[dict[str, Any]]]:
    """Run enabled sources in parallel; return merged candidates + used + errors."""
    errors: list[dict[str, Any]] = []
    used: list[ResearchProviderId] = []
    batches: list[list[ProspectCandidate]] = []

    async def _one(pid: ResearchProviderId) -> None:
        cred = credentials.get(pid)
        if not cred or not cred.get("apiKey"):
            errors.append(
                {"provider": pid, "error": "provider_not_configured"}
            )
            return
        try:
            provider = get_provider(pid)
            settings = dict(cred.get("settings") or {})
            if organization_id and "organizationId" not in settings:
                settings["organizationId"] = str(organization_id)
            rows = await provider.search(
                criteria=criteria,
                api_key=str(cred["apiKey"]),
                limit=fetch_limit,
                settings=settings,
            )
            batches.append(rows)
            if rows is not None:
                used.append(pid)
        except Exception as exc:  # noqa: BLE001
            logger.warning("provider %s failed: %s", pid, exc)
            errors.append({"provider": pid, "error": str(exc)})

    await asyncio.gather(*[_one(s) for s in sources if s in PROVIDERS])
    merged = merge_candidates(batches)
    return merged, used, errors


async def fill_personnel_providers(
    *,
    candidates: list[ProspectCandidate],
    credentials: dict[ResearchProviderId, dict[str, Any]],
    titles: list[str] | None,
) -> list[ProspectCandidate]:
    """Prefer Lusha then Apollo for person fill."""
    current = candidates
    for pid in ("lusha", "apollo", "zoominfo"):
        cred = credentials.get(pid)  # type: ignore[arg-type]
        if not cred or not cred.get("apiKey"):
            continue
        try:
            provider = get_provider(pid)  # type: ignore[arg-type]
            current = await provider.fill_personnel(
                candidates=current,
                api_key=str(cred["apiKey"]),
                titles=titles,
                settings=cred.get("settings"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("personnel %s failed: %s", pid, exc)
    return current
