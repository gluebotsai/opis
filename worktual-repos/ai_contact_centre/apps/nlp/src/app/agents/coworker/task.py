"""Task co-worker agent."""

from app.agents.definitions import TASK_AGENT_DEFINITION
from app.runtime.agent import Agent


class TaskAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(TASK_AGENT_DEFINITION, **kwargs)
