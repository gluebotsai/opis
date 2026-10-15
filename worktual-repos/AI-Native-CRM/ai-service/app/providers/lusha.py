"""Lusha person enrichment / search adapter."""

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

LUSHA_PERSON_URL = "https://api.lusha.com/v2/person"


class LushaProvider:
    provider_id = "lusha"

    async def search(
        self,
        *,
        criteria: ProspectCriteria,
        api_key: str,
        limit: int,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        # Lusha is primarily person reveal; for list search we use fixtures or
        # a thin company+title heuristic via their person endpoint when possible.
        if use_fixture_key(api_key):
            return fixture_candidates("lusha", criteria, limit)
        logger.info(
            "lusha search: list search not available without company names; "
            "returning empty (use with personnel step or fixtures)."
        )
        return []

    async def fill_personnel(
        self,
        *,
        candidates: list[ProspectCandidate],
        api_key: str,
        titles: list[str] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        if use_fixture_key(api_key):
            return await fixture_fill_personnel("lusha", candidates, titles)
        out: list[ProspectCandidate] = []
        async with httpx.AsyncClient(timeout=20.0) as client:
            for c in candidates:
                if c.get("email") and c.get("phone"):
                    out.append(c)
                    continue
                first = c.get("firstName")
                last = c.get("lastName")
                company = c.get("companyName") or c.get("companyDomain")
                if not company:
                    out.append(c)
                    continue
                try:
                    res = await client.post(
                        LUSHA_PERSON_URL,
                        headers={
                            "Content-Type": "application/json",
                            "api_key": api_key,
                        },
                        json={
                            "firstName": first,
                            "lastName": last,
                            "companyName": company,
                            "jobTitle": (titles or [c.get("title")])[0]
                            if (titles or c.get("title"))
                            else None,
                        },
                    )
                    if res.status_code >= 400:
                        out.append(c)
                        continue
                    data = res.json()
                    contact = data.get("contact") or data.get("data") or data
                    row = dict(c)
                    email = (
                        contact.get("emailAddresses")
                        or contact.get("emails")
                        or []
                    )
                    if isinstance(email, list) and email:
                        first_email = email[0]
                        row["email"] = (
                            first_email.get("email")
                            if isinstance(first_email, dict)
                            else first_email
                        )
                    elif isinstance(email, str):
                        row["email"] = email
                    phones = contact.get("phoneNumbers") or contact.get("phones") or []
                    if isinstance(phones, list) and phones and not row.get("phone"):
                        ph = phones[0]
                        row["phone"] = (
                            ph.get("number") if isinstance(ph, dict) else str(ph)
                        )
                    src = list(row.get("sourcesFoundIn") or [])
                    if "lusha" not in src:
                        src.append("lusha")
                    row["sourcesFoundIn"] = src
                    out.append(row)  # type: ignore[arg-type]
                except Exception as exc:  # noqa: BLE001
                    logger.warning("lusha fill error: %s", exc)
                    out.append(c)
        return out
