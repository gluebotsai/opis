"""email_content executor — template_library channel writer."""

from __future__ import annotations

from typing import Any

from app.mas.executors.shared.content_native import (
    is_native_content,
    run_native_content_executor,
)


async def run_email_content_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    if is_native_content():
        return await run_native_content_executor(ctx, "email_content")
    from app.mas.executors.shared.channel_content import run_channel_content_executor

    return await run_channel_content_executor("email_content", ctx)
