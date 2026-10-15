"""Image Generation Executor — deprecated alias → image_generate."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_image_generation_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    """Legacy content-domain id; delegates to Image domain image_generate."""
    meta = package_agent_md(_PACKAGE)
    from app.mas.executors.image_generate.runner import run_image_generate_executor

    out = await run_image_generate_executor(ctx)
    out["agent_id"] = "image_generation"
    out["deprecated_alias"] = "image_generate"
    out["agent_md_loaded"] = not meta.get("missing")
    return out
