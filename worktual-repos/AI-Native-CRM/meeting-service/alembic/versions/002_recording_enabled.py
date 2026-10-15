"""add meetings.recording_enabled

Revision ID: 002_recording_enabled
Revises: 001_initial
Create Date: 2026-09-11
"""

from alembic import op
import sqlalchemy as sa

revision = "002_recording_enabled"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meetings",
        sa.Column("recording_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("meetings", "recording_enabled")
