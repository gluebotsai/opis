"""Prior turns for supervisor/specialist. Not used to classify intent."""

from __future__ import annotations

from typing import Any

MAX_HISTORY = 8
MAX_HISTORY_CHARS = 2000


def history_messages(history: list[Any] | None) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for item in (history or [])[-MAX_HISTORY:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip()
        content = str(item.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append({"role": role, "content": content[:MAX_HISTORY_CHARS]})
    return messages
