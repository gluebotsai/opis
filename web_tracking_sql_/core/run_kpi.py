"""Fill a certified KPI template and run it against Postgres.

Decision: If task.kpi is set, ONLY run_kpi is accepted.
If template cannot satisfy the request -> error_type: REPLAN.
If scope or permission is denied -> error_type: DENY.
"""

from __future__ import annotations

from typing import Any

from .access import AccessDenied, Identity
from .loader import merge_effective
from .templates import fill_slots

TIME_COLUMNS: dict[str, str] = {
    "note_count": "n.created_at",
    "escalation_count": "ae.created_at",
    "reassignment_count": "ae.created_at",
    "accounts_served": "base_ticket.created_at",
    "active_customers": "base_ticket.created_at",
    "distinct_agents_in_queues": "a.created_at",
    "distinct_queues_covered": "q.created_at",
}

SCOPE_OWN_COLUMNS: dict[str, str] = {
    "unread_notifications": "user_id",
}


def run_kpi(
    kpi_id: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int] | None = None,
    scope_level: str = "org",
    target_ids: list[int] | None = None,
    time_start: str | None = None,
    time_end: str | None = None,
    date_column: str | None = None,
    slot_values: dict[str, str] | None = None,
    dsn: str | None = None,
    dimension: str | None = None,
    time_window: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    """Fill the certified template for kpi_id, enforce role scope, and optionally execute.

    Returns:
      {
        "status": "ok" | "compiled" | "error",
        "store": "sql",
        "kpi_id": kpi_id,
        "error_type": "DENY" | "REPLAN" (on error),
        "error": message,
        "sql": compiled SQL,
        "rows": [...]
      }
    """
    queue_ids = list(queue_ids or [])
    catalog = merge_effective(organization_id)
    kpis = catalog.get("kpis") or {}
    sql_files = catalog.get("sql_files") or {}

    if kpi_id not in kpis or kpi_id not in sql_files:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPLAN",
            "error": f"kpi_not_found: {kpi_id} is not in the certified KPI index.",
            "rows": [],
        }

    card = kpis[kpi_id]
    allowed_levels = card.get("allowed_scope_levels") or []
    if allowed_levels and scope_level not in allowed_levels:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": f"scope_denied: KPI '{kpi_id}' does not allow scope '{scope_level}'.",
            "rows": [],
        }

    # Verify role permissions for scope_level
    access = catalog["access"]
    matrix = access.get("matrix") or {}
    grant = (matrix.get(scope_level) or {}).get(role, "deny")
    if grant == "deny":
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": f"scope_denied: role '{role}' is denied scope '{scope_level}'.",
            "rows": [],
        }
    if grant == "ticket_count_only" and kpi_id != "ticket_count":
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": f"scope_denied: role '{role}' is only permitted 'ticket_count' at scope '{scope_level}'.",
            "rows": [],
        }

    # Compute scope SQL
    org_id = int(organization_id)
    org_str = str(org_id)
    role_meta = (access.get("roles") or {}).get(role) or {}

    scope_sql = "TRUE"
    if scope_level == "own":
        col = SCOPE_OWN_COLUMNS.get(kpi_id) or role_meta.get("my_tickets_column", "assignee_id")
        scope_sql = f"{col} = {int(user_id)}"
    elif scope_level == "created_by_me":
        col = role_meta.get("created_by_me_column")
        if not col or col == "deny":
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": kpi_id,
                "error_type": "DENY",
                "error": f"scope_denied: created_by_me not allowed for role '{role}'.",
                "rows": [],
            }
        scope_sql = f"{col} = {int(user_id)}"
    elif scope_level == "queue":
        q_ids = target_ids or queue_ids
        if grant in ("all_in_my_queues", "ticket_count_only"):
            # Agent / Resolver: restrict to their own queues
            allowed = set(queue_ids or [])
            if not allowed:
                return {
                    "status": "error",
                    "store": "sql",
                    "kpi_id": kpi_id,
                    "error_type": "DENY",
                    "error": f"scope_denied: role '{role}' has no queues in context.",
                    "rows": [],
                }
            ids = set(q_ids or allowed)
            if not ids.issubset(allowed):
                return {
                    "status": "error",
                    "store": "sql",
                    "kpi_id": kpi_id,
                    "error_type": "DENY",
                    "error": f"scope_denied: requested queue(s) not in your queue set.",
                    "rows": [],
                }
            in_q = ", ".join(str(int(q)) for q in sorted(ids))
            scope_sql = f"queue_id IN ({in_q})"
        else:
            # Admin: any queue
            if not q_ids:
                scope_sql = "FALSE"
            else:
                in_q = ", ".join(str(int(q)) for q in q_ids)
                scope_sql = f"queue_id IN ({in_q})"
    elif scope_level in {"agent", "resolver"}:
        col = "assignee_id" if scope_level == "agent" else "resolver_id"
        if grant == "all_in_my_queues":
            # Agent viewing resolver scope: restricted to resolvers in their queues
            allowed = set(queue_ids)
            if not allowed:
                return {
                    "status": "error",
                    "store": "sql",
                    "kpi_id": kpi_id,
                    "error_type": "DENY",
                    "error": f"scope_denied: role '{role}' has no queues in context.",
                    "rows": [],
                }
            scope_sql = f"queue_id = ANY(ARRAY[{', '.join(str(int(q)) for q in sorted(allowed))}])"
        else:
            # Admin: specific target IDs
            if not target_ids:
                scope_sql = "FALSE"
            else:
                in_ids = ", ".join(str(int(i)) for i in target_ids)
                scope_sql = f"{col} IN ({in_ids})"
    elif scope_level == "org":
        scope_sql = "TRUE"

    # Time bounds SQL
    date_col = date_column or TIME_COLUMNS.get(kpi_id) or card.get("default_time_column") or "created_at"
    time_sql = "TRUE"
    if time_start and time_end:
        time_sql = f"({date_col} >= TIMESTAMPTZ '{time_start}' AND {date_col} < TIMESTAMPTZ '{time_end}')"

    # Dynamic window_days calculation from UTC bounds
    window_days_val = None
    if time_start and time_end:
        try:
            from datetime import datetime
            t_s = datetime.fromisoformat(time_start.replace("Z", "+00:00"))
            t_e = datetime.fromisoformat(time_end.replace("Z", "+00:00"))
            diff = (t_e - t_s).total_seconds() / 86400.0
            if diff > 0:
                window_days_val = max(1, round(diff))
        except Exception:
            pass

    window_days_str = str(window_days_val) if window_days_val is not None else "1"
    window_days_sql = str(window_days_val) if window_days_val is not None else "1"

    # Merge caller slot values with computed values
    slots = {
        "org_id": org_str,
        "tenant_sql": f"organization_id = {org_str}",
        "scope_sql": scope_sql,
        "time_sql": time_sql,
        "segment_sql": "TRUE",
        "filters_sql": "TRUE",
        "dimension_select": "",
        "group_by_sql": "",
        "window_days": window_days_str,
        "window_days_sql": window_days_sql,
        "limit_sql": "",
    }
    if slot_values:
        slots.update(slot_values)
        slots["org_id"] = org_str  # org_id is always strictly authoritative

    raw_sql = sql_files[kpi_id].read_text()
    base_ticket = catalog.get("base_ticket_sql")
    try:
        compiled = fill_slots(raw_sql, slots, base_ticket=base_ticket if "{{base_ticket}}" in raw_sql else None)
        # Lightweight read-only check — certified templates are generated by Python, not the LLM.
        _head = compiled.strip().lower()
        if not (_head.startswith("select") or _head.startswith("with")):
            raise ValueError("Compiled KPI SQL must be a SELECT or WITH statement.")
    except Exception as exc:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPLAN",
            "error": f"kpi_template_slot_error: {exc}",
            "rows": [],
        }

    out: dict[str, Any] = {
        "status": "compiled",
        "store": "sql",
        "kpi_id": kpi_id,
        "sql": compiled,
        "rows": [],
    }

    if dsn:
        from . import db as pg
        from .errors import public_message

        try:
            out["rows"] = pg.fetchall(dsn, compiled, ())
            out["status"] = "ok"
        except Exception as exc:
            out["status"] = "error"
            out["error_type"] = "REPLAN"
            out["error"] = public_message(exc)

    return out
