"""Runtime hooks (auth/audit/tracing placeholders)."""

from __future__ import annotations

from typing import Any, Callable


Hook = Callable[[dict[str, Any]], None]


def run_hooks(hooks: list[Hook] | None, event: dict[str, Any]) -> None:
    for hook in hooks or []:
        try:
            hook(event)
        except Exception:
            continue
