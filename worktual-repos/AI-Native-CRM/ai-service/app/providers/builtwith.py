"""BuiltWith technographics / domain filter adapter."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import httpx

from app.providers.fixtures import (
    fixture_candidates,
    fixture_fill_personnel,
    use_fixture_key,
)
from app.providers.prospect_types import ProspectCandidate, ProspectCriteria

logger = logging.getLogger(__name__)


class BuiltWithProvider:
    provider_id = "builtwith"

    async def search(
        self,
        *,
        criteria: ProspectCriteria,
        api_key: str,
        limit: int,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        if use_fixture_key(api_key):
            return fixture_candidates("builtwith", criteria, limit)
        tech = list(criteria.get("technographics") or [])
        if settings and isinstance(settings.get("competitorStacks"), list):
            for t in settings["competitorStacks"]:
                if isinstance(t, str) and t.strip() and t not in tech:
                    tech.append(t.strip())
        if not tech:
            logger.info("builtwith search skipped: no technographics/competitors")
            return []
        # BuiltWith Lists API varies by plan; call domain lookup for freeText domains
        # or return empty when only tech tags are present without a domain list.
        free = (criteria.get("freeText") or "").strip()
        domains: list[str] = []
        if free and "." in free:
            domains = [d.strip() for d in free.replace(",", " ").split() if "." in d]
        out: list[ProspectCandidate] = []
        async with httpx.AsyncClient(timeout=25.0) as client:
            for domain in domains[:limit]:
                try:
                    url = (
                        "https://api.builtwith.com/v21/api.json"
                        f"?KEY={quote(api_key)}&LOOKUP={quote(domain)}"
                    )
                    res = await client.get(url)
                    if res.status_code >= 400:
                        continue
                    data = res.json()
                    techs_found: list[str] = []
                    for result in data.get("Results") or []:
                        for path in result.get("Result") or []:
                            for cat in (path.get("Paths") or []) if isinstance(path, dict) else []:
                                pass
                        # Flatten technology names best-effort
                        raw = str(result)
                        for t in tech:
                            if t.lower() in raw.lower():
                                techs_found.append(t)
                    out.append(
                        {
                            "firstName": None,
                            "lastName": None,
                            "email": None,
                            "phone": None,
                            "title": None,
                            "companyName": domain.split(".")[0].title(),
                            "companyDomain": domain,
                            "linkedinUrl": None,
                            "industry": None,
                            "employeeCount": None,
                            "city": None,
                            "country": None,
                            "technographics": techs_found or tech[:3],
                            "sourcesFoundIn": ["builtwith"],
                            "providerPayload": {"domain": domain},
                        }
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning("builtwith lookup error: %s", exc)
        return out[:limit]

    async def fill_personnel(
        self,
        *,
        candidates: list[ProspectCandidate],
        api_key: str,
        titles: list[str] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        # BuiltWith has no person API
        if use_fixture_key(api_key):
            return await fixture_fill_personnel("builtwith", candidates, titles)
        return candidates
