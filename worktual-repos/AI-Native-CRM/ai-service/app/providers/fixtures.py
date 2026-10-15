"""Deterministic fixture candidates for local/dev and tests."""

from __future__ import annotations

from typing import Any

from app.providers.prospect_types import (
    ProspectCandidate,
    ProspectCriteria,
    ResearchProviderId,
)


def use_fixture_key(api_key: str) -> bool:
    k = (api_key or "").strip().lower()
    return k in {"__fixture__", "fixture", "test"} or k.startswith("fixture:")


def fixture_candidates(
    provider: ResearchProviderId,
    criteria: ProspectCriteria,
    limit: int,
) -> list[ProspectCandidate]:
    industries = criteria.get("industries") or ["IT services"]
    geos = criteria.get("geos") or ["IN"]
    titles = criteria.get("titles") or ["VP Sales", "Head of Sales"]
    tech = criteria.get("technographics") or []
    industry = industries[0]
    geo = geos[0]
    base: list[ProspectCandidate] = []
    first_names = ["Asha", "Rohan", "Priya", "Dev", "Meera", "Karan", "Nisha", "Arjun"]
    last_names = ["Sharma", "Patel", "Iyer", "Khan", "Nair", "Singh", "Desai", "Gupta"]
    for i in range(max(limit, 8)):
        title = titles[i % len(titles)]
        domain = f"prospect-{provider}-{i + 1}.example.com"
        row: ProspectCandidate = {
            "firstName": first_names[i % len(first_names)],
            "lastName": last_names[i % len(last_names)],
            "email": f"{first_names[i % len(first_names)].lower()}.{last_names[i % len(last_names)].lower()}@{domain}",
            "phone": None,
            "title": title,
            "companyName": f"{industry.title()} Partners {i + 1}",
            "companyDomain": domain,
            "linkedinUrl": None,
            "industry": industry,
            "employeeCount": 250 + i * 50,
            "city": "Bengaluru" if geo.upper() in {"IN", "INDIA"} else "Austin",
            "country": geo.upper() if len(geo) <= 3 else geo,
            "technographics": list(tech) if tech else (
                ["salesforce"] if provider == "builtwith" else []
            ),
            "sourcesFoundIn": [provider],
            "providerPayload": {"fixture": True, "provider": provider, "i": i},
        }
        # BuiltWith often returns accounts without people
        if provider == "builtwith" and i % 2 == 0:
            row["firstName"] = None
            row["lastName"] = None
            row["email"] = None
            row["title"] = None
        base.append(row)
    return base[:limit]


async def fixture_fill_personnel(
    provider: ResearchProviderId,
    candidates: list[ProspectCandidate],
    titles: list[str] | None,
) -> list[ProspectCandidate]:
    title = (titles or ["VP Sales"])[0]
    out: list[ProspectCandidate] = []
    for i, c in enumerate(candidates):
        row = dict(c)
        if not row.get("email") and row.get("companyDomain"):
            domain = row["companyDomain"]
            row["firstName"] = row.get("firstName") or f"Contact{i + 1}"
            row["lastName"] = row.get("lastName") or "Lead"
            row["email"] = f"contact{i + 1}@{domain}"
            row["title"] = row.get("title") or title
            sources = list(row.get("sourcesFoundIn") or [])
            if provider not in sources:
                sources.append(provider)
            row["sourcesFoundIn"] = sources
        out.append(row)  # type: ignore[arg-type]
    return out
