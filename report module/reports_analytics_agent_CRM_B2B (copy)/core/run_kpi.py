"""Fill a certified KPI template and run it against Postgres."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime
from pathlib import Path

from .loader import load_kpis, load_access, PRODUCT_DIR
from .templates import fill_slots, normalize_dimension
from .run_sql import run_sql, execute_sql
from .time import resolve_expression
from .errors import UnavailableKPIError, AccessDeniedError

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
    "contact_count": "lead_count",
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
    time_start: Optional[str] = None,
    time_end: Optional[str] = None,
    time_window: Optional[str] = None,
    dimension: Optional[str] = None,
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
            time_start = bounds.start.isoformat()
            time_end = bounds.end.isoformat()
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

    if time_start and time_end:
        time_sql = f"{default_time_col} >= :start AND {default_time_col} < :end"
        params["start"] = time_start
        params["end"] = time_end

    raw_template = template_path.read_text()
    dimension = normalize_dimension(dimension, kpi_meta.get("allowed_dimensions"))
    compiled_sql = fill_slots(
        raw_template,
        dimension=dimension,
        time_sql=time_sql,
        date_column=str(default_time_col or "created_at"),
        slot_values=slot_values,
    )

    # Run through run_sql (which applies sql_guard role scoping)
    result = run_sql(
        compiled_sql,
        organization_id=organization_id,
        user_id=user_id,
        role=role,
        params=params,
        dsn=dsn,
        product_dir=product_dir,
    )
    result["kpi_id"] = canonical_id
    if dimension:
        result["dimension"] = dimension
    if time_start and time_end:
        result["time_status"] = "bounded"
    else:
        result["time_status"] = "all_time"
    return result
