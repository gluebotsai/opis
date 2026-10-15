"""In-memory conversation store — per WebSocket session, TTL purge."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Any


@dataclass
class ConversationTurn:
    role: str
    content: str
    sql: str | None = None
    result_preview: str | None = None


@dataclass
class SessionMemory:
    turns: list[ConversationTurn] = field(default_factory=list)
    last_sql: str | None = None
    last_columns: list[str] = field(default_factory=list)
    last_rows: list[list[Any]] = field(default_factory=list)
    active_period: str | None = None  # internal key e.g. this_month — inherited by follow-ups
    ontology_prompt: str | None = None
    ontology_metrics: list[dict] = field(default_factory=list)
    ontology_version: str | None = None
    last_standalone: str | None = None
    last_accessed: float = field(default_factory=time.time)


class MemoryStore:
    def __init__(self, max_turns: int = 20, ttl_seconds: int = 7200) -> None:
        self._sessions: dict[str, SessionMemory] = {}
        self._lock = Lock()
        self._max_turns = max_turns
        self._ttl_seconds = ttl_seconds

    def get(self, session_id: str) -> SessionMemory:
        with self._lock:
            self._purge_stale_locked()
            if session_id not in self._sessions:
                self._sessions[session_id] = SessionMemory()
            memory = self._sessions[session_id]
            memory.last_accessed = time.time()
            return memory

    def clear(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def add_user(self, session_id: str, message: str) -> None:
        memory = self.get(session_id)
        memory.turns.append(ConversationTurn(role="user", content=message))
        memory.turns = memory.turns[-self._max_turns :]

    def add_assistant(
        self,
        session_id: str,
        answer: str,
        *,
        sql: str | None = None,
        columns: list[str] | None = None,
        rows: list[list[Any]] | None = None,
        active_period: str | None = None,
    ) -> None:
        memory = self.get(session_id)
        preview = None
        if columns and rows:
            preview = f"{len(rows)} rows x {len(columns)} columns"
        memory.turns.append(
            ConversationTurn(role="assistant", content=answer, sql=sql, result_preview=preview)
        )
        memory.last_sql = sql
        if columns is not None:
            memory.last_columns = columns
        if rows is not None:
            memory.last_rows = rows
        if active_period is not None:
            memory.active_period = active_period
        memory.turns = memory.turns[-self._max_turns :]

    def set_ontology_slice(
        self,
        session_id: str,
        *,
        prompt: str,
        metrics: list[dict] | None = None,
        version: str | None = None,
    ) -> None:
        memory = self.get(session_id)
        memory.ontology_prompt = prompt
        memory.ontology_metrics = list(metrics or [])
        memory.ontology_version = version

    def ontology_slice_snapshot(self, session_id: str) -> dict[str, Any] | None:
        memory = self.get(session_id)
        if not memory.ontology_metrics:
            return None
        return {
            "prompt": memory.ontology_prompt or "",
            "metrics": list(memory.ontology_metrics),
            "version": memory.ontology_version,
        }

    def set_active_period(self, session_id: str, period: str | None) -> None:
        memory = self.get(session_id)
        memory.active_period = period

    def set_last_standalone(self, session_id: str, standalone: str | None) -> None:
        memory = self.get(session_id)
        memory.last_standalone = (standalone or "").strip() or None

    def history_messages(self, session_id: str) -> list[dict[str, str]]:
        memory = self.get(session_id)
        return [{"role": t.role, "content": t.content} for t in memory.turns]

    def _purge_stale_locked(self) -> None:
        cutoff = time.time() - self._ttl_seconds
        stale = [sid for sid, mem in self._sessions.items() if mem.last_accessed < cutoff]
        for sid in stale:
            del self._sessions[sid]


memory_store = MemoryStore()
