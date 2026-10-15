"""Worktual DQL SQL developer experiment."""

from sql_agent.catalog import Catalog, load_catalog
from sql_agent.planner import SqlPlanner
from sql_agent.tools import SqlAgentTools

__all__ = ["Catalog", "SqlAgentTools", "SqlDeveloperAgent", "SqlPlanner", "load_catalog"]


def __getattr__(name: str):
    if name == "SqlDeveloperAgent":
        from sql_agent.agent import SqlDeveloperAgent

        return SqlDeveloperAgent
    raise AttributeError(name)
