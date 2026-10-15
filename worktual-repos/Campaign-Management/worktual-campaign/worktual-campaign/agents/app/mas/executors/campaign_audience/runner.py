"""Campaign Audience Executor — native check/create/upload/update contact tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.create_campaign_native import run_native_create_executor

_PACKAGE = Path(__file__).resolve().parent


async def run_campaign_audience_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    return await run_native_create_executor(ctx, "campaign_audience", agent_md_dir=_PACKAGE)
