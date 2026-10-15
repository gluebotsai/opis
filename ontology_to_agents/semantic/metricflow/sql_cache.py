"""Cache rendered MetricFlow SQL (not result numbers) — memory + optional Redis."""

from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any

_memory: dict[str, str] = {}
_redis_client: Any | None = None
_redis_checked = False
_compile_locks: dict[str, threading.Lock] = {}
_lock_guard = threading.Lock()

_REDIS_PREFIX = "mf:sql:"


def _redis_url() -> str | None:
    url = os.environ.get("REDIS_URL", "").strip()
    return url or None


def _get_redis() -> Any | None:
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client
    _redis_checked = True
    url = _redis_url()
    if not url:
        return None
    try:
        import redis  # type: ignore[import-untyped]

        _redis_client = redis.from_url(url, decode_responses=True)
        _redis_client.ping()
    except Exception:
        _redis_client = None
    return _redis_client


def cache_key_for_prepared(prepared: dict[str, Any]) -> str:
    """Stable key from query shape including org isolation in WHERE."""
    payload = {
        "organizationId": prepared.get("organizationId"),
        "execution_product": prepared.get("execution_product") or prepared.get("product"),
        "metrics": prepared.get("metrics"),
        "group_by": prepared.get("group_by"),
        "where": prepared.get("where"),
        "time": prepared.get("time"),
        "order_by": prepared.get("order_by"),
        "limit": prepared.get("limit"),
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def get_cached_sql(key: str) -> str | None:
    if key in _memory:
        return _memory[key]
    client = _get_redis()
    if client is None:
        return None
    try:
        val = client.get(f"{_REDIS_PREFIX}{key}")
        if val:
            _memory[key] = val
        return val
    except Exception:
        return None


def set_cached_sql(key: str, sql: str) -> None:
    if not sql:
        return
    _memory[key] = sql
    client = _get_redis()
    if client is None:
        return
    try:
        client.set(f"{_REDIS_PREFIX}{key}", sql)
    except Exception:
        pass


def clear_sql_cache() -> None:
    global _redis_client, _redis_checked
    _memory.clear()
    client = _get_redis()
    if client is not None:
        try:
            for key in client.scan_iter(f"{_REDIS_PREFIX}*"):
                client.delete(key)
        except Exception:
            pass
    _redis_client = None
    _redis_checked = False


def compile_lock_for_product(product: str) -> threading.Lock:
    key = (product or "default").strip().lower()
    with _lock_guard:
        if key not in _compile_locks:
            _compile_locks[key] = threading.Lock()
        return _compile_locks[key]
