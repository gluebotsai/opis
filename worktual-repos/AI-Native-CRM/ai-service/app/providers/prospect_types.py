"""Shared prospect candidate contracts for multi-source lead pull."""

from __future__ import annotations

from typing import Any, Literal, TypedDict

ResearchProviderId = Literal["apollo", "zoominfo", "lusha", "builtwith"]

PROVIDERS: tuple[ResearchProviderId, ...] = (
    "apollo",
    "zoominfo",
    "lusha",
    "builtwith",
)


class ProspectCriteria(TypedDict, total=False):
    industries: list[str]
    geos: list[str]
    sizeTiers: list[str]
    titles: list[str]
    technographics: list[str]
    productFitHint: str | None
    freeText: str | None


class ProspectCandidate(TypedDict, total=False):
    firstName: str | None
    lastName: str | None
    email: str | None
    phone: str | None
    title: str | None
    companyName: str | None
    companyDomain: str | None
    linkedinUrl: str | None
    industry: str | None
    employeeCount: int | None
    city: str | None
    country: str | None
    technographics: list[str]
    sourcesFoundIn: list[ResearchProviderId]
    qualifyReasons: list[str]
    qualifyScore: int | None
    providerPayload: dict[str, Any]


def normalize_domain(raw: str | None) -> str | None:
    if not raw or not str(raw).strip():
        return None
    d = (
        str(raw)
        .strip()
        .lower()
        .replace("https://", "")
        .replace("http://", "")
        .removeprefix("www.")
    )
    return d.split("/")[0].split("@")[-1] or None


def candidate_dedupe_key(c: ProspectCandidate) -> str:
    email = (c.get("email") or "").strip().lower()
    if email:
        return f"email:{email}"
    domain = normalize_domain(c.get("companyDomain"))
    name = " ".join(
        p
        for p in [
            (c.get("firstName") or "").strip().lower(),
            (c.get("lastName") or "").strip().lower(),
        ]
        if p
    )
    company = (c.get("companyName") or "").strip().lower()
    if domain and name:
        return f"person:{domain}:{name}"
    if domain and company:
        return f"acct:{domain}"
    if company and name:
        return f"co:{company}:{name}"
    return f"row:{company}:{name}:{c.get('title') or ''}"


def merge_candidates(batches: list[list[ProspectCandidate]]) -> list[ProspectCandidate]:
    """Merge multi-source results; union sourcesFoundIn on duplicates."""
    by_key: dict[str, ProspectCandidate] = {}
    order: list[str] = []
    for batch in batches:
        for raw in batch:
            c = dict(raw)
            sources = list(c.get("sourcesFoundIn") or [])
            c["sourcesFoundIn"] = sources
            if c.get("companyDomain"):
                c["companyDomain"] = normalize_domain(c.get("companyDomain"))
            key = candidate_dedupe_key(c)  # type: ignore[arg-type]
            existing = by_key.get(key)
            if not existing:
                by_key[key] = c  # type: ignore[assignment]
                order.append(key)
                continue
            # Prefer filled fields; union sources
            for field in (
                "firstName",
                "lastName",
                "email",
                "phone",
                "title",
                "companyName",
                "companyDomain",
                "linkedinUrl",
                "industry",
                "employeeCount",
                "city",
                "country",
            ):
                if not existing.get(field) and c.get(field):
                    existing[field] = c[field]
            tech = list(existing.get("technographics") or [])
            for t in c.get("technographics") or []:
                if t not in tech:
                    tech.append(t)
            if tech:
                existing["technographics"] = tech
            src = list(existing.get("sourcesFoundIn") or [])
            for s in sources:
                if s not in src:
                    src.append(s)
            existing["sourcesFoundIn"] = src
    return [by_key[k] for k in order]  # type: ignore[return-value]
