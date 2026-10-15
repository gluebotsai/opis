"""Read Booxoo customers and orders from the contact-center customer store."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.cdp_store")


def store_configured() -> bool:
    return bool(get_settings().database_url.strip())


def _connect_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True) if key != "schema"]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _organization_id(value: str) -> int | None:
    text = str(value or "").strip()
    if not text.isdigit():
        return None
    return int(text)


def _name(first: str | None, last: str | None) -> str:
    return " ".join(part.strip() for part in (first or "", last or "") if part and part.strip())


def lookup_customer(organization_id: str, email: str = "", phone: str = "") -> dict[str, Any] | None:
    """Return None when the database is not configured."""
    if not store_configured():
        return None
    org_id = _organization_id(organization_id)
    email = (email or "").strip()
    phone = (phone or "").strip()
    if org_id is None or (not email and not phone):
        return {"found": False}
    if email:
        key_types, key_value = ("email", "email_secondary"), email
        key_filter = "ik.key_type = ANY(%s)"
        match = "lower(ik.key_value) = lower(%s)"
        params = (org_id, list(key_types), key_value)
    else:
        key_value = phone
        key_filter = "ik.key_type = %s"
        match = "ik.key_value = %s"
        params = (org_id, "phone", key_value)
    sql = f"""
        SELECT cp.cdp_id, cp.first_name, cp.last_name, cp.contact_type,
               em.key_value AS email, ph.key_value AS phone
        FROM cdp.identity_keys ik
        JOIN cdp.customer_profile cp
          ON cp.cdp_id = ik.cdp_id
         AND cp.organization_id = ik.organization_id
        LEFT JOIN cdp.identity_keys em
          ON em.cdp_id = cp.cdp_id
         AND em.organization_id = cp.organization_id
         AND em.key_type = 'email'
        LEFT JOIN cdp.identity_keys ph
          ON ph.cdp_id = cp.cdp_id
         AND ph.organization_id = cp.organization_id
         AND ph.key_type = 'phone'
        WHERE ik.organization_id = %s
          AND {key_filter}
          AND {match}
        LIMIT 1
    """
    row = _one(sql, params)
    if not row:
        return {"found": False}
    return {
        "found": True,
        "cdp_id": row[0],
        "customer": {
            "name": _name(row[1], row[2]),
            "email": row[4] or email,
            "phone": row[5] or phone,
            "contact_type": row[3] or "",
        },
    }


def list_recent_orders_for_customer(organization_id: str, cdp_id: str, limit: int = 5) -> list[dict] | None:
    if not store_configured():
        return None
    org_id = _organization_id(organization_id)
    cdp_id = (cdp_id or "").strip()
    if org_id is None or not cdp_id:
        return []
    rows = _all(
        """
        SELECT order_id, order_number, status, created_at
        FROM cdp.orders
        WHERE organization_id = %s AND cdp_id = %s
        ORDER BY created_at DESC NULLS LAST
        LIMIT %s
        """,
        (org_id, cdp_id, limit),
    )
    return _with_items(org_id, rows)


def get_order_for_customer(organization_id: str, cdp_id: str, order_ref: str) -> dict | None:
    """Return None when the database is not configured. Empty dict when the order is missing."""
    if not store_configured():
        return None
    org_id = _organization_id(organization_id)
    cdp_id = (cdp_id or "").strip()
    order_ref = (order_ref or "").strip()
    if org_id is None or not cdp_id or not order_ref:
        return {}
    if order_ref.isdigit():
        where = "(o.order_id = %s OR o.order_number = %s)"
        params: tuple = (org_id, cdp_id, int(order_ref), order_ref)
    else:
        where = "o.order_number = %s"
        params = (org_id, cdp_id, order_ref)
    rows = _all(
        f"""
        SELECT o.order_id, o.order_number, o.status, o.created_at
        FROM cdp.orders o
        WHERE o.organization_id = %s
          AND o.cdp_id = %s
          AND {where}
        LIMIT 1
        """,
        params,
    )
    orders = _with_items(org_id, rows)
    return orders[0] if orders else {}


def _with_items(org_id: int, rows: list[tuple]) -> list[dict]:
    if not rows:
        return []
    order_ids = [row[0] for row in rows]
    items = _all(
        """
        SELECT oi.order_id,
               oi.order_item_id,
               oi.custom_fields->>'sku' AS sku,
               oi.custom_fields->>'source_product_id' AS source_product_id,
               p.name
        FROM cdp.order_items oi
        LEFT JOIN inventory.products p
          ON p.organization_id = oi.organization_id
         AND p.sku = oi.custom_fields->>'sku'
        WHERE oi.organization_id = %s
          AND oi.order_id = ANY(%s)
        ORDER BY oi.order_item_id
        """,
        (org_id, order_ids),
    )
    by_order: dict[str, list[dict]] = {}
    for order_id, order_item_id, sku, source_product_id, name in items:
        ref = str(sku or source_product_id or order_item_id or "").strip()
        by_order.setdefault(str(order_id), []).append(
            {"product_id": ref, "name": (name or "").strip() or ref}
        )
    slim = []
    for order_id, order_number, status, created_at in rows:
        slim.append(
            {
                "order_id": str(order_id),
                "order_number": str(order_number or order_id),
                "status": status or "",
                "date": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at or ""),
                "items": by_order.get(str(order_id), []),
            }
        )
    return slim


def _one(sql: str, params: tuple) -> tuple | None:
    rows = _all(sql, params)
    return rows[0] if rows else None


def _all(sql: str, params: tuple) -> list[tuple]:
    import psycopg

    try:
        with psycopg.connect(_connect_url(get_settings().database_url), connect_timeout=8) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return list(cur.fetchall())
    except Exception as exc:
        logger.warning("cdp_store_query_failed error=%s", exc)
        raise
