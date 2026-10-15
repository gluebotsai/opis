"""Campaign launch mail: My Accounts mailbox only.

Mirrors backend/src/helpers/email-launch-transport.ts (worker is TS glue).
"""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.request_context import peek_request_token

EMAIL_MAILBOX_NOT_READY = "email_mailbox_not_ready"
EMAIL_SEND_READINESS_UNAVAILABLE = "email_send_readiness_unavailable"

_BLOCKED_FROM_REASON = (
    "This mailbox cannot be used for campaign send. "
    "Connect a Google, Microsoft, or SMTP mailbox in Setup."
)


def _public(mailbox: Any) -> dict[str, Any]:
    if not mailbox or not isinstance(mailbox, dict):
        return {}
    inner = mailbox.get("public")
    if isinstance(inner, dict):
        return inner
    return mailbox


def _is_blocked_from(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return "@worktual.tech" in text


def is_accounts_launch_ready(mailbox: Any) -> bool:
    pub = _public(mailbox)
    if pub.get("send_ready") is not True:
        return False
    if (
        _is_blocked_from(pub.get("display_from"))
        or _is_blocked_from(pub.get("sender_email"))
        or _is_blocked_from(pub.get("oauth_account_email"))
    ):
        return False
    return True


def accounts_launch_fail_reason(mailbox: Any) -> str:
    if not mailbox or not isinstance(mailbox, dict):
        return (
            "No My Accounts campaign email mailbox (accounts.setup_channel_configs "
            "email + product campaign, joined to setup_email_configs)."
        )
    pub = _public(mailbox)
    reason = str(pub.get("block_reason") or "").strip()
    if reason:
        return reason
    if (
        _is_blocked_from(pub.get("display_from"))
        or _is_blocked_from(pub.get("sender_email"))
        or _is_blocked_from(pub.get("oauth_account_email"))
    ):
        return _BLOCKED_FROM_REASON
    return (
        "My Accounts campaign mailbox is not send-ready. "
        "Reconnect Email in Setup. Campaign mail uses the org My Accounts mailbox only."
    )


def _unwrap_phase2(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {}
    data = body.get("data")
    if isinstance(data, dict):
        return data
    return body


async def fetch_email_send_readiness(*, token: str = "") -> dict[str, Any] | None:
    """GET /configuration/email/send-readiness — unified mailbox + backend env gate."""
    auth = str(token or peek_request_token() or "").strip()
    if not auth:
        return None
    settings = get_settings()
    url = (
        f"{settings.campaign_api_base.rstrip('/')}/configuration/email/send-readiness"
    )
    headers = {"Authorization": f"Bearer {auth}"}
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            payload = _unwrap_phase2(res.json() if res.content else {})
    except Exception:  # noqa: BLE001
        return None
    return payload if isinstance(payload, dict) else None


async def fetch_accounts_mailbox(*, token: str = "") -> dict[str, Any] | None:
    """GET /configuration/email/phase2 — selected mailbox for this org."""
    auth = str(token or peek_request_token() or "").strip()
    if not auth:
        return None
    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/configuration/email/phase2"
    headers = {"Authorization": f"Bearer {auth}"}
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            payload = _unwrap_phase2(res.json() if res.content else {})
    except Exception:  # noqa: BLE001
        return None
    selected = payload.get("selected")
    if isinstance(selected, dict):
        return selected
    mailboxes = payload.get("mailboxes")
    if isinstance(mailboxes, list):
        for row in mailboxes:
            if isinstance(row, dict) and row.get("send_ready") is True:
                return row
        for row in mailboxes:
            if isinstance(row, dict):
                return row
    return None


async def email_channel_mailbox_block(
    *,
    channels: list[str],
    token: str = "",
) -> dict[str, Any] | None:
    """If email is launching, refuse unless Accounts mailbox is send-ready."""
    wanted = {str(c).strip().lower() for c in channels if str(c).strip()}
    if "email" not in wanted:
        return None
    readiness = await fetch_email_send_readiness(token=token)
    if isinstance(readiness, dict) and readiness.get("ready") is True:
        return None

    if isinstance(readiness, dict) and readiness.get("ready") is False:
        reason = str(readiness.get("message") or "").strip()
        remedy = str(readiness.get("remedy") or "").strip()
        code = str(readiness.get("code") or EMAIL_MAILBOX_NOT_READY).strip()
        user_html = f"<p>{reason}</p>" if reason else ""
        if remedy:
            user_html += f"<p>{remedy}</p>"
        if not user_html:
            user_html = (
                "<p>Email send is not ready (mailbox or Campaign API OAuth env).</p>"
            )
        return {
            "ok": False,
            "error": code,
            "message": (
                f"LAUNCH_EMAIL_NOT_READY: {reason or code} "
                "Do not claim the campaign is live or queued."
            ),
            "user_message": user_html,
        }

    return {
        "ok": False,
        "error": EMAIL_SEND_READINESS_UNAVAILABLE,
        "message": (
            "LAUNCH_EMAIL_NOT_READY: Could not verify email send readiness with Campaign API. "
            "Do not claim the campaign is live or queued."
        ),
        "user_message": (
            "<p>Could not verify email send readiness (Campaign API /configuration/email/send-readiness).</p>"
            "<p>Check that the backend is running and reachable, then retry launch.</p>"
        ),
    }


__all__ = [
    "EMAIL_MAILBOX_NOT_READY",
    "EMAIL_SEND_READINESS_UNAVAILABLE",
    "accounts_launch_fail_reason",
    "email_channel_mailbox_block",
    "fetch_accounts_mailbox",
    "fetch_email_send_readiness",
    "is_accounts_launch_ready",
]
