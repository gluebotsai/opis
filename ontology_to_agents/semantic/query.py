"""Semantic query gateway — certify, allowlist, scope, MetricFlow execute."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

from ontology.slice import normalize_product_id
from semantic.capabilities import get_metric_capabilities, resolve_execution_product
from semantic.context import resolve_context
from semantic.entitlements import load_tenant_entitlements
from semantic.lookup import get_allowed_dims, get_metric_policy, is_certified
from semantic.metricflow.dimension_resolver import (
    DimensionResolveError,
    entity_from_ontology_type,
    resolve_group_by_for_metrics,
)
from semantic.metricflow.manifest_resolver import ManifestNotFoundError, resolve_manifest_dir
from semantic.scope import lookup_user_scope, owner_filter_clauses, scope_summary
from semantic.thresholds import build_interpretation
from semantic.time_resolver import ALLOWED_TIME_GRAINS, resolve_time_window


class QueryValidationError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        suggestions: list[str] | None = None,
        code: str | None = None,
        website_id: int | None = None,
    ):
        super().__init__(message)
        self.suggestions = list(suggestions or [])
        self.code = code
        self.website_id = website_id


class MetricFlowUnavailableError(RuntimeError):
    pass


class WarehouseQueryError(RuntimeError):
    """Postgres / ClickHouse execution failed (missing table, SQL error)."""


class SemanticQueryExecutionError(RuntimeError):
    """Unexpected MetricFlow or adapter failure after validation."""


@dataclass
class SemanticQuery:
    organization_id: int
    user_id: int
    product: str
    agent: str
    metrics: list[str]
    group_by: list[str] | None = None
    filters: list[dict[str, Any]] | None = None
    time: dict[str, str] | None = None
    order_by: list[str] | None = None
    limit: int | None = 50
    data_scope: str | None = None
    website_id: int | None = None


def _allowlisted_metrics(
    agent: str,
    product: str,
    organization_id: int,
    user_id: int,
) -> set[str]:
    ctx = resolve_context(
        organization_id=organization_id,
        user_id=user_id,
        agent=agent,
        product=product,
    )
    return ctx.visible_set()


def _channel_entitlement_clauses(
    metric_ids: list[str],
    *,
    product: str,
    organization_id: int,
    metric_names: list[str],
) -> list[str]:
    ent = load_tenant_entitlements(organization_id)
    channels = ent.channels_for_product(product)
    if not channels:
        return []
    needs_scope = any(
        get_metric_capabilities(mid).get("channel_scoped") for mid in metric_ids
    )
    if not needs_scope:
        return []
    try:
        resolved = _resolve_dimensions(
            product, organization_id, metric_names, ["channel"]
        )
    except (QueryValidationError, MetricFlowUnavailableError):
        return []
    if not resolved:
        return []
    mf_dim = resolved[0]
    quoted = ", ".join(f"'{c}'" for c in channels)
    return [f"{{{{ Dimension('{mf_dim}') }}}} IN ({quoted})"]


_DIM_ALIASES: dict[str, tuple[str, ...]] = {
    "channel": ("channel", "source_channel", "channel_name"),
    "direction": ("direction",),
    "campaign_name": ("campaign_name",),
    "queue_name": ("queue_name",),
    "priority": ("priority",),
    "stage": ("stage",),
    "status": ("status",),
    # Ticketing uses assignee_name; CCaaS uses agent_name / assigned_agent_name.
    "agent_name": ("agent_name", "assigned_agent_name", "assignee_name"),
    "assigned_agent_name": ("assigned_agent_name", "agent_name", "assignee_name"),
    "assignee_name": ("assignee_name", "agent_name", "assigned_agent_name"),
}


_TICKETING_DIM_NAME_MAP = {
    "agent_name": "assignee_name",
    "assigned_agent_name": "assignee_name",
}


def _normalize_ticketing_dim_name(name: str) -> str:
    n = str(name or "").strip()
    if "__" in n:
        n = n.split("__", 1)[-1]
    return _TICKETING_DIM_NAME_MAP.get(n, n)


def _is_metric_time_dim(dim: str) -> bool:
    return dim == "metric_time" or dim.startswith("metric_time__")


def _dim_allowed(metric_id: str, dim: str, allowed: set[str]) -> bool:
    if dim in allowed:
        return True
    for policy_dim in allowed:
        suffixes = _DIM_ALIASES.get(policy_dim, (policy_dim,))
        if any(dim == s or dim.endswith(f"__{s}") for s in suffixes):
            return True
    return False


def _validate_dims(
    metric_id: str, dims: list[str], *, product: str | None = None
) -> None:
    dims = [d for d in dims if not _is_metric_time_dim(d)]
    allowed = set(get_allowed_dims(metric_id, product=product))
    if not allowed:
        return
    bad = [d for d in dims if not _dim_allowed(metric_id, d, allowed)]
    if bad:
        raise QueryValidationError(
            f"Dimension(s) {bad} not allowed for metric '{metric_id}'. "
            f"Allowed: {', '.join(sorted(allowed))}"
        )


def _resolve_dimensions(
    product: str,
    organization_id: int,
    metric_names: list[str],
    names: list[str],
) -> list[str]:
    if not names:
        return []
    try:
        manifest_dir = resolve_manifest_dir(product, str(organization_id))
        policy = get_metric_policy(metric_names[0], product=product)
        hint = entity_from_ontology_type(policy.get("on"))
        return resolve_group_by_for_metrics(
            manifest_dir, metric_names, names, hint_entity=hint
        )
    except ManifestNotFoundError as exc:
        raise MetricFlowUnavailableError(str(exc)) from exc
    except DimensionResolveError as exc:
        raise QueryValidationError(str(exc), suggestions=exc.suggestions) from exc


def _normalize_filter(flt: dict[str, Any]) -> dict[str, Any]:
    """Coerce common agent/client filter shapes to internal schema."""
    out = dict(flt)
    op = str(out.get("op") or out.get("operator") or "eq").strip().lower()
    if op in ("equals", "equal", "=="):
        op = "eq"
    elif op in ("not_equals", "not_equal", "!="):
        op = "neq"
    out["op"] = op

    values = out.get("values")
    if not values:
        singular = out.get("value")
        if singular is not None and singular != "":
            values = [singular] if not isinstance(singular, list) else singular
    out["values"] = list(values or [])
    return out


def _filters_to_where(
    filters: list[dict[str, Any]],
    metric_id: str,
    *,
    product: str,
    organization_id: int,
    metric_names: list[str],
) -> list[str]:
    clauses: list[str] = []
    for raw in filters:
        flt = _normalize_filter(raw)
        dim = str(flt.get("dimension") or "").strip()
        op = str(flt.get("op") or "eq").strip().lower()
        values = flt.get("values") or []
        if not dim:
            raise QueryValidationError("Each filter requires dimension.")
        _validate_dims(metric_id, [dim], product=product)
        resolved = _resolve_dimensions(product, organization_id, metric_names, [dim])
        mf_dim = resolved[0] if resolved else dim
        dim_expr = f"{{{{ Dimension('{mf_dim}') }}}}"
        if op in ("in", "not_in", "not in"):
            if not values:
                raise QueryValidationError(f"Filter on {dim} requires values.")
            sql_op = "NOT IN" if "not" in op else "IN"
            quoted = ", ".join(f"'{v}'" for v in values)
            clauses.append(f"{dim_expr} {sql_op} ({quoted})")
        elif op in ("eq", "="):
            if not values:
                raise QueryValidationError(f"Filter on {dim} requires values.")
            clauses.append(f"{dim_expr} = '{values[0]}'")
        elif op in ("neq", "not_eq", "!="):
            if not values:
                raise QueryValidationError(f"Filter on {dim} requires values.")
            clauses.append(f"{dim_expr} != '{values[0]}'")
        elif op in ("contains", "like", "ilike"):
            if not values:
                raise QueryValidationError(f"Filter on {dim} requires values.")
            needle = str(values[0]).replace("'", "''")
            clauses.append(f"{dim_expr} ILIKE '%{needle}%'")
        else:
            raise QueryValidationError(f"Unsupported filter op '{op}' on {dim}.")
    return clauses


def _coerce_null_metrics(metrics: list[str], rows: list[dict]) -> list[dict]:
    """MetricFlow returns NULL for zero-count/rate aggregates; agents expect 0."""
    if not rows:
        return rows
    from semantic.thresholds import merge_threshold

    coerce_metrics: set[str] = set()
    for mid in metrics:
        try:
            kind = merge_threshold(mid).get("kind")
            if kind in ("count", "rate"):
                coerce_metrics.add(mid)
        except ValueError:
            pass
    if not coerce_metrics:
        return rows
    out: list[dict] = []
    for row in rows:
        patched = dict(row)
        for mid in coerce_metrics:
            if mid in patched and patched[mid] is None:
                patched[mid] = 0
        out.append(patched)
    return out


def _coerce_null_count_metrics(metrics: list[str], rows: list[dict]) -> list[dict]:
    return _coerce_null_metrics(metrics, rows)


def _parse_mf_suggestions(message: str) -> list[str]:
    """Extract suggestion list from MetricFlow InvalidQueryException text."""
    match = re.search(r"Suggestions:\s*\[(.*?)\]", message, re.DOTALL)
    if not match:
        return []
    raw = match.group(1)
    return [s.strip().strip("'\"") for s in raw.split(",") if s.strip()]


def _classify_metricflow_error(exc: Exception) -> Exception:
    name = type(exc).__name__
    text = str(exc)

    if name == "ManifestNotFoundError":
        return MetricFlowUnavailableError(text)
    if name == "InvalidQueryException":
        return QueryValidationError(
            text.split("\n\n")[0] if text else "Invalid semantic query.",
            suggestions=_parse_mf_suggestions(text),
        )
    if name == "DbtDatabaseError" or "Database Error" in text:
        return WarehouseQueryError(text)
    if name == "RuntimeError" and "adapter" in text.lower():
        return MetricFlowUnavailableError(text)
    if name in ("ImportError", "ModuleNotFoundError"):
        return MetricFlowUnavailableError(text)
    return SemanticQueryExecutionError(text or name)


def validate_and_prepare(query: SemanticQuery) -> dict[str, Any]:
    product = normalize_product_id(query.product)
    if not query.metrics:
        raise QueryValidationError("metrics must be a non-empty list.")

    try:
        execution_product, engine = resolve_execution_product(
            query.metrics, product
        )
    except ValueError as exc:
        raise QueryValidationError(str(exc)) from exc

    # Website tenancy before agent allowlist so foreign/missing websiteId
    # always returns website_not_entitled / website_id_required (not agent errors).
    if execution_product in ("webtracking", "web_tracking"):
        from semantic.webtracking_entitlement import (
            WebsiteEntitlementError,
            assert_webtracking_website_entitled,
        )

        try:
            query.website_id = assert_webtracking_website_entitled(
                query.organization_id, query.website_id
            )
        except WebsiteEntitlementError as exc:
            raise QueryValidationError(
                str(exc),
                code=exc.code,
                website_id=exc.website_id,
            ) from exc

    allowlist = _allowlisted_metrics(
        query.agent, execution_product, query.organization_id, query.user_id
    )
    for mid in query.metrics:
        if not is_certified(mid):
            raise QueryValidationError(f"Metric '{mid}' is not certified.")
        if mid not in allowlist:
            from semantic.lookup import resolve_metric_alias

            canonical = resolve_metric_alias(mid)
            if canonical == mid or canonical not in allowlist:
                raise QueryValidationError(
                    f"Metric '{mid}' is not entitled for agent '{query.agent}' "
                    f"(organization {query.organization_id})."
                )

    group_by_requested = list(query.group_by or [])
    user_filters = list(query.filters or [])
    if execution_product in ("webtracking", "web_tracking"):
        from semantic.sql.webtracking_dims import (
            normalize_webtracking_dims,
            normalize_webtracking_filters,
        )

        group_by_requested = normalize_webtracking_dims(group_by_requested)
        user_filters = normalize_webtracking_filters(user_filters)
    elif execution_product in ("ticketing", "tk"):
        group_by_requested = [_normalize_ticketing_dim_name(d) for d in group_by_requested]
        for flt in user_filters:
            dim = str(flt.get("dimension") or "")
            if dim:
                flt["dimension"] = _normalize_ticketing_dim_name(dim)

    for mid in query.metrics:
        _validate_dims(mid, group_by_requested, product=execution_product)
        for flt in user_filters:
            dim = str(flt.get("dimension") or "")
            if dim and dim != "website_id":
                _validate_dims(mid, [dim], product=execution_product)

    raw_time = dict(query.time or {})
    if execution_product in ("webtracking", "web_tracking"):
        from semantic.time_resolver import apply_webtracking_month_rolling

        raw_time = apply_webtracking_month_rolling(raw_time)
    time_spec = resolve_time_window(raw_time)
    start = time_spec.get("start")
    end = time_spec.get("end")
    grain = time_spec.get("grain")
    if grain and grain not in ALLOWED_TIME_GRAINS:
        raise QueryValidationError(
            f"time.grain must be one of: {', '.join(sorted(ALLOWED_TIME_GRAINS))}."
        )

    # Webtracking stays on CH templates — keep short dim names, skip MF resolve.
    if execution_product in ("webtracking", "web_tracking"):
        group_by = list(group_by_requested)
    else:
        needs_dim_resolve = bool(group_by_requested or user_filters or grain)
        if needs_dim_resolve:
            group_by = _resolve_dimensions(
                execution_product,
                query.organization_id,
                query.metrics,
                group_by_requested,
            )
        else:
            group_by = []

    scope = lookup_user_scope(
        query.organization_id, query.user_id, product=execution_product
    )
    from semantic.scope import apply_ticketing_visible_ids

    apply_ticketing_visible_ids(
        scope,
        data_scope=query.data_scope,
        filters=user_filters,
    )
    where: list[str] = []
    for mid in query.metrics:
        where.extend(
            owner_filter_clauses(
                scope,
                metric_id=mid,
                product=execution_product,
                data_scope=query.data_scope,
                filters=user_filters,
            )
        )

    where.extend(
        _channel_entitlement_clauses(
            query.metrics,
            product=execution_product,
            organization_id=query.organization_id,
            metric_names=query.metrics,
        )
    )

    if query.filters:
        # Webtracking filters are applied on the CH template path via user_filters.
        # Do not build MetricFlow Dimension() clauses (fails without a PG manifest).
        if execution_product not in ("webtracking", "web_tracking"):
            where.extend(
                _filters_to_where(
                    user_filters,
                    query.metrics[0],
                    product=execution_product,
                    organization_id=query.organization_id,
                    metric_names=query.metrics,
                )
            )

    seen_where: set[str] = set()
    deduped_where: list[str] = []
    for clause in where:
        if clause not in seen_where:
            seen_where.add(clause)
            deduped_where.append(clause)
    where = deduped_where

    if grain and execution_product not in ("webtracking", "web_tracking"):
        metric_time_dim = f"metric_time__{grain}"
        if metric_time_dim not in group_by:
            group_by.append(metric_time_dim)

    time_out: dict[str, Any] | None = None
    if start or end or grain or time_spec.get("period"):
        time_out = {"start": start, "end": end, "grain": grain}
        if time_spec.get("period"):
            time_out["period"] = time_spec.get("period")

    return {
        "organizationId": query.organization_id,
        "userId": query.user_id,
        "product": product,
        "execution_product": execution_product,
        "engine": engine,
        "agent": query.agent,
        "metrics": query.metrics,
        "group_by": group_by,
        "group_by_requested": group_by_requested,
        "where": where,
        "time": time_out,
        "order_by": query.order_by,
        "limit": query.limit,
        "scope": scope_summary(scope),
        "user_scope": scope,
        "policies": {
            m: get_metric_policy(m, product=execution_product)
            for m in query.metrics
        },
        "user_filters": user_filters,
        "dataScope": query.data_scope,
        "data_scope": query.data_scope,
        "websiteId": query.website_id,
        "website_id": query.website_id,
    }


def _build_result(
    prepared: dict[str, Any],
    row_list: list[dict],
    *,
    source: str,
    sql: Any,
    path: str,
    prepare_ms: int = 0,
    compile_ms: int = 0,
    warehouse_ms: int = 0,
) -> dict[str, Any]:
    org_id = prepared["organizationId"]
    return {
        "organizationId": org_id,
        "product": prepared["product"],
        "metrics": prepared["metrics"],
        "group_by": prepared.get("group_by_requested") or prepared.get("group_by"),
        "group_by_resolved": prepared.get("group_by"),
        "scope": prepared["scope"],
        "rows": row_list,
        "sql": sql,
        "interpretation": build_interpretation(
            prepared["metrics"], row_list, org_id
        ),
        "source": source,
        "_timing": {
            "path": path,
            "prepare_ms": prepare_ms,
            "compile_ms": compile_ms,
            "warehouse_ms": warehouse_ms,
        },
    }


def execute(query: SemanticQuery) -> dict[str, Any]:
    prep_t0 = time.monotonic()
    try:
        prepared = validate_and_prepare(query)
    except (QueryValidationError, MetricFlowUnavailableError):
        raise
    except Exception as exc:
        raise _classify_metricflow_error(exc) from exc
    prepare_ms = int((time.monotonic() - prep_t0) * 1000)

    from semantic.sql.template_execute import (
        can_use_sql_template,
        execute_prepared_templates,
    )

    if can_use_sql_template(prepared):
        t0 = time.monotonic()
        try:
            tpl = execute_prepared_templates(prepared)
        except Exception as exc:
            from semantic.sql.webtracking_dim_catalog import DimensionNotJoinable

            if isinstance(exc, DimensionNotJoinable):
                raise QueryValidationError(
                    str(exc),
                    code=exc.code,
                ) from exc
            raise WarehouseQueryError(str(exc)) from exc
        warehouse_ms = int((time.monotonic() - t0) * 1000)
        row_list = _coerce_null_count_metrics(
            prepared["metrics"], tpl.get("rows", [])
        )
        return _build_result(
            prepared,
            row_list,
            source="sql_template",
            sql=tpl.get("sql"),
            path="sql_template",
            prepare_ms=prepare_ms,
            warehouse_ms=warehouse_ms,
        )

    if str(prepared.get("execution_product") or prepared.get("product") or "").lower() in (
        "webtracking",
        "web_tracking",
    ):
        raise QueryValidationError(
            "webtracking metrics require a ClickHouse SQL template; "
            "MetricFlow/Postgres path is disabled for this product."
        )

    try:
        from semantic.metricflow.engine import run_metricflow_query
    except ImportError as exc:
        raise MetricFlowUnavailableError(
            "MetricFlow dependencies are not installed."
        ) from exc

    try:
        rows = run_metricflow_query(prepared)
    except (QueryValidationError, MetricFlowUnavailableError, WarehouseQueryError):
        raise
    except Exception as exc:
        from semantic.metricflow.engine import TenantIsolationError

        if isinstance(exc, TenantIsolationError):
            raise MetricFlowUnavailableError(str(exc)) from exc
        raise _classify_metricflow_error(exc) from exc

    row_list = _coerce_null_count_metrics(prepared["metrics"], rows.get("rows", []))
    mf_path = str(rows.get("path") or "mf_compile")
    return _build_result(
        prepared,
        row_list,
        source="metricflow",
        sql=rows.get("sql"),
        path=mf_path,
        prepare_ms=prepare_ms,
        compile_ms=int(rows.get("compile_ms") or 0),
        warehouse_ms=int(rows.get("warehouse_ms") or 0),
    )


def _dim_short_name(col: str) -> str:
    if col == "metric_time" or col.startswith("metric_time__"):
        return col
    if "__" in col:
        return col.split("__", 1)[1]
    return col


def _fanout_join_keys(query: SemanticQuery) -> list[str]:
    keys = list(query.group_by or [])
    grain = (query.time or {}).get("grain")
    if grain:
        time_key = f"metric_time__{grain}"
        if time_key not in keys:
            keys.append(time_key)
    return keys


def _merge_fanout_rows(
    rows_by_metric: dict[str, list[dict]],
    metrics: list[str],
    join_keys: list[str],
) -> list[dict[str, Any]]:
    """Merge per-metric fan-out rows on normalized dimension keys."""
    if not join_keys:
        combined: dict[str, Any] = {}
        for mid in metrics:
            rows = rows_by_metric.get(mid) or []
            if rows:
                combined[mid] = rows[0].get(mid)
        return [combined] if combined else []

    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    for mid in metrics:
        for row in rows_by_metric.get(mid) or []:
            norm: dict[str, Any] = {}
            for k, v in row.items():
                norm[_dim_short_name(k)] = v
            key = tuple(norm.get(k) for k in join_keys)
            bucket = merged.setdefault(key, {})
            for k in join_keys:
                if k in norm:
                    bucket[k] = norm[k]
            if mid in norm:
                bucket[mid] = norm[mid]
    return list(merged.values())


def execute_multi(query: SemanticQuery) -> dict[str, Any]:
    """Try one MetricFlow call; fan-out per metric and merge on org grain if incompatible."""
    if len(query.metrics) <= 1:
        return execute(query)

    try:
        return execute(query)
    except (QueryValidationError, SemanticQueryExecutionError):
        pass

    rows_by_metric: dict[str, list[dict]] = {}
    sql_parts: list[str] = []
    scope: dict[str, Any] = {}
    product: str | None = None

    for mid in query.metrics:
        sub = SemanticQuery(
            organization_id=query.organization_id,
            user_id=query.user_id,
            product=query.product,
            agent=query.agent,
            metrics=[mid],
            group_by=query.group_by,
            filters=query.filters,
            time=query.time,
            order_by=query.order_by,
            limit=query.limit,
        )
        part = execute(sub)
        rows_by_metric[mid] = part.get("rows") or []
        scope = part.get("scope") or scope
        product = part.get("product") or product
        if part.get("sql"):
            sql_parts.append(str(part["sql"]))

    join_keys = _fanout_join_keys(query)
    merged_rows = _merge_fanout_rows(rows_by_metric, query.metrics, join_keys)

    return {
        "organizationId": query.organization_id,
        "product": product,
        "metrics": query.metrics,
        "group_by": query.group_by,
        "scope": scope,
        "rows": merged_rows,
        "sql": sql_parts,
        "execution": "fan_out",
        "source": "metricflow",
    }
