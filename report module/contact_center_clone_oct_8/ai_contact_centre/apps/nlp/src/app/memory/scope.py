"""Identity boundaries shared by all agent memory layers."""

from __future__ import annotations

from dataclasses import dataclass


class MemoryScopeError(ValueError):
    """Raised when memory is accessed without a valid or matching scope."""


@dataclass(frozen=True, slots=True)
class MemoryScope:
    """Trusted identity boundary for one agent run.

    Tenant and user are always required. Conversation and task remain optional
    because some runtime entry points are not attached to either resource.
    """

    tenant_id: str
    user_id: str
    conversation_id: str | None = None
    task_id: str | None = None

    def __post_init__(self) -> None:
        for name in ("tenant_id", "user_id"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise MemoryScopeError(f"{name} must be a non-empty string")

        for name in ("conversation_id", "task_id"):
            value = getattr(self, name)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise MemoryScopeError(f"{name} must be None or a non-empty string")

    def metadata(self) -> dict[str, str]:
        """Return non-null scope fields for durable item metadata."""
        values = {
            "tenant_id": self.tenant_id,
            "user_id": self.user_id,
            "conversation_id": self.conversation_id,
            "task_id": self.task_id,
        }
        return {key: value for key, value in values.items() if value is not None}
