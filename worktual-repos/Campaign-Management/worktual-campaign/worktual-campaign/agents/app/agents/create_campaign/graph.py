"""Compatibility shim — prefer `app.agents.create_campaign.agent`."""

from app.agents.create_campaign.agent import (
    get_graph,
    run_coordinator,
    run_create_campaign_turn,
)
from app.agents.create_campaign.prompts import welcome_text

__all__ = [
    "get_graph",
    "run_coordinator",
    "run_create_campaign_turn",
    "welcome_text",
]
