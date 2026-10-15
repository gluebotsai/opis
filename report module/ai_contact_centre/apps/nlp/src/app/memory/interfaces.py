"""Typed contracts for the four agent memory layers."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.memory.scope import MemoryScope

Message = dict[str, Any]
MemoryItem = dict[str, Any]
PreferenceData = dict[str, Any]


@runtime_checkable
class WorkingMemory(Protocol):
    """Current-task scratch state used for slot filling and intermediate work."""

    @property
    def scope(self) -> MemoryScope: ...

    def get(self, key: str) -> object | None: ...

    def set(self, key: str, value: object) -> None: ...

    def update(self, values: dict[str, object]) -> None: ...

    def clear(self) -> None: ...

    def as_prompt_block(self) -> str: ...


@runtime_checkable
class ShortTermMemory(Protocol):
    """Conversation-local transcript and optional running summary."""

    @property
    def scope(self) -> MemoryScope: ...

    def add_message(self, message: Message) -> None: ...

    def get_messages(self, limit: int | None = None) -> list[Message]: ...

    def set_summary(self, summary: str) -> None: ...

    def get_summary(self) -> str | None: ...

    def clear(self) -> None: ...


@runtime_checkable
class LongTermMemory(Protocol):
    """Durable cross-session memory backend.

    Every operation carries tenant and user identity explicitly. Conversation
    identity is required when storing an item.
    """

    async def store(
        self,
        *,
        tenant_id: str,
        user_id: str,
        conversation_id: str,
        item: MemoryItem,
    ) -> str: ...

    async def search(
        self,
        *,
        tenant_id: str,
        user_id: str,
        query: str,
        limit: int = 5,
    ) -> list[MemoryItem]: ...

    async def get_recent(
        self,
        *,
        tenant_id: str,
        user_id: str,
        limit: int = 10,
    ) -> list[MemoryItem]: ...


@runtime_checkable
class PreferenceScratchpad(Protocol):
    """User-scoped preference backend read and written through trusted tools."""

    async def get(self, *, tenant_id: str, user_id: str) -> PreferenceData: ...

    async def upsert(
        self,
        *,
        tenant_id: str,
        user_id: str,
        patch: PreferenceData,
    ) -> PreferenceData: ...
