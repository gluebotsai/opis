"""expected_end_at for CRM meeting slot end"""

from alembic import op
import sqlalchemy as sa

revision = "004_expected_end_at"
down_revision = "003_meeting_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meetings",
        sa.Column("expected_end_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("meetings", "expected_end_at")
