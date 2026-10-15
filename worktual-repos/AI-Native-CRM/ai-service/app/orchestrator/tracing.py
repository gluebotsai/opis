"""Small dependency-free tracing primitives for orchestrator runs."""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Protocol


@dataclass(frozen=True)
class TraceEvent:
    name: str
    started_at: float
    ended_at: float
    status: str
    attributes: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


class TraceSink(Protocol):
    def emit(self, event: TraceEvent) -> None:
        ...


class InMemoryTraceSink:
    def __init__(self) -> None:
        self.events: List[TraceEvent] = []

    def emit(self, event: TraceEvent) -> None:
        self.events.append(event)


class NullTraceSink:
    def emit(self, event: TraceEvent) -> None:
        del event


@contextmanager
def trace_span(
    sink: TraceSink,
    name: str,
    **attributes: Any,
) -> Iterator[None]:
    started = time.time()
    try:
        yield
    except Exception as exc:
        sink.emit(
            TraceEvent(
                name=name,
                started_at=started,
                ended_at=time.time(),
                status="error",
                attributes=attributes,
                error=str(exc)[:500],
            )
        )
        raise
    sink.emit(
        TraceEvent(
            name=name,
            started_at=started,
            ended_at=time.time(),
            status="ok",
            attributes=attributes,
        )
    )
