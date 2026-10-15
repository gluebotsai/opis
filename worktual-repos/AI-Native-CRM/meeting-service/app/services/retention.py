from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.constants import utcnow
from app.models import Meeting, MeetingExtract, TranscriptSegment

log = logging.getLogger(__name__)


def run_retention(db: Session) -> int:
    cutoff = utcnow() - timedelta(days=settings.transcript_retention_days)
    meetings = db.scalars(
        select(Meeting).where(Meeting.ended_at.is_not(None), Meeting.ended_at < cutoff)
    ).all()
    n = 0
    for m in meetings:
        db.query(TranscriptSegment).filter(TranscriptSegment.meeting_id == m.id).delete()
        db.query(MeetingExtract).filter(MeetingExtract.meeting_id == m.id).delete()
        n += 1
        log.info("retention_cleared", extra={"meeting_id": m.id, "org_id": m.org_id})
    db.commit()
    return n
