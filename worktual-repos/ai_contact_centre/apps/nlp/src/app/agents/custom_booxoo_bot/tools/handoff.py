"""Live agent tools for custom_booxoo_bot."""

from __future__ import annotations

from app.agents.custom_booxoo_bot.tools.base import Tool


def recommend_live_agent_handoff(_ctx, reason: str = "", **_kwargs):
    """Same signal as the contact-center support bot live-agent tool."""
    return {
        "ok": True,
        "handoff_recommended": True,
        "reason": (reason or "").strip() or "explicit_request",
    }


def handoff_tools() -> list[Tool]:
    return [
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "recommend_live_agent_handoff",
                    "description": (
                        "Call only when the customer explicitly asks to speak with a live agent, "
                        "human, or representative, or accepts an offer to be connected. "
                        "Do not call this because a knowledge search was empty."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {"reason": {"type": "string"}},
                        "required": [],
                    },
                },
            },
            recommend_live_agent_handoff,
        ),
    ]
