from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PricingCatalog(Base):
    """Single-row catalog document merged with app defaults at read time."""

    __tablename__ = "pricing_catalogs"

    version: Mapped[int] = mapped_column(Integer, primary_key=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[str | None] = mapped_column(String(255))
    regions: Mapped[dict | None] = mapped_column(JSONB)
    shared: Mapped[dict | None] = mapped_column(JSONB)
    products: Mapped[dict | None] = mapped_column(JSONB)
    region_pricing: Mapped[dict | None] = mapped_column(JSONB)
