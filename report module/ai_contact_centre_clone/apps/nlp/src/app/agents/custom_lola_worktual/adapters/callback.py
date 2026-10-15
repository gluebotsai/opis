"""Sync wrapper for bot callback creation."""

from __future__ import annotations

import asyncio
from typing import Any

from app.agents.custom_lola_worktual.adapters.cc_core_client import create_bot_callback
from app.config import get_settings


def request_bot_callback(
    organization_id: str,
    conversation_id: str,
    *,
    summary: str,
    notes: str | None = None,
    preferred_time: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    assigned = settings.custom_lola_worktual_callback_assignee_user_id.strip()
    if not assigned:
        return {"error": "Callback assignee is not configured"}

    async def _run() -> dict[str, Any]:
        return await create_bot_callback(
            organization_id,
            conversation_id,
            summary=summary,
            notes=notes,
            preferred_time=preferred_time,
            assigned_user_id=assigned,
        )

    try:
        return asyncio.run(_run())
    except Exception as exc:
        return {"error": str(exc)}
