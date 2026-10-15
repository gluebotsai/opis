"""Run LLM-written SQL through sql_guard + scoped rpt.* virtual views for B2B CRM.

Enforces role-based virtual views, scopes, masks, function allowlists,
and row limits.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.agents.reports_b2b.core.db import fetch_warehouse_rows
from app.agents.reports_b2b.core.loader import PRODUCT_DIR
from app.agents.reports_b2b.core.name_ilike import rewrite_name_predicates
from app.agents.reports_b2b.core.sql_guard import GuardError, guard_sql


def run_sql(
    sql: str,
    *,
    organization_id: int = 1003,
    user_id: int = 1017,
    role: str = "admin",
    queue_ids: list[int] | None = None,
    params: dict[str, Any] | None = None,
    dsn: str | None = None,
    row_cap: int = 500,
    product_dir: Path = PRODUCT_DIR,
    view_scope_overrides: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Guard and execute one LLM-written SQL statement with virtual rpt.* CTE scoping."""
    del queue_ids
    full_params = {
        "user_id": user_id,
        "organization_id": organization_id,
        "org_id": organization_id,
        "tenant_id": organization_id,
        "current_user_id": user_id,
    }
    if params:
        full_params.update(params)

    sql = rewrite_name_predicates(sql)

    try:
        guarded = guard_sql(
            sql,
            role=role,
            organization_id=organization_id,
            user_id=user_id,
            params=full_params,
            row_cap=row_cap,
            product_dir=product_dir,
            view_scope_overrides=view_scope_overrides,
        )
    except GuardError as exc:
        msg = str(exc)
        low = msg.lower()
        if "is not available for role" in low or "is not allowed" in low:
            error_type = "DENY"
        elif "not in rpt." in low or "function" in low or "parameter" in low or "column" in low:
            error_type = "REPAIR"
        else:
            error_type = "REPLAN"
        return {
            "status": "error",
            "store": "sql",
            "error_type": error_type,
            "error": msg,
            "rows": [],
            "sql": "",
        }

    out: dict[str, Any] = {
        "status": "compiled",
        "store": "sql",
        "sql": guarded.sql,
        "views": guarded.views,
        "guard_notes": guarded.notes,
        "bound_params": guarded.params,
        "rows": [],
    }

    try:
        out["rows"] = fetch_warehouse_rows(
            guarded.sql,
            guarded.params,
            dsn=dsn,
            statement_timeout="15s",
        )
        out["status"] = "ok"
    except Exception as exc:
        msg = str(exc)
        if re.search(
            r"no module named|modulenotfounderror|psycopg|could not connect|connection refused",
            msg,
            re.I,
        ):
            msg = "Analytics warehouse is unavailable"
        out["status"] = "error"
        out["error"] = msg
        out["error_type"] = "REPAIR"

    return out


def execute_sql(
    sql_query: str,
    params: Optional[Dict[str, Any]] = None,
    allowed_views: Optional[set] = None,
) -> List[Dict[str, Any]]:
    """Safely executes raw parameter-bound SQL query against PostgreSQL warehouse."""
    del allowed_views
    pg_sql = re.sub(r"(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)", r"%(\1)s", sql_query)
    return fetch_warehouse_rows(pg_sql, params, statement_timeout="15s")
