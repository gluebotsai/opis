"""CRM B2B Knowledge Graph Query Runner for certified templates and raw Cypher."""

from __future__ import annotations

from typing import Any, Optional

from .access import (
    AccessDenied,
    can_view_all_records,
    get_effective_user_scope,
    validate_role_kg_template_access,
)
from .cypher_guard import CypherSecurityViolation, validate_and_guard_cypher
from .kg_client import Neo4jClient, resolve_org_default_currency
from .loader import load_templates
from .models import AgentContext, Fact, QueryResult


def run_cypher_query(
    raw_cypher: str,
    context: AgentContext,
    params: Optional[dict[str, Any]] = None,
) -> QueryResult:
    """Validate and execute a read-only Cypher query through security guardrail."""
    actual_params = dict(params or {})

    # Auto-bind parameter aliases (account_name <-> company_name, deal_name <-> deal_title, etc.)
    if "company_name" not in actual_params and "account_name" in actual_params:
        actual_params["company_name"] = actual_params["account_name"]
    elif "account_name" not in actual_params and "company_name" in actual_params:
        actual_params["account_name"] = actual_params["company_name"]

    if "company_id" not in actual_params and "account_id" in actual_params:
        actual_params["company_id"] = actual_params["account_id"]
    elif "account_id" not in actual_params and "company_id" in actual_params:
        actual_params["account_id"] = actual_params["company_id"]

    if "deal_title" not in actual_params and "deal_name" in actual_params:
        actual_params["deal_title"] = actual_params["deal_name"]
    elif "deal_name" not in actual_params and "deal_title" in actual_params:
        actual_params["deal_name"] = actual_params["deal_title"]

    # Auto-bind standard CRM B2B security and scoping parameters
    can_view_all = can_view_all_records(context.role)
    effective_user_id = get_effective_user_scope(context.role, context.user_id)
    default_curr = resolve_org_default_currency(context.org_id)
    actual_params["can_view_all"] = can_view_all
    actual_params["effective_user_id"] = effective_user_id
    if "default_currency" not in actual_params:
        actual_params["default_currency"] = default_curr

    if "$org_id" in raw_cypher and "org_id" not in actual_params:
        actual_params["org_id"] = context.org_id
    if "$user_id" in raw_cypher and "user_id" not in actual_params:
        actual_params["user_id"] = effective_user_id
    if "$deal_id" in raw_cypher and "deal_id" not in actual_params:
        actual_params["deal_id"] = ""
    if "$deal_title" in raw_cypher and "deal_title" not in actual_params:
        actual_params["deal_title"] = ""
    if "$deal_name" in raw_cypher and "deal_name" not in actual_params:
        actual_params["deal_name"] = actual_params.get("deal_title", "")
    if "$company_id" in raw_cypher and "company_id" not in actual_params:
        actual_params["company_id"] = ""
    if "$account_id" in raw_cypher and "account_id" not in actual_params:
        actual_params["account_id"] = actual_params.get("company_id", "")
    if "$company_name" in raw_cypher and "company_name" not in actual_params:
        actual_params["company_name"] = ""
    if "$account_name" in raw_cypher and "account_name" not in actual_params:
        actual_params["account_name"] = actual_params.get("company_name", "")
    if "$contact_id" in raw_cypher and "contact_id" not in actual_params:
        actual_params["contact_id"] = ""
    if "$cdp_id" in raw_cypher and "cdp_id" not in actual_params:
        actual_params["cdp_id"] = ""
    if "$rep_name" in raw_cypher and "rep_name" not in actual_params:
        actual_params["rep_name"] = actual_params.get("user_name", "")
    if "$user_name" in raw_cypher and "user_name" not in actual_params:
        actual_params["user_name"] = actual_params.get("rep_name", "")
    if "$target_date" in raw_cypher and "target_date" not in actual_params:
        actual_params["target_date"] = actual_params.get("date", "")
    elif "target_date" in actual_params and "date" not in actual_params:
        actual_params["date"] = actual_params["target_date"]

    try:
        guarded = validate_and_guard_cypher(raw_cypher, params=actual_params, context=context)
    except CypherSecurityViolation as sec_err:
        return QueryResult(
            status="error",
            error=str(sec_err),
            error_type="DENY",
            raw_query=raw_cypher,
        )
    except Exception as exc:
        return QueryResult(
            status="error",
            error=f"Cypher guard error: {str(exc)}",
            error_type="REPLAN",
            raw_query=raw_cypher,
        )

    client = Neo4jClient.get_instance()
    return client.execute_cypher(
        cypher=guarded.cypher,
        params=guarded.params,
        org_id=context.org_id,
    )


def execute_kg_template(
    template_name: str,
    context: AgentContext,
    params: Optional[dict[str, Any]] = None,
) -> tuple[QueryResult, Optional[Fact]]:
    """Execute a certified CRM B2B Cypher template with role access governance."""
    try:
        validate_role_kg_template_access(context.role, template_name)
    except AccessDenied as acc_err:
        res = QueryResult(
            status="error",
            error=str(acc_err),
            error_type="DENY",
        )
        return res, None

    all_templates = load_templates().get("templates", {})
    if template_name not in all_templates:
        res = QueryResult(
            status="error",
            error=f"CRM B2B template '{template_name}' not found in registry.",
            error_type="template_not_found",
        )
        return res, None

    meta = all_templates[template_name]
    raw_cypher = meta.get("cypher", "")
    desc = meta.get("description", template_name)

    res = run_cypher_query(raw_cypher, context, params=params)
    if res.status != "success":
        return res, None

    # Derive factual metric or breakdown table
    if res.rows and len(res.rows) == 1 and len(res.rows[0]) == 1:
        single_val = list(res.rows[0].values())[0]
        fact = Fact(label=desc, value=single_val, unit="count")
    else:
        fact = Fact(label=desc, value=res.row_count, unit="records", breakdown=res.rows)

    return res, fact
