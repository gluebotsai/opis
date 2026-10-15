import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(64))
    department: Mapped[str | None] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    created_by: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
    updated_by: Mapped[str | None] = mapped_column(String(255))

    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    token: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User | None] = relationship(back_populates="sessions")
