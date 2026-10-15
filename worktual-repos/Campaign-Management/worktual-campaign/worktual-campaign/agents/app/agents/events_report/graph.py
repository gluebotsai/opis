"""Compatibility shim — prefer `app.agents.events_report.agent`."""

from app.agents.events_report.agent import (
    run_coordinator,
    get_graph,
    run_events_report_turn,
)

__all__ = [
    "run_coordinator",
    "get_graph",
    "run_events_report_turn",
]

