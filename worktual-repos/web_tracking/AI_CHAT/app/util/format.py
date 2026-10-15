"""Display formatting for analytics answers (no routing logic)."""

from __future__ import annotations

from typing import Any


def format_duration_seconds(value: Any) -> str:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return str(value)
    if seconds < 60:
        return f"{seconds:.0f}s"
    minutes = int(seconds // 60)
    rem = int(seconds % 60)
    if minutes < 60:
        return f"{minutes}m {rem}s"
    hours = minutes // 60
    minutes = minutes % 60
    return f"{hours}h {minutes}m"
