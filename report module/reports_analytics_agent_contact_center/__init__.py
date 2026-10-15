"""Reports & Analytics Agent for Contact Center (V2 Architecture).

SQL runtime: sql_executor. KG runtime: kg_executor. Shared spine: core.
"""

from __future__ import annotations

from .core.facts import assemble_facts
from .core.loop import LoopState
from .core.time import resolve_expression
from .kg_executor.core.run_cypher import run_cypher
from .sql_executor.core.run_kpi import run_kpi
from .sql_executor.core.run_sql import run_sql

__all__ = [
    "run_kpi",
    "run_sql",
    "run_cypher",
    "assemble_facts",
    "LoopState",
    "resolve_expression",
]
