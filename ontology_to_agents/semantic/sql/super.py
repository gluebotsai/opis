"""SQL Super Agent — plan, route, orchestrate product executors."""

from __future__ import annotations

import re
import uuid
from typing import Any

from ontology.slice import normalize_product_id
from semantic.capabilities import get_metric_capabilities
from semantic.entitlements import load_tenant_entitlements
from semantic.lookup import is_certified
from semantic.query import QueryValidationError, SemanticQuery, validate_and_prepare
from semantic.scope import lookup_user_scope, scope_summary
from semantic.sql.agent_policy import (
    PLAIN_COUNT,
    AgentPolicyError,
    assert_metrics_allowed,
    detect_count_metrics,
    detect_kpi_metrics,
    resolve_agent_policy,
    suggest_metric_request,
)
from semantic.sql.catalog_loader import get_table, load_product_catalog
from semantic.sql.job import ExecutorJob, SqlFilter, SqlQueryRequest
from semantic.sql.metric_template_registry import get_template, metric_meta
from semantic.sql.router import default_table, normalize_product, route_product
from semantic.sql.scope_resolver import resolve_list_scope

_EXECUTORS: dict[str, str] = {
    "ccaas": "semantic.sql.executors.ccaas",
    "ticketing": "semantic.sql.executors.ticketing",
    "crm": "semantic.sql.executors.crm",
    "campaign": "semantic.sql.executors.campaign",
    "webtracking": "semantic.sql.executors.webtracking",
}

_PRODUCT_SKU: dict[str, str] = {
    "ccaas": "contact-center",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
}


class SqlAgentError(ValueError):
    pass


def _parse_instruction_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    product: str,
) -> list[SqlFilter]:
    from semantic.sql.instruction_filters import parse_ticketing_filters

    if product == "ticketing":
        return parse_ticketing_filters(instruction, raw_filters, product=product)

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

    text = instruction.lower()
    if "open" in text and not any(f.column in ("is_open", "status") for f in filters):
        if product == "ccaas" and "conversation" in text:
            filters.append(SqlFilter(column="is_open", op="eq", values=[True]))
    m = re.search(r"queue\s+([a-zA-Z0-9 _&-]+)", instruction, re.I)
    if m and not any(f.column == "queue_name" for f in filters):
        qname = m.group(1).strip().rstrip(".")
        filters.append(SqlFilter(column="queue_name", op="contains", values=[qname]))
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
        ("ticketing", "mart_tickets"): [
            "ticket_id",
            "status",
            "priority",
            "queue_name",
            "assignee_name",
            "created_at",
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


def _build_list_job(
    req: SqlQueryRequest, product: str, policy: dict[str, Any]
) -> ExecutorJob:
    cat = load_product_catalog(product)
    table = default_table(req.entity_hint, product)
    tbl = get_table(product, table)
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=normalize_product_id(req.origin_product)
    )
    ent = load_tenant_entitlements(req.organization_id)
    channels = ent.channels_for_product(product) or ent.channels_for_product("ccaas")

    has_row_scope = bool(tbl.get("row_scope_column"))
    import re

    _assignee_intent = re.compile(
        r"\b(my |mine|assigned to me|my conversations?|my tickets?)\b",
        re.I,
    )
    personal_intent = bool(_assignee_intent.search(req.instruction or ""))
    list_scope = resolve_list_scope(
        product=product,
        table=table,
        instruction=req.instruction,
        has_row_scope=has_row_scope,
        caller_role=scope.role,
    )
    from semantic.ticketing_scope import list_scope_fields

    scope_fields = list_scope_fields(
        scope,
        product=product,
        list_scope=list_scope,
        personal_intent=personal_intent,
    )

    return ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="list",
        product=product,
        engine=str(cat.get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=table,
        schema=str(tbl.get("schema") or cat.get("default_schema")),
        select=_list_select_columns(product, table),
        filters=_parse_instruction_filters(req.instruction, req.filters, product),
        order_by=_default_order_by(product, table),
        limit=req.limit,
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        entitled_channels=channels,
        channel_column="channel" if table in ("mart_conversations", "mart_tickets") else None,
        instruction=req.instruction,
    )


def _metric_fallback_job(
    req: SqlQueryRequest,
    metric_request: dict[str, Any],
    product: str,
    metric_id: str,
    prepared: dict[str, Any],
) -> ExecutorJob:
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=req.origin_product
    )
    ent = load_tenant_entitlements(req.organization_id)
    channels = ent.channels_for_product(product) or []
    cap = get_metric_capabilities(metric_id, product=product)
    from semantic.ticketing_scope import job_scope_fields

    data_scope = (prepared or {}).get("dataScope") or (prepared or {}).get("data_scope")
    scope_fields = job_scope_fields(
        scope,
        metric_id,
        product=product,
        data_scope=data_scope,
        filters=(prepared or {}).get("user_filters"),
    )
    meta = get_template(product, metric_id) or metric_meta(metric_id)
    cat = load_product_catalog(product)
    table = meta.get("table") or default_table(req.entity_hint, product)
    tbl = get_table(product, table) if table else {}
    row_col = meta.get("row_scope_column") or tbl.get("row_scope_column")
    parsed_filters = _parse_instruction_filters(req.instruction, req.filters, product)
    from semantic.sql.catalog_loader import resolve_channel_filter

    entitled_channels, channel_column = resolve_channel_filter(
        product,
        str(table),
        channel_scoped=bool(cap.get("channel_scoped")),
        channels=channels,
    )
    return ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="metric_fallback",
        product=product,
        engine=str(cat.get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=table,
        schema=str(tbl.get("schema") or cat.get("default_schema")),
        select=[],
        filters=parsed_filters,
        metric_id=metric_id,
        template_id=metric_id,
        prepared=prepared,
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(row_col) if row_col else None,
        entitled_channels=entitled_channels,
        channel_column=channel_column,
        time_column=meta.get("time_column"),
    )


def _metric_template_query(
    req: SqlQueryRequest,
    metric_request: dict[str, Any],
    *,
    skip_allowlist: bool = False,
) -> dict[str, Any]:
    """Spoke-side fallback: template only (semantic should be tried first)."""
    product = normalize_product(route_product(req.entity_hint, req.origin_product))
    metric_id = metric_request["metrics"][0]
    if not get_template(product, metric_id):
        raise SqlAgentError(
            f"No SQL template for metric '{metric_id}' (product={product}). "
            "Use POST /v1/semantic/query first."
        )
    prepared: dict[str, Any] = {}
    if not skip_allowlist:
        try:
            prepared = validate_and_prepare(
                SemanticQuery(
                    organization_id=int(metric_request["organizationId"]),
                    user_id=int(metric_request["userId"]),
                    product=str(metric_request["product"]),
                    agent=str(metric_request["agent"]),
                    metrics=list(metric_request["metrics"]),
                    group_by=metric_request.get("groupBy")
                    or metric_request.get("group_by"),
                    filters=metric_request.get("filters"),
                    time=metric_request.get("time"),
                )
            )
        except QueryValidationError as exc:
            raise SqlAgentError(str(exc)) from exc
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=req.origin_product
    )
    job = _metric_fallback_job(req, metric_request, product, metric_id, prepared)
    result = _dispatch(job)
    return {
        "source": "metric_fallback",
        "products": [product],
        "metrics": metric_request["metrics"],
        "rows": result.get("rows", []),
        "scope": scope_summary(scope),
        "sql": result.get("sql"),
        "organizationId": req.organization_id,
    }


def _execute_count_query(
    req: SqlQueryRequest,
    policy: dict[str, Any],
    product: str,
    metric_id: str,
) -> dict[str, Any]:
    from semantic.sql.metric_template_registry import get_template

    product = normalize_product(product)
    if metric_id != PLAIN_COUNT and get_template(product, metric_id):
        metric_request = {
            "organizationId": req.organization_id,
            "userId": req.user_id,
            "product": product,
            "agent": policy.get("agent") or req.origin_agent,
            "metrics": [metric_id],
        }
        return _metric_template_query(
            req,
            metric_request,
            skip_allowlist=bool(policy.get("list_only")),
        )

    table = default_table(req.entity_hint, product)
    cat = load_product_catalog(product)
    tbl = get_table(product, table)
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=normalize_product_id(req.origin_product)
    )
    ent = load_tenant_entitlements(req.organization_id)
    channels = ent.channels_for_product(product) or ent.channels_for_product("ccaas")
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
        channel_column="channel" if table in ("mart_conversations", "mart_tickets") else None,
        instruction=req.instruction,
    )
    from semantic.sql.executors.base import build_count_sql
    from semantic.sql.db import run_postgres_query

    sql, params = build_count_sql(job, result_column=result_col)
    rows = run_postgres_query(sql, params)
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
        raise SqlAgentError(f"No executor for product '{job.product}'")
    mod = __import__(_EXECUTORS[job.product], fromlist=["execute_job"])
    return mod.execute_job(job)


def execute_sql_query(req: SqlQueryRequest) -> dict[str, Any]:
    """Main entry: Gemma Super plan → preset executor → harness (no MetricFlow)."""
    import re

    from semantic.sql.mas.orchestrator import execute_plan
    from semantic.sql.mas.super_planner import plan_sql_query

    if re.search(
        r"\b(insert|update|delete|drop|truncate|alter|create|merge|copy)\b",
        req.instruction or "",
        re.I,
    ):
        raise SqlAgentError("Write operations are not allowed on the SQL agent.")

    plan = plan_sql_query(req)
    return execute_plan(req, plan)


def detect_kpi_only(instruction: str, policy: dict[str, Any]) -> bool:
    from semantic.sql.agent_policy import (
        _COUNT_INTENT,
        _LIST_VERBS,
        _instruction_names_kpi,
    )

    text = instruction or ""
    if _LIST_VERBS.search(text) and not _COUNT_INTENT.search(text):
        return False
    return _instruction_names_kpi(text)
