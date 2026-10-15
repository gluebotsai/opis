"""Resolve Contact Center admin/agent from product-access tables. Deny is final."""

from __future__ import annotations

from typing import Any, Callable

from ..access import AccessDenied, normalize_role
from ..loader import merge_effective

PRODUCT_ID = "contact-center"

ROLE_SQL = """
SELECT r.name AS role_name
FROM accounts.setup_users u
JOIN accounts.setup_user_product_access p ON u.id = p.user_id
JOIN accounts.setup_roles r ON p.role_id = r.id
WHERE u.id = %s
  AND u.organization_id = %s
  AND p.product_id = %s
"""


def lookup_cc_role(
    dsn: str,
    organization_id: int,
    user_id: int,
    *,
    fetch: Callable[..., list[dict[str, Any]]] | None = None,
) -> str:
    """Return 'admin' or 'agent' from setup_user_product_access + setup_roles."""
    if not str(dsn or "").strip():
        raise AccessDenied("scope_denied: contact-center role could not be resolved.")
    from .. import db as pg

    runner = fetch or pg.fetchall
    access = merge_effective()["access"]
    try:
        rows = runner(
            str(dsn),
            ROLE_SQL,
            (int(user_id), int(organization_id), PRODUCT_ID),
        )
    except AccessDenied:
        raise
    except Exception as exc:
        raise AccessDenied("scope_denied: contact-center role could not be resolved.") from exc
    if not rows:
        raise AccessDenied("scope_denied: no contact-center product access for this user.")
    names = [normalize_role(str(row.get("role_name") or ""), access) for row in rows]
    if "admin" in names:
        return "admin"
    return names[0] or "agent"
