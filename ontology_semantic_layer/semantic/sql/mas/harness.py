"""Guardrail harness — validate ConstrainedJob and compile ExecutorJob."""

from __future__ import annotations

import uuid
from typing import Any

from semantic.entitlements import load_tenant_entitlements
from semantic.lookup import is_certified, resolve_metric_alias
from semantic.scope import lookup_user_scope
from semantic.sql.agent_policy import (
    AgentPolicyError,
    assert_metrics_allowed,
)
from semantic.sql.catalog_loader import allowed_columns, get_table, resolve_channel_filter
from semantic.sql.compiled_catalog import load_compiled_catalog
from semantic.sql.job import ExecutorJob, SqlFilter, SqlQueryRequest
from semantic.sql.mas.plan_schema import ConstrainedJob, SqlPlan
from semantic.sql.metric_template_registry import get_template
from semantic.sql.presets.loader import load_preset
from semantic.sql.router import normalize_product
from semantic.sql.scope_resolver import resolve_list_scope
from semantic.sql.super import SqlAgentError, _PRODUCT_SKU
from semantic.sql.validator import SqlValidationError


def _normalize_preset_table(table: str, allowed: set[str]) -> str:
    if not allowed or not table:
        return table
    if table in allowed:
        return table
    if not table.startswith("mart_"):
        candidate = f"mart_{table}"
        if candidate in allowed:
            return candidate
    return table


def validate_constrained_job(
    job: ConstrainedJob,
    *,
    preset_id: str,
    raw: dict[str, Any] | None = None,
) -> None:
    """Fail closed if job references unknown tables/columns or contains SQL."""
    if raw and raw.get("sql"):
        raise SqlAgentError("Model output must not contain SQL")
    try:
        spec = load_preset(preset_id)
    except KeyError as exc:
        raise SqlAgentError(str(exc)) from exc

    product = job.product
    if preset_id != "metric.certified":
        allowed_tables = set(spec.get("tables") or [])
        table = _normalize_preset_table(job.table, allowed_tables)
        if allowed_tables and table not in allowed_tables:
            spec_default = spec.get("default_table")
            if spec_default in allowed_tables:
                table = str(spec_default)
            else:
                raise SqlAgentError(
                    f"Table '{job.table}' not in preset '{preset_id}'"
                )
        job.table = table

    tbl = get_table(product, job.table)
    cols = allowed_columns(tbl)
    if job.select and job.select != ["*"]:
        sanitized = [c for c in job.select if c in cols]
        if not sanitized:
            spec = load_preset(preset_id)
            sanitized = [
                c for c in (spec.get("default_select") or []) if c in cols
            ] or ["*"]
        job.select = sanitized
        for col in job.select:
            if col != "*" and col not in cols:
                raise SqlValidationError(
                    f"Column '{col}' not allowed on {job.table}"
                )

    compiled = load_compiled_catalog(product)
    allowed_joins = {
        (j.get("from"), j.get("to"))
        for j in (compiled.get("joins") or [])
    }
    for join in job.joins:
        pair = (join.get("from"), join.get("to"))
        if allowed_joins and pair not in allowed_joins:
            raise SqlAgentError(f"Join {pair} not allowlisted for {product}")

    if job.template_id:
        canonical = resolve_metric_alias(job.template_id) or job.template_id
        if not get_template(product, canonical):
            raise SqlAgentError(
                f"Unknown certified template '{job.template_id}'"
            )
        if not is_certified(canonical):
            raise SqlAgentError(f"Metric '{canonical}' is not certified.")


def constrained_to_executor_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
    job: ConstrainedJob,
    policy: dict[str, Any],
) -> ExecutorJob:
    """Inject org scope and compile a safe ExecutorJob."""
    product = normalize_product(job.product)
    ent = load_tenant_entitlements(req.organization_id)
    sku = _PRODUCT_SKU.get(product, product)
    if sku not in ent.skus and product not in ("hub", "cdp"):
        raise SqlAgentError(
            f"Product '{product}' not entitled for org {req.organization_id}"
        )

    scope = lookup_user_scope(
        req.organization_id,
        req.user_id,
        product=normalize_product(req.origin_product),
    )
    tbl = get_table(product, job.table)
    channels: list[str] = []
    has_row_scope = bool(tbl.get("row_scope_column"))

    if plan.intent == "kpi" or job.template_id or job.metric_id:
        return _kpi_executor_job(req, job, policy, product, scope, channels, tbl)

    tbl = get_table(product, job.table)
    allowed = allowed_columns(tbl)
    import re

    _assignee_intent = re.compile(
        r"\b(my |mine|assigned to me|my conversations?|my tickets?)\b",
        re.I,
    )
    personal_intent = bool(_assignee_intent.search(req.instruction or ""))
    list_scope = resolve_list_scope(
        product=product,
        table=job.table,
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
    filters = _parse_filters(job.filters, req, product, allowed=allowed)
    return ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="list",
        product=product,
        engine=str(load_compiled_catalog(product).get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=job.table,
        schema=job.schema or str(tbl.get("schema") or ""),
        select=job.select or ["*"],
        filters=filters,
        order_by=list(job.order_by),
        limit=min(int(job.limit), 500),
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        entitled_channels=channels,
        channel_column="channel"
        if job.table in ("mart_conversations", "mart_tickets")
        else None,
        instruction=req.instruction,
    )


def _kpi_executor_job(
    req: SqlQueryRequest,
    job: ConstrainedJob,
    policy: dict[str, Any],
    product: str,
    scope: Any,
    channels: list[str],
    tbl: dict[str, Any],
) -> ExecutorJob:
    if policy.get("list_only"):
        raise SqlAgentError(
            f"Agent '{req.origin_agent}' cannot run KPI queries. Route to reporting agent."
        )
    metric_id = resolve_metric_alias(job.metric_id or job.template_id or "")
    if not metric_id:
        raise SqlAgentError("KPI job missing metric_id or template_id")
    try:
        assert_metrics_allowed(policy, [metric_id])
    except AgentPolicyError as exc:
        raise SqlAgentError(str(exc)) from exc
    if not get_template(product, metric_id):
        raise SqlAgentError(
            f"No SQL template for metric '{metric_id}' (product={product})."
        )
    from semantic.ticketing_scope import job_scope_fields

    scope_fields = job_scope_fields(scope, metric_id, product=product)
    meta = get_template(product, metric_id) or {}
    table = meta.get("table") or job.table
    tbl_meta = get_table(product, str(table))
    entitled_channels, channel_column = resolve_channel_filter(
        product,
        str(table),
        channel_scoped=False,
        channels=channels,
    )
    return ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="metric_fallback",
        product=product,
        engine=str(load_compiled_catalog(product).get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=str(table),
        schema=str(tbl_meta.get("schema") or job.schema),
        select=[],
        filters=_parse_filters(job.filters, req, product, allowed=allowed_columns(tbl_meta)),
        metric_id=metric_id,
        template_id=metric_id,
        prepared={},
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(
            meta.get("row_scope_column") or tbl_meta.get("row_scope_column") or ""
        )
        or None,
        entitled_channels=entitled_channels,
        channel_column=channel_column,
        time_column=meta.get("time_column"),
    )


def _parse_filters(
    raw_filters: list[dict[str, Any]],
    req: SqlQueryRequest,
    product: str,
    *,
    allowed: set[str] | None = None,
) -> list[SqlFilter]:
    from semantic.sql.super import _parse_instruction_filters

    parsed = _parse_instruction_filters(req.instruction, req.filters, product)
    for raw in raw_filters or []:
        col = str(raw.get("column") or raw.get("dimension") or "").strip()
        if not col:
            continue
        if allowed is not None and col not in allowed:
            continue
        parsed.append(
            SqlFilter(
                column=col,
                op=str(raw.get("op") or "eq"),
                values=list(raw.get("values") or []),
            )
        )
    if allowed is not None:
        parsed = [f for f in parsed if f.column in allowed]
    return parsed
