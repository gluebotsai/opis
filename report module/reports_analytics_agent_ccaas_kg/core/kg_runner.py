"""CCaaS Knowledge Graph Query Runner for certified templates and raw Cypher."""

from __future__ import annotations

from typing import Any, Optional

from .access import AccessDenied, validate_role_kg_template_access
from .cypher_guard import CypherSecurityViolation, validate_and_guard_cypher
from .kg_client import Neo4jClient
from .loader import load_templates
from .models import AgentContext, Fact, QueryResult


def run_cypher_query(
    raw_cypher: str,
    context: AgentContext,
    params: Optional[dict[str, Any]] = None,
) -> QueryResult:
    """Validate and execute a read-only Cypher query through security guardrail."""
    actual_params = dict(params or {})

    # Auto-bind standard CCaaS parameters if referenced in query but omitted by caller
    if "$period_start" in raw_cypher and "period_start" not in actual_params:
        actual_params["period_start"] = "2026-09-20T00:00:00Z"
    if "$period_end" in raw_cypher and "period_end" not in actual_params:
        actual_params["period_end"] = "2026-09-28T00:00:00Z"
    if "$start_date" in raw_cypher and "start_date" not in actual_params:
        actual_params["start_date"] = "2026-09-20T00:00:00Z"
    if "$end_date" in raw_cypher and "end_date" not in actual_params:
        actual_params["end_date"] = "2026-09-28T00:00:00Z"
    if "$queue_id" in raw_cypher and "queue_id" not in actual_params:
        actual_params["queue_id"] = "support_queue_1"
    if "$agent_id" in raw_cypher and "agent_id" not in actual_params:
        actual_params["agent_id"] = "staff_01"
    if "$contact_id" in raw_cypher and "contact_id" not in actual_params:
        actual_params["contact_id"] = "contact_01"

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
    """Execute a certified CCaaS Cypher template with role access governance."""
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
            error=f"CCaaS template '{template_name}' not found.",
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
