"""Campaign A2A spoke package."""

from app.a2a.card import (
    build_agent_card,
    build_extended_agent_card,
    build_public_agent_card,
)
from app.a2a.escalate import build_remainder_body, send_remainder_to_hub

__all__ = [
    "build_agent_card",
    "build_extended_agent_card",
    "build_public_agent_card",
    "build_remainder_body",
    "send_remainder_to_hub",
]
