"""Cross-cutting progress events for long-running tools (e.g. ontology SSE)."""

from __future__ import annotations

import queue
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_progress_sink: ContextVar[queue.Queue[dict[str, Any] | None] | None] = ContextVar(
    "tool_progress_sink", default=None
)


def emit_progress(event: dict[str, Any]) -> None:
    sink = _progress_sink.get()
    if sink is None:
        return
    try:
        sink.put_nowait(dict(event) if isinstance(event, dict) else {"label": str(event)})
    except Exception:  # noqa: BLE001
        pass


@contextmanager
def progress_sink(
    sink: queue.Queue[dict[str, Any] | None],
) -> Iterator[queue.Queue[dict[str, Any] | None]]:
    token = _progress_sink.set(sink)
    try:
        yield sink
    finally:
        _progress_sink.reset(token)
