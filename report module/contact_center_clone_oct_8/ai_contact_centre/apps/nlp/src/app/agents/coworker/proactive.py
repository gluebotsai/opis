"""Thin proactive coworker agent wrapper (headless, not chat-routed)."""

from app.agents.definitions import PROACTIVE_AGENT_DEFINITION
from app.runtime.agent import Agent


class ProactiveAgent(Agent):
    def __init__(self, **kwargs):
        super().__init__(PROACTIVE_AGENT_DEFINITION, **kwargs)
