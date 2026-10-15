"""search_knowledge MAS executor — context_layer KB lookup for create-campaign."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.create_campaign_native import run_native_create_executor

_PACKAGE = Path(__file__).resolve().parent


async def run_search_knowledge_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    return await run_native_create_executor(
        ctx, "search_knowledge", agent_md_dir=_PACKAGE
    )
