"""Order lookup tools for custom_booxoo_bot ticket handling."""

from __future__ import annotations

from typing import Any

from app.agents.custom_booxoo_bot.clients.cdp import CdpClient
from app.agents.custom_booxoo_bot.clients.cdp_store import (
    get_order_for_customer,
    list_recent_orders_for_customer,
    lookup_customer,
)
from app.agents.custom_booxoo_bot.contact import resolve_identity, usable_email, usable_phone
from app.agents.custom_booxoo_bot.tools.base import Tool
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.orders")

_client = CdpClient()


def _contact(ctx, email: str = "", mobile: str = "") -> tuple[str, str]:
    return resolve_identity(
        ctx.session.contact,
        email,
        mobile,
        lock=bool(ctx.session.authenticated),
    )


def _lookup_contact(ctx, email: str = "", mobile: str = "") -> tuple[str, str]:
    provided_email = usable_email(email)
    provided_mobile = usable_phone(mobile)
    if provided_email:
        return provided_email, ""
    if provided_mobile:
        return "", provided_mobile
    return _contact(ctx)


def _save_contact(ctx, email: str, mobile: str) -> None:
    previous_email = (ctx.session.contact.get("email") or "").strip()
    previous_phone = (ctx.session.contact.get("phone") or "").strip()
    email = usable_email(email)
    mobile = usable_phone(mobile)
    if ctx.session.authenticated:
        if email and previous_email and email.lower() != previous_email.lower():
            email = ""
        if mobile and previous_phone and mobile != previous_phone:
            mobile = ""
    if ctx.session.registered_customer and not ctx.session.authenticated:
        if email and previous_email and email.lower() != previous_email.lower():
            email = ""
        if mobile and previous_phone and mobile != previous_phone:
            mobile = ""
    if email:
        ctx.session.contact["email"] = email
    if mobile:
        ctx.session.contact["phone"] = mobile
    switched = (email and previous_email and email.lower() != previous_email.lower()) or (
        mobile and previous_phone and mobile != previous_phone
    )
    if switched and not ctx.session.authenticated:
        ctx.session.customer_found = False
        ctx.session.ticketing_verified = False
        ctx.session.authenticated = False
        ctx.session.cdp_id = None
        ctx.session.contact_type = ""
        ctx.session.otp_code = None
        ctx.session.otp_channel = None
        ctx.session.otp_destination = None
        ctx.session.selected_order_id = None
        ctx.session.selected_order = None
        ctx.session.selected_product_id = None


def _as_customer(payload: Any) -> dict | None:
    if not isinstance(payload, dict) or payload.get("found") is False:
        return None
    if isinstance(payload.get("customer_profile"), dict):
        profile = dict(payload["customer_profile"])
    elif isinstance(payload.get("customer"), dict):
        profile = dict(payload["customer"])
    elif isinstance(payload.get("data"), dict):
        profile = dict(payload["data"])
    else:
        profile = dict(payload)
    for key in payload.get("identity_keys") or []:
        if not isinstance(key, dict):
            continue
        kind = str(key.get("key_type") or "").lower()
        value = str(key.get("key_value") or "").strip()
        if not value:
            continue
        if kind == "email" and not profile.get("email"):
            profile["email"] = value
        if kind in ("phone", "mobile", "mobile_number") and not profile.get("phone"):
            profile["phone"] = value
    full = " ".join(part for part in (profile.get("first_name"), profile.get("last_name")) if part).strip()
    if full and not profile.get("name"):
        profile["name"] = full
    if not profile.get("name") and not profile.get("email") and not profile.get("phone"):
        return None
    return profile


def _fill_empty_contact(session, profile: dict) -> None:
    contact = session.contact
    name = profile.get("name") or profile.get("customer_name") or ""
    email = profile.get("email") or ""
    phone = profile.get("mobile_number") or profile.get("phone") or profile.get("mobile") or ""
    if name and not contact.get("name"):
        contact["name"] = str(name).strip()
    if email and not contact.get("email"):
        contact["email"] = str(email).strip()
    if phone and not contact.get("phone"):
        contact["phone"] = str(phone).strip()


def _unwrap(payload: Any) -> dict:
    if not isinstance(payload, dict):
        return {}
    if isinstance(payload.get("order"), dict):
        return payload["order"]
    if isinstance(payload.get("data"), dict):
        return payload["data"]
    return payload


def _item_ref(item: dict) -> str:
    extra = item.get("custom_fields") if isinstance(item.get("custom_fields"), dict) else {}
    sku = item.get("sku") or extra.get("sku")
    product_id = item.get("product_id") or item.get("productId")
    return str(sku or product_id or "").strip()


def _items(payload: dict) -> list[dict]:
    raw = payload.get("items") or payload.get("line_items") or payload.get("products") or []
    if not isinstance(raw, list):
        return []
    slim = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        ref = _item_ref(item)
        if not ref:
            continue
        slim.append(
            {
                "product_id": ref,
                "name": item.get("name") or item.get("title") or item.get("product_name") or ref,
            }
        )
    return slim


def _slim_order(payload: Any, order_id: str = "") -> dict | None:
    if isinstance(payload, dict) and payload.get("found") is False:
        return None
    order = _unwrap(payload)
    if not order:
        return None
    items = _items(payload if isinstance(payload, dict) and payload.get("items") else order)
    found_id = order.get("order_id") or order.get("id") or order.get("orderId") or order_id
    order_number = order.get("order_number") or order.get("orderNumber") or ""
    if not found_id and not order_number and not items:
        return None
    return {
        "order_id": str(found_id or ""),
        "order_number": str(order_number or found_id or ""),
        "status": order.get("status") or "",
        "date": order.get("date") or order.get("created_at") or order.get("createdAt") or "",
        "items": items,
    }


def _recent_list(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        raw = payload
    elif isinstance(payload, dict):
        raw = payload.get("orders") or payload.get("data") or payload.get("results") or []
    else:
        raw = []
    slim = []
    for entry in raw[:5]:
        order = _slim_order(entry)
        if order:
            slim.append(order)
    return slim


def _mark_chat_store_ready(ctx) -> None:
    channel = str(getattr(ctx.request, "channel", "") or "").strip().lower()
    if channel != "email":
        ctx.session.ticketing_verified = True


def _apply_store_customer(ctx, record: dict, email: str, mobile: str) -> dict:
    customer = record.get("customer") or {}
    ctx.session.customer_found = True
    _mark_chat_store_ready(ctx)
    if not ctx.session.profile_created_here:
        ctx.session.registered_customer = True
    ctx.session.cdp_id = record.get("cdp_id") or ctx.session.cdp_id
    ctx.session.contact_type = customer.get("contact_type") or ""
    _fill_empty_contact(ctx.session, customer)
    return {
        "ok": True,
        "found": True,
        "http_status": 200,
        "source": "customer_store",
        "contact_type": ctx.session.contact_type,
        "customer": {
            "name": customer.get("name") or "",
            "email": customer.get("email") or email,
            "phone": customer.get("phone") or mobile,
            "contact_type": ctx.session.contact_type,
        },
    }


def lookup_customer_details(ctx, email: str = "", mobile: str = "", **_kwargs):
    email, mobile = _lookup_contact(ctx, email, mobile)
    if not email and not mobile:
        return {"ok": False, "error": "email_or_phone_required", "found": False}
    _save_contact(ctx, email, mobile)
    try:
        stored = lookup_customer(str(ctx.request.organization_id), email, mobile)
    except Exception:
        stored = {"found": False, "error": "customer_store_unavailable"}
    if stored is not None:
        if stored.get("error") == "customer_store_unavailable":
            ctx.session.customer_found = False
            return {
                "ok": False,
                "found": False,
                "error": "customer_store_unavailable",
                "user_message": "The customer store is not available. Do not send OTP.",
            }
        if not stored.get("found"):
            ctx.session.customer_found = False
            return {
                "ok": False,
                "found": False,
                "error": "customer_not_found",
                "user_message": "Ask for the email or phone they used when they purchased.",
            }
        return _apply_store_customer(ctx, stored, email, mobile)
    status, payload = _client.get_customer_details(email=email, mobile=mobile)
    if status == 0:
        ctx.session.customer_found = False
        return {
            "ok": False,
            "found": False,
            "configured": False,
            "http_status": 0,
            "error": "customer_store_not_configured",
            "user_message": "The customer store is not available. Do not send OTP. Say you cannot look up the account right now.",
        }
    profile = _as_customer(payload) if status == 200 else None
    if status != 200 or not profile:
        ctx.session.customer_found = False
        return {
            "ok": False,
            "found": False,
            "http_status": status,
            "error": "customer_not_found",
            "user_message": "Ask for the email or phone they used when they purchased.",
        }
    ctx.session.customer_found = True
    _mark_chat_store_ready(ctx)
    if not ctx.session.profile_created_here:
        ctx.session.registered_customer = True
    ctx.session.cdp_id = (
        profile.get("cdp_id")
        or profile.get("cdpId")
        or ctx.session.cdp_id
    )
    if not ctx.session.cdp_id:
        ctx.session.customer_found = False
        ctx.session.ticketing_verified = False
        return {
            "ok": False,
            "found": False,
            "http_status": 200,
            "error": "customer_identity_incomplete",
            "user_message": "The customer record is incomplete. Do not send OTP.",
        }
    _fill_empty_contact(ctx.session, profile)
    return {
        "ok": True,
        "found": True,
        "http_status": 200,
        "customer": {
            "name": profile.get("name") or profile.get("customer_name") or "",
            "email": profile.get("email") or email,
            "phone": profile.get("mobile_number") or profile.get("phone") or mobile,
        },
    }


def _numeric_order_id(order_id: str, email: str, mobile: str) -> str:
    if order_id.isdigit():
        return order_id
    status, payload = _client.get_recent_orders(email=email, mobile=mobile)
    if status != 200:
        return ""
    for order in _recent_list(payload):
        if order_id in (order.get("order_number"), order.get("order_id")):
            return str(order.get("order_id") or "")
    return ""


def _ensure_cdp_id(ctx, email: str, mobile: str) -> str:
    if ctx.session.cdp_id:
        return str(ctx.session.cdp_id)
    try:
        stored = lookup_customer(str(ctx.request.organization_id), email, mobile)
    except Exception:
        return ""
    if stored and stored.get("found"):
        ctx.session.cdp_id = stored.get("cdp_id") or ""
        return str(ctx.session.cdp_id or "")
    return ""


def get_order_by_id(ctx, order_id: str = "", **_kwargs):
    if not ctx.session.authenticated:
        return {"ok": False, "error": "otp_required"}
    order_id = str(order_id or "").strip()
    if not order_id:
        return {"ok": False, "error": "order_id_required"}
    email, mobile = _contact(ctx)
    cdp_id = _ensure_cdp_id(ctx, email, mobile)
    if cdp_id:
        try:
            stored = get_order_for_customer(str(ctx.request.organization_id), cdp_id, order_id)
        except Exception:
            stored = {}
        if stored is not None:
            if not stored:
                ctx.session.selected_order_id = None
                ctx.session.selected_order = None
                ctx.session.selected_product_id = None
                return {"ok": False, "error": "order_not_found"}
            ctx.session.selected_order_id = stored["order_number"] or stored["order_id"]
            ctx.session.selected_order = stored
            ctx.session.selected_product_id = None
            return {"ok": True, "http_status": 200, "order": stored, "source": "customer_store"}
    lookup_id = _numeric_order_id(order_id, email, mobile)
    if not lookup_id:
        ctx.session.selected_order_id = None
        ctx.session.selected_order = None
        ctx.session.selected_product_id = None
        return {"ok": False, "error": "order_not_found"}
    status, payload = _client.get_order(lookup_id)
    order = _slim_order(payload, lookup_id) if status == 200 else None
    if status != 200 or not order:
        ctx.session.selected_order_id = None
        ctx.session.selected_order = None
        ctx.session.selected_product_id = None
        return {"ok": False, "http_status": status, "error": "order_not_found"}
    ctx.session.selected_order_id = order["order_number"] or order["order_id"]
    ctx.session.selected_order = order
    ctx.session.selected_product_id = None
    return {"ok": True, "http_status": 200, "order": order}


def list_recent_orders(ctx, email: str = "", mobile: str = "", **_kwargs):
    if not ctx.session.authenticated:
        return {"ok": False, "error": "otp_required"}
    email, mobile = _contact(ctx, email, mobile)
    if not email and not mobile:
        return {"ok": False, "error": "email_or_phone_required"}
    cdp_id = _ensure_cdp_id(ctx, email, mobile)
    if cdp_id:
        try:
            orders = list_recent_orders_for_customer(str(ctx.request.organization_id), cdp_id)
        except Exception:
            return {"ok": False, "error": "customer_store_unavailable", "orders": []}
        if orders is not None:
            return {
                "ok": True,
                "http_status": 200,
                "orders": orders,
                "source": "customer_store",
                "note": "Ask the user which order has the issue. Do not pick one yourself.",
            }
    status, payload = _client.get_recent_orders(email=email, mobile=mobile)
    orders = _recent_list(payload) if status == 200 else []
    logger.info("recent_orders status=%s count=%s", status, len(orders))
    return {
        "ok": status == 200,
        "http_status": status,
        "orders": orders,
        "note": "Ask the user which order has the issue. Do not pick one yourself.",
    }


def select_order_product(ctx, product_id: str = "", **_kwargs):
    order = ctx.session.selected_order or {}
    items = order.get("items") if isinstance(order, dict) else []
    if not items:
        return {"ok": False, "error": "order_required"}
    product_id = str(product_id or "").strip()
    match = next((item for item in items if str(item.get("product_id")) == product_id), None)
    if not match:
        return {"ok": False, "error": "product_not_on_order", "products": items}
    ctx.session.selected_product_id = str(match.get("product_id") or product_id)
    return {"ok": True, "product_id": ctx.session.selected_product_id, "name": match.get("name") or ""}


def order_tools(email_mode: bool = False) -> list[Tool]:
    lookup_description = (
        "Look up the customer using the email From address already stored in the session. "
        "Do not ask the sender to repeat it. Email does not use OTP."
        if email_mode
        else "Find this person in the customer store before sending a code. A found webchat or social customer is ready for one OTP. Do not ask them to verify twice."
    )
    order_description = (
        "Load the order identified in the email (BXUK-... or numeric). Email does not use OTP."
        if email_mode
        else "Load one existing order after OTP, only when the user gave an order id for a refund, return, exchange, damaged or wrong item, or delivery. Do not use this when payment failed before an order existed."
    )
    recent_description = (
        "Use only when an order-related customer cannot identify the order. Return up to five "
        "recent orders and ask them to choose in the same email as any other missing detail."
        if email_mode
        else "Only when the issue is about an existing order and the user cannot remember the order id. Do not use this for a payment failure or any issue with no order."
    )
    return [
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "lookup_customer_details",
                    "description": lookup_description,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "mobile": {"type": "string"},
                        },
                        "required": [],
                    },
                },
            },
            lookup_customer_details,
        ),
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "get_order_by_id",
                    "description": order_description,
                    "parameters": {
                        "type": "object",
                        "properties": {"order_id": {"type": "string"}},
                        "required": ["order_id"],
                    },
                },
            },
            get_order_by_id,
        ),
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "list_recent_orders",
                    "description": recent_description,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "mobile": {"type": "string"},
                        },
                        "required": [],
                    },
                },
            },
            list_recent_orders,
        ),
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "select_order_product",
                    "description": "Record which item on an already loaded order has the issue. Use only for a refund, return, exchange, damaged or wrong item, or delivery. Do not call this for a payment failure or any issue where no order was created.",
                    "parameters": {
                        "type": "object",
                        "properties": {"product_id": {"type": "string"}},
                        "required": ["product_id"],
                    },
                },
            },
            select_order_product,
        ),
    ]
