"""Tenant-scoped idempotency receipts for confirmed agent mutations."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

from app.config import get_settings
from app.memory.store import RedisMemoryStore


def canonical_arguments(arguments: dict[str, Any]) -> str:
    ignored = {"confirmed", "auto", "label", "receiptId", "receiptKey"}
    value = {key: arguments[key] for key in sorted(arguments) if key not in ignored}
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def receipt_key(
    organization_id: str,
    actor_id: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> str:
    digest = hashlib.sha256(canonical_arguments(arguments).encode()).hexdigest()
    scope = f"{organization_id.strip()}:{actor_id.strip()}:{tool_name.strip()}"
    return "action-receipt:" + hashlib.sha256(f"{scope}:{digest}".encode()).hexdigest()


class ActionReceiptStore(Protocol):
    async def claim(self, key: str, receipt_id: str, ttl_seconds: int) -> bool: ...
    async def release(self, key: str, receipt_id: str) -> None: ...


class InMemoryActionReceiptStore:
    def __init__(self) -> None:
        self._keys: set[str] = set()
        self._lock = asyncio.Lock()

    async def claim(self, key: str, receipt_id: str, ttl_seconds: int) -> bool:
        del receipt_id, ttl_seconds
        async with self._lock:
            if key in self._keys:
                return False
            self._keys.add(key)
            return True

    async def release(self, key: str, receipt_id: str) -> None:
        del receipt_id
        async with self._lock:
            self._keys.discard(key)


class RedisActionReceiptStore:
    def __init__(self, url: str) -> None:
        self._store = RedisMemoryStore(url)

    async def claim(self, key: str, receipt_id: str, ttl_seconds: int) -> bool:
        # A non-released Redis lock is exactly a SET NX receipt with expiry.
        return await self._store.acquire_lock(key, receipt_id, ttl_seconds)

    async def release(self, key: str, receipt_id: str) -> None:
        await self._store.release_lock(key, receipt_id)


@dataclass(frozen=True)
class ActionReceipt:
    key: str
    receipt_id: str
    replay: bool


class ActionReceipts:
    def __init__(self, store: ActionReceiptStore, *, ttl_seconds: int = 86_400) -> None:
        self.store = store
        self.ttl_seconds = ttl_seconds

    async def claim(
        self,
        *,
        organization_id: str,
        actor_id: str,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> ActionReceipt:
        key = receipt_key(organization_id, actor_id, tool_name, arguments)
        receipt_id = hashlib.sha256(key.encode()).hexdigest()[:24]
        claimed = await self.store.claim(key, receipt_id, self.ttl_seconds)
        return ActionReceipt(key=key, receipt_id=receipt_id, replay=not claimed)

    async def release(self, receipt: ActionReceipt) -> None:
        if not receipt.replay:
            await self.store.release(receipt.key, receipt.receipt_id)


_MEMORY_STORE = InMemoryActionReceiptStore()


@lru_cache
def configured_action_receipts() -> ActionReceipts:
    settings = get_settings()
    if settings.orchestrator_stm_enabled:
        return ActionReceipts(RedisActionReceiptStore(settings.orchestrator_redis_url))
    return ActionReceipts(_MEMORY_STORE)
