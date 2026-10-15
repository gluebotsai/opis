"""KPI SQL Template slot rendering helper."""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

# Mapping of valid dimension column names
SAFE_DIMENSIONS: Dict[str, str] = {
    "owner": "owner_name",
    "owner_name": "owner_name",
    "stage": "stage",
    "company": "company_name",
    "company_name": "company_name",
    "industry": "company_industry",
    "channel_role": "channel_role",
    "lead_source": "lead_source",
    "lead_status": "lead_status",
    "product": "product_name",
    "product_name": "product_name",
    "billing_frequency": "billing_frequency",
    "payment_method": "payment_method",
    "month": "TO_CHAR(close_ts, 'YYYY-MM')",
    "created_month": "TO_CHAR(created_at, 'YYYY-MM')",
    "city": "city",
    "currency": "currency_code",
    "currency_code": "currency_code",
    "type": "type",
    "activity_type": "type",
    "activity_source": "activity_source",
    "task_status": "task_status",
    "host": "host_name",
    "job_type": "job_type",
    "status": "status",
    "week": "TO_CHAR(created_at, 'IYYY-IW')",
    "day": "TO_CHAR(created_at::date, 'YYYY-MM-DD')",
    "lost_reason": "lost_reason",
    "region": "region",
    "country": "country",
}

_PLACE_DIMENSIONS = frozenset({"region", "country"})

DIMENSION_ALIASES: Dict[str, str] = {
    "agent": "owner",
    "agents": "owner",
    "sales_rep": "owner",
    "sales_reps": "owner",
    "rep": "owner",
    "reps": "owner",
    "salesperson": "owner",
    "salespeople": "owner",
    "owner_name": "owner",
    "owner": "owner",
}


DIM_SLOT_MARKERS = ("{{dimension_select}}", "{{group_by_sql}}", "{{extra_group_sql}}")
_SQL_FUNC_TOKENS = {
    "to_char", "cast", "coalesce", "text", "date", "null", "true", "false",
}


def dimension_sql_expr(dimension: Optional[str], date_column: str = "created_at") -> Optional[str]:
    """SQL expression fill_slots uses for a catalog dimension id."""
    if not dimension:
        return None
    mapping = dict(SAFE_DIMENSIONS)
    date_col = date_column if date_column else "created_at"
    mapping["month"] = f"TO_CHAR({date_col}, 'YYYY-MM')"
    mapping["week"] = f"TO_CHAR({date_col}, 'IYYY-IW')"
    mapping["day"] = f"TO_CHAR({date_col}::date, 'YYYY-MM-DD')"
    return mapping.get(dimension)


def dimension_column_idents(dimension: Optional[str], date_column: str = "created_at") -> list[str]:
    """Base column names a dimension expression needs on the KPI's rpt view."""
    expr = dimension_sql_expr(dimension, date_column)
    if not expr:
        return []
    if expr.isidentifier():
        return [expr]
    to_char = re.search(r"TO_CHAR\(\s*([a-z_][a-z0-9_]*)", expr, flags=re.IGNORECASE)
    if to_char:
        return [to_char.group(1)]
    tokens = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", expr)
    return [t for t in tokens if t.lower() not in _SQL_FUNC_TOKENS]


def template_rpt_views(raw_sql: str) -> list[str]:
    return re.findall(r"\brpt\.([a-z_][a-z0-9_]*)", raw_sql, flags=re.IGNORECASE)


def template_has_dimension_slots(raw_sql: str) -> bool:
    return any(marker in raw_sql for marker in DIM_SLOT_MARKERS)


def normalize_dimension(dimension: Optional[str], allowed: Optional[list] = None) -> Optional[str]:
    """Map caller dimension names onto catalog ids that exist in SAFE_DIMENSIONS."""
    if dimension is None:
        return None
    raw = str(dimension).strip()
    if not raw or raw.lower() in {"null", "none", "false"}:
        return None
    mapped = DIMENSION_ALIASES.get(raw.lower(), raw.lower())
    if mapped not in SAFE_DIMENSIONS:
        return None
    if allowed:
        allowed_ids = {str(a).strip().lower() for a in allowed if a}
        if mapped not in allowed_ids:
            return None
    return mapped


def fill_slots(
    raw_sql: str,
    *,
    dimension: Optional[str] = None,
    time_sql: str = "TRUE",
    filters_sql: str = "TRUE",
    scope_sql: str = "TRUE",
    segment_sql: str = "TRUE",
    limit_sql: str = "",
    order_by_sql: str = "",
    date_column: str = "created_at",
    slot_values: Optional[Dict[str, str]] = None,
) -> str:
    """Fills template slots in KPI SQL files."""
    slots = dict(slot_values or {})
    date_col = date_column if date_column in {
        "created_at", "closed_at", "close_ts", "updated_at", "due_at",
        "ends_at", "starts_at", "expected_close_date", "paid_at",
    } else "created_at"
    mapping = dict(SAFE_DIMENSIONS)
    mapping["month"] = f"TO_CHAR({date_col}, 'YYYY-MM')"
    mapping["week"] = f"TO_CHAR({date_col}, 'IYYY-IW')"
    mapping["day"] = f"TO_CHAR({date_col}::date, 'YYYY-MM-DD')"

    dim_col = mapping.get(dimension, dimension) if dimension else None
    if dimension in _PLACE_DIMENSIONS and dim_col:
        key = f"lower(btrim(COALESCE({dim_col}, '')))"
        label = f"COALESCE(MAX(NULLIF(btrim({dim_col}), '')), 'Unassigned')"
        slots.setdefault("dimension_select", f"{label} AS {dimension},\n  ")
        slots.setdefault("group_by_sql", f"\nGROUP BY {key}")
        slots.setdefault("order_by_sql", "\nORDER BY 2 DESC NULLS LAST")
        slots.setdefault("extra_group_sql", f", {key}")
    elif dim_col:
        # Owner lists are named people only. A blank owner is not a rep.
        if dimension in {"owner", "owner_name"} or dim_col == "owner_name":
            dim_expr = dim_col
        else:
            dim_expr = f"COALESCE({dim_col}::text, 'Unassigned')"
        dim_select = f"{dim_expr} AS {dimension},\n  "
        grp_by = f"\nGROUP BY {dim_expr}"
        ord_by = "\nORDER BY 2 DESC NULLS LAST"
        extra_group = f", {dim_expr}"
        slots.setdefault("dimension_select", dim_select)
        slots.setdefault("group_by_sql", grp_by)
        slots.setdefault("order_by_sql", ord_by)
        slots.setdefault("extra_group_sql", extra_group)
    else:
        slots.setdefault("dimension_select", "")
        slots.setdefault("group_by_sql", "")
        slots.setdefault("order_by_sql", "")
        slots.setdefault("extra_group_sql", "")

    slots.setdefault("time_sql", time_sql or "TRUE")
    slots.setdefault("filters_sql", filters_sql or "TRUE")
    slots.setdefault("scope_sql", scope_sql or "TRUE")
    slots.setdefault("segment_sql", segment_sql or "TRUE")
    slots.setdefault("limit_sql", limit_sql or "")
    slots.setdefault("polarity_sql", "stage_weight >= 0.75")

    rendered = raw_sql
    for slot_name, slot_val in slots.items():
        # Match both {{slot_name}} and {slot_name}
        rendered = rendered.replace(f"{{{{{slot_name}}}}}", str(slot_val))
        rendered = rendered.replace(f"{{{slot_name}}}", str(slot_val))

    # Clean any remaining empty or unmatched slots
    rendered = re.sub(r"\{\{[a-zA-Z0-9_]+\}\}", "TRUE", rendered)
    return rendered


def render_kpi_template(kpi_id: str, params: Optional[Dict[str, Any]] = None) -> str:
    """Render a KPI template by ID."""
    from app.agents.reports_b2b.core.loader import load_sql_template
    raw = load_sql_template(kpi_id)
    return fill_slots(raw, slot_values=params)

