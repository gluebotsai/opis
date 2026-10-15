"""CDP profile client for custom_booxoo_bot."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.cdp")


class CdpClient:
    @property
    def base_url(self) -> str:
        return get_settings().custom_booxoo_bot_cdp_base_url.strip().rstrip("/")

    def _get(self, path: str, params: dict[str, str]) -> tuple[int, Any]:
        if not self.base_url:
            return 0, None
        try:
            response = httpx.get(f"{self.base_url}{path}", params=params, timeout=20.0)
        except Exception as exc:
            logger.warning("cdp_request_failed path=%s error=%s", path, exc)
            return 0, None
        try:
            payload = response.json() if response.content else None
        except ValueError:
            payload = None
        return response.status_code, payload

    def get_customer(self, **params: str) -> tuple[int, Any]:
        return self._get("/v1/customers", params)

    def get_recommendations(self, cdp_id: str) -> tuple[int, Any]:
        return self._get("/v1/recommendations", {"cdp_id": cdp_id})

    def get_customer_details(self, email: str = "", mobile: str = "") -> tuple[int, Any]:
        params = _identity_params(email, mobile)
        if not params:
            return 400, {"error": "email_or_phone_required"}
        return self._get("/v1/customers/details", params)

    def get_recent_orders(self, email: str = "", mobile: str = "") -> tuple[int, Any]:
        params = _identity_params(email, mobile)
        if not params:
            return 400, {"error": "email_or_phone_required"}
        return self._get("/v1/customers/orders/recent", params)

    def get_order(self, order_id: str) -> tuple[int, Any]:
        return self._get(f"/v1/orders/{order_id}", {})


def _identity_params(email: str = "", mobile: str = "") -> dict[str, str]:
    email = (email or "").strip()
    mobile = (mobile or "").strip()
    if email:
        return {"email": email}
    if mobile:
        return {"mobile_number": mobile}
    return {}


def _as_profile(payload: Any) -> dict | None:
    if not isinstance(payload, dict):
        return None
    if isinstance(payload.get("customer"), dict):
        return payload["customer"]
    if isinstance(payload.get("data"), dict):
        return payload["data"]
    return payload


def _cdp_id(profile: dict) -> str | None:
    for key in ("cdp_id", "cdpId"):
        value = profile.get(key)
        if value:
            return str(value)
    return None


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


def load_customer_profile(session, visitor_id: str, client: CdpClient | None = None) -> None:
    if session.customer_profile:
        return
    if not get_settings().custom_booxoo_bot_cdp_base_url.strip():
        return
    email = (session.contact.get("email") or "").strip()
    phone = (session.contact.get("phone") or "").strip()
    visitor_id = (visitor_id or "").strip()
    if email:
        key, params = f"email:{email}", {"email": email}
    elif phone:
        key, params = f"phone:{phone}", {"mobile_number": phone}
    elif visitor_id:
        key, params = f"visitor:{visitor_id}", {"visitor_id": visitor_id}
    else:
        return
    if session.profile_lookup_key == key:
        return
    session.profile_lookup_key = key
    client = client or CdpClient()
    status, payload = client.get_customer(**params)
    if status != 200:
        logger.info("cdp_customer_miss key=%s status=%s", key, status)
        return
    profile = _as_profile(payload)
    if not profile:
        return
    session.customer_profile = profile
    session.cdp_id = _cdp_id(profile)
    _fill_empty_contact(session, profile)
    stored_email = str(profile.get("email") or "").strip()
    stored_phone = str(
        profile.get("mobile_number") or profile.get("phone") or profile.get("mobile") or ""
    ).strip()
    if not session.profile_created_here and (stored_email or stored_phone):
        session.registered_customer = True
    logger.info("cdp_customer_loaded key=%s cdp_id=%s", key, session.cdp_id or "")
