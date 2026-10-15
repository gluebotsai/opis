from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.constants import utcnow


class Base(DeclarativeBase):
    pass


JsonType = JSON


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        Index("ix_meetings_entity", "org_id", "entity_type", "entity_id", "created_at"),
        Index("ix_meetings_status_updated", "status", "updated_at"),
        Index("ix_meetings_native", "org_id", "platform", "native_meeting_id"),
        Index("ix_meetings_idempotency", "org_id", "idempotency_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(16))
    entity_id: Mapped[str] = mapped_column(String(128))
    meeting_url: Mapped[str] = mapped_column(String(2048))
    platform: Mapped[str] = mapped_column(String(32))
    native_meeting_id: Mapped[str] = mapped_column(String(512))
    passcode_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    vexa_meeting_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bot_name: Mapped[str] = mapped_column(String(100), default="Worktual Notetaker")
    status: Mapped[str] = mapped_column(String(32), default="requested", index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    consent_captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    join_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    admitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider: Mapped[str] = mapped_column(String(32), default="vexa")
    recording_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    segments: Mapped[list[TranscriptSegment]] = relationship(back_populates="meeting")
    extract: Mapped[MeetingExtract | None] = relationship(back_populates="meeting", uselist=False)


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"
    __table_args__ = (UniqueConstraint("meeting_id", "segment_id", name="uq_segments_meeting_segment"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    segment_id: Mapped[str] = mapped_column(String(128))
    speaker: Mapped[str] = mapped_column(String(255), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    t0: Mapped[float | None] = mapped_column(Float, nullable=True)
    t1: Mapped[float | None] = mapped_column(Float, nullable=True)
    completed: Mapped[int] = mapped_column(Integer, default=1)
    raw_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    meeting: Mapped[Meeting] = relationship(back_populates="segments")


class MeetingExtract(Base):
    __tablename__ = "meeting_extracts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), unique=True)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    summary: Mapped[str] = mapped_column(Text, default="")
    next_steps: Mapped[str] = mapped_column(Text, default="")
    action_items: Mapped[list] = mapped_column(JsonType, default=list)
    pain_points: Mapped[list] = mapped_column(JsonType, default=list)
    products: Mapped[list] = mapped_column(JsonType, default=list)
    speakers: Mapped[list] = mapped_column(JsonType, default=list)
    raw_llm_json: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    meeting: Mapped[Meeting] = relationship(back_populates="extract")


class MeetingEvent(Base):
    __tablename__ = "meeting_events"
    __table_args__ = (UniqueConstraint("event_id", name="uq_meeting_events_event_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    meeting_id: Mapped[str] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), index=True)
    event_id: Mapped[str] = mapped_column(String(128))
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WebhookReceipt(Base):
    __tablename__ = "webhook_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(128), unique=True)
    event_type: Mapped[str] = mapped_column(String(64))
    hmac_timestamp: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_claim", "status", "run_after", "locked_until"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    meeting_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def init_db() -> None:
    from app.db import engine

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        dialect = engine.dialect.name
        if dialect == "postgresql":
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_inflight_native
                    ON meetings (org_id, platform, native_meeting_id)
                    WHERE status NOT IN ('completed', 'completed_partial', 'failed')
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_org_idempotency_nn
                    ON meetings (org_id, idempotency_key)
                    WHERE idempotency_key IS NOT NULL
                    """
                )
            )
        elif dialect == "sqlite":
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_inflight_native
                    ON meetings (org_id, platform, native_meeting_id)
                    WHERE status NOT IN ('completed', 'completed_partial', 'failed')
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS uq_meetings_org_idempotency_nn
                    ON meetings (org_id, idempotency_key)
                    WHERE idempotency_key IS NOT NULL
                    """
                )
            )
