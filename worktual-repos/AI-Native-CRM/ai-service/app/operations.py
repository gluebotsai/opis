"""Dependency-light operational controls and redacted metrics for agents."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable

SENSITIVE_KEYS = {
    "authorization",
    "cookie",
    "email",
    "phone",
    "prompt",
    "messages",
    "token",
    "secret",
    "api_key",
    "transcript",
}


def redact_labels(labels: dict[str, Any] | None) -> dict[str, str]:
    """Keep bounded operational dimensions; discard secrets and free text."""
    safe: dict[str, str] = {}
    for key, value in (labels or {}).items():
        lowered = key.lower()
        if any(part in lowered for part in SENSITIVE_KEYS):
            safe[key] = "[redacted]"
            continue
        text = str(value)
        safe[key] = text[:80] if len(text) <= 80 else "[redacted]"
    return safe


class Metrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: dict[tuple[str, tuple[tuple[str, str], ...]], float] = defaultdict(float)
        self._gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}

    def increment(self, name: str, value: float = 1, **labels: Any) -> None:
        key = (name, tuple(sorted(redact_labels(labels).items())))
        with self._lock:
            self._counters[key] += value

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        key = (name, tuple(sorted(redact_labels(labels).items())))
        with self._lock:
            self._gauges[key] = value

    def snapshot(self) -> dict[str, list[dict[str, Any]]]:
        with self._lock:
            return {
                "counters": [
                    {"name": name, "labels": dict(labels), "value": value}
                    for (name, labels), value in self._counters.items()
                ],
                "gauges": [
                    {"name": name, "labels": dict(labels), "value": value}
                    for (name, labels), value in self._gauges.items()
                ],
            }

    def queue_depth(self, queue: str, depth: int) -> None:
        self.gauge("agent_queue_depth", max(0, depth), queue=queue)

    def lease(self, lease: str, outcome: str) -> None:
        self.increment("agent_lease_total", lease=lease, outcome=outcome)

    def agent_run(self, agent: str, latency_ms: float, outcome: str) -> None:
        self.increment("agent_runs_total", agent=agent, outcome=outcome)
        self.gauge("agent_latency_ms", max(0, latency_ms), agent=agent)

    def handoff(self, from_agent: str, to_agent: str, outcome: str) -> None:
        self.increment(
            "agent_handoffs_total",
            from_agent=from_agent,
            to_agent=to_agent,
            outcome=outcome,
        )

    def tool_outcome(self, tool: str, outcome: str) -> None:
        self.increment("agent_tool_outcomes_total", tool=tool, outcome=outcome)

    def duplicate_confirmation(self, agent: str) -> None:
        self.increment("duplicate_confirmations_total", agent=agent)


metrics = Metrics()


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = max(1, limit)
        self.window_seconds = max(1.0, window_seconds)
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        current = now if now is not None else time.monotonic()
        with self._lock:
            events = self._events[key]
            while events and events[0] <= current - self.window_seconds:
                events.popleft()
            if len(events) >= self.limit:
                metrics.increment("tenant_throttle_total", tenant=key)
                return False
            events.append(current)
            return True


class ConcurrencyLimiter:
    """Global plus keyed tenant/agent limits with cancellation-safe release."""

    def __init__(self, global_limit: int, per_key_limit: int) -> None:
        self.global_limit = asyncio.Semaphore(max(1, global_limit))
        self.per_key_limit = max(1, per_key_limit)
        self._keyed: dict[str, asyncio.Semaphore] = {}

    async def run(self, key: str, operation: Callable[[], Any]) -> Any:
        keyed = self._keyed.setdefault(key, asyncio.Semaphore(self.per_key_limit))
        async with self.global_limit, keyed:
            return await operation()


@dataclass
class CircuitBreaker:
    failure_threshold: int = 5
    recovery_seconds: float = 30.0
    failures: int = 0
    opened_at: float | None = None

    def allow(self, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        if self.opened_at is None:
            return True
        if current - self.opened_at >= self.recovery_seconds:
            return True
        return False

    def success(self) -> None:
        self.failures = 0
        self.opened_at = None

    def failure(self, now: float | None = None) -> None:
        self.failures += 1
        if self.failures >= max(1, self.failure_threshold):
            self.opened_at = time.monotonic() if now is None else now

    @property
    def state(self) -> str:
        return "open" if not self.allow() else ("half_open" if self.opened_at else "closed")


llm_circuit = CircuitBreaker()
mcp_circuit = CircuitBreaker()
