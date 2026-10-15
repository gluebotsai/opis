"""initial meeting_service schema

Revision ID: 001_initial
Revises:
Create Date: 2026-09-10
"""

from alembic import op
import sqlalchemy as sa

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meetings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("org_id", sa.String(64), nullable=False, index=True),
        sa.Column("entity_type", sa.String(16), nullable=False),
        sa.Column("entity_id", sa.String(128), nullable=False),
        sa.Column("meeting_url", sa.String(2048), nullable=False),
        sa.Column("platform", sa.String(32), nullable=False),
        sa.Column("native_meeting_id", sa.String(512), nullable=False),
        sa.Column("passcode_encrypted", sa.Text(), nullable=True),
        sa.Column("vexa_meeting_id", sa.String(64), nullable=True),
        sa.Column("bot_name", sa.String(100), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, index=True),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("consent_captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("idempotency_key", sa.String(128), nullable=True),
        sa.Column("join_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("admitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider", sa.String(32), nullable=False, server_default="vexa"),
        sa.Column("created_by", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_meetings_entity", "meetings", ["org_id", "entity_type", "entity_id", "created_at"])
    op.create_index("ix_meetings_status_updated", "meetings", ["status", "updated_at"])
    op.create_index("ix_meetings_native", "meetings", ["org_id", "platform", "native_meeting_id"])
    op.create_table(
        "transcript_segments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("meeting_id", sa.String(36), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("segment_id", sa.String(128), nullable=False),
        sa.Column("speaker", sa.String(255), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("t0", sa.Float(), nullable=True),
        sa.Column("t1", sa.Float(), nullable=True),
        sa.Column("completed", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("raw_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("meeting_id", "segment_id", name="uq_segments_meeting_segment"),
    )
    op.create_table(
        "meeting_extracts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("meeting_id", sa.String(36), sa.ForeignKey("meetings.id", ondelete="CASCADE"), unique=True),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("next_steps", sa.Text(), nullable=False),
        sa.Column("action_items", sa.JSON(), nullable=False),
        sa.Column("pain_points", sa.JSON(), nullable=False),
        sa.Column("products", sa.JSON(), nullable=False),
        sa.Column("speakers", sa.JSON(), nullable=False),
        sa.Column("raw_llm_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "meeting_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("meeting_id", sa.String(36), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.String(128), nullable=False, unique=True),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "webhook_receipts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.String(128), nullable=False, unique=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("hmac_timestamp", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(32), nullable=False, index=True),
        sa.Column("meeting_id", sa.String(36), nullable=True, index=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, index=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("run_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    bind = op.get_bind()
    op.create_index("ix_meetings_idempotency", "meetings", ["org_id", "idempotency_key"])
    if bind.dialect.name == "postgresql":
        op.execute(
            """
            CREATE UNIQUE INDEX uq_meetings_inflight_native
            ON meetings (org_id, platform, native_meeting_id)
            WHERE status NOT IN ('completed', 'completed_partial', 'failed')
            """
        )
        op.execute(
            """
            CREATE UNIQUE INDEX uq_meetings_org_idempotency_nn
            ON meetings (org_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )
    elif bind.dialect.name == "sqlite":
        op.execute(
            """
            CREATE UNIQUE INDEX uq_meetings_inflight_native
            ON meetings (org_id, platform, native_meeting_id)
            WHERE status NOT IN ('completed', 'completed_partial', 'failed')
            """
        )
        op.execute(
            """
            CREATE UNIQUE INDEX uq_meetings_org_idempotency_nn
            ON meetings (org_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """
        )


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("webhook_receipts")
    op.drop_table("meeting_events")
    op.drop_table("meeting_extracts")
    op.drop_table("transcript_segments")
    op.drop_table("meetings")
