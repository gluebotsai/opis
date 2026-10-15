"""Compatibility shim — prefer `app.agents.recommendations.agent`."""

from app.agents.recommendations.agent import (
    run_coordinator,
    get_graph,
    run_recommendations_turn,
)

__all__ = [
    "run_coordinator",
    "get_graph",
    "run_recommendations_turn",
]

