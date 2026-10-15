"""Optional signed webhook from meeting-service back to CRM (poll is the default)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging

import httpx

from app.config import settings
from app.models import Meeting, MeetingExtract

log = logging.getLogger(__name__)


def notify_completed(meeting: Meeting, extract: MeetingExtract | None) -> None:
    url = (settings.crm_completed_webhook_url or "").strip()
    if not url:
        return
    body = {
        "event": "meeting.completed",
        "meeting_id": meeting.id,
        "organization_id": meeting.org_id,
        "entity_type": meeting.entity_type,
        "entity_id": meeting.entity_id,
        "status": meeting.status,
        "error_code": meeting.error_code,
        "error_message": meeting.error_message,
        "extract": None
        if extract is None
        else {
            "summary": extract.summary,
            "next_step": extract.next_steps,
            "action_items": extract.action_items or [],
            "pain_points": extract.pain_points or [],
            "products": extract.products or [],
            "speakers": extract.speakers or [],
        },
    }
    raw = json.dumps(body, default=str).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if settings.webhook_secret:
        sig = hmac.new(settings.webhook_secret.encode(), raw, hashlib.sha256).hexdigest()
        headers["X-Webhook-Signature"] = f"sha256={sig}"
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.post(url, content=raw, headers=headers)
            log.info(
                "crm_notify",
                extra={"meeting_id": meeting.id, "org_id": meeting.org_id, "status": str(r.status_code)},
            )
    except httpx.HTTPError:
        log.warning("crm_notify_failed", extra={"meeting_id": meeting.id, "org_id": meeting.org_id})
