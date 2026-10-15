"""Read-only website registry from My Accounts (visitorAllowanceBySlot JSON).

Used for diagnostics/tests. Ingest validates via ClickHouse dict_admin_accounts
(synced from public.admin_accounts) — not per-payload Postgres lookups from this module.
"""

from __future__ import annotations

from typing import Any

from ingest.validation import website_url_key
from shared.postgres import get_pg_connection

WEB_TRACKING_PRODUCT_ID = "web-tracking"
DEFAULT_SITE_TYPE = "ecommerce"

# All entitled websites from live subscriptions + pre-live active_products.
_LOOKUP_BY_WEBSITE_ID_SQL = """
WITH live AS (
  SELECT organization_id, entitlement_config AS config
  FROM accounts.subscriptions
  WHERE product_id = %(product_id)s
    AND status <> 'cancelled'
),
prelive AS (
  SELECT pgl.organization_id, ap.config
  FROM accounts.active_products ap
  JOIN accounts.product_go_live pgl
    ON pgl.lead_id = ap.lead_id
   AND pgl.product_id = ap.product_id
   AND pgl.branch_id = ap.branch_id
  WHERE ap.product_id = %(product_id)s
),
configs AS (
  SELECT organization_id, config FROM live
  UNION ALL
  SELECT organization_id, config FROM prelive
),
slots AS (
  SELECT
    c.organization_id,
    slot.key AS website_id,
    slot.value->>'url' AS website_url
  FROM configs c,
  LATERAL jsonb_each(
    CASE
      WHEN jsonb_typeof(c.config->'visitorAllowanceBySlot') = 'object'
      THEN c.config->'visitorAllowanceBySlot'
      ELSE '{}'::jsonb
    END
  ) AS slot(key, value)
  WHERE slot.key ~ '^[0-9]+$'
)
SELECT organization_id, website_id, website_url
FROM slots
WHERE website_id = %(website_id)s
"""


def lookup_website(website_id: int, website_url: str) -> dict[str, Any]:
    """
    Resolve website_id + URL against My Accounts entitlement JSON.
    Raises ValueError when not registered (caller maps to WebsiteNotRegisteredError).
    """
    with get_pg_connection() as conn:
        row = conn.execute(
            _LOOKUP_BY_WEBSITE_ID_SQL,
            {"product_id": WEB_TRACKING_PRODUCT_ID, "website_id": str(website_id)},
        ).fetchone()

    if not row:
        raise ValueError(f"website_id {website_id} is not registered or inactive")

    registry_url = (row.get("website_url") or "").strip()
    if not registry_url:
        raise ValueError(f"website_id {website_id} has no URL configured in My Accounts")

    if website_url_key(registry_url) != website_url_key(website_url):
        raise ValueError(f"website_url mismatch for website_id {website_id}")

    org_id = row.get("organization_id")
    organization_id: int | None = int(org_id) if org_id is not None else None
    if organization_id == 0:
        organization_id = None

    return {
        "organization_id": organization_id,
        "website_url": registry_url,
        "site_type": DEFAULT_SITE_TYPE,
        "status": "active",
        "is_active": True,
    }


def lookup_organization_id(website_id: int) -> int | None:
    """Return organization_id for a registered website_id, if any."""
    with get_pg_connection() as conn:
        row = conn.execute(
            _LOOKUP_BY_WEBSITE_ID_SQL,
            {"product_id": WEB_TRACKING_PRODUCT_ID, "website_id": str(website_id)},
        ).fetchone()
    if not row:
        return None
    org_id = row.get("organization_id")
    if org_id is None:
        return None
    value = int(org_id)
    return value if value > 0 else None
