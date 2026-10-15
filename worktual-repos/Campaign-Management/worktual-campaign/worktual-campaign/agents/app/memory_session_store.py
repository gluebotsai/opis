"""In-memory agent sessions.

- Ephemeral modules (contacts, monitoring, hub, …): memory only
- Create-campaign drafts: warm cache for LLM turns; durable DB persist is scheduled
  from session_store after local updates
"""

from __future__ import annotations

import threading
import time
from copy import deepcopy
from typing import Any

# session_id -> { "session": dict, "touched_at": float }
_STORE: dict[str, dict[str, Any]] = {}
# session_id -> monotonic deadline when a deferred delete should run
_PENDING_DELETE: dict[str, float] = {}
_LOCK = threading.RLock()

# Drop idle ephemeral sessions after this many seconds (safety net).
_IDLE_TTL_SEC = 4 * 60 * 60
# Grace before drop on leave/disconnect so React Strict Mode remount can rejoin.
_LEAVE_GRACE_SEC = 1.5


def _purge_idle_locked(now: float | None = None) -> None:
    now = time.time() if now is None else now
    dead = [
        sid
        for sid, row in _STORE.items()
        if now - float(row.get("touched_at") or 0) > _IDLE_TTL_SEC
    ]
    for sid in dead:
        _STORE.pop(sid, None)
        _PENDING_DELETE.pop(sid, None)
    due = [sid for sid, when in _PENDING_DELETE.items() if now >= when]
    for sid in due:
        _PENDING_DELETE.pop(sid, None)
        _STORE.pop(sid, None)


def memory_has(session_id: str) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    with _LOCK:
        _purge_idle_locked()
        return sid in _STORE


def memory_get(session_id: str) -> dict[str, Any] | None:
    sid = str(session_id or "").strip()
    if not sid:
        return None
    with _LOCK:
        _purge_idle_locked()
        row = _STORE.get(sid)
        if not row:
            return None
        # Re-join cancels a pending leave drop.
        _PENDING_DELETE.pop(sid, None)
        row["touched_at"] = time.time()
        return deepcopy(row["session"])


def memory_put(session: dict[str, Any]) -> dict[str, Any]:
    sid = str(session.get("session_id") or "").strip()
    if not sid:
        raise ValueError("session_id required")
    stored = deepcopy(session)
    with _LOCK:
        _PENDING_DELETE.pop(sid, None)
        _STORE[sid] = {"session": stored, "touched_at": time.time()}
        return deepcopy(stored)


def memory_delete(session_id: str, *, immediate: bool = False) -> bool:
    sid = str(session_id or "").strip()
    if not sid:
        return False
    with _LOCK:
        if immediate:
            _PENDING_DELETE.pop(sid, None)
            return _STORE.pop(sid, None) is not None
        if sid not in _STORE:
            return False
        _PENDING_DELETE[sid] = time.time() + _LEAVE_GRACE_SEC
        return True


def memory_clear_all() -> None:
    with _LOCK:
        _STORE.clear()
        _PENDING_DELETE.clear()


__all__ = [
    "memory_has",
    "memory_get",
    "memory_put",
    "memory_delete",
    "memory_clear_all",
]
