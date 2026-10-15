"""General / navigation specialist agent."""

from app.agents.base import run_specialist
from app.state import AgentState


def general_agent(state: AgentState) -> dict:
    """Answer general help and navigation questions."""
    return run_specialist("general", state)
