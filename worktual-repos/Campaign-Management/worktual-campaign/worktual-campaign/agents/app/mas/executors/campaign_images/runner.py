"""Campaign Images Executor — batch plan / generate / attach."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.image_native import run_native_image_executor

_PACKAGE = Path(__file__).resolve().parent


async def run_campaign_images_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    return await run_native_image_executor(ctx, "campaign_images", agent_md_dir=_PACKAGE)
