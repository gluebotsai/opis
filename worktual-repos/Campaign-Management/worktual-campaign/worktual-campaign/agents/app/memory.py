"""Session memory facade (multi-agent style) over session_store.

Agents should prefer this module for turn STM; persistence remains in session_store.
"""

from __future__ import annotations

from typing import Any

from app.session_store import (
    append_message,
    chat_history_for_llm,
    get_llm_memory,
    get_or_create_session,
    llm_session_snapshot,
    public_state,
    replace_llm_memory,
    save_session,
)

__all__ = [
    "append_message",
    "chat_history_for_llm",
    "get_llm_memory",
    "get_or_create_session",
    "llm_session_snapshot",
    "public_state",
    "replace_llm_memory",
    "save_session",
    "SessionMemory",
]


class SessionMemory:
    """Thin helper around a session_id for chat turns."""

    def __init__(self, session_id: str):
        self.session_id = session_id

    async def load(self) -> dict[str, Any]:
        return await get_or_create_session(self.session_id)

    async def history(self) -> list[dict]:
        session = await self.load()
        return chat_history_for_llm(session)

    async def snapshot(self) -> dict[str, Any]:
        session = await self.load()
        return llm_session_snapshot(session)

    async def add(self, role: str, content: str) -> dict[str, Any]:
        return await append_message(self.session_id, role, content)

    async def persist(self, session: dict[str, Any] | None = None) -> None:
        await save_session(session or await self.load())
