"""Fill a certified KPI template and run it against Postgres for Contact Center.

Decision: If task.kpi is set, ONLY run_kpi is accepted.
If template cannot satisfy the request -> error_type: REPLAN.
If scope or permission is denied -> error_type: DENY.
"""

from __future__ import annotations

from typing import Any

from reports_analytics_agent_contact_center.core.access import AccessDenied, Identity
from .loader import merge_effective
from .templates import dimension_slots, fill_slots, normalize_dimension

TIME_COLUMNS: dict[str, str] = {
    "message_count": "m.created_at",
    "avg_messages_per_conversation": "m.created_at",
    "transfer_count": "ct.requested_at",
    "escalation_count": "t.created_at",
    "callback_completion_rate": "t.created_at",
    "avg_offer_ring_time": "offered_at",
    "avg_handle_time_voice": "to_timestamp(c.session_start_time / 1000.0)",
    "avg_hold_time": "to_timestamp(c.session_start_time / 1000.0)",
    "avg_wait_time": "created_at",
    "call_count": "created_at",
    "offer_timeout_rate": "offered_at",
    "offer_accept_rate": "offered_at",
    "missed_contact_count": "m.missed_at",
    "routing_attempt_success_rate": "ra.created_at",
    "overflow_rate": "ra.created_at",
    "agent_occupancy": "p.started_at",
    "login_hours": "p.started_at",
    "presence_reason_breakdown": "p.started_at",
    "bot_turn_count": "t.created_at",
    "bot_intent_distribution": "t.created_at",
    "bot_intent_confidence_avg": "t.created_at",
    "bot_grounded_rate": "t.created_at",
    "bot_response_latency_avg": "t.created_at",
    "copilot_acceptance_rate": "ct.created_at",
    "copilot_usage_count": "ct.created_at",
    "copilot_tool_success_rate": "e.created_at",
    "copilot_latency_avg": "ct.created_at",
    "sentiment_trend": "st.created_at",
    "negative_sentiment_rate": "st.created_at",
    "avg_breach_duration": "resolution_due_at",
}

SCOPE_OWN_COLUMNS: dict[str, str] = {
    "agent_occupancy": "p.agent_id",
    "login_hours": "p.agent_id",
    "presence_reason_breakdown": "p.agent_id",
    "concurrency_utilization": "ac.agent_id",
    "callback_completion_rate": "t.assigned_user_id",
    "missed_contact_count": "m.agent_id",
    "missed_contact_rate": "agent_id",
    "call_count": "assigned_agent_id",
    "transfer_count": "from_agent_id",
    "offer_timeout_rate": "agent_id",
    "offer_accept_rate": "agent_id",
    "avg_offer_ring_time": "agent_id",
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
    """Fill the certified template for kpi_id, enforce role scope, and execute or compile.

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
    requested_dim = extra.get("dimension", dimension)
    allowed_dims = card.get("allowed_dimensions") or []
    dim = normalize_dimension(requested_dim, allowed_dims)
    if requested_dim not in (None, "", "null", "none") and dim is None:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPLAN",
            "error": (
                f"unknown dimension '{requested_dim}' for KPI '{kpi_id}'. "
                f"Allowed: {', '.join(str(d) for d in allowed_dims) or '(none)'}."
            ),
            "rows": [],
        }

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

    # Compute scope SQL
    org_id = int(organization_id)
    org_str = str(org_id)
    role_meta = (access.get("roles") or {}).get(role) or {}

    scope_sql = "TRUE"
    if scope_level == "own":
        col = SCOPE_OWN_COLUMNS.get(kpi_id) or role_meta.get("my_conversations_column", "assigned_agent_id")
        scope_sql = f"{col} = {int(user_id)}"
    elif scope_level == "queue":
        q_ids = target_ids or queue_ids
        if grant == "all_in_my_queues":
            # Agent: restrict to own queues
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
            ids = set(q_ids or allowed)
            if not ids.issubset(allowed):
                return {
                    "status": "error",
                    "store": "sql",
                    "kpi_id": kpi_id,
                    "error_type": "DENY",
                    "error": "scope_denied: requested queue(s) not in your queue set.",
                    "rows": [],
                }
            in_q = ", ".join(str(int(q)) for q in sorted(ids))
            scope_sql = f"queue_id IN ({in_q})"
        else:
            # Admin: any queue
            if not q_ids:
                scope_sql = "TRUE"
            else:
                in_q = ", ".join(str(int(q)) for q in q_ids)
                scope_sql = f"queue_id IN ({in_q})"
    elif scope_level == "agent":
        col = "assigned_agent_id"
        if not target_ids:
            scope_sql = "TRUE"
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

    # Compute window days
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
    if window_days_val is not None:
        window_days_sql = str(window_days_val)
    else:
        window_days_sql = "GREATEST(1, (CURRENT_DATE - MIN(created_at)::date) + 1)"

    dim_slots = dimension_slots(dim, str(date_col), kpi_id=kpi_id)
    if time_start and time_end:
        returning_predicate = f"cs.first_at < TIMESTAMPTZ '{time_start}'"
    else:
        returning_predicate = "cs.convos > 1"

    # Merge caller slot values with computed values
    slots = {
        "org_id": org_str,
        "tenant_sql": f"organization_id = {org_str}",
        "scope_sql": scope_sql,
        "time_sql": time_sql,
        "time_start": time_start or "1970-01-01T00:00:00Z",
        "time_end": time_end or "2099-01-01T00:00:00Z",
        "segment_sql": "TRUE",
        "filters_sql": "TRUE",
        "window_days": window_days_str,
        "window_days_sql": window_days_sql,
        "returning_predicate": returning_predicate,
        "limit_sql": "",
        **dim_slots,
    }
    if slot_values:
        slots.update(slot_values)
        slots["org_id"] = org_str  # org_id is authoritative
        if dim:
            slots.update(dim_slots)

    raw_sql = sql_files[kpi_id].read_text()
    base_conv = catalog.get("base_conversation_sql")
    if base_conv and "{{base_conversation}}" in raw_sql:
        inlined_base = base_conv.replace("{org_id}", org_str).replace("{{org_id}}", org_str)
        raw_sql = raw_sql.replace("{{base_conversation}}", inlined_base)
    raw_sql = raw_sql.replace("{org_id}", org_str)

    compiled = fill_slots(raw_sql, slots)

    # Lightweight check
    compiled_lower = compiled.strip().lower()
    if not (compiled_lower.startswith("select") or compiled_lower.startswith("with")):
        raise ValueError("Compiled KPI SQL must be a SELECT")

    out: dict[str, Any] = {
        "status": "compiled",
        "store": "sql",
        "kpi_id": kpi_id,
        "sql": compiled,
        "rows": [],
        "dimension": dim,
    }

    if dsn:
        from . import db as pg
        from reports_analytics_agent_contact_center.core.errors import public_message

        try:
            out["rows"] = pg.fetchall(dsn, compiled, ())
            out["status"] = "ok"
        except Exception as exc:
            out["status"] = "error"
            out["error_type"] = "REPLAN"
            out["error"] = public_message(exc)

    return out
