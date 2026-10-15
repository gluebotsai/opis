"""Create-campaign pipeline helpers — prompt-first; no post-turn auto orchestration."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def complete_create_campaign_highway(
    *,
    session_id: str,
    token: str,
    module: str,
    user_text: str = "",
    event_callback: Any = None,
) -> dict[str, Any]:
    """
    Deprecated no-op. Create-campaign flow is owned by Super → Creation domain → executors
    via agent.md prompts and tool calls; chat memory is ground truth.
    """
    _ = (session_id, token, module, user_text, event_callback)
    return {}


__all__ = ["complete_create_campaign_highway"]
