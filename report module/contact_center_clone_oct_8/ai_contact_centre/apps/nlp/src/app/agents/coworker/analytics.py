"""Analytics co-worker agent."""

from app.agents.definitions import ANALYTICS_AGENT_DEFINITION
from app.runtime.agent import Agent


class AnalyticsAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(ANALYTICS_AGENT_DEFINITION, **kwargs)
