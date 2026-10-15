from __future__ import annotations

from typing import Any, Callable, TypedDict, Optional


class AgentResult(TypedDict, total=False):
    contactId: str
    status: str
    reason: Optional[str]
    fields: dict[str, Any]


FREE_MAIL_DOMAINS = {
    "gmail.com",
    "googlemail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "msn.com",
    "icloud.com",
    "me.com",
    "aol.com",
    "protonmail.com",
    "proton.me",
    "mail.com",
    "yandex.com",
    "gmx.com",
}


def email_domain(email: str | None) -> str | None:
    if not email or "@" not in email:
        return None
    return email.strip().lower().split("@", 1)[1].removeprefix("www.") or None


def is_free_mail(domain: str | None) -> bool:
    return bool(domain) and domain.lower() in FREE_MAIL_DOMAINS


AgentRunner = Callable[..., Any]
