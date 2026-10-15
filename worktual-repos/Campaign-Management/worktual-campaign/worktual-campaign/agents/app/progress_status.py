"""Static / random in-process progress labels for WebSocket thinking_progress.

Emit from the function doing the work — never from the LLM reply.
"""

from __future__ import annotations

import random
from typing import Any, Awaitable, Callable

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]] | None

# Process → pool of user-facing labels (pick one at random per emit).
_PROGRESS_POOLS: dict[str, list[str]] = {
    "thinking": [
        "Thinking…",
        "Understanding your request…",
        "Working on that…",
    ],
    "filtering": [
        "Filtering audience…",
        "Matching contacts…",
        "Applying filters…",
    ],
    "calculating": [
        "Calculating reach…",
        "Checking counts…",
        "Summarizing matches…",
    ],
    "templates": [
        "Building templates…",
        "Generating content…",
        "Preparing campaign cards…",
    ],
    "launch": [
        "Preparing launch…",
        "Saving campaign…",
        "Finishing launch…",
    ],
    "analytics": [
        "Analyzing…",
        "Fetching metrics…",
        "Preparing report…",
    ],
    "contacts": [
        "Looking up contacts…",
        "Updating contact…",
        "Saving details…",
    ],
    "routing": [
        "Opening workspace…",
        "Switching view…",
    ],
}


def pick_progress_label(process: str) -> str:
    pool = _PROGRESS_POOLS.get(process) or _PROGRESS_POOLS["thinking"]
    return random.choice(pool)


def progress_steps(
    process: str,
    *,
    status: str = "active",
    extra_label: str | None = None,
) -> list[dict[str, str]]:
    label = (extra_label or "").strip() or pick_progress_label(process)
    return [{"id": process, "label": label, "status": status}]


async def emit_process_progress(
    event_callback: ProgressCallback,
    process: str,
    *,
    status: str = "active",
    extra_label: str | None = None,
) -> None:
    if not event_callback:
        return
    try:
        await event_callback(
            {
                "type": "thinking_progress",
                "payload": {
                    "status": status,
                    "steps": progress_steps(
                        process, status=status, extra_label=extra_label
                    ),
                },
            }
        )
    except Exception:  # noqa: BLE001
        pass
