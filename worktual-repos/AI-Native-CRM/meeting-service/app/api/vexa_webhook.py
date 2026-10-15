from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.metrics import WEBHOOKS
from app.models import Meeting, WebhookReceipt
from app.services import jobs, status as status_svc
from app.services.webhooks import verify_legacy_bearer, verify_vexa_signature

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/vexa", tags=["internal"])


def _meeting_from_payload(db: Session, data: dict[str, Any]) -> Meeting | None:
    meta = data.get("metadata") or data.get("data", {}).get("metadata") or {}
    mid = meta.get("meeting_id")
    if mid:
        return db.get(Meeting, str(mid))
    native = data.get("native_meeting_id") or data.get("native_id")
    platform = data.get("platform")
    meeting_obj = data.get("meeting") or data.get("data", {}).get("meeting") or {}
    native = native or meeting_obj.get("native_meeting_id")
    platform = platform or meeting_obj.get("platform")
    if native and platform:
        return db.scalar(
            select(Meeting).where(
                Meeting.platform == platform,
                Meeting.native_meeting_id == str(native),
            ).order_by(Meeting.created_at.desc())
        )
    return None


@router.post("/webhook")
async def vexa_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_webhook_signature: str | None = Header(None, alias="X-Webhook-Signature"),
    x_webhook_timestamp: str | None = Header(None, alias="X-Webhook-Timestamp"),
    authorization: str | None = Header(None),
) -> dict:
    body = await request.body()
    ok = verify_vexa_signature(body, x_webhook_signature, x_webhook_timestamp)
    if not ok:
        ok = verify_legacy_bearer(authorization)
    if not ok:
        WEBHOOKS.labels(event_type="unknown", outcome="rejected").inc()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid webhook signature")

    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid json")

    event_type = str(payload.get("event") or payload.get("type") or "meeting.status_change")
    event_id = str(payload.get("event_id") or payload.get("id") or uuid.uuid4())
    existing = db.scalar(select(WebhookReceipt).where(WebhookReceipt.event_id == event_id))
    if existing:
        WEBHOOKS.labels(event_type=event_type, outcome="duplicate").inc()
        return {"ok": True, "duplicate": True}

    db.add(
        WebhookReceipt(
            event_id=event_id,
            event_type=event_type,
            hmac_timestamp=x_webhook_timestamp,
        )
    )
    data = payload.get("data") or payload
    meeting = _meeting_from_payload(db, data if isinstance(data, dict) else payload)
    if not meeting:
        WEBHOOKS.labels(event_type=event_type, outcome="no_meeting").inc()
        db.commit()
        return {"ok": True, "ignored": True}

    vexa_status = (
        (data.get("status") if isinstance(data, dict) else None)
        or payload.get("status")
        or (data.get("meeting") or {}).get("status")
    )
    if event_type in ("bot.failed",):
        status_svc.transition(db, meeting, "failed", event_id=event_id, error_code="vexa_unavailable")
    elif event_type == "meeting.completed" or vexa_status == "completed":
        if meeting.status not in ("completed", "completed_partial", "failed"):
            status_svc.transition(db, meeting, "processing", event_id=event_id)
            jobs.enqueue(db, "extract", meeting.id)
    elif vexa_status in ("failed", "evicted"):
        code = "evicted" if vexa_status == "evicted" else "vexa_unavailable"
        status_svc.transition(db, meeting, "failed", event_id=event_id, error_code=code)
    elif vexa_status:
        status_svc.apply_vexa_status(db, meeting, str(vexa_status), event_id)
    db.commit()
    WEBHOOKS.labels(event_type=event_type, outcome="ok").inc()
    log.info("webhook_ok", extra={"meeting_id": meeting.id, "org_id": meeting.org_id, "event_type": event_type})
    return {"ok": True}
