"""Image Refine Executor — ENHANCE → REFINE native loop."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.image_native import is_native_image, run_native_image_executor

_PACKAGE = Path(__file__).resolve().parent


async def run_image_refine_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    if is_native_image():
        return await run_native_image_executor(ctx, "image_refine", agent_md_dir=_PACKAGE)
    return {
        "ok": False,
        "action_status": "failed",
        "kind": "executor",
        "agent_id": "image_refine",
        "error": "MAS_IMAGE_NATIVE must be enabled",
    }
