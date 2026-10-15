"""Agents package for NLP service."""

from app.agents.coworker import (
    AnalyticsAgent,
    ContactAgent,
    GeneralAgent,
    InboxAgent,
    QueueAgent,
    TaskAgent,
    create_coworker_agent,
)

__all__ = [
    "AnalyticsAgent",
    "ContactAgent",
    "GeneralAgent",
    "InboxAgent",
    "QueueAgent",
    "SupportBotAgent",
    "TaskAgent",
    "create_coworker_agent",
]


def __getattr__(name: str) -> object:
    if name == "SupportBotAgent":
        from app.agents.support_bot import SupportBotAgent

        return SupportBotAgent
    raise AttributeError(name)
