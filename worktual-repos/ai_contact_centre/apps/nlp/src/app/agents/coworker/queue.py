"""Queue co-worker agent."""

from app.agents.definitions import QUEUE_AGENT_DEFINITION
from app.runtime.agent import Agent


class QueueAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(QUEUE_AGENT_DEFINITION, **kwargs)
