"""Isolated SQL Super agent — Gemma plan/execute, warehouse SELECT, KPI templates.

Keep this module lazy: ``semantic.scope`` imports ``sql_agent.ticketing_scope``
during API startup. Eagerly importing ``sql_agent.super`` here cycles back into
``semantic.scope`` before ``UserScope`` exists.
"""

from sql_agent.errors import SqlAgentError, WarehouseUnavailableError

__all__ = ["SqlAgentError", "WarehouseUnavailableError", "execute_sql_query"]


def __getattr__(name: str):
    if name == "execute_sql_query":
        from sql_agent.super import execute_sql_query

        return execute_sql_query
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
