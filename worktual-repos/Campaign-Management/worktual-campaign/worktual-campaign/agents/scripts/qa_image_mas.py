#!/usr/bin/env python3
"""Offline QA — Image MAS enhance gate and domain routing."""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import AsyncMock, patch

_ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _ok(label: str) -> None:
    print(f"  OK  {label}")


async def _main() -> int:
    from app.agents.image.enhance import is_unsafe_image_request, validate_enhanced_prompt
    from app.mas.catalog import executors_for_domain

    assert "image_generate" in executors_for_domain("image")
    _ok("catalog image executors")

    assert is_unsafe_image_request("nsfw porn banner") is True
    assert is_unsafe_image_request("professional email hero") is False
    _ok("safety term gate")

    ok, _ = validate_enhanced_prompt("banner", "short")
    assert ok is False
    _ok("structural validation")

    from app.agents.image.tools.handlers import dispatch_tool

    with patch(
        "app.agents.image.tools.handlers.get_or_create_session",
        new_callable=AsyncMock,
    ) as mock_sess, patch(
        "app.agents.image.tools.handlers.save_session",
        new_callable=AsyncMock,
    ):
        session = {"session_id": "qa-img", "module": "image", "mas_task": {"slots": {}}}
        mock_sess.return_value = session
        blocked = await dispatch_tool(
            "GENERATE_IMAGE",
            "qa-img",
            "tok",
            {"enhanced_prompt": "Only enhanced text without prior enhance call."},
        )
    assert blocked.get("ok") is False
    _ok("generate blocked without enhance")

    print("\nImage MAS QA passed.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
