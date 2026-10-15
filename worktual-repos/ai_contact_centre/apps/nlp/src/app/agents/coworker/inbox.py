"""Inbox co-worker agent."""

from app.agents.definitions import INBOX_AGENT_DEFINITION
from app.runtime.agent import Agent


class InboxAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(INBOX_AGENT_DEFINITION, **kwargs)
