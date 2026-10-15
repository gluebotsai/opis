"""Compatibility shim — prefer `app.agents.forms.agent`."""

from app.agents.forms.agent import (
    run_coordinator,
    get_graph,
    run_forms_turn,
)

__all__ = [
    "run_coordinator",
    "get_graph",
    "run_forms_turn",
]

