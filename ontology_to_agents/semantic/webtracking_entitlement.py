"""Webtracking website tenancy: require websiteId and verify org ownership."""

from __future__ import annotations

from typing import Any


class WebsiteEntitlementError(ValueError):
    """Structured entitlement / websiteId validation failure."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        website_id: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.website_id = website_id


def assert_webtracking_website_entitled(
    organization_id: int,
    website_id: int | None,
    *,
    run_query=None,
) -> int:
    """Require website_id and prove it belongs to organization_id via mart_web_sites.

    Raises WebsiteEntitlementError with code website_id_required or website_not_entitled.
    Returns the validated website_id.
    """
    if website_id is None:
        raise WebsiteEntitlementError(
            "websiteId is required for webtracking semantic queries.",
            code="website_id_required",
            website_id=None,
        )
    try:
        wid = int(website_id)
    except (TypeError, ValueError) as exc:
        raise WebsiteEntitlementError(
            "websiteId must be a positive integer.",
            code="website_id_required",
            website_id=None,
        ) from exc
    if wid < 1:
        raise WebsiteEntitlementError(
            "websiteId must be a positive integer.",
            code="website_id_required",
            website_id=wid,
        )

    if run_query is None:
        from semantic.sql.db import run_clickhouse_query

        run_query = run_clickhouse_query

    rows = run_query(
        """
        SELECT 1 AS ok
        FROM webtracking_marts.mart_web_sites
        WHERE organization_id = %s AND website_id = %s
        LIMIT 1
        """,
        [int(organization_id), wid],
    )
    if not rows:
        raise WebsiteEntitlementError(
            f"websiteId {wid} is not entitled for this organization.",
            code="website_not_entitled",
            website_id=wid,
        )
    return wid
