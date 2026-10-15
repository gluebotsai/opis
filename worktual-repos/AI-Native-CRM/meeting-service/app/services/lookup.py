from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import IN_FLIGHT
from app.models import Meeting
from app.services.url_parse import UrlParseError, parse_meeting_url


def inflight_by_url(db: Session, org_id: str, meeting_url: str) -> Meeting:
    try:
        parsed = parse_meeting_url(meeting_url)
    except UrlParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row = db.scalar(
        select(Meeting)
        .where(
            Meeting.org_id == org_id,
            Meeting.platform == parsed.platform,
            func.lower(Meeting.native_meeting_id) == parsed.native_meeting_id.lower(),
            Meeting.status.in_(IN_FLIGHT),
        )
        .order_by(Meeting.created_at.desc())
    )
    if not row:
        raise HTTPException(status_code=404, detail="no in-flight meeting for this URL")
    return row
