from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.constants import utcnow
from app.models import Job

log = logging.getLogger(__name__)


def enqueue(db: Session, kind: str, meeting_id: str | None, payload: dict | None = None) -> Job:
    if kind == "extract" and meeting_id:
        existing = db.scalar(
            select(Job).where(
                Job.kind == "extract",
                Job.meeting_id == meeting_id,
                Job.status.in_(("queued", "running")),
            )
        )
        if existing:
            return existing
    job = Job(
        id=str(uuid.uuid4()),
        kind=kind,
        meeting_id=meeting_id,
        payload=payload or {},
        status="queued",
        run_after=utcnow(),
    )
    db.add(job)
    db.flush()
    log.info("job_enqueued", extra={"job_id": job.id, "meeting_id": meeting_id or ""})
    return job


def claim_jobs(db: Session, limit: int = 5) -> list[Job]:
    now = utcnow()
    rows = db.scalars(
        select(Job)
        .where(Job.status == "queued", Job.run_after <= now)
        .where((Job.locked_until.is_(None)) | (Job.locked_until < now))
        .order_by(Job.created_at)
        .limit(limit)
    ).all()
    claimed: list[Job] = []
    for job in rows:
        job.status = "running"
        job.locked_until = now + timedelta(minutes=5)
        job.attempts += 1
        claimed.append(job)
    db.commit()
    return claimed


def complete_job(db: Session, job: Job) -> None:
    job.status = "done"
    job.locked_until = None
    db.commit()


def fail_job(db: Session, job: Job, error: str) -> None:
    job.last_error = error[:2000]
    if job.attempts >= settings.extract_max_attempts:
        job.status = "failed"
        job.locked_until = None
    else:
        job.status = "queued"
        delay = min(60 * job.attempts, 300)
        job.run_after = utcnow() + timedelta(seconds=delay)
        job.locked_until = None
    db.commit()
