"""SMS OTP sender for custom_booxoo_bot."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.sms")


def normalize_sms_destination(mobile: str) -> str | None:
    raw = str(mobile or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0"):
        # Booxoo is UK-based, so accept a UK national number as +44.
        digits = "44" + digits[1:]
    if not 11 <= len(digits) <= 15 or digits.startswith("0"):
        return None
    return digits


def send_otp_sms(mobile: str, otp: str, first_name: str = "") -> dict:
    destination = normalize_sms_destination(mobile)
    if not destination:
        return {"ok": False, "error": "invalid_phone"}
    settings = get_settings()
    name = (first_name or "").strip() or "there"
    content = f"Hello {name}, {otp} is your OTP to authenticate your Booxoo account."
    url = settings.custom_booxoo_bot_sms_otp_url.strip()
    source = settings.custom_booxoo_bot_sms_otp_source.strip()
    payload = {"destination": destination, "source": source, "content": content}
    try:
        response = httpx.post(url, json=payload, timeout=10.0)
        body = response.json() if response.content else {}
    except Exception as exc:
        logger.warning("otp_sms_failed destination=%s error=%s", destination, exc)
        return {"ok": False, "error": "sms_failed", "destination": destination}
    status = body.get("status") if isinstance(body, dict) else None
    logger.info(
        "otp_sms destination=%s http_status=%s api_status=%s",
        destination,
        response.status_code,
        status,
    )
    if response.status_code < 400 and status == "Success":
        return {"ok": True, "destination": destination, "http_status": response.status_code}
    return {
        "ok": False,
        "error": "sms_failed",
        "destination": destination,
        "http_status": response.status_code,
    }
