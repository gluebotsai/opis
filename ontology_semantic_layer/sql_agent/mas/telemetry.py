"""Telemetry + counters for instruction-first harness guards."""

from __future__ import annotations

import logging
import threading
from typing import Any

_log = logging.getLogger("sql_agent.instruction_first")
_lock = threading.Lock()
_COUNTERS: dict[str, int] = {
    "metric_stripped": 0,
    "metric_rejected_filter_mismatch": 0,
    "scope_clamped": 0,
    "none": 0,
    "needs_clarification": 0,
    "instruction_first_diff": 0,
}


def bump(action: str) -> None:
    with _lock:
        _COUNTERS[action] = _COUNTERS.get(action, 0) + 1


def counters_snapshot() -> dict[str, int]:
    with _lock:
        return dict(_COUNTERS)


def reset_counters() -> None:
    with _lock:
        for k in list(_COUNTERS.keys()):
            _COUNTERS[k] = 0


def log_request(
    *,
    gate_hint: str | None,
    raw_plan: dict[str, Any] | None,
    guard_action: str,
    final_intent: str,
    metric_id: str | None,
    metric_reason: str | None,
    scope_mode: str | None,
    instruction: str | None = None,
) -> None:
    bump(guard_action if guard_action in _COUNTERS else "none")
    _log.info(
        "instruction_first gate_hint=%s guard=%s intent=%s metric_id=%s reason=%s scope=%s instruction=%r plan=%s",
        gate_hint,
        guard_action,
        final_intent,
        metric_id,
        metric_reason,
        scope_mode,
        (instruction or "")[:200],
        raw_plan,
    )
