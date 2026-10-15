"""Scoped memory composition for injection into L3 agents."""

from __future__ import annotations

import copy
from dataclasses import dataclass

from app.memory.in_process import InProcessShortTermMemory, InProcessWorkingMemory
from app.memory.interfaces import (
    LongTermMemory,
    MemoryItem,
    PreferenceData,
    PreferenceScratchpad,
    ShortTermMemory,
    WorkingMemory,
)
from app.memory.scope import MemoryScope, MemoryScopeError


class MemoryBackendUnavailable(RuntimeError):
    """Raised when a write is attempted without a configured durable backend."""


def _validate_limit(limit: int) -> None:
    if isinstance(limit, bool) or not isinstance(limit, int):
        raise TypeError("memory result limit must be an integer")
    if limit < 1:
        raise ValueError("memory result limit must be positive")


def _validate_result_scope(items: list[MemoryItem], scope: MemoryScope) -> list[MemoryItem]:
    """Fail closed if a backend returns data explicitly owned by another principal."""
    safe_items: list[MemoryItem] = []
    expected = {"tenant_id": scope.tenant_id, "user_id": scope.user_id}
    for item in items:
        if not isinstance(item, dict):
            raise TypeError("long-term memory backends must return dictionaries")
        for field, value in expected.items():
            returned_value = item.get(field)
            if returned_value is not None and returned_value != value:
                raise MemoryScopeError(f"long-term backend returned mismatched {field}")
        safe_items.append(copy.deepcopy(item))
    return safe_items


def _validate_preference_scope(
    preferences: PreferenceData,
    scope: MemoryScope,
) -> PreferenceData:
    if not isinstance(preferences, dict):
        raise TypeError("preference scratchpads must return dictionaries")
    for field, value in (("tenant_id", scope.tenant_id), ("user_id", scope.user_id)):
        returned_value = preferences.get(field)
        if returned_value is not None and returned_value != value:
            raise MemoryScopeError(f"preference backend returned mismatched {field}")
    return copy.deepcopy(preferences)


class UnavailableLongTermMemory:
    """Safe placeholder used until a durable backend is wired."""

    async def store(
        self,
        *,
        tenant_id: str,
        user_id: str,
        conversation_id: str,
        item: MemoryItem,
    ) -> str:
        raise MemoryBackendUnavailable("long-term memory backend is not configured")

    async def search(
        self,
        *,
        tenant_id: str,
        user_id: str,
        query: str,
        limit: int = 5,
    ) -> list[MemoryItem]:
        return []

    async def get_recent(
        self,
        *,
        tenant_id: str,
        user_id: str,
        limit: int = 10,
    ) -> list[MemoryItem]:
        return []


class UnavailablePreferenceScratchpad:
    """Safe placeholder that permits empty reads but rejects misleading writes."""

    async def get(self, *, tenant_id: str, user_id: str) -> PreferenceData:
        return {}

    async def upsert(
        self,
        *,
        tenant_id: str,
        user_id: str,
        patch: PreferenceData,
    ) -> PreferenceData:
        raise MemoryBackendUnavailable("preference scratchpad backend is not configured")


@dataclass(frozen=True, slots=True)
class LongTermMemoryView:
    """Bind a durable backend to one tenant and user scope."""

    scope: MemoryScope
    backend: LongTermMemory

    async def store(self, item: MemoryItem) -> str:
        if self.scope.conversation_id is None:
            raise MemoryScopeError("conversation_id is required to store long-term memory")
        if not isinstance(item, dict):
            raise TypeError("long-term memory items must be dictionaries")

        payload = copy.deepcopy(item)
        for field, value in self.scope.metadata().items():
            existing = payload.get(field)
            if existing is not None and existing != value:
                raise MemoryScopeError(f"memory item contains mismatched {field}")
            payload[field] = value

        return await self.backend.store(
            tenant_id=self.scope.tenant_id,
            user_id=self.scope.user_id,
            conversation_id=self.scope.conversation_id,
            item=payload,
        )

    async def search(self, query: str, limit: int = 5) -> list[MemoryItem]:
        if not isinstance(query, str) or not query.strip():
            raise ValueError("long-term memory query must be a non-empty string")
        _validate_limit(limit)
        items = await self.backend.search(
            tenant_id=self.scope.tenant_id,
            user_id=self.scope.user_id,
            query=query,
            limit=limit,
        )
        return _validate_result_scope(items, self.scope)

    async def get_recent(self, limit: int = 10) -> list[MemoryItem]:
        _validate_limit(limit)
        items = await self.backend.get_recent(
            tenant_id=self.scope.tenant_id,
            user_id=self.scope.user_id,
            limit=limit,
        )
        return _validate_result_scope(items, self.scope)


@dataclass(frozen=True, slots=True)
class PreferenceScratchpadView:
    """Bind preference reads and writes to one tenant and user."""

    scope: MemoryScope
    backend: PreferenceScratchpad

    async def get(self) -> PreferenceData:
        preferences = await self.backend.get(
            tenant_id=self.scope.tenant_id,
            user_id=self.scope.user_id,
        )
        return _validate_preference_scope(preferences, self.scope)

    async def upsert(self, patch: PreferenceData) -> PreferenceData:
        if not isinstance(patch, dict):
            raise TypeError("preference patches must be dictionaries")
        for field, value in (
            ("tenant_id", self.scope.tenant_id),
            ("user_id", self.scope.user_id),
        ):
            existing = patch.get(field)
            if existing is not None and existing != value:
                raise MemoryScopeError(f"preference patch contains mismatched {field}")

        preferences = await self.backend.upsert(
            tenant_id=self.scope.tenant_id,
            user_id=self.scope.user_id,
            patch=copy.deepcopy(patch),
        )
        return _validate_preference_scope(preferences, self.scope)


@dataclass(frozen=True, slots=True)
class MemoryView:
    """The scoped dependency passed to an individual L3 agent."""

    agent_name: str
    scope: MemoryScope
    working: WorkingMemory
    short_term: ShortTermMemory
    long_term: LongTermMemoryView
    preferences: PreferenceScratchpadView

    def __post_init__(self) -> None:
        if not isinstance(self.agent_name, str) or not self.agent_name.strip():
            raise ValueError("agent_name must be a non-empty string")
        if self.working.scope != self.scope:
            raise MemoryScopeError("working memory scope does not match MemoryView")
        if self.short_term.scope != self.scope:
            raise MemoryScopeError("short-term memory scope does not match MemoryView")


@dataclass(slots=True)
class AgentMemory:
    """Own memory layers for a run and issue scope-safe per-agent views."""

    scope: MemoryScope
    working: WorkingMemory
    short_term: ShortTermMemory
    long_term_backend: LongTermMemory
    preference_backend: PreferenceScratchpad

    def __post_init__(self) -> None:
        if self.working.scope != self.scope:
            raise MemoryScopeError("working memory scope does not match AgentMemory")
        if self.short_term.scope != self.scope:
            raise MemoryScopeError("short-term memory scope does not match AgentMemory")

    @classmethod
    def in_process(
        cls,
        scope: MemoryScope,
        *,
        long_term: LongTermMemory | None = None,
        preferences: PreferenceScratchpad | None = None,
    ) -> AgentMemory:
        """Build local layers with explicit safe placeholders for durable layers."""
        return cls(
            scope=scope,
            working=InProcessWorkingMemory(scope),
            short_term=InProcessShortTermMemory(scope),
            long_term_backend=(
                long_term if long_term is not None else UnavailableLongTermMemory()
            ),
            preference_backend=(
                preferences
                if preferences is not None
                else UnavailablePreferenceScratchpad()
            ),
        )

    def for_agent(self, agent_name: str) -> MemoryView:
        """Return a view that cannot override tenant or user identifiers."""
        return MemoryView(
            agent_name=agent_name,
            scope=self.scope,
            working=self.working,
            short_term=self.short_term,
            long_term=LongTermMemoryView(self.scope, self.long_term_backend),
            preferences=PreferenceScratchpadView(self.scope, self.preference_backend),
        )
