"""Contracts for analytics owned by external Marketing and Service systems."""

from __future__ import annotations

from typing import Any, Protocol

from app.agents.reports_analytics_agent import AnalyticsScope


class MarketingAnalyticsConnector(Protocol):
    """Query the Marketing service API; never join its database from CRM."""

    async def query(
        self, semantic_request: dict[str, Any], scope: AnalyticsScope
    ) -> dict[str, Any]: ...


class ServiceAnalyticsConnector(Protocol):
    """Query the Service service API; never join its database from CRM."""

    async def query(
        self, semantic_request: dict[str, Any], scope: AnalyticsScope
    ) -> dict[str, Any]: ...


class ExternalConnectorRegistry:
    def __init__(
        self,
        *,
        marketing: MarketingAnalyticsConnector | None = None,
        service: ServiceAnalyticsConnector | None = None,
    ) -> None:
        self.marketing = marketing
        self.service = service

    def for_domain(
        self, domain: str
    ) -> MarketingAnalyticsConnector | ServiceAnalyticsConnector | None:
        if domain == "marketing":
            return self.marketing
        if domain == "service":
            return self.service
        return None
