"""Contact co-worker agent."""

from app.agents.definitions import CONTACT_AGENT_DEFINITION
from app.runtime.agent import Agent


class ContactAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(CONTACT_AGENT_DEFINITION, **kwargs)
