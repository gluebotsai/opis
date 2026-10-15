"""Email OTP sender for custom_booxoo_bot."""

from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.email_otp")


def send_otp_email(
    organization_id: str,
    recipient: str,
    otp: str,
    first_name: str = "",
) -> dict:
    settings = get_settings()
    organization_id = str(organization_id or "").strip()
    sender = settings.custom_booxoo_bot_smtp_sender.strip()
    password = settings.custom_booxoo_bot_smtp_app_password.replace(" ", "").strip()
    recipient = (recipient or "").strip()
    if not organization_id:
        return {"ok": False, "error": "organization_required"}
    if not sender or not password:
        return {"ok": False, "error": "email_not_configured"}
    if not recipient or "@" not in recipient:
        return {"ok": False, "error": "invalid_email"}
    name = (first_name or "").strip() or "there"
    message = EmailMessage()
    message["Subject"] = "Your Booxoo verification code"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        f"Hello {name},\n\n"
        f"{otp} is your OTP to authenticate your Booxoo account.\n\n"
        "If you did not request this, you can ignore this email.\n"
    )
    try:
        with smtplib.SMTP_SSL(
            settings.custom_booxoo_bot_smtp_host,
            settings.custom_booxoo_bot_smtp_port,
            timeout=20,
        ) as smtp:
            smtp.login(sender, password)
            smtp.send_message(message)
    except Exception as exc:
        logger.warning(
            "otp_email_failed organization_id=%s error=%s",
            organization_id,
            exc,
        )
        return {"ok": False, "error": "email_failed", "destination": recipient}
    logger.info("otp_email_sent organization_id=%s", organization_id)
    return {
        "ok": True,
        "destination": recipient,
    }
