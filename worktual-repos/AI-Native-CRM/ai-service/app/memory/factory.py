"""Configuration adapter for the optional Redis STM authority."""

from __future__ import annotations

from app.config import Settings, get_settings
from app.memory.manager import MemoryManager
from app.memory.store import RedisMemoryStore


def configured_memory_manager(settings: Settings | None = None) -> MemoryManager:
    value = settings or get_settings()
    failure_mode = (
        "closed" if value.orchestrator_stm_failure_mode.strip().lower() == "closed"
        else "graceful"
    )
    return MemoryManager(
        RedisMemoryStore(value.orchestrator_redis_url),
        enabled=value.orchestrator_stm_enabled,
        ttl_seconds=value.orchestrator_stm_ttl_seconds,
        lock_ttl_seconds=value.orchestrator_stm_lock_ttl_seconds,
        max_bytes=value.orchestrator_stm_max_bytes,
        failure_mode=failure_mode,
    )

