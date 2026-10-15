"""Fill a certified KPI template and run it against Postgres."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime
from pathlib import Path

from app.agents.reports_b2b.core.loader import load_kpis, load_access, PRODUCT_DIR
from app.agents.reports_b2b.core.templates import fill_slots, normalize_dimension
from app.agents.reports_b2b.core.run_sql import run_sql, execute_sql
from app.agents.reports_b2b.core.time import resolve_expression
from app.agents.reports_b2b.core.scope import default_scope_for_role, resolve_scope_level
from app.agents.reports_b2b.core.places import match_place
from app.agents.reports_b2b.core.terms import LEAD_KPI_IDS, bind_term, lead_scope_overrides

KPI_ALIASES: Dict[str, str] = {
    # volume (COUNT)
    "total_deals": "total_opportunities",
    "total_deals_count": "total_opportunities",
    "deal_count": "total_opportunities",
    "all_deals": "total_opportunities",
    "active_deals": "active_opportunities",
    "active_deals_count": "active_opportunities",
    "open_deals": "active_opportunities",
    "open_deals_count": "active_opportunities",
    "won_deals": "won_deal_count",
    "won_deals_count": "won_deal_count",
    "closed_won_count": "won_deal_count",
    "lost_deals": "lost_deal_count",
    "lost_deals_count": "lost_deal_count",
    "closed_lost_count": "lost_deal_count",
    "total_leads": "lead_count",
    "lead_count_total": "lead_count",
    "how_many_leads": "lead_count",
    # money (SUM)
    "won_deals_amount": "won_revenue",
    "closed_won_revenue": "won_revenue",
    "closed_revenue": "won_revenue",
    "lost_deals_amount": "lost_revenue",
    "closed_lost_revenue": "lost_revenue",
    "pipeline_value": "total_pipeline",
    "total_pipeline_value": "total_pipeline",
    "active_pipeline": "total_pipeline",
    "total_pipeline_amount": "total_pipeline",
    "ar_balance": "invoice_outstanding",
    "accounts_receivable": "invoice_outstanding",
    "invoice_outstanding_amount": "invoice_outstanding",
    "overdue_invoices_amount": "overdue_amount",
    "collected_revenue_ytd": "collected_revenue",
    "contract_arr_active": "contract_arr",
    "activity_volume_total": "activity_volume",
    "lead_status_distribution": "lead_status_mix",
    "meeting_completion_rate": "meeting_completion",
}

REFUSAL_KPIS: Dict[str, str] = {
    "quota_attainment": "CRM does not store monthly sales targets per rep.",
    "stage_conversion": "CRM does not store deal stage transition history.",
    "won_reason_mix": "CRM does not store a won_reason column.",
    "time_in_stage": "CRM does not store stage duration history.",
    "campaign_attribution": "CRM does not store marketing campaign spend attribution chain.",
    "email_open_rate": "CRM does not store email open tracking events on activities.",
    "sequence_compliance": "CRM does not store sequence repeat rule compliance tables.",
}


def run_kpi(
    kpi_id: str,
    *,
    organization_id: int = 1003,
    user_id: int = 1017,
    role: str = "sales_rep",
    scope_level: str = "org",
    time_start: Optional[str | datetime] = None,
    time_end: Optional[str | datetime] = None,
    time_window: Optional[str] = None,
    dimension: Optional[str] = None,
    owner_name: Optional[str] = None,
    owner_names: Optional[List[str]] = None,
    status_filter: Optional[str] = None,
    term: Optional[str] = None,
    region: Optional[str] = None,
    country: Optional[str] = None,
    row_limit: Optional[int] = None,
    slot_values: Optional[Dict[str, str]] = None,
    dsn: Optional[str] = None,
    product_dir: Path = PRODUCT_DIR,
    **extra: Any,
) -> Dict[str, Any]:
    """Compile and execute a certified KPI with role guarding and slot substitution."""
    canonical_id = KPI_ALIASES.get(kpi_id, kpi_id)

    if canonical_id in REFUSAL_KPIS:
        missing_msg = REFUSAL_KPIS[canonical_id]
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": canonical_id,
            "error_type": "UNAVAILABLE_KPI",
            "error": f"KPI '{canonical_id}' is unavailable: {missing_msg}",
            "missing_input": missing_msg,
            "rows": [],
        }

    kpi_registry = load_kpis()
    if canonical_id not in kpi_registry:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": canonical_id,
            "error_type": "REPLAN",
            "error": f"kpi_not_found: '{kpi_id}' is not in the certified KPI catalog.",
            "rows": [],
        }

    kpi_meta = kpi_registry[canonical_id]
    bound = bind_term(
        term,
        kpi_id=canonical_id,
        time_window=time_window,
        aggregation=str(kpi_meta.get("aggregation") or ""),
        status_filter=status_filter,
        row_limit=row_limit,
        product_dir=product_dir,
    )
    if bound.stop:
        bound.stop["kpi_id"] = canonical_id
        return bound.stop
    if bound.kpi_id and bound.kpi_id != canonical_id:
        canonical_id = KPI_ALIASES.get(bound.kpi_id, bound.kpi_id)
        if canonical_id in REFUSAL_KPIS:
            missing_msg = REFUSAL_KPIS[canonical_id]
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": canonical_id,
                "error_type": "UNAVAILABLE_KPI",
                "error": f"KPI '{canonical_id}' is unavailable: {missing_msg}",
                "missing_input": missing_msg,
                "rows": [],
            }
        if canonical_id not in kpi_registry:
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": canonical_id,
                "error_type": "REPLAN",
                "error": f"kpi_not_found: '{bound.kpi_id}' is not in the certified KPI catalog.",
                "rows": [],
            }
        kpi_meta = kpi_registry[canonical_id]
    if bound.time_window:
        time_window = bound.time_window
    if bound.status_filter:
        status_filter = bound.status_filter

    effective_scope, scope_err = resolve_scope_level(
        role=role,
        requested=scope_level,
        kpi_id=canonical_id,
    )
    if scope_err:
        scope_err["kpi_id"] = canonical_id
        scope_err["scope_level"] = effective_scope
        return scope_err

    template_path = product_dir / "sql" / f"{canonical_id}.sql"
    if not template_path.exists():
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": canonical_id,
            "error_type": "REPLAN",
            "error": f"template_not_found: SQL template for '{canonical_id}' does not exist.",
            "rows": [],
        }

    # Time parameters
    params: Dict[str, Any] = {}
    time_sql = "TRUE"
    default_time_col = kpi_meta.get("default_time_column", "created_at")

    if not (time_start and time_end) and time_window:
        bounds = resolve_expression(time_window)
        if bounds.status == "bounded" and bounds.start and bounds.end:
            time_start = bounds.start
            time_end = bounds.end
        elif bounds.status == "unresolved":
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": canonical_id,
                "error_type": "REPAIR",
                "error": (
                    f"time_unresolved: '{time_window}' is not a bound UTC window. "
                    "Re-emit time as all time, this month, last month, August 2026, last 30 days, or an ISO date."
                ),
                "time_echo": bounds.echo,
                "time_status": bounds.status,
                "rows": [],
            }

    if isinstance(time_start, str):
        time_start = datetime.fromisoformat(time_start.replace("Z", "+00:00"))
    if isinstance(time_end, str):
        time_end = datetime.fromisoformat(time_end.replace("Z", "+00:00"))
    if isinstance(time_start, datetime) and time_start.tzinfo is not None:
        time_start = time_start.replace(tzinfo=None)
    if isinstance(time_end, datetime) and time_end.tzinfo is not None:
        time_end = time_end.replace(tzinfo=None)

    if time_start and time_end:
        time_sql = f"{default_time_col} >= :start AND {default_time_col} < :end"
        params["start"] = time_start
        params["end"] = time_end

    filter_parts: list[str] = []
    allowed_dimensions = kpi_meta.get("allowed_dimensions") or []
    dimension = normalize_dimension(dimension, allowed_dimensions)
    clean_owner_names = [
        str(item).strip() for item in (owner_names or []) if str(item).strip()
    ][:20]
    owner_allowed = "owner" in allowed_dimensions
    named_owner = bool(clean_owner_names or owner_name)
    if named_owner and owner_allowed:
        # Named-rep counts and lists are that person only. Blank owners are not included.
        filter_parts.append("owner_name IS NOT NULL AND btrim(owner_name) <> ''")
    if clean_owner_names and owner_allowed:
        owner_parts: list[str] = []
        for index, name in enumerate(clean_owner_names):
            param_name = f"owner_name_{index}"
            owner_parts.append(f"owner_name ILIKE :{param_name}")
            params[param_name] = f"%{name}%"
        filter_parts.append("(" + " OR ".join(owner_parts) + ")")
    elif owner_name and owner_allowed:
        filter_parts.append("owner_name ILIKE :owner_name")
        params["owner_name"] = f"%{str(owner_name).strip()}%"
    elif dimension == "owner" and owner_allowed:
        filter_parts.append("owner_name IS NOT NULL AND btrim(owner_name) <> ''")
    if status_filter and canonical_id == "lead_count":
        filter_parts.append("LOWER(lead_status) = LOWER(:status_filter)")
        params["status_filter"] = str(status_filter).strip()

    scope_overrides = lead_scope_overrides(default_scope_for_role(role), canonical_id)
    sql_kwargs = {
        "organization_id": organization_id,
        "user_id": user_id,
        "role": role,
        "dsn": dsn,
        "product_dir": product_dir,
        "view_scope_overrides": scope_overrides,
    }
    if canonical_id in LEAD_KPI_IDS:
        for column, asked in (("region", region), ("country", country)):
            place_err = _bind_place(filter_parts, params, column, asked, sql_kwargs)
            if place_err:
                place_err["kpi_id"] = canonical_id
                return place_err

    raw_template = template_path.read_text()
    if bound.limit and "limit_sql" not in raw_template:
        bound.limit = None
        bound.order_by_sql = None
        if bound.answer_note and "most recently created" in bound.answer_note:
            bound.answer_note = None
    slots = dict(slot_values or {})
    slots["filters_sql"] = " AND ".join(filter_parts) if filter_parts else "TRUE"
    if bound.polarity_sql:
        slots["polarity_sql"] = bound.polarity_sql
    if bound.limit:
        slots["limit_sql"] = f"\nLIMIT {int(bound.limit)}"
    if bound.order_by_sql:
        slots["order_by_sql"] = bound.order_by_sql
    compiled_sql = fill_slots(
        raw_template,
        dimension=dimension,
        time_sql=time_sql,
        date_column=str(default_time_col or "created_at"),
        slot_values=slots,
    )

    # Run through run_sql (which applies sql_guard role scoping)
    result = run_sql(compiled_sql, params=params, **sql_kwargs)
    result["kpi_id"] = canonical_id
    if bound.answer_note:
        result["answer_note"] = bound.answer_note
    if dimension:
        result["dimension"] = dimension
    if time_start and time_end:
        result["time_status"] = "bounded"
        if bound.answer_note and bound.time_window:
            result["time_echo"] = bound.answer_note
    else:
        result["time_status"] = "all_time"
    return result


def _bind_place(
    filter_parts: list[str],
    params: Dict[str, Any],
    column: str,
    asked: Optional[str],
    sql_kwargs: Dict[str, Any],
) -> Dict[str, Any] | None:
    text = str(asked or "").strip()
    if column not in {"region", "country"} or not text:
        return None
    listed = run_sql(
        "SELECT DISTINCT btrim(" + column + ") AS place "
        "FROM rpt.contacts "
        "WHERE " + column + " IS NOT NULL AND btrim(" + column + ") <> ''",
        row_cap=500,
        **sql_kwargs,
    )
    if listed.get("status") != "ok":
        return {
            "status": "error",
            "store": "sql",
            "error_type": "REPAIR",
            "error": listed.get("error") or f"Could not read stored {column} values.",
            "rows": [],
        }
    stored = [
        str(row.get("place") or "")
        for row in (listed.get("rows") or [])
        if str(row.get("place") or "").strip()
    ]
    matched = match_place(text, stored)
    if matched.get("status") == "one":
        param = f"place_{column}"
        filter_parts.append(f"lower(btrim(COALESCE({column}, ''))) = :{param}")
        params[param] = matched["value"]
        return None
    choices = matched.get("choices") or []
    shown = ", ".join(str(item) for item in choices) or "none stored"
    return {
        "status": "error",
        "store": "sql",
        "error_type": "CLARIFY",
        "error": f"Which {column}? Stored values: {shown}",
        "rows": [],
    }
