"""Contact value checks for custom_booxoo_bot ticket identity."""

from __future__ import annotations


def usable_email(value: str = "") -> str:
    value = (value or "").strip()
    if not value or "..." in value or "@" not in value:
        return ""
    local, _, domain = value.partition("@")
    if not local or "." not in domain:
        return ""
    return value


def usable_phone(value: str = "") -> str:
    value = (value or "").strip()
    if not value or "..." in value:
        return ""
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) < 8:
        return ""
    return value


def resolve_identity(
    contact: dict | None,
    email: str = "",
    mobile: str = "",
    lock: bool = False,
) -> tuple[str, str]:
    contact = contact or {}
    known_email = usable_email(contact.get("email") or "")
    known_phone = usable_phone(contact.get("phone") or contact.get("mobile") or "")
    email = usable_email(email)
    mobile = usable_phone(mobile)
    if lock:
        if email and known_email and email.lower() != known_email.lower():
            email = ""
        if mobile and known_phone and mobile != known_phone:
            mobile = ""
    return email or known_email, mobile or known_phone
