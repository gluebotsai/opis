"""Tenant-safe Redis-authoritative short-term memory manager."""

from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Literal, Mapping, Optional
from urllib.parse import quote

from app.memory.store import MemoryStore, lock_token
_SENSITIVE_KEY = re.compile(
    r"(password|passwd|secret|token|authorization|cookie|api[_-]?key)", re.I
)
_SENSITIVE_VALUE = re.compile(
    r"(Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:\d[ -]*?){13,19})", re.I
)


class MemoryScopeError(ValueError):
    pass


class MemoryConflictError(RuntimeError):
    pass


def redact_memory(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return "[TRUNCATED]"
    if isinstance(value, Mapping):
        return {
            str(key)[:120]: (
                "[REDACTED]"
                if _SENSITIVE_KEY.search(str(key))
                else redact_memory(item, depth=depth + 1)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_memory(item, depth=depth + 1) for item in value[:100]]
    if isinstance(value, str):
        return _SENSITIVE_VALUE.sub("[REDACTED]", value)[:4000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:1000]


def merge_patch(base: Mapping[str, Any], patch: Mapping[str, Any]) -> dict[str, Any]:
    output = dict(base)
    for key, value in patch.items():
        if value is None:
            output.pop(key, None)
        elif isinstance(value, Mapping) and isinstance(output.get(key), Mapping):
            output[key] = merge_patch(output[key], value)
        else:
            output[key] = value
    return output


class MemoryManager:
    def __init__(
        self,
        store: MemoryStore,
        *,
        enabled: bool = False,
        ttl_seconds: int = 86_400,
        lock_ttl_seconds: int = 15,
        lock_wait_seconds: float = 2.0,
        max_bytes: int = 16_384,
        max_summary_chars: int = 1_500,
        failure_mode: Literal["closed", "graceful"] = "graceful",
    ) -> None:
        self.store = store
        self.enabled = enabled
        self.ttl_seconds = max(60, ttl_seconds)
        self.lock_ttl_seconds = max(2, lock_ttl_seconds)
        self.lock_wait_seconds = max(0.0, lock_wait_seconds)
        self.max_bytes = max(1024, max_bytes)
        self.max_summary_chars = max(100, max_summary_chars)
        self.failure_mode = failure_mode

    @staticmethod
    def key(organization_id: str, user_id: str, conversation_id: str) -> str:
        scopes = (organization_id, user_id, conversation_id)
        if any(not str(scope).strip() for scope in scopes):
            raise MemoryScopeError(
                "Organization, user, and conversation scopes are required"
            )
        encoded = [quote(str(scope).strip(), safe="-_.~") for scope in scopes]
        return "stm:" + ":".join(encoded)

    async def load(
        self,
        organization_id: str,
        user_id: str,
        conversation_id: str,
        *,
        compatibility_memory: Optional[Mapping[str, Any]] = None,
    ) -> dict[str, Any]:
        fallback = redact_memory(dict(compatibility_memory or {}))
        if not self.enabled:
            return {"version": 0, "working": fallback, "provenance": []}
        key = self.key(organization_id, user_id, conversation_id)
        try:
            stored = await self.store.get(key)
            if stored:
                return self._normalize_record(stored)
            return {"version": 0, "working": fallback, "summary": "", "provenance": []}
        except Exception:
            if self.failure_mode == "closed":
                raise
            return {"version": 0, "working": fallback, "summary": "", "provenance": []}

    async def save(
        self,
        organization_id: str,
        user_id: str,
        conversation_id: str,
        *,
        expected_version: int,
        working: Mapping[str, Any],
        summary: str = "",
        provenance: Optional[list[Mapping[str, Any]]] = None,
    ) -> dict[str, Any]:
        record = self._compact_record(
            {
                "version": expected_version + 1,
                "working": redact_memory(dict(working)),
                "summary": redact_memory(summary)[: self.max_summary_chars],
                "provenance": [
                    redact_memory(dict(item)) for item in (provenance or [])[-20:]
                ],
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
        )
        if not self.enabled:
            return record
        key = self.key(organization_id, user_id, conversation_id)
        try:
            if not await self.store.compare_set(
                key, expected_version, record, self.ttl_seconds
            ):
                raise MemoryConflictError("STM optimistic version conflict")
            return record
        except MemoryConflictError:
            raise
        except Exception:
            if self.failure_mode == "closed":
                raise
            return record

    async def apply_patch(
        self,
        organization_id: str,
        user_id: str,
        conversation_id: str,
        *,
        current: Mapping[str, Any],
        patch: Mapping[str, Any],
        source: str,
        run_id: str,
    ) -> dict[str, Any]:
        working = merge_patch(
            current.get("working") if isinstance(current.get("working"), Mapping) else {},
            patch,
        )
        provenance = list(current.get("provenance") or [])
        provenance.append({"source": source[:80], "runId": run_id[:160]})
        return await self.save(
            organization_id,
            user_id,
            conversation_id,
            expected_version=int(current.get("version") or 0),
            working=working,
            summary=str(current.get("summary") or ""),
            provenance=provenance,
        )

    async def forget(
        self, organization_id: str, user_id: str, conversation_id: str
    ) -> bool:
        if not self.enabled:
            return False
        try:
            return await self.store.delete(
                self.key(organization_id, user_id, conversation_id)
            )
        except Exception:
            if self.failure_mode == "closed":
                raise
            return False

    @asynccontextmanager
    async def conversation_lock(
        self, organization_id: str, user_id: str, conversation_id: str
    ) -> AsyncIterator[None]:
        if not self.enabled:
            yield
            return
        key = self.key(organization_id, user_id, conversation_id) + ":lock"
        token = lock_token()
        deadline = asyncio.get_running_loop().time() + self.lock_wait_seconds
        acquired = False
        while not acquired:
            acquired = await self.store.acquire_lock(
                key, token, self.lock_ttl_seconds
            )
            if acquired:
                break
            if asyncio.get_running_loop().time() >= deadline:
                raise MemoryConflictError("Conversation is already being processed")
            await asyncio.sleep(0.025)
        try:
            yield
        finally:
            await self.store.release_lock(key, token)

    def _normalize_record(self, record: Mapping[str, Any]) -> dict[str, Any]:
        return self._compact_record(
            {
                "version": max(0, int(record.get("version") or 0)),
                "working": redact_memory(
                    record.get("working") if isinstance(record.get("working"), Mapping) else {}
                ),
                "summary": str(redact_memory(record.get("summary") or ""))[
                    : self.max_summary_chars
                ],
                "provenance": list(record.get("provenance") or [])[-20:],
                "updatedAt": str(record.get("updatedAt") or ""),
            }
        )

    def _compact_record(self, record: dict[str, Any]) -> dict[str, Any]:
        while len(json.dumps(record, default=str).encode()) > self.max_bytes:
            provenance = record.get("provenance")
            if isinstance(provenance, list) and provenance:
                provenance.pop(0)
                continue
            working = record.get("working")
            if isinstance(working, dict) and working:
                working.pop(next(iter(working)))
                continue
            record["summary"] = str(record.get("summary") or "")[: max(0, len(str(record.get("summary") or "")) // 2)]
            if not record["summary"]:
                break
        return record

