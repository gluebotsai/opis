"""Async STM store contracts plus Redis and deterministic offline implementations."""

from __future__ import annotations

import asyncio
import json
import secrets
import time
from typing import Any, Optional, Protocol


class MemoryStore(Protocol):
    async def get(self, key: str) -> Optional[dict[str, Any]]: ...
    async def compare_set(
        self, key: str, expected_version: int, value: dict[str, Any], ttl_seconds: int
    ) -> bool: ...
    async def delete(self, key: str) -> bool: ...
    async def acquire_lock(self, key: str, token: str, ttl_seconds: int) -> bool: ...
    async def release_lock(self, key: str, token: str) -> None: ...


class FakeMemoryStore:
    """In-memory store with Redis-equivalent CAS, TTL, and lock semantics."""

    def __init__(self) -> None:
        self.items: dict[str, tuple[dict[str, Any], float]] = {}
        self.locks: dict[str, tuple[str, float]] = {}
        self._mutex = asyncio.Lock()

    async def get(self, key: str) -> Optional[dict[str, Any]]:
        async with self._mutex:
            item = self.items.get(key)
            if not item:
                return None
            value, expires = item
            if expires <= time.monotonic():
                self.items.pop(key, None)
                return None
            return json.loads(json.dumps(value))

    async def compare_set(
        self, key: str, expected_version: int, value: dict[str, Any], ttl_seconds: int
    ) -> bool:
        async with self._mutex:
            item = self.items.get(key)
            current = item[0] if item and item[1] > time.monotonic() else None
            current_version = int((current or {}).get("version") or 0)
            if current_version != expected_version:
                return False
            self.items[key] = (
                json.loads(json.dumps(value)),
                time.monotonic() + ttl_seconds,
            )
            return True

    async def delete(self, key: str) -> bool:
        async with self._mutex:
            return self.items.pop(key, None) is not None

    async def acquire_lock(self, key: str, token: str, ttl_seconds: int) -> bool:
        async with self._mutex:
            current = self.locks.get(key)
            if current and current[1] > time.monotonic():
                return False
            self.locks[key] = (token, time.monotonic() + ttl_seconds)
            return True

    async def release_lock(self, key: str, token: str) -> None:
        async with self._mutex:
            if self.locks.get(key, (None, 0))[0] == token:
                self.locks.pop(key, None)


class RedisMemoryStore:
    _CAS = """
local current = redis.call('GET', KEYS[1])
local version = 0
if current then
  local decoded = cjson.decode(current)
  version = tonumber(decoded['version']) or 0
end
if version ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
"""
    _UNLOCK = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""

    def __init__(self, url: str) -> None:
        from redis.asyncio import Redis

        self.client = Redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> Optional[dict[str, Any]]:
        raw = await self.client.get(key)
        if not raw:
            return None
        value = json.loads(raw)
        return value if isinstance(value, dict) else None

    async def compare_set(
        self, key: str, expected_version: int, value: dict[str, Any], ttl_seconds: int
    ) -> bool:
        result = await self.client.eval(
            self._CAS, 1, key, expected_version, json.dumps(value), ttl_seconds
        )
        return bool(result)

    async def delete(self, key: str) -> bool:
        return bool(await self.client.delete(key))

    async def acquire_lock(self, key: str, token: str, ttl_seconds: int) -> bool:
        return bool(await self.client.set(key, token, ex=ttl_seconds, nx=True))

    async def release_lock(self, key: str, token: str) -> None:
        await self.client.eval(self._UNLOCK, 1, key, token)


def lock_token() -> str:
    return secrets.token_urlsafe(24)

