"""SQL Super Agent — Gemma plan/execute entry (isolated from semantic query stack)."""

from __future__ import annotations

import re
import uuid
from typing import Any

from ontology.slice import normalize_product_id
from sql_agent.agent_policy import PLAIN_COUNT, metric_scope_mode, resolve_agent_policy
from sql_agent.catalog_loader import get_table, load_product_catalog
from sql_agent.job import ExecutorJob, SqlFilter, SqlQueryRequest
from sql_agent.kpi_template_registry import get_template
from sql_agent.router import default_table, normalize_product
from sql_agent.scope_resolver import resolve_list_scope
from sql_agent.user_scope import lookup_user_scope, scope_summary

_EXECUTORS: dict[str, str] = {
    "ccaas": "sql_agent.executors.ccaas",
    "ticketing": "sql_agent.executors.ticketing",
    "crm": "sql_agent.executors.crm",
    "campaign": "sql_agent.executors.campaign",
    "webtracking": "sql_agent.executors.webtracking",
}

_PRODUCT_SKU: dict[str, str] = {
    "ccaas": "contact-center",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
}


from sql_agent.errors import SqlAgentError


def _parse_instruction_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    product: str,
) -> list[SqlFilter]:
    from sql_agent.instruction_filters import (
        parse_campaign_filters,
        parse_ccaas_filters,
        parse_crm_filters,
        parse_ticketing_filters,
        parse_webtracking_filters,
    )

    parsers = {
        "ticketing": parse_ticketing_filters,
        "ccaas": parse_ccaas_filters,
        "crm": parse_crm_filters,
        "campaign": parse_campaign_filters,
        "webtracking": parse_webtracking_filters,
    }
    parser = parsers.get(product)
    if parser:
        return parser(instruction, raw_filters, product=product)

    filters: list[SqlFilter] = []
    for raw in raw_filters or []:
        col = str(raw.get("dimension") or raw.get("column") or "").strip()
        if not col:
            continue
        op = str(raw.get("op") or raw.get("operator") or "eq").lower()
        vals = raw.get("values") or []
        if not vals and raw.get("value") is not None:
            vals = [raw["value"]]
        filters.append(SqlFilter(column=col, op=op, values=list(vals)))
    return filters


def _list_select_columns(product: str, table: str) -> list[str]:
    defaults = {
        ("ccaas", "mart_conversations"): [
            "conversation_id",
            "channel",
            "status",
            "queue_name",
            "assigned_agent_name",
            "created_at",
        ],
        ("ticketing", "tickets"): [
            "ticket_number",
            "subject",
            "status",
            "priority",
            "channel",
            "assignee_name",
            "resolver_name",
            "queue_name",
            "customer_name",
            "due_at",
            "created_at",
            "updated_at",
            "id",
        ],
        ("crm", "mart_deals"): [
            "deal_id",
            "stage",
            "owner_name",
            "deal_status_proxy",
            "created_at",
        ],
        ("crm", "mart_contacts"): [
            "contact_id",
            "lifecycle_stage",
            "lead_status",
            "owner_name",
            "created_at",
        ],
        ("campaign", "mart_campaign_overview"): [
            "campaign_id",
            "campaign_name",
            "campaign_status",
            "source_channel",
            "created_at",
        ],
        ("webtracking", "mart_web_sessions"): [
            "session_id",
            "visitor_id",
            "device",
            "country",
            "utm_source",
            "started_at",
        ],
    }
    return defaults.get((product, table), ["*"])


def _default_order_by(product: str, table: str) -> list[str]:
    cols = _list_select_columns(product, table)
    if "created_at" in cols:
        return ["created_at desc"]
    if "started_at" in cols:
        return ["started_at desc"]
    if "offered_at" in cols:
        return ["offered_at desc"]
    return []


def _execute_count_query(
    req: SqlQueryRequest,
    policy: dict[str, Any],
    product: str,
    metric_id: str,
) -> dict[str, Any]:
    product = normalize_product(product)
    if metric_id != PLAIN_COUNT and get_template(product, metric_id):
        raise SqlAgentError(
            f"Count for certified metric '{metric_id}' must use intent=kpi with metric.certified preset.",
            code="invalid_plan",
        )

    table = default_table(req.entity_hint, product)
    cat = load_product_catalog(product)
    tbl = get_table(product, table)
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=normalize_product_id(req.origin_product)
    )
    channels: list[str] = []
    result_col = metric_id if metric_id != PLAIN_COUNT else "count"
    job = ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="count",
        product=product,
        engine=str(cat.get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=table,
        schema=str(tbl.get("schema") or cat.get("default_schema")),
        select=[],
        filters=_parse_instruction_filters(req.instruction, req.filters, product),
        limit=1,
        scope="org",
        visible_user_ids=list(scope.visible_user_ids),
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        entitled_channels=channels,
        channel_column="channel" if table in ("mart_conversations", "tickets") else None,
        instruction=req.instruction,
    )
    from sql_agent.executors.base import build_count_sql
    from sql_agent.db import run_postgres_query

    sql, params = build_count_sql(job, result_column=result_col)
    rows = run_postgres_query(
        sql, params, schema=job.schema, table=job.table
    )
    metrics = [metric_id] if metric_id != PLAIN_COUNT else []
    return {
        "source": "sql_count",
        "products": [product],
        "metrics": metrics,
        "rows": rows,
        "scope": scope_summary(scope),
        "sql": sql,
        "organizationId": req.organization_id,
    }


def _dispatch(job: ExecutorJob) -> dict[str, Any]:
    if job.product not in _EXECUTORS:
        raise SqlAgentError(
            f"No executor for product '{job.product}'",
            code="unknown_product",
        )
    mod = __import__(_EXECUTORS[job.product], fromlist=["execute_job"])
    return mod.execute_job(job)


def execute_sql_query(req: SqlQueryRequest) -> dict[str, Any]:
    """Main entry: Gemma Super plan → preset executor → harness."""
    from sql_agent.mas.feature_flags import instruction_first_enabled
    from sql_agent.mas.orchestrator import execute_plan
    from sql_agent.mas.super_planner import plan_sql_query

    if re.search(
        r"\b(insert|update|delete|drop|truncate|alter|create|merge|copy)\b",
        req.instruction or "",
        re.I,
    ):
        raise SqlAgentError(
            "Write operations are not allowed on the SQL agent.",
            code="write_denied",
        )

    if instruction_first_enabled():
        plan = plan_sql_query(req)
        return execute_plan(req, plan)

    # Shadow mode: legacy response, log instruction-first diff
    plan = plan_sql_query(req)
    result = execute_plan(req, plan)
    try:
        _shadow_instruction_first(req, plan, result)
    except Exception:
        pass
    return result


def _shadow_instruction_first(
    req: SqlQueryRequest,
    legacy_plan: Any,
    legacy_result: dict[str, Any],
) -> None:
    """Compute what instruction-first would do; log diff; do not return it."""
    from sql_agent.mas.intent_gate import hint_intent
    from sql_agent.mas.telemetry import bump, log_request

    gate_hint = hint_intent(req.instruction)
    legacy_intent = str(getattr(legacy_plan, "intent", None) or "")
    forced_kpi = bool(req.metric_request) and legacy_intent == "kpi"
    would_list = gate_hint == "list" and (
        forced_kpi or legacy_intent == "kpi"
    )
    diff = {
        "legacy_intent": legacy_intent,
        "gate_hint": gate_hint,
        "metric_request_forced": forced_kpi,
        "would_strip_to_list": would_list,
        "legacy_metric_id": getattr(legacy_plan, "metric_id", None),
        "legacy_source": legacy_result.get("source"),
    }
    if (
        gate_hint != legacy_intent
        or would_list
        or (forced_kpi and gate_hint != "kpi")
    ):
        bump("instruction_first_diff")
        log_request(
            gate_hint=gate_hint,
            raw_plan=diff,
            guard_action="instruction_first_diff",
            final_intent=legacy_intent,
            metric_id=getattr(legacy_plan, "metric_id", None),
            metric_reason="shadow",
            scope_mode=None,
            instruction=req.instruction,
        )


def detect_kpi_only(instruction: str, policy: dict[str, Any]) -> bool:
    from sql_agent.agent_policy import (
        _COUNT_INTENT,
        _LIST_VERBS,
        _instruction_names_kpi,
    )

    text = instruction or ""
    if _LIST_VERBS.search(text) and not _COUNT_INTENT.search(text):
        return False
    return _instruction_names_kpi(text)
