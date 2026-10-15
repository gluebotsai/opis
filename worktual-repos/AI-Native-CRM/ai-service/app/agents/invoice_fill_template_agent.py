"""Invoice document fill in learned template layout."""

from __future__ import annotations

from typing import Any

from app.agents.commercial_fill_template_agent import run_for_kind


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    return await run_for_kind(body or {}, "invoice")
