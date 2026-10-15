"""Run LLM-written SQL through sql_guard + scoped rpt.* views."""

from __future__ import annotations

from typing import Any

from ..access import AccessDenied, assert_scope_allowed, normalize_role, normalize_scope_level
from ..errors import public_message
from ..loader import PRODUCT_DIR, merge_effective
from .sql_guard import GuardError, guard_sql


def run_sql(
    sql: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int] | None = None,
    scope_level: str = "org",
    params: dict[str, Any] | None = None,
    dsn: str | None = None,
    row_cap: int = 500,
) -> dict[str, Any]:
    catalog = merge_effective(organization_id)
    access = catalog["access"]
    role = normalize_role(role, access)
    scope_level = normalize_scope_level(scope_level, role, access)
    queue_ids = list(queue_ids or [])
    try:
        assert_scope_allowed(role, scope_level, access)
        if scope_level == "queue" and not queue_ids:
            raise AccessDenied("scope_denied: queue scope requires queue_ids from the UI.")
    except AccessDenied as exc:
        return {
            "status": "error",
            "store": "sql",
            "error_type": "DENY",
            "error": str(exc),
            "rows": [],
            "sql": "",
            "certified": False,
        }

    user_params = dict(params or {})
    try:
        guarded = guard_sql(
            sql,
            role=role,
            organization_id=organization_id,
            user_id=user_id,
            queue_ids=queue_ids,
            params=user_params,
            row_cap=row_cap,
            product_dir=PRODUCT_DIR,
            apply_row_cap=True,
        )
    except GuardError as exc:
        msg = str(exc)
        low = msg.lower()
        if "is not available for this user" in low or ("is not allowed" in low and "rpt." in low):
            error_type = "DENY"
        else:
            error_type = "REPAIR"
        return {
            "status": "error",
            "store": "sql",
            "error_type": error_type,
            "error": msg,
            "rows": [],
            "sql": "",
            "certified": False,
        }

    out: dict[str, Any] = {
        "status": "compiled",
        "store": "sql",
        "sql": guarded.sql,
        "views": guarded.views,
        "guard_notes": guarded.notes,
        "certified": False,
        "rows": [],
    }
    if dsn:
        from .. import db as pg

        try:
            out["rows"] = pg.fetchall(dsn, guarded.sql, guarded.params)
            out["status"] = "ok"
            out["row_cap"] = row_cap
            out["capped"] = len(out["rows"]) >= row_cap
        except Exception as exc:
            out["status"] = "error"
            out["error_type"] = "REPLAN"
            out["error"] = public_message(exc)
    return out
