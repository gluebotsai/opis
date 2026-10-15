"""Compatibility shim — prefer `app.agents.whatsapp_approved.agent`."""

from app.agents.whatsapp_approved.agent import (
    run_coordinator,
    get_graph,
    run_whatsapp_approved_turn,
)

__all__ = [
    "run_coordinator",
    "get_graph",
    "run_whatsapp_approved_turn",
]

