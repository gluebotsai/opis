"""Agents package for NLP service."""

from app.agents.coworker import (
    ContactAgent,
    GeneralAgent,
    InboxAgent,
    QueueAgent,
    ReportsAnalyticsAgent,
    TaskAgent,
    create_coworker_agent,
)

__all__ = [
    "ContactAgent",
    "GeneralAgent",
    "InboxAgent",
    "QueueAgent",
    "ReportsAnalyticsAgent",
    "SupportBotAgent",
    "TaskAgent",
    "create_coworker_agent",
]


def __getattr__(name: str) -> object:
    if name == "SupportBotAgent":
        from app.agents.support_bot import SupportBotAgent

        return SupportBotAgent
    if name == "reports_analytics_agent":
        import importlib

        return importlib.import_module("app.agents.reports_analytics_agent")
    raise AttributeError(name)
