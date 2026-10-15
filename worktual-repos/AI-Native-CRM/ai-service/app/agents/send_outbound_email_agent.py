"""Send Outbound Email Agent — Hub A2A only.

Takes a pre-composed subject/body (from compose-email) and sends via the org
CRM bot mailbox through Fastify. Does not invent copy. Coworker Inbox send and
auto-reply inbound flows are unchanged.
"""

from __future__ import annotations

import logging
from typing import Any

from app.crm_client import CrmClient

logger = logging.getLogger(__name__)


async def run(
    contact_id: str,
    subject: str,
    body: str,
    organization_id: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    contact = (contact_id or "").strip()
    subj = (subject or "").strip()
    text = (body or "").strip()
    if not contact:
        return {"ok": False, "status": "failed", "error": "contact_id_required"}
    if not subj or not text:
        return {
            "ok": False,
            "status": "failed",
            "error": "subject_and_body_required",
        }

    client = CrmClient(organization_id)
    try:
        result = await client.send_hub_outbound_email(
            contact,
            {
                "subject": subj,
                "body": text,
                "organizationId": organization_id,
                "reason": reason or "hub_a2a_send",
            },
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("send-outbound-email failed contact=%s: %s", contact, exc)
        return {
            "ok": False,
            "status": "failed",
            "error": str(exc) or "send_failed",
        }

    status = str(result.get("status") or "").strip().lower()
    ok = status == "sent"
    err = result.get("lastError") or result.get("error")
    return {
        "ok": ok,
        "status": status or ("sent" if ok else "failed"),
        "to": result.get("to"),
        "fromEmail": result.get("fromEmail"),
        "messageId": result.get("messageId"),
        "activityId": result.get("activityId"),
        "error": err,
        "source": "hub_outbound",
    }
