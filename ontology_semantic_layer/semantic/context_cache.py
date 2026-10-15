"""In-process TTL cache for resolved semantic context / allowlists."""

from __future__ import annotations

import threading
import time
from typing import Any

_DEFAULT_TTL_SEC = 60

_lock = threading.Lock()
_entries: dict[tuple[Any, ...], tuple[float, Any]] = {}


def _purge_expired(now: float) -> None:
    expired = [k for k, (exp, _) in _entries.items() if exp <= now]
    for key in expired:
        _entries.pop(key, None)


def get_cached(key: tuple[Any, ...]) -> Any | None:
    now = time.monotonic()
    with _lock:
        _purge_expired(now)
        entry = _entries.get(key)
        if entry is None:
            return None
        expires, value = entry
        if expires <= now:
            _entries.pop(key, None)
            return None
        return value


def set_cached(key: tuple[Any, ...], value: Any, ttl_sec: int = _DEFAULT_TTL_SEC) -> None:
    expires = time.monotonic() + max(1, ttl_sec)
    with _lock:
        _entries[key] = (expires, value)


def clear_context_cache() -> None:
    with _lock:
        _entries.clear()


def allowlist_cache_key(
    organization_id: int,
    user_id: int,
    agent: str,
    product: str,
) -> tuple[Any, ...]:
    return ("allowlist", organization_id, user_id, agent, product)
