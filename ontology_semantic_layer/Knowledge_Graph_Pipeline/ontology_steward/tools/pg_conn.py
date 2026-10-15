"""Shared Postgres connection factory for steward scan/eval."""

from __future__ import annotations

import os
from typing import Callable


def steward_pg_conn_factory() -> Callable | None:
    try:
        import psycopg2
    except ImportError:
        return None

    dsn = os.environ.get("STEWARD_PG_DSN") or os.environ.get("DATABASE_URL")
    if not dsn:
        return None

    def factory():
        return psycopg2.connect(dsn)

    return factory
