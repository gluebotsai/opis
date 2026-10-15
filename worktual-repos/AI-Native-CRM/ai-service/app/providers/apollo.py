"""Apollo.io prospect adapter."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.providers.fixtures import (
    fixture_candidates,
    fixture_fill_personnel,
    use_fixture_key,
)
from app.providers.prospect_types import ProspectCandidate, ProspectCriteria

logger = logging.getLogger(__name__)

APOLLO_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/search"


class ApolloProvider:
    provider_id = "apollo"

    async def search(
        self,
        *,
        criteria: ProspectCriteria,
        api_key: str,
        limit: int,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        if use_fixture_key(api_key):
            return fixture_candidates("apollo", criteria, limit)
        body: dict[str, Any] = {
            "page": 1,
            "per_page": min(limit, 100),
        }
        if criteria.get("titles"):
            body["person_titles"] = criteria["titles"]
        if criteria.get("industries"):
            body["q_organization_keyword_tags"] = criteria["industries"]
        if criteria.get("geos"):
            body["organization_locations"] = criteria["geos"]
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                res = await client.post(
                    APOLLO_SEARCH_URL,
                    headers={
                        "Content-Type": "application/json",
                        "X-Api-Key": api_key,
                    },
                    json=body,
                )
                if res.status_code >= 400:
                    logger.warning(
                        "apollo search failed status=%s body=%s",
                        res.status_code,
                        res.text[:300],
                    )
                    return []
                data = res.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("apollo search error: %s", exc)
            return []
        people = data.get("people") or data.get("contacts") or []
        out: list[ProspectCandidate] = []
        for p in people[:limit]:
            org = p.get("organization") or {}
            out.append(
                {
                    "firstName": p.get("first_name"),
                    "lastName": p.get("last_name"),
                    "email": p.get("email"),
                    "phone": None,
                    "title": p.get("title"),
                    "companyName": org.get("name") or p.get("organization_name"),
                    "companyDomain": org.get("primary_domain")
                    or org.get("website_url"),
                    "linkedinUrl": p.get("linkedin_url"),
                    "industry": org.get("industry"),
                    "employeeCount": org.get("estimated_num_employees"),
                    "city": p.get("city") or org.get("city"),
                    "country": p.get("country") or org.get("country"),
                    "technographics": [],
                    "sourcesFoundIn": ["apollo"],
                    "providerPayload": {"apolloId": p.get("id")},
                }
            )
        return out

    async def fill_personnel(
        self,
        *,
        candidates: list[ProspectCandidate],
        api_key: str,
        titles: list[str] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        if use_fixture_key(api_key):
            return await fixture_fill_personnel("apollo", candidates, titles)
        # Re-search per domain when email missing (best-effort, capped).
        filled: list[ProspectCandidate] = []
        for c in candidates:
            if c.get("email"):
                filled.append(c)
                continue
            domain = c.get("companyDomain")
            if not domain:
                filled.append(c)
                continue
            try:
                more = await self.search(
                    criteria={
                        "titles": titles or ["VP Sales", "Head of Sales"],
                        "freeText": domain,
                    },
                    api_key=api_key,
                    limit=1,
                    settings=settings,
                )
                if more:
                    row = dict(c)
                    m = more[0]
                    for k in (
                        "firstName",
                        "lastName",
                        "email",
                        "phone",
                        "title",
                        "linkedinUrl",
                    ):
                        if not row.get(k) and m.get(k):
                            row[k] = m[k]
                    src = list(row.get("sourcesFoundIn") or [])
                    if "apollo" not in src:
                        src.append("apollo")
                    row["sourcesFoundIn"] = src
                    filled.append(row)  # type: ignore[arg-type]
                else:
                    filled.append(c)
            except Exception:  # noqa: BLE001
                filled.append(c)
        return filled
