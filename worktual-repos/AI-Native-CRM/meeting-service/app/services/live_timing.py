"""UTC timestamps for live Assist latency tracing."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def latency_mark(stage: str, *, started_at: str, ended_at: str | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {"stage": stage, "startedAt": started_at}
    if ended_at:
        row["endedAt"] = ended_at
    return row


def append_mark(trace: dict[str, Any] | None, mark: dict[str, Any]) -> dict[str, Any]:
    base = dict(trace) if trace else {}
    marks = list(base.get("marks") or [])
    marks.append(mark)
    base["marks"] = marks
    return base
