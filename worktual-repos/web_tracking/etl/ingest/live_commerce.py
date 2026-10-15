"""Redis ecommerce live state + pub/sub for dashboard SSE."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from config import Settings, get_settings

from ingest.live_presence import extract_live_fields

logger = logging.getLogger(__name__)

_CLIENT: Any = None
_CLIENT_URL: str | None = None

EVENTS_TYPES = frozenset({"events_v2", "events_v3"})
ECOM_EVENTS = frozenset(
    {
        "product_view",
        "add_to_cart",
        "remove_from_cart",
        "add_to_wishlist",
        "remove_from_wishlist",
        "begin_checkout",
        "purchase",
        "refund",
        "payment_failure",
    }
)
KPI_FIELDS = (
    "product_views",
    "cart_adds",
    "cart_removes",
    "wishlist_adds",
    "wishlist_removes",
    "checkout_starts",
    "purchases",
    "purchase_revenue",
    "refunds",
    "refund_value",
    "payment_failures",
)
INCR_MAP = {
    "product_view": "product_views",
    "add_to_cart": "cart_adds",
    "remove_from_cart": "cart_removes",
    "add_to_wishlist": "wishlist_adds",
    "remove_from_wishlist": "wishlist_removes",
    "begin_checkout": "checkout_starts",
    "purchase": "purchases",
    "refund": "refunds",
    "payment_failure": "payment_failures",
}


def _redis_client(redis_url: str) -> Any:
    global _CLIENT, _CLIENT_URL
    if _CLIENT is not None and _CLIENT_URL == redis_url:
        return _CLIENT
    import redis

    _CLIENT = redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=2)
    _CLIENT_URL = redis_url
    return _CLIENT


def _utc_date() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _kpis_key(website_id: int, day: str) -> str:
    return f"wt:ecom:{website_id}:kpis:{day}"


def _visitors_key(website_id: int, day: str) -> str:
    return f"wt:ecom:{website_id}:visitors:{day}"


def _products_zkey(website_id: int, day: str) -> str:
    return f"wt:ecom:{website_id}:products:{day}"


def _product_hkey(website_id: int, day: str, product_id: str) -> str:
    return f"wt:ecom:{website_id}:product:{day}:{product_id}"


def _visitor_hkey(website_id: int, visitor_id: str) -> str:
    return f"wt:ecom:{website_id}:visitor:{visitor_id}"


def _recent_key(website_id: int) -> str:
    return f"wt:ecom:{website_id}:recent"


def _sse_channel(website_id: int) -> str:
    return f"wt:sse:{website_id}"


def _props(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("properties") or event.get("props") or {}
    return raw if isinstance(raw, dict) else {}


def _product_from_props(props: dict[str, Any]) -> dict[str, Any] | None:
    pid = str(props.get("productId") or props.get("sku") or props.get("id") or "").strip()
    if not pid:
        return None
    qty = props.get("quantity")
    try:
        qty_n = int(float(qty)) if qty is not None else 1
    except (TypeError, ValueError):
        qty_n = 1
    price = props.get("productPrice") if props.get("productPrice") is not None else props.get("price")
    try:
        price_n = float(price) if price is not None else 0.0
    except (TypeError, ValueError):
        price_n = 0.0
    return {
        "id": pid[:256],
        "name": str(props.get("productName") or props.get("name") or "")[:512],
        "qty": max(1, qty_n),
        "price": price_n,
        "currency": str(props.get("currency") or "USD")[:8],
    }


def _products_from_event(props: dict[str, Any]) -> list[dict[str, Any]]:
    lines = props.get("products") or props.get("items")
    out: list[dict[str, Any]] = []
    if isinstance(lines, list):
        for line in lines:
            if isinstance(line, dict):
                parsed = _product_from_props(line)
                if parsed:
                    out.append(parsed)
    single = _product_from_props(props)
    if single and not any(p["id"] == single["id"] for p in out):
        out.insert(0, single)
    return out


def _order_from_props(props: dict[str, Any], event_name: str) -> dict[str, Any] | None:
    if event_name not in {"purchase", "refund", "begin_checkout"}:
        return None
    revenue = props.get("revenue")
    if revenue is None:
        revenue = props.get("cartValue")
    if revenue is None:
        revenue = props.get("value")
    try:
        revenue_n = float(revenue) if revenue is not None else 0.0
    except (TypeError, ValueError):
        revenue_n = 0.0
    return {
        "id": str(props.get("orderId") or props.get("transactionId") or "")[:256],
        "revenue": revenue_n,
        "currency": str(props.get("currency") or "USD")[:8],
    }


def _read_counts(client: Any, website_id: int, day: str) -> dict[str, float]:
    raw = client.hgetall(_kpis_key(website_id, day)) or {}
    counts: dict[str, float] = {}
    for field in KPI_FIELDS:
        try:
            counts[field] = float(raw.get(field) or 0)
        except (TypeError, ValueError):
            counts[field] = 0.0
    views = counts.get("product_views") or 0
    cart = counts.get("cart_adds") or 0
    counts["add_to_cart_rate"] = round((cart / views) * 1000) / 10 if views > 0 else 0
    counts["unique_products_touched"] = int(client.zcard(_products_zkey(website_id, day)) or 0)
    counts["product_engaged_visitors"] = int(client.scard(_visitors_key(website_id, day)) or 0)
    return counts


def _bump_product(pipe: Any, website_id: int, day: str, product: dict[str, Any], event_name: str) -> None:
    pid = product["id"]
    hkey = _product_hkey(website_id, day, pid)
    zkey = _products_zkey(website_id, day)
    pipe.hset(hkey, mapping={"product_id": pid, "product_name": product.get("name") or pid})
    field = INCR_MAP.get(event_name)
    if field:
        pipe.hincrby(hkey, field, 1)
    if event_name == "purchase":
        pipe.hincrbyfloat(hkey, "purchase_revenue", float(product.get("price") or 0) * int(product.get("qty") or 1))
    pipe.zincrby(zkey, 1, pid)
    pipe.expire(hkey, 172800)
    pipe.expire(zkey, 172800)


def update_from_collect_body(body: dict[str, Any], settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.live_presence_enabled or not settings.redis_url:
        return
    if str(body.get("type") or "") not in EVENTS_TYPES:
        return
    live = extract_live_fields(body)
    if not live:
        return

    events = body.get("events")
    if not isinstance(events, list) or not events:
        return

    website_id = live["website_id"]
    visitor_id = live["visitor_id"]
    session_id = live["session_id"]
    day = _utc_date()
    ttl_kpis = 172800
    ttl_visitor = max(settings.live_presence_ttl_seconds, 1800)

    try:
        client = _redis_client(settings.redis_url)
        kpis_key = _kpis_key(website_id, day)
        visitors_key = _visitors_key(website_id, day)
        visitor_key = _visitor_hkey(website_id, visitor_id)
        recent_key = _recent_key(website_id)
        channel = _sse_channel(website_id)

        for event in events:
            if not isinstance(event, dict):
                continue
            name = str(event.get("name") or event.get("event") or "").strip()
            # page_view Live Users path is handled in live_presence (Redis + SSE).
            # Skipping here avoids a second ~1–2s remote Redis round-trip on every view.
            if name not in ECOM_EVENTS:
                continue
            props = _props(event)
            products = _products_from_event(props)
            product = products[0] if products else None
            order = _order_from_props(props, name)
            ts = event.get("ts") or event.get("timestamp") or int(time.time() * 1000)
            try:
                ts_n = int(ts)
            except (TypeError, ValueError):
                ts_n = int(time.time() * 1000)

            pipe = client.pipeline(transaction=False)
            field = INCR_MAP.get(name)
            if field:
                pipe.hincrby(kpis_key, field, 1)
            if name == "purchase" and order:
                pipe.hincrbyfloat(kpis_key, "purchase_revenue", float(order.get("revenue") or 0))
            if name == "refund" and order:
                pipe.hincrbyfloat(kpis_key, "refund_value", float(order.get("revenue") or 0))
            pipe.sadd(visitors_key, visitor_id)
            pipe.expire(kpis_key, ttl_kpis)
            pipe.expire(visitors_key, ttl_kpis)
            visitor_map = {
                "visitor_id": visitor_id,
                "last_type": name,
                "last_ts": str(ts_n),
            }
            if product:
                visitor_map["last_product_id"] = product["id"]
                visitor_map["last_product_name"] = product.get("name") or ""
            pipe.hset(visitor_key, mapping=visitor_map)
            if field:
                pipe.hincrby(visitor_key, field, 1)
            pipe.expire(visitor_key, ttl_visitor)
            for line in products:
                _bump_product(pipe, website_id, day, line, name)
            recent = {
                "type": name,
                "visitor_id": visitor_id,
                "product": product,
                "ts": ts_n,
            }
            pipe.lpush(recent_key, json.dumps(recent, separators=(",", ":")))
            pipe.ltrim(recent_key, 0, 19)
            pipe.expire(recent_key, ttl_kpis)
            pipe.execute()

            counts = _read_counts(client, website_id, day)
            payload = {
                "v": 1,
                "type": name,
                "website_id": website_id,
                "visitor_id": visitor_id,
                "session_id": session_id,
                "ts": ts_n,
                "product": product,
                "products": products,
                "order": order,
                "counts": counts,
                "session": {
                    "session_id": session_id,
                    "visitor_id": visitor_id,
                    "current_page": live.get("current_page") or "",
                    "country": live.get("country") or "",
                    "last_activity_ms": live.get("last_activity_ms") or ts_n,
                },
            }
            client.publish(channel, json.dumps(payload, separators=(",", ":")))
    except Exception as exc:
        logger.warning("live ecommerce redis update failed: %s", exc)


def maybe_update_live_commerce(body: dict[str, Any], settings: Settings | None = None) -> None:
    try:
        update_from_collect_body(body, settings=settings)
    except Exception as exc:
        logger.warning("live ecommerce skipped: %s", exc)
