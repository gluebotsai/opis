import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class Quotation(Base):
    __tablename__ = "quotations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lead_snapshot: Mapped[dict | None] = mapped_column(JSONB)
    file_name: Mapped[str | None] = mapped_column(String(255))
    pdf_base64: Mapped[str | None] = mapped_column(Text)
    invoice_mode: Mapped[str | None] = mapped_column(String(32))
    branch_summary: Mapped[dict | None] = mapped_column(JSONB)
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    grand_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(8), default="INR", nullable=False)
    gst_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))
    status: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    finance_note: Mapped[str | None] = mapped_column(Text)
    submitted_by: Mapped[str | None] = mapped_column(String(255))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[str | None] = mapped_column(String(255))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(default=1, nullable=False)

    lead: Mapped["Lead"] = relationship(back_populates="quotations")
    assignments: Mapped[list["ProductAssignment"]] = relationship(
        back_populates="quotation", cascade="all, delete-orphan"
    )
    summary_items: Mapped[list["ProductSummaryItem"]] = relationship(
        back_populates="quotation", cascade="all, delete-orphan"
    )
    invoices: Mapped[list["QuotationInvoice"]] = relationship(
        back_populates="quotation", cascade="all, delete-orphan"
    )
    payment: Mapped["Payment | None"] = relationship(
        back_populates="quotation", cascade="all, delete-orphan", uselist=False
    )


class ProductAssignment(Base):
    __tablename__ = "product_assignments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    quotation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    branch_id: Mapped[str] = mapped_column(String(128), nullable=False)
    billing_target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    change_type: Mapped[str | None] = mapped_column(String(32))
    config: Mapped[dict | None] = mapped_column(JSONB)

    quotation: Mapped[Quotation] = relationship(back_populates="assignments")


class ProductSummaryItem(Base):
    __tablename__ = "product_summary_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    quotation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(255))
    price_label: Mapped[str | None] = mapped_column(String(128))
    branch_label: Mapped[str | None] = mapped_column(String(255))
    billing_label: Mapped[str | None] = mapped_column(String(255))
    change_type_label: Mapped[str | None] = mapped_column(String(64))

    quotation: Mapped[Quotation] = relationship(back_populates="summary_items")


class QuotationInvoice(Base):
    __tablename__ = "quotation_invoices"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    quotation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_name: Mapped[str | None] = mapped_column(String(255))
    pdf_base64: Mapped[str | None] = mapped_column(Text)
    billing_target_id: Mapped[str | None] = mapped_column(String(64))
    branch_label: Mapped[str | None] = mapped_column(String(255))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    grand_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    quotation: Mapped[Quotation] = relationship(back_populates="invoices")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    quotation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("quotations.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    provider: Mapped[str | None] = mapped_column(String(32))
    payment_link_url: Mapped[str | None] = mapped_column(Text)
    payment_link_id: Mapped[str | None] = mapped_column(String(255))
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    grand_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str | None] = mapped_column(String(8))
    gst_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))
    amount_label: Mapped[str | None] = mapped_column(String(128))
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    quotation: Mapped[Quotation] = relationship(back_populates="payment")


class ActiveProduct(Base):
    __tablename__ = "active_products"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    lead_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[str] = mapped_column(String(64), nullable=False)
    branch_id: Mapped[str] = mapped_column(String(128), nullable=False)
    billing_target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    change_type: Mapped[str | None] = mapped_column(String(32))
    config: Mapped[dict | None] = mapped_column(JSONB)
    implementation_purchased: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    price_label: Mapped[str | None] = mapped_column(String(128))
    quotation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("quotations.id", ondelete="SET NULL"), index=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lead: Mapped["Lead"] = relationship(back_populates="active_product_rows")

