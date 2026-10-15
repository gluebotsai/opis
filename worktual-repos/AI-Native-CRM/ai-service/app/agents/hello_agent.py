from __future__ import annotations

from typing import Any


async def run(message: str | None = None) -> dict[str, Any]:
    """Read-only probe agent — confirms the gateway is alive."""
    return {
        "ok": True,
        "agent": "hello",
        "message": message or "hello from ai-service",
    }
