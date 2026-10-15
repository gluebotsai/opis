"""Access control types and role identity for Contact Center."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class AccessDenied(Exception):
    """Raised when an operation violates role scope or permissions."""


@dataclass(frozen=True)
class Identity:
    organization_id: int
    user_id: int
    role: str
    queue_ids: tuple[int, ...] = field(default_factory=tuple)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Identity:
        q_raw = data.get("queue_ids") or []
        return cls(
            organization_id=int(data["organization_id"]),
            user_id=int(data["user_id"]),
            role=str(data.get("role", "agent")),
            queue_ids=tuple(int(x) for x in q_raw),
        )
