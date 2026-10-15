"""SQL analytics executor for Contact Center. Independent of the KG executor."""

from .core.run_kpi import run_kpi
from .core.run_sql import run_sql

__all__ = ["run_kpi", "run_sql"]
