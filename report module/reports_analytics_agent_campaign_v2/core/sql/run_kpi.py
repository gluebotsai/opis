"""Fill a certified Campaign KPI template and run it."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ..access import normalize_role, normalize_scope_level
from ..loader import merge_effective
from .templates import dimension_slots, fill_slots


ADMIN_ONLY_GRANT = "admin_only"


def run_kpi(
    kpi_id: str,
    *,
    organization_id: int,
    user_id: int,
    branch_id: int,
    role: str,
    scope_level: str = "org",
    time_start: str | None = None,
    time_end: str | None = None,
    date_column: str | None = None,
    slot_values: dict[str, str] | None = None,
    dsn: str | None = None,
    dimension: str | None = None,
    dimensions: list[str] | None = None,
    time_window: str | None = None,
    **extra: Any,
) -> dict[str, Any]:
    role = normalize_role(role)
    scope_level = normalize_scope_level(scope_level, role)
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
    if card.get("admin_only") and role != "admin":
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": f"scope_denied: KPI '{kpi_id}' is administrator-only.",
            "rows": [],
        }

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

    org_str = str(int(organization_id))
    branch_str = str(int(branch_id))
    user_str = str(int(user_id))

    if role == "operator" or scope_level in {"own", "mine", "created_by_me"}:
        scope_sql = f"created_by_user_id = {int(user_id)}"
    else:
        scope_sql = "TRUE"

    if not (time_start and time_end) and time_window:
        from ..time import resolve_expression

        tb = resolve_expression(time_window)
        if tb.start and tb.end:
            time_start = tb.start.isoformat()
            time_end = tb.end.isoformat()

    date_col = date_column or card.get("default_time_column") or "launch_local_date"
    time_kind = card.get("time_kind") or "launch_date"
    time_sql = "TRUE"
    start_date = "1970-01-01"
    end_date = "9999-12-31"
    if time_start and time_end:
        t_s = datetime.fromisoformat(time_start.replace("Z", "+00:00"))
        t_e = datetime.fromisoformat(time_end.replace("Z", "+00:00"))
        start_date = t_s.date().isoformat()
        end_date = t_e.date().isoformat()
        if time_kind == "launch_date":
            time_sql = (
                f"({date_col} IS NOT NULL AND {date_col} >= '{start_date}' "
                f"AND {date_col} < '{end_date}')"
            )
        else:
            time_sql = (
                f"({date_col} >= TIMESTAMPTZ '{time_start}' AND {date_col} < TIMESTAMPTZ '{time_end}')"
            )

    ppc_exclude = "TRUE"
    if card.get("exclude_ppc_only"):
        ppc_exclude = (
            "EXISTS ("
            "SELECT 1 FROM campaign.campaign_channels ch "
            f"WHERE ch.campaign_id = campaigns.id AND ch.organization_id = {org_str} "
            "AND ch.channel <> 'ppc'"
            ")"
        )

    dim_list = list(dimensions or [])
    if dimension:
        dim_list = [dimension] + dim_list
    # de-dupe preserve order
    seen: list[str] = []
    for d in dim_list:
        if d and d not in seen:
            seen.append(d)
    if kpi_id == "delivered_by_channel" and not seen:
        seen = ["channel"]
    if kpi_id == "delivery_trend" and not seen:
        seen = ["day"]

    channel_join = ""
    if any(str(d).strip().lower() in {"channel", "channels"} for d in seen):
        channel_join = (
            "LEFT JOIN campaign.campaign_channels cc "
            "ON cc.campaign_id = campaigns.id "
            f"AND cc.organization_id = {org_str}"
        )

    try:
        dim_select, group_by_sql, group_by_tail = dimension_slots(
            seen or None,
            card.get("allowed_dimensions"),
            grain=str(card.get("dimension_grain") or card.get("grain") or ""),
        )
    except ValueError as exc:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPAIR",
            "error": str(exc),
            "rows": [],
        }

    slots = {
        "org_id": org_str,
        "branch_id": branch_str,
        "user_id": user_str,
        "tenant_sql": f"organization_id = {org_str} AND branch_id = {branch_str}",
        "scope_sql": scope_sql,
        "time_sql": time_sql,
        "segment_sql": "TRUE",
        "filters_sql": "TRUE",
        "ppc_exclude_sql": ppc_exclude,
        "dimension_select": dim_select,
        "group_by_sql": group_by_sql,
        "group_by_tail": group_by_tail,
        "channel_join": channel_join,
        "limit_sql": "",
        "start_date": start_date,
        "end_date": end_date,
    }
    if slot_values:
        slots.update(slot_values)
        slots["org_id"] = org_str
        slots["branch_id"] = branch_str

    raw_sql = sql_files[kpi_id].read_text()
    base_campaign = catalog.get("base_campaign_sql")
    try:
        compiled = fill_slots(
            raw_sql,
            slots,
            base_campaign=base_campaign if "{{base_campaign}}" in raw_sql else None,
        )
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
        from .. import db as pg
        from ..errors import public_message

        try:
            out["rows"] = pg.fetchall(dsn, compiled, ())
            out["status"] = "ok"
        except Exception as exc:
            out["status"] = "error"
            out["error_type"] = "REPLAN"
            out["error"] = public_message(exc)

    return out
