"""Role-Based Access Control (RBAC) and Security Fencing for CRM B2B Knowledge Graph."""

from __future__ import annotations

from typing import Any, Optional


class AccessDenied(Exception):
    """Raised when an operation, template, or graph entity is denied by RBAC policy."""
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


# Role policies for CRM B2B knowledge graph
# Based on 02-modules-roles-pipeline.md
ROLE_POLICIES: dict[str, dict[str, Any]] = {
    "admin": {
        "description": "Tenant administrator. Full visibility across all CRM entities and operations.",
        "can_view_all_records": True,
        "allowed_modules": ["dashboard", "sales", "finance", "agents", "inbox", "contact", "company", "activities", "product", "configuration"],
        "can_access_finance": True,
        "can_access_agents_ops": True,
        "allowed_templates": ["*"],
    },
    "sales_manager": {
        "description": "Sales management. Organization-wide visibility across deals, pipelines, teams, and finance links.",
        "can_view_all_records": True,
        "allowed_modules": ["dashboard", "sales", "finance", "agents", "inbox", "contact", "company", "activities", "product", "configuration"],
        "can_access_finance": True,
        "can_access_agents_ops": True,
        "allowed_templates": ["*"],
    },
    "finance": {
        "description": "Finance lead. Organization-wide visibility on invoices, approvals, cash collections, and contracts.",
        "can_view_all_records": True,
        "allowed_modules": ["dashboard", "finance", "inbox", "contact", "company", "configuration"],
        "can_access_finance": True,
        "can_access_agents_ops": False,
        "allowed_templates": [
            "invoice_outstanding_and_due",
            "overdue_invoice_aging_and_risk",
            "collected_revenue_mix",
            "finance_approval_queue",
            "contract_arr_and_renewals",
            "product_revenue_breakdown",
            "product_revenue_from_closed_deals",
            "quote_acceptance_and_friction",
            "deal_commercial_path_walk",
            "customer_account_commercial_summary",
        ],
    },
    "sales_rep": {
        "description": "Individual account executive scoped strictly to owned deals, contacts, and activities.",
        "can_view_all_records": False,
        "allowed_modules": ["dashboard", "sales", "inbox", "contact", "company", "activities", "product", "configuration"],
        "can_access_finance": False,  # Only deep-linked invoice for owned deals
        "can_access_agents_ops": False,
        "allowed_templates": [
            "deal_root_cause_loss",
            "deal_forecast_risk_and_stall",
            "deal_commercial_path_walk",
            "open_pipeline_health",
            "top_open_opportunities",
            "pipeline_by_owner",
            "deal_aging_bands",
            "sales_velocity_breakdown",
            "quote_acceptance_and_friction",
            "customer_account_commercial_summary",
            "contact_timeline_and_bant",
            "open_task_and_touch_cadence",
            "lead_status_mix",
            "lead_source_conversion",
            "deals_by_period_or_month",
            "won_deals_overview",
            "open_deals_overview",
            "deals_by_day_or_date",
            "product_revenue_from_closed_deals",
        ],
    },
    "presales": {
        "description": "Presales specialist supporting discovery and proposals on owned/assigned deals.",
        "can_view_all_records": False,
        "allowed_modules": ["dashboard", "sales", "inbox", "contact", "company", "activities", "product", "configuration"],
        "can_access_finance": False,
        "can_access_agents_ops": False,
        "allowed_templates": [
            "deal_root_cause_loss",
            "deal_forecast_risk_and_stall",
            "deal_commercial_path_walk",
            "open_pipeline_health",
            "top_open_opportunities",
            "pipeline_by_owner",
            "deal_aging_bands",
            "sales_velocity_breakdown",
            "quote_acceptance_and_friction",
            "customer_account_commercial_summary",
            "contact_timeline_and_bant",
            "open_task_and_touch_cadence",
            "lead_status_mix",
            "lead_source_conversion",
            "deals_by_period_or_month",
            "won_deals_overview",
            "open_deals_overview",
            "deals_by_day_or_date",
            "product_revenue_from_closed_deals",
        ],
    },
    "marketing": {
        "description": "Marketing specialist scoped to owned contacts and campaign conversion.",
        "can_view_all_records": False,
        "allowed_modules": ["dashboard", "inbox", "contact", "company", "marketing", "activities", "product", "configuration"],
        "can_access_finance": False,
        "can_access_agents_ops": False,
        "allowed_templates": [
            "lead_status_mix",
            "lead_source_conversion",
            "contact_timeline_and_bant",
            "open_task_and_touch_cadence",
        ],
    },
    "viewer": {
        "description": "Read-only viewer restricted strictly to owned records.",
        "can_view_all_records": False,
        "allowed_modules": ["dashboard", "sales", "inbox", "contact", "company", "activities", "product"],
        "can_access_finance": False,
        "can_access_agents_ops": False,
        "allowed_templates": [
            "deal_root_cause_loss",
            "deal_forecast_risk_and_stall",
            "deal_commercial_path_walk",
            "open_pipeline_health",
            "top_open_opportunities",
            "pipeline_by_owner",
            "deal_aging_bands",
            "sales_velocity_breakdown",
            "quote_acceptance_and_friction",
            "customer_account_commercial_summary",
            "contact_timeline_and_bant",
            "open_task_and_touch_cadence",
            "lead_status_mix",
            "lead_source_conversion",
            "deals_by_period_or_month",
            "won_deals_overview",
            "open_deals_overview",
            "deals_by_day_or_date",
        ],
    },
}


def get_role_policy(role: str) -> dict[str, Any]:
    """Retrieve policy configuration for a given role, defaulting to sales_rep."""
    return ROLE_POLICIES.get(role.lower(), ROLE_POLICIES["sales_rep"])


def can_view_all_records(role: str) -> bool:
    """Return True if the role has organization-wide data visibility."""
    return bool(get_role_policy(role).get("can_view_all_records", False))


def get_effective_user_scope(role: str, user_id: Optional[int]) -> int:
    """Resolve effective user id for row scoping. If not org-wide and user_id is missing, returns sentinel 0."""
    if can_view_all_records(role):
        return user_id or 0
    if not user_id:
        # Fail-closed sentinel matching nothing
        return 0
    return user_id


def validate_role_kg_template_access(role: str, template_name: str) -> None:
    """Validate whether the role has permission to run the specified CRM B2B template."""
    policy = get_role_policy(role)
    allowed = policy.get("allowed_templates", [])
    if "*" not in allowed and template_name not in allowed:
        raise AccessDenied(
            f"Role '{role}' is not authorized to execute CRM B2B template '{template_name}'."
        )


def validate_finance_access(role: str) -> None:
    """Ensure caller has permission to view org-wide finance metrics."""
    policy = get_role_policy(role)
    if not policy.get("can_access_finance", False):
        raise AccessDenied(
            f"Role '{role}' is not authorized to query organization finance metrics. "
            "Finance access is restricted to admin, sales_manager, and finance roles."
        )


def validate_agents_ops_access(role: str) -> None:
    """Ensure caller has permission to view agent operations metrics."""
    policy = get_role_policy(role)
    if not policy.get("can_access_agents_ops", False):
        raise AccessDenied(
            f"Role '{role}' is not authorized to query agent operational metrics. "
            "Operations access is restricted to admin and sales_manager."
        )
