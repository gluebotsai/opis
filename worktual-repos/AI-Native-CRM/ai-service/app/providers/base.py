"""Provider adapter interface for prospect search / personnel."""

from __future__ import annotations

from typing import Any, Protocol

from app.providers.prospect_types import (
    ProspectCandidate,
    ProspectCriteria,
    ResearchProviderId,
)


class ProspectProvider(Protocol):
    provider_id: ResearchProviderId

    async def search(
        self,
        *,
        criteria: ProspectCriteria,
        api_key: str,
        limit: int,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        """Return raw person/account candidates (not yet qualified)."""

    async def fill_personnel(
        self,
        *,
        candidates: list[ProspectCandidate],
        api_key: str,
        titles: list[str] | None = None,
        settings: dict[str, Any] | None = None,
    ) -> list[ProspectCandidate]:
        """Fill missing contact fields on account-heavy rows."""
