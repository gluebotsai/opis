"""Redact secrets and pretty-print payloads for observability logs."""

from __future__ import annotations

import json
import re
from typing import Any

_SECRET_RE = re.compile(
    r"(password|secret|token|api[_-]?key|authorization|credential|client_secret|"
    r"refresh_token|access_token|mcp[_-]?execution)",
    re.I,
)

_MAX_TOOL_CHARS = 6000
_MAX_REPLY_CHARS = 8000


def _key_sensitive(key: Any) -> bool:
    return bool(_SECRET_RE.search(str(key)))


def redact(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return "…"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in list(value.items())[:64]:
            if _key_sensitive(key):
                out[str(key)] = "***"
            else:
                out[str(key)] = redact(item, depth=depth + 1)
        return out
    if isinstance(value, list):
        return [redact(item, depth=depth + 1) for item in value[:48]]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    text = str(value)
    return text if len(text) <= 800 else text[:799] + "…"


def clip_text(text: str, *, limit: int = _MAX_TOOL_CHARS) -> str:
    raw = (text or "").strip()
    if len(raw) <= limit:
        return raw
    return raw[: limit - 1] + f"… [truncated {len(raw) - limit + 1} chars]"


def pretty_payload(value: Any, *, indent: int = 2) -> str:
    cleaned = redact(value)
    if isinstance(cleaned, str):
        stripped = cleaned.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                cleaned = json.loads(stripped)
            except json.JSONDecodeError:
                return clip_text(stripped)
        else:
            return clip_text(stripped)
    try:
        text = json.dumps(cleaned, ensure_ascii=False, indent=indent, default=str)
    except (TypeError, ValueError):
        text = str(cleaned)
    return clip_text(text)


def indent_block(text: str, spaces: int) -> str:
    pad = " " * spaces
    lines = (text or "").splitlines() or [""]
    return "\n".join(pad + line for line in lines)
