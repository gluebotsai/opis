"""Compatibility shim — prefer `app.agents.reports.agent`."""

from app.agents.reports.agent import (
    run_coordinator,
    get_graph,
    run_reports_turn,
)

__all__ = [
    "run_coordinator",
    "get_graph",
    "run_reports_turn",
]

