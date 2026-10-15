"""Run LLM-written SQL through sql_guard + scoped rpt.* views."""

from __future__ import annotations

from typing import Any

from ..access import normalize_role
from .sql_guard import GuardError, guard_sql


def run_sql(
    sql: str,
    *,
    organization_id: int,
    user_id: int,
    branch_id: int,
    role: str,
    params: dict[str, Any] | None = None,
    dsn: str | None = None,
    row_cap: int = 500,
) -> dict[str, Any]:
    role = normalize_role(role)
    full_params = {
        "user_id": user_id,
        "organization_id": organization_id,
        "org_id": organization_id,
        "branch_id": branch_id,
    }
    if params:
        full_params.update(params)
    try:
        guarded = guard_sql(
            sql,
            role=role,
            organization_id=organization_id,
            user_id=user_id,
            branch_id=branch_id,
            params=full_params,
            row_cap=row_cap,
        )
    except GuardError as exc:
        msg = str(exc)
        low = msg.lower()

        import re

        from ..loader import PRODUCT_DIR
        from .views import _load

        try:
            views_dict, _ = _load(str(PRODUCT_DIR))
            all_views = set(views_dict.keys())
        except Exception:
            all_views = set()

        view_match = re.search(r"rpt\.([a-z0-9_]+)\s+is not available", low)
        is_real_denied_view = bool(view_match and view_match.group(1) in all_views)

        if is_real_denied_view or ("is not allowed" in low and ("use rpt." in low or "query only" in low)):
            error_type = "DENY"
        elif (
            "not in rpt." in low
            or "function" in low
            or "parameter" in low
            or "column" in low
            or "not available for this user" in low
            or "unknown dimension" in low
        ):
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
        "rows": [],
    }

    if dsn:
        from .. import db as pg
        from ..errors import public_message

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
