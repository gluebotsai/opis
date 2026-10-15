"""Monitoring co-worker agent."""

from app.agents.definitions import MONITORING_AGENT_DEFINITION
from app.runtime.agent import Agent


class MonitoringAgent(Agent):
    def __init__(self, **kwargs: object) -> None:
        super().__init__(MONITORING_AGENT_DEFINITION, **kwargs)
