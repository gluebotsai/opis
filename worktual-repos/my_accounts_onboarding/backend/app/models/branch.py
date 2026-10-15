import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True
    )
    label: Mapped[str | None] = mapped_column(String(128))
    address: Mapped[str | None] = mapped_column(Text)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    lead: Mapped["Lead"] = relationship(back_populates="branches")


class QuoteSession(Base):
    __tablename__ = "quote_sessions"

    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True
    )
    lead_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    file_name: Mapped[str | None] = mapped_column(String(255))
    pdf_base64: Mapped[str | None] = mapped_column(Text)
    assignments: Mapped[list] = mapped_column(JSONB, default=list)
    product_summary: Mapped[list] = mapped_column(JSONB, default=list)
    invoices: Mapped[list] = mapped_column(JSONB, default=list)
    invoice_mode: Mapped[str | None] = mapped_column(String(32))
    branch_summary: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    lead: Mapped["Lead"] = relationship(back_populates="quote_session")
