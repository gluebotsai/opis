"""Compose pipeline — delegates to the domain dispatcher."""

from __future__ import annotations

from typing import Any

from app.mas.phase2_compose.dispatcher import dispatch_compose


async def run_compose_pipeline(ctx: dict[str, Any]) -> dict[str, Any]:
    return await dispatch_compose(ctx)
