from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

IN_FLIGHT = (
    "requested",
    "joining",
    "awaiting_admission",
    "active",
    "stopping",
    "processing",
)
# Bot slots: live Chrome/Whisper bots. `requested` is queued and must not consume a slot.
BOT_SLOTS = (
    "joining",
    "awaiting_admission",
    "active",
    "stopping",
)
TERMINAL = ("completed", "completed_partial", "failed")

EntityType = Literal["contact", "deal", "team"]
ErrorCode = Literal[
    "not_admitted",
    "vexa_unavailable",
    "whisper_unavailable",
    "capacity",
    "evicted",
    "no_audio",
    "invalid_url",
    "llm_failed",
    "duplicate_provider",
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
