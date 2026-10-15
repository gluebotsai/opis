"""meeting_messages for CRM-sent live chat

Revision ID: 003_meeting_messages
Revises: 002_recording_enabled
Create Date: 2026-09-12
"""

from alembic import op
import sqlalchemy as sa

revision = "003_meeting_messages"
down_revision = "002_recording_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meeting_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("meeting_id", sa.String(36), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("source", sa.String(32), nullable=False, server_default="crm"),
        sa.Column("delivered", sa.String(16), nullable=False, server_default="stored"),
        sa.Column("created_by", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_meeting_messages_meeting_created", "meeting_messages", ["meeting_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_meeting_messages_meeting_created", table_name="meeting_messages")
    op.drop_table("meeting_messages")
