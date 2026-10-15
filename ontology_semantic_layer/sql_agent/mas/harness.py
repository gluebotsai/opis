"""Guardrail harness — validate ConstrainedJob and compile ExecutorJob."""

from __future__ import annotations

import os
import uuid
from typing import Any

from semantic.entitlements import load_tenant_entitlements
from sql_agent.agent_policy import (
    AgentPolicyError,
    assert_metrics_allowed,
)
from sql_agent.catalog_loader import allowed_columns, get_table, resolve_channel_filter
from sql_agent.compiled_catalog import load_compiled_catalog
from sql_agent.errors import SqlAgentError
from sql_agent.job import ExecutorJob, SqlFilter, SqlQueryRequest
from sql_agent.kpi_certified import is_certified, resolve_metric_alias
from sql_agent.kpi_template_registry import get_template
from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan
from sql_agent.presets.loader import load_preset
from sql_agent.router import normalize_product
from sql_agent.scope_resolver import assert_ticketing_scope_allowed, resolve_list_scope
from sql_agent.super import _PRODUCT_SKU
from sql_agent.user_scope import lookup_user_scope
from sql_agent.validator import SqlValidationError

_TIME_GROUP_COLUMNS = frozenset({"created_at", "updated_at", "resolved_at", "due_at", "first_response_at"})


def _fold_executor_time_filters(executor: ExecutorJob) -> ExecutorJob:
    from sql_agent.time_window import fold_time_filters

    kept, start, end, tcol = fold_time_filters(
        executor.filters,
        time_start=executor.time_start,
        time_end=executor.time_end,
        time_column=executor.time_column,
    )
    executor.filters = kept
    if start:
        executor.time_start = start
    if end:
        executor.time_end = end
    if tcol:
        executor.time_column = tcol
    return executor


def _normalize_preset_table(table: str, allowed: set[str], *, product: str = "") -> str:
    if not allowed or not table:
        return table
    if table in allowed:
        return table
    if product == "ticketing":
        return table
    if not table.startswith("mart_"):
        candidate = f"mart_{table}"
        if candidate in allowed:
            return candidate
    return table


def _coerce_preset_table(
    *,
    job: ConstrainedJob,
    preset_id: str,
    product: str,
    allowed_tables: set[str],
    spec: dict[str, Any],
    warnings: list[str],
) -> None:
    original = job.table
    table = _normalize_preset_table(job.table, allowed_tables, product=product)
    if allowed_tables and table not in allowed_tables:
        spec_default = spec.get("default_table")
        if spec_default in allowed_tables:
            if original and str(original) != str(spec_default):
                warnings.append(f"coerced_table:{original}→{spec_default}")
            table = str(spec_default)
        else:
            allowed_list = ", ".join(sorted(allowed_tables))
            raise SqlAgentError(
                f"Table '{job.table}' is not allowed for preset '{preset_id}' "
                f"(product {product}). Allowed tables: {allowed_list}.",
                code="unknown_table",
            )
    job.table = table


def validate_constrained_job(
    job: ConstrainedJob,
    *,
    preset_id: str,
    raw: dict[str, Any] | None = None,
) -> list[str]:
    """Fail closed if job references unknown tables/columns or contains SQL."""
    warnings: list[str] = []
    if raw and raw.get("sql"):
        raise SqlAgentError(
            "Model output must not contain SQL",
            code="invalid_plan",
        )
    try:
        spec = load_preset(preset_id)
    except KeyError as exc:
        raise SqlAgentError(str(exc), code="unknown_preset") from exc

    product = normalize_product(job.product)
    if preset_id != "metric.certified":
        allowed_tables = set(spec.get("tables") or [])
        preset_product = str(spec.get("product") or product)
        if preset_product not in ("any", ""):
            job.product = normalize_product(preset_product)
            product = job.product
        _coerce_preset_table(
            job=job,
            preset_id=preset_id,
            product=product,
            allowed_tables=allowed_tables,
            spec=spec,
            warnings=warnings,
        )

    tbl = get_table(product, job.table)
    cols = allowed_columns(tbl)
    if job.select and job.select != ["*"]:
        requested = list(job.select)
        sanitized = [c for c in requested if c in cols]
        dropped_cols = [c for c in requested if c not in cols]
        if dropped_cols:
            warnings.append(f"dropped_columns:{','.join(dropped_cols)}")
        if not sanitized:
            sanitized = [
                c for c in (spec.get("default_select") or []) if c in cols
            ] or ["*"]
        job.select = sanitized
        for col in job.select:
            if col != "*" and col not in cols:
                raise SqlValidationError(
                    f"Column '{col}' not allowed on {job.table}"
                )

    if job.group_by:
        allowed_gb = allowed_columns(tbl) | _TIME_GROUP_COLUMNS
        for col in job.group_by:
            if col not in allowed_gb:
                raise SqlValidationError(
                    f"group_by column '{col}' not allowed on {job.table}"
                )

    compiled = load_compiled_catalog(product)
    allowed_joins = {
        (j.get("from"), j.get("to"))
        for j in (compiled.get("joins") or [])
    }
    for join in job.joins:
        pair = (join.get("from"), join.get("to"))
        if allowed_joins and pair not in allowed_joins:
            raise SqlAgentError(
                f"Join {pair} not allowlisted for {product}",
                code="invalid_join",
            )

    if job.template_id:
        canonical = resolve_metric_alias(job.template_id) or job.template_id
        if not get_template(product, canonical):
            raise SqlAgentError(
                f"No certified template '{job.template_id}' for product {product}.",
                code="unknown_template",
            )
        if not is_certified(canonical, product=product):
            raise SqlAgentError(
                f"Metric '{canonical}' is not certified.",
                code="unknown_template",
            )
    return warnings


def constrained_to_executor_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
    job: ConstrainedJob,
    policy: dict[str, Any],
) -> tuple[ExecutorJob, list[str]]:
    """Inject org scope and compile a safe ExecutorJob (instruction-first guards)."""
    from sql_agent.mas.intent_kinds import is_scalar_instruction, normalize_intent
    from sql_agent.mas.metric_validator import validate_metric_against_instruction
    from sql_agent.mas.scope_clamp import clamp_scope_mode
    from sql_agent.mas.telemetry import log_request

    warnings: list[str] = []
    guard_action = "none"
    metric_reason: str | None = None
    product = normalize_product(job.product)
    from sql_agent.time_window import bounds_from_instruction

    gate_start, gate_end = bounds_from_instruction(req.instruction)
    if gate_start:
        plan.time_start = gate_start
        job.time_start = gate_start
    if gate_end:
        plan.time_end = gate_end
        job.time_end = gate_end
    ent = load_tenant_entitlements(req.organization_id)
    sku = _PRODUCT_SKU.get(product, product)
    if sku not in ent.skus and product not in ("hub", "cdp"):
        raise SqlAgentError(
            f"Product '{product}' not entitled for org {req.organization_id}",
            code="not_entitled",
        )

    scope = lookup_user_scope(
        req.organization_id,
        req.user_id,
        product=normalize_product(req.origin_product),
    )
    # Ensure table for count_scalar / list defaults
    if not job.table:
        job.table = "tickets" if product == "ticketing" else job.table
    tbl = get_table(product, job.table)
    channels: list[str] = []
    has_row_scope = bool(tbl.get("row_scope_column"))

    requested_scope = job.scope_mode or plan.scope_mode
    clamped_mode, was_clamped = clamp_scope_mode(
        caller_role=scope.role,
        requested=requested_scope,
        team_scope=bool(job.team_scope or plan.team_scope),
    )
    if was_clamped:
        guard_action = "scope_clamped"
        warnings.append(f"scope_clamped:org→{clamped_mode}")
        job.scope_mode = clamped_mode
        plan.scope_mode = clamped_mode

    intent = normalize_intent(
        str(plan.intent),
        has_group_by=bool(plan.group_by or job.group_by),
    )
    plan.intent = intent

    # --- branch order (instruction-first) ---
    if plan.group_by or job.group_by:
        executor, w = _group_count_executor_job(req, plan, job, product, scope, tbl)
        warnings.extend(w)
        plan.guard_action = guard_action
        log_request(
            gate_hint=plan.gate_hint,
            raw_plan=None,
            guard_action=guard_action,
            final_intent="count_grouped",
            metric_id=None,
            metric_reason=None,
            scope_mode=executor.scope,
            instruction=req.instruction,
        )
        return _fold_executor_time_filters(executor), warnings

    if intent == "list":
        if job.metric_id or job.template_id or plan.metric_id or plan.template_id:
            guard_action = "metric_stripped"
            warnings.append("metric_stripped:list_intent")
        job.metric_id = None
        job.template_id = None
        plan.metric_id = None
        plan.template_id = None
        executor, w = _list_executor_job(
            req, plan, job, product, scope, tbl, channels, has_row_scope
        )
        warnings.extend(w)
        plan.guard_action = guard_action
        log_request(
            gate_hint=plan.gate_hint,
            raw_plan=None,
            guard_action=guard_action,
            final_intent="list",
            metric_id=None,
            metric_reason="stripped" if guard_action == "metric_stripped" else None,
            scope_mode=executor.scope,
            instruction=req.instruction,
        )
        return _fold_executor_time_filters(executor), warnings

    if intent == "count_scalar":
        executor, w = _count_scalar_executor_job(
            req, plan, job, product, scope, tbl, has_row_scope
        )
        warnings.extend(w)
        plan.guard_action = guard_action
        log_request(
            gate_hint=plan.gate_hint,
            raw_plan=None,
            guard_action=guard_action,
            final_intent="count_scalar",
            metric_id=None,
            metric_reason=None,
            scope_mode=executor.scope,
            instruction=req.instruction,
        )
        return _fold_executor_time_filters(executor), warnings

    if intent == "kpi":
        mid = resolve_metric_alias(job.metric_id or job.template_id or plan.metric_id or "")
        if mid:
            validation = validate_metric_against_instruction(mid, req.instruction)
            if validation.ok:
                job.metric_id = mid
                job.template_id = mid
                executor, w = _kpi_executor_job(
                    req, plan, job, policy, product, scope, channels, tbl
                )
                # Clamp KPI org scope for agents
                if was_clamped or (
                    str(scope.role or "").lower() not in ("admin", "viewer")
                    and executor.scope == "org"
                ):
                    executor.scope = "assignee"
                    executor.visible_user_ids = [str(scope.user_id)]
                    guard_action = "scope_clamped"
                    warnings.append("scope_clamped:kpi_org→assignee")
                warnings.extend(w)
                plan.guard_action = guard_action
                log_request(
                    gate_hint=plan.gate_hint,
                    raw_plan=None,
                    guard_action=guard_action,
                    final_intent="kpi",
                    metric_id=mid,
                    metric_reason=validation.reason,
                    scope_mode=executor.scope,
                    instruction=req.instruction,
                )
                return _fold_executor_time_filters(executor), warnings
            guard_action = validation.guard_action
            metric_reason = validation.reason
            warnings.append(f"metric_rejected:{validation.reason}")
            # Downgrade to count_scalar with explicit filters
            if validation.fallback_filters:
                job.filters = list(job.filters) + list(validation.fallback_filters)
            job.metric_id = None
            job.template_id = None
            plan.metric_id = None
            plan.template_id = None
            plan.intent = "count_scalar"
            executor, w = _count_scalar_executor_job(
                req, plan, job, product, scope, tbl, has_row_scope
            )
            warnings.extend(w)
            plan.guard_action = guard_action
            log_request(
                gate_hint=plan.gate_hint,
                raw_plan=None,
                guard_action=guard_action,
                final_intent="count_scalar",
                metric_id=mid,
                metric_reason=metric_reason,
                scope_mode=executor.scope,
                instruction=req.instruction,
            )
            return _fold_executor_time_filters(executor), warnings

    # otherwise: scalar instruction → count_scalar else list
    if is_scalar_instruction(req.instruction):
        plan.intent = "count_scalar"
        executor, w = _count_scalar_executor_job(
            req, plan, job, product, scope, tbl, has_row_scope
        )
        warnings.extend(w)
        final = "count_scalar"
    else:
        plan.intent = "list"
        job.metric_id = None
        job.template_id = None
        executor, w = _list_executor_job(
            req, plan, job, product, scope, tbl, channels, has_row_scope
        )
        warnings.extend(w)
        final = "list"
    plan.guard_action = guard_action
    log_request(
        gate_hint=plan.gate_hint,
        raw_plan=None,
        guard_action=guard_action,
        final_intent=final,
        metric_id=None,
        metric_reason=metric_reason,
        scope_mode=executor.scope,
        instruction=req.instruction,
    )
    return _fold_executor_time_filters(executor), warnings


def _list_executor_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
    job: ConstrainedJob,
    product: str,
    scope: Any,
    tbl: dict[str, Any],
    channels: list[str],
    has_row_scope: bool,
) -> tuple[ExecutorJob, list[str]]:
    warnings: list[str] = []
    allowed = allowed_columns(tbl)
    from sql_agent.mas.intent_gate import is_created_by_me_instruction

    scope_mode = job.scope_mode or plan.scope_mode
    if product == "ticketing" and (
        is_created_by_me_instruction(req.instruction) or plan.scope_mode == "created_by"
    ):
        scope_mode = "created_by"
    list_scope = resolve_list_scope(
        product=product,
        table=job.table,
        instruction=req.instruction,
        has_row_scope=has_row_scope,
        caller_role=scope.role,
        scope_mode=scope_mode,
        team_scope=bool(job.team_scope or plan.team_scope),
    )
    if product == "ticketing":
        assert_ticketing_scope_allowed(
            scope,
            filters=list(job.filters) + list(plan.filters),
            scope_mode=list_scope,
            team_scope=bool(job.team_scope or plan.team_scope),
        )
    from sql_agent.ticketing_scope import list_scope_fields

    scope_fields = list_scope_fields(
        scope,
        product=product,
        list_scope=list_scope,
        personal_intent=False,
    )
    filters, filter_warnings = _parse_filters(
        job.filters,
        req,
        product,
        allowed=allowed,
        instruction=req.instruction,
        use_instruction_parser=product != "ticketing",
    )
    if product == "ticketing":
        from sql_agent.ticketing_resolve import drop_self_name_filters

        filters = drop_self_name_filters(filters)
    warnings.extend(filter_warnings)
    raw_limit = job.limit or plan.limit or 20
    limit = min(max(int(raw_limit), 1), 200)
    order_by = list(job.order_by)
    if not order_by:
        order_by = _default_list_order(job.table, req.instruction, allowed)
    executor = ExecutorJob(
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
        order_by=order_by,
        limit=limit,
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        my_queue_ids=list(scope_fields.get("my_queue_ids") or []),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        entitled_channels=channels,
        channel_column="channel"
        if job.table in ("mart_conversations", "tickets")
        else None,
        cdp_live=bool(job.cdp_live or plan.cdp_live),
        cdp_email=job.cdp_email or plan.cdp_email,
        time_start=job.time_start or plan.time_start,
        time_end=job.time_end or plan.time_end,
        time_grain=job.time_grain or plan.time_grain,
        instruction=req.instruction,
    )
    return _fold_executor_time_filters(executor), warnings


def _default_list_order(
    table: str,
    instruction: str | None,
    allowed: set[str],
) -> list[str]:
    """Default ORDER BY for list; priority-rank first when priority mentioned."""
    import re

    text = (instruction or "").lower()
    mentions_priority = bool(
        re.search(r"\b(priority|urgent|p0|p1|p2|p3|high|medium|low)\b", text)
    )
    if table == "tickets" and mentions_priority:
        if "priority" in allowed and "created_at" in allowed:
            return ["priority_rank ASC", "created_at DESC"]
        if "created_at" in allowed:
            return ["created_at DESC"]
    if "created_at" in allowed:
        return ["created_at DESC"]
    if "updated_at" in allowed:
        return ["updated_at DESC"]
    return []


def _count_scalar_executor_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
    job: ConstrainedJob,
    product: str,
    scope: Any,
    tbl: dict[str, Any],
    has_row_scope: bool,
) -> tuple[ExecutorJob, list[str]]:
    warnings: list[str] = []
    table = job.table or ("tickets" if product == "ticketing" else job.table)
    if product == "ticketing" and table != "tickets":
        # Prefer tickets for scalar ticket counts
        if "ticket" in (req.instruction or "").lower() or not table:
            table = "tickets"
    tbl_meta = get_table(product, table)
    allowed = allowed_columns(tbl_meta)
    list_scope = resolve_list_scope(
        product=product,
        table=table,
        instruction=req.instruction,
        has_row_scope=bool(tbl_meta.get("row_scope_column")),
        caller_role=scope.role,
        scope_mode=job.scope_mode or plan.scope_mode,
        team_scope=bool(job.team_scope or plan.team_scope),
    )
    if product == "ticketing":
        assert_ticketing_scope_allowed(
            scope,
            filters=list(job.filters) + list(plan.filters),
            scope_mode=list_scope,
            team_scope=bool(job.team_scope or plan.team_scope),
        )
    from semantic.ticketing_scope import list_scope_fields

    scope_fields = list_scope_fields(
        scope,
        product=product,
        list_scope=list_scope,
        personal_intent=False,
    )
    # Merge plan filters + job filters; also fold instruction-extracted if empty
    raw_filters = list(job.filters) + list(plan.filters)
    if not raw_filters and product == "ticketing":
        from sql_agent.mas.metric_validator import extract_instruction_filters

        raw_filters = extract_instruction_filters(req.instruction).as_plan_filters()
        _STATUS_TITLE = {
            "open": "Open",
            "pending": "Pending",
            "resolved": "Resolved",
            "closed": "closed",
            "overdue": "Overdue",
            "reopened": "Reopened",
        }
        for flt in raw_filters:
            if flt.get("column") == "status":
                flt["values"] = [
                    _STATUS_TITLE.get(str(v).lower(), v) for v in flt.get("values") or []
                ]
            if flt.get("column") == "priority":
                flt["values"] = [str(v).lower() for v in flt.get("values") or []]
    filters, filter_warnings = _parse_filters(
        raw_filters,
        req,
        product,
        allowed=allowed,
        instruction=req.instruction,
        use_instruction_parser=False,
    )
    if product == "ticketing":
        from sql_agent.ticketing_resolve import drop_self_name_filters

        filters = drop_self_name_filters(filters)
    warnings.extend(filter_warnings)
    return ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="count_scalar",
        product=product,
        engine=str(load_compiled_catalog(product).get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=table,
        schema=job.schema or str(tbl_meta.get("schema") or ""),
        select=[],
        filters=filters,
        limit=1,
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        my_queue_ids=list(scope_fields.get("my_queue_ids") or []),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(tbl_meta.get("row_scope_column") or "") or None,
        time_start=job.time_start or plan.time_start,
        time_end=job.time_end or plan.time_end,
        instruction=req.instruction,
    ), warnings


def _group_count_executor_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
    job: ConstrainedJob,
    product: str,
    scope: Any,
    tbl: dict[str, Any],
) -> tuple[ExecutorJob, list[str]]:
    warnings: list[str] = []
    group_by = list(job.group_by or plan.group_by)
    if not group_by:
        raise SqlAgentError(
            "group_count job requires group_by columns",
            code="invalid_plan",
        )
    table = job.table or "tickets"
    if product == "ticketing" and table != "tickets":
        table = "tickets"
        warnings.append(f"coerced_table:{job.table}→tickets")
    tbl_meta = get_table(product, table)
    allowed = allowed_columns(tbl_meta)
    has_row_scope = bool(tbl_meta.get("row_scope_column"))
    list_scope = resolve_list_scope(
        product=product,
        table=table,
        instruction=req.instruction,
        has_row_scope=has_row_scope,
        caller_role=scope.role,
        scope_mode=job.scope_mode or plan.scope_mode,
        team_scope=bool(job.team_scope or plan.team_scope),
    )
    if product == "ticketing":
        assert_ticketing_scope_allowed(
            scope,
            filters=list(job.filters) + list(plan.filters),
            scope_mode=list_scope,
            team_scope=bool(job.team_scope or plan.team_scope),
        )
    from semantic.ticketing_scope import list_scope_fields

    scope_fields = list_scope_fields(
        scope,
        product=product,
        list_scope=list_scope,
        personal_intent=False,
    )
    filters, filter_warnings = _parse_filters(
        job.filters,
        req,
        product,
        allowed=allowed,
        instruction=req.instruction,
        use_instruction_parser=product != "ticketing",
    )
    warnings.extend(filter_warnings)
    return ExecutorJob(
        job_id=str(uuid.uuid4()),
        mode="group_count",
        product=product,
        engine=str(load_compiled_catalog(product).get("engine") or "postgres"),
        organization_id=req.organization_id,
        user_id=req.user_id,
        table=table,
        schema=job.schema or str(tbl_meta.get("schema") or ""),
        select=[],
        filters=filters,
        limit=min(int(job.limit or plan.limit), 500),
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        my_queue_ids=list(scope_fields.get("my_queue_ids") or []),
        caller_role=scope_fields.get("caller_role"),
        scope_dual_assignee_resolver=bool(
            scope_fields.get("scope_dual_assignee_resolver")
        ),
        row_scope_column=str(tbl_meta.get("row_scope_column") or "assignee_id"),
        group_by=group_by,
        cdp_live=bool(job.cdp_live or plan.cdp_live),
        cdp_email=job.cdp_email or plan.cdp_email,
        time_start=job.time_start or plan.time_start,
        time_end=job.time_end or plan.time_end,
        time_grain=job.time_grain or plan.time_grain,
    ), warnings


def _kpi_executor_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
    job: ConstrainedJob,
    policy: dict[str, Any],
    product: str,
    scope: Any,
    channels: list[str],
    tbl: dict[str, Any],
) -> tuple[ExecutorJob, list[str]]:
    if job.group_by:
        raise SqlAgentError(
            "Scalar KPI templates cannot be used with group_by; use count breakdown.",
            code="invalid_plan",
        )
    if policy.get("list_only"):
        raise SqlAgentError(
            f"Agent '{req.origin_agent}' cannot run KPI queries. Route to reporting agent.",
            code="kpi_not_allowed",
        )
    metric_id = resolve_metric_alias(job.metric_id or job.template_id or "")
    if not metric_id:
        raise SqlAgentError(
            "KPI job missing metric_id or template_id",
            code="invalid_plan",
        )
    try:
        assert_metrics_allowed(policy, [metric_id])
    except AgentPolicyError as exc:
        raise SqlAgentError(str(exc), code="kpi_not_allowed") from exc
    if not get_template(product, metric_id):
        raise SqlAgentError(
            f"No SQL template for metric '{metric_id}' (product={product}).",
            code="unknown_template",
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
    filters, filter_warnings = _parse_filters(
        job.filters,
        req,
        product,
        allowed=allowed_columns(tbl_meta),
        use_instruction_parser=product != "ticketing",
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
        filters=filters,
        metric_id=metric_id,
        template_id=metric_id,
        prepared={},
        scope=scope_fields["scope"],
        visible_user_ids=list(scope_fields["visible_user_ids"]),
        my_queue_ids=list(getattr(scope, "my_queue_ids", None) or []),
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
        time_start=job.time_start or plan.time_start,
        time_end=job.time_end or plan.time_end,
    ), filter_warnings


def _parse_filters(
    raw_filters: list[dict[str, Any]],
    req: SqlQueryRequest,
    product: str,
    *,
    allowed: set[str] | None = None,
    instruction: str | None = None,
    use_instruction_parser: bool = True,
) -> tuple[list[SqlFilter], list[str]]:
    from sql_agent.super import _parse_instruction_filters

    warnings: list[str] = []
    parsed: list[SqlFilter] = []
    if use_instruction_parser:
        parsed = _parse_instruction_filters(
            instruction or req.instruction, req.filters, product
        )
    else:
        from sql_agent.instruction_filters import _from_raw

        parsed = _from_raw(req.filters)
    before = len(parsed)
    for raw in raw_filters or []:
        col = str(raw.get("column") or raw.get("dimension") or "").strip()
        if not col:
            continue
        if allowed is not None and col not in allowed:
            warnings.append(f"dropped_filter:{col}")
            continue
        parsed.append(
            SqlFilter(
                column=col,
                op=str(raw.get("op") or "eq"),
                values=list(raw.get("values") or []),
            )
        )
    if allowed is not None:
        kept = [f for f in parsed if f.column in allowed]
        dropped = [f.column for f in parsed if f.column not in allowed]
        for col in dropped:
            if f"dropped_filter:{col}" not in warnings:
                warnings.append(f"dropped_filter:{col}")
        parsed = kept
    if os.environ.get("SQL_AGENT_STRICT", "").strip() in ("1", "true", "yes"):
        if warnings:
            raise SqlAgentError(
                "Strict mode: dropped invalid columns/filters — "
                + "; ".join(warnings),
                code="strict_validation",
            )
        if before and not parsed:
            raise SqlAgentError(
                "Strict mode: all instruction filters were dropped.",
                code="strict_validation",
            )
    return parsed, warnings
