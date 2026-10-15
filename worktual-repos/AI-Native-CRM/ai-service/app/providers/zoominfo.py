"""ZoomInfo prospect adapter via Worktual gateway (search free; enrich costs credits)."""

from __future__ import annotations

import logging
from typing import Any

from app.integrations.zoominfo_gateway import (
    ZOOMINFO_GATEWAY_API_KEY,
    is_zoominfo_gateway_configured,
    uses_zoominfo_gateway,
    zoominfo_gateway_call,
)
from app.providers.fixtures import (
    fixture_candidates,
    fixture_fill_personnel,
    use_fixture_key,
)
from app.providers.prospect_types import ProspectCandidate, ProspectCriteria

logger = logging.getLogger(__name__)


def _org_id(settings: dict[str, Any] | None) -> str:
    if not settings:
        return ""
    return str(settings.get("organizationId") or settings.get("organization_id") or "").strip()


def _attrs(row: dict[str, Any]) -> dict[str, Any]:
    attrs = row.get("attributes")
    if isinstance(attrs, dict):
        return attrs
    return row


def _company_name(attrs: dict[str, Any]) -> str | None:
    company = attrs.get("company")
    if isinstance(company, dict):
        name = company.get("name")
        if name:
            return str(name)
    for key in ("companyName", "company_name"):
        if attrs.get(key):
            return str(attrs[key])
    return None


def _linkedin(attrs: dict[str, Any]) -> str | None:
    urls = attrs.get("externalUrls") or attrs.get("external_urls")
    if isinstance(urls, list):
        for item in urls:
            if not isinstance(item, dict):
                continue
            typ = str(item.get("type") or "").lower()
            url = item.get("url")
            if url and "linkedin" in typ:
                return str(url)
            if url and "linkedin.com" in str(url).lower():
                return str(url)
    return (
        attrs.get("linkedInUrl")
        or attrs.get("linkedinUrl")
        or attrs.get("linkedin_url")
    )


def _map_search_row(row: dict[str, Any]) -> ProspectCandidate:
    attrs = _attrs(row)
    person_id = row.get("id") or attrs.get("id")
    company = attrs.get("company") if isinstance(attrs.get("company"), dict) else {}
    return {
        "firstName": attrs.get("firstName") or attrs.get("firstname"),
        "lastName": attrs.get("lastName") or attrs.get("lastname"),
        "email": attrs.get("email") or attrs.get("emailAddress"),
        "phone": attrs.get("phone") or attrs.get("mobilePhone"),
        "title": attrs.get("jobTitle") or attrs.get("title"),
        "companyName": _company_name(attrs),
        "companyDomain": attrs.get("companyWebsite")
        or (company.get("website") if isinstance(company, dict) else None),
        "linkedinUrl": _linkedin(attrs),
        "industry": attrs.get("companyIndustry")
        or attrs.get("industry")
        or (company.get("industry") if isinstance(company, dict) else None),
        "employeeCount": attrs.get("companyEmployeeCount")
        or (company.get("employeeCount") if isinstance(company, dict) else None),
        "city": attrs.get("city"),
        "country": attrs.get("country"),
        "technographics": list(attrs.get("technologies") or [])[:20],
        "sourcesFoundIn": ["zoominfo"],
        "providerPayload": {
            "zoominfoId": str(person_id) if person_id is not None else None,
            "contactAccuracyScore": attrs.get("contactAccuracyScore"),
        },
    }


def _search_rows_from_data(data: dict[str, Any]) -> list[dict[str, Any]]:
    inner = data.get("data")
    if isinstance(inner, list):
        return [x for x in inner if isinstance(x, dict)]
    if isinstance(inner, dict):
        nested = inner.get("data")
        if isinstance(nested, list):
            return [x for x in nested if isinstance(x, dict)]
    raw = data.get("raw")
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    return []


def _looks_like_company(text: str) -> bool:
    words = [w for w in text.split() if w]
    if not words or len(words) > 4 or len(text) > 60:
        return False
    lowered = text.lower()
    blocked = (
        "lead",
        "leads",
        "searching",
        "research",
        "product",
        "products",
        "prospect",
        "import",
        "pull",
    )
    return not any(f" {word} " in f" {lowered} " for word in blocked)


def _criteria_to_search_params(
    criteria: ProspectCriteria, limit: int
) -> dict[str, Any]:
    params: dict[str, Any] = {"pageSize": max(1, min(25, limit))}
    titles = criteria.get("titles") or []
    if titles:
        params["jobTitle"] = titles[0] if len(titles) == 1 else titles
    industries = criteria.get("industries") or []
    if industries:
        params["industry"] = industries[0] if len(industries) == 1 else industries
    geos = criteria.get("geos") or []
    if geos:
        params["country"] = geos[0] if len(geos) == 1 else geos
    free = (criteria.get("freeText") or "").strip()
    # productFitHint is for qualify, not a ZoomInfo company-name filter.
    if (
        free
        and "companyName" not in params
        and "jobTitle" not in params
        and _looks_like_company(free)
    ):
        params["companyName"] = free[:120]
    if not any(
        k in params
        for k in (
            "jobTitle",
            "companyName",
            "industry",
            "country",
            "emailAddress",
            "phone",
            "firstName",
            "lastName",
            "fullName",
        )
    ):
        params["jobTitle"] = "Manager"
    return params


class ZoomInfoProvider:
    provider_id = "zoominfo"

    async def search(
        self,
        *,
        criteria: ProspectCriteria,
        api_key: str,
        limit: int,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        if use_fixture_key(api_key):
            return fixture_candidates("zoominfo", criteria, limit)

        if uses_zoominfo_gateway(api_key) or is_zoominfo_gateway_configured():
            org = _org_id(settings)
            if not org:
                raise RuntimeError(
                    "ZoomInfo search needs an organization id."
                )
            data = await zoominfo_gateway_call(
                organization_id=org,
                tool_name="search_contacts",
                parameters=_criteria_to_search_params(criteria, limit),
            )
            rows = _search_rows_from_data(data)
            return [_map_search_row(r) for r in rows[:limit]]

        raise RuntimeError(
            "ZoomInfo gateway is not configured. Set ZOOMINFO_GATEWAY_TOKEN."
        )

    async def fill_personnel(
        self,
        *,
        candidates: list[ProspectCandidate],
        api_key: str,
        titles: list[str] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        if use_fixture_key(api_key):
            return await fixture_fill_personnel("zoominfo", candidates, titles)
        # Enrich is credit-bearing; do not auto-enrich during personnel fill.
        return candidates

    async def enrich_contact(
        self,
        *,
        organization_id: str,
        person_id: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any] | None:
        """Paid enrich_contacts call (1 credit per contact)."""
        if not is_zoominfo_gateway_configured():
            return None
        params: dict[str, Any] = {
            "outputFields": [
                "id",
                "firstName",
                "lastName",
                "jobTitle",
                "email",
                "phone",
                "mobilePhone",
                "companyName",
                "externalUrls",
                "contactAccuracyScore",
            ]
        }
        if person_id:
            params["personId"] = person_id
        elif email:
            params["emailAddress"] = email
        elif phone:
            params["phone"] = phone
        else:
            return None
        data = await zoominfo_gateway_call(
            organization_id=organization_id,
            tool_name="enrich_contacts",
            parameters=params,
            idempotency_key=idempotency_key,
        )
        return data
