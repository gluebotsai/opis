"""Campaign Content Executor — native build_campaign persistence."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.create_campaign_native import run_native_create_executor

_PACKAGE = Path(__file__).resolve().parent


async def run_campaign_content_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    return await run_native_create_executor(ctx, "campaign_content", agent_md_dir=_PACKAGE)
