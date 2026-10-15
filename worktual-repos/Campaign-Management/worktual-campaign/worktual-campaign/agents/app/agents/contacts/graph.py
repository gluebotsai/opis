"""Compatibility shim — prefer `app.agents.contacts.agent`."""

from app.agents.contacts.agent import (
    run_coordinator,
    get_graph,
    run_contacts_turn,
    _filter_contacts_tool_calls,
)

__all__ = [
    "run_coordinator",
    "get_graph",
    "run_contacts_turn",
    "_filter_contacts_tool_calls",
]

