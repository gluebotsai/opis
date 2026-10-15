"""General co-worker agent."""

from app.agents.definitions import GENERAL_AGENT_DEFINITION
from app.runtime.agent import Agent


class GeneralAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(GENERAL_AGENT_DEFINITION, **kwargs)
