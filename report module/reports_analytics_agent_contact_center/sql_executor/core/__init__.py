"""SQL executor: certified KPI templates and rpt.* SQL."""

from .run_kpi import run_kpi
from .run_sql import run_sql

__all__ = ["run_kpi", "run_sql"]
