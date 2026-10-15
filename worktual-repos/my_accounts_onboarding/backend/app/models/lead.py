import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    company_name: Mapped[str | None] = mapped_column(String(255))
    industry_type: Mapped[str | None] = mapped_column(String(128))
    business_type: Mapped[str | None] = mapped_column(String(32))
    contact_name: Mapped[str | None] = mapped_column(String(255))
    designation: Mapped[str | None] = mapped_column(String(128))
    work_email: Mapped[str | None] = mapped_column(String(255))
    admin_email: Mapped[str | None] = mapped_column(String(255))
    tax_number: Mapped[str | None] = mapped_column(String(64))
    billing_address: Mapped[str | None] = mapped_column(Text)
    website_url: Mapped[str | None] = mapped_column(String(512))
    mobile_country_code: Mapped[str | None] = mapped_column(String(8))
    mobile_number: Mapped[str | None] = mapped_column(String(32))
    secondary_mobile_country_code: Mapped[str | None] = mapped_column(String(8))
    secondary_mobile_number: Mapped[str | None] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(64), default="New", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    product_draft: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    additional_addresses: Mapped[list["AdditionalAddress"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan"
    )
    branches: Mapped[list["Branch"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan"
    )
    quote_session: Mapped["QuoteSession | None"] = relationship(
        back_populates="lead", cascade="all, delete-orphan", uselist=False
    )
    quotations: Mapped[list["Quotation"]] = relationship(back_populates="lead")
    active_product_rows: Mapped[list["ActiveProduct"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan"
    )


class AdditionalAddress(Base):
    __tablename__ = "additional_addresses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str | None] = mapped_column(String(128))
    address: Mapped[str | None] = mapped_column(Text)

    lead: Mapped[Lead] = relationship(back_populates="additional_addresses")
