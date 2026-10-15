from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.constants import BOT_SLOTS
from app.metrics import CONCURRENT, QUEUED
from app.models import Meeting


def inflight_count(db: Session, org_id: str | None = None) -> int:
    q = select(func.count()).select_from(Meeting).where(Meeting.status.in_(BOT_SLOTS))
    if org_id:
        q = q.where(Meeting.org_id == org_id)
    n = db.scalar(q) or 0
    if org_id is None:
        CONCURRENT.set(n)
    return int(n)


def queued_count(db: Session, org_id: str | None = None) -> int:
    q = select(func.count()).select_from(Meeting).where(Meeting.status == "requested")
    if org_id:
        q = q.where(Meeting.org_id == org_id)
    n = int(db.scalar(q) or 0)
    if org_id is None:
        QUEUED.set(n)
    return n


def at_capacity(db: Session, org_id: str) -> str | None:
    if inflight_count(db) >= settings.max_concurrent_meetings:
        return "global"
    if inflight_count(db, org_id) >= settings.max_concurrent_per_org:
        return "org"
    return None


def queue_full(db: Session, org_id: str) -> str | None:
    if queued_count(db) >= settings.max_queued_meetings:
        return "global"
    if queued_count(db, org_id) >= settings.max_queued_per_org:
        return "org"
    return None


def snapshot(db: Session, org_id: str) -> dict:
    return {
        "bots_live": inflight_count(db),
        "bots_max": settings.max_concurrent_meetings,
        "queued": queued_count(db),
        "queued_max": settings.max_queued_meetings,
        "org_bots_live": inflight_count(db, org_id),
        "org_bots_max": settings.max_concurrent_per_org,
        "org_queued": queued_count(db, org_id),
        "org_queued_max": settings.max_queued_per_org,
    }
