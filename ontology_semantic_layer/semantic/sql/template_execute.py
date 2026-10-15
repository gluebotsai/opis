"""Run certified scalar metrics via pre-approved SQL templates (semantic fast path)."""

from __future__ import annotations

from typing import Any

from semantic.capabilities import get_metric_capabilities
from semantic.scope import UserScope, lookup_user_scope
from semantic.sql.catalog_loader import (
    get_table,
    load_product_catalog,
    resolve_channel_filter,
)
from semantic.sql.job import ExecutorJob, SqlFilter
from semantic.sql.metric_fallback import execute_metric_fallback
from semantic.sql.metric_template_registry import get_template


def can_use_sql_template(prepared: dict[str, Any]) -> bool:
    """True when a mart template can answer without MetricFlow compile."""
    from semantic.sql.product_aliases import normalize_sql_catalog_product

    metrics = prepared.get("metrics") or []
    if not metrics:
        return False

    product = normalize_sql_catalog_product(
        str(prepared.get("execution_product") or prepared.get("product") or "")
    )
    # Webtracking is ClickHouse-only: always use templates when present
    # (including group_by / filters / grain).
    # Ticketing: allow templates for scalars + group_by/filters so boolean and
    # categorical dims return full bucket series without MF fallback.
    is_wt = product in ("webtracking", "web_tracking")
    if not is_wt:
        time_spec = prepared.get("time") or {}
        if time_spec.get("grain"):
            return False

    for mid in metrics:
        if not get_template(product, mid):
            return False
    return True


def _filters_from_prepared(prepared: dict[str, Any]) -> list[SqlFilter]:
    from semantic.sql.webtracking_dims import normalize_webtracking_dim

    out: list[SqlFilter] = []
    product = str(prepared.get("execution_product") or prepared.get("product") or "")
    is_wt = product.lower() in ("webtracking", "web_tracking")
    is_tk = product.lower() in ("ticketing", "tk")
    for flt in prepared.get("user_filters") or []:
        dim = str(flt.get("dimension") or "")
        if is_wt:
            dim = normalize_webtracking_dim(dim)
        elif is_tk:
            dim = _normalize_ticketing_dim(dim)
        if dim == "website_id":
            # Applied via website scope, not as duplicate filter
            continue
        vals = list(flt.get("values") or [])
        if not dim or not vals:
            continue
        out.append(
            SqlFilter(
                column=dim,
                op=str(flt.get("op") or "eq"),
                values=vals,
            )
        )
    return out


def _group_by_from_prepared(prepared: dict[str, Any]) -> list[str]:
    from semantic.sql.webtracking_dims import normalize_webtracking_dims

    product = str(prepared.get("execution_product") or prepared.get("product") or "")
    raw = list(prepared.get("group_by_requested") or prepared.get("group_by") or [])
    # Drop MF entity prefixes / metric_time for CH path
    cleaned = [g for g in raw if g and not str(g).startswith("metric_time")]
    # Strip MF entity prefixes (ticket__assignee_name → assignee_name)
    short = []
    for g in cleaned:
        s = str(g)
        if "__" in s:
            s = s.split("__", 1)[-1]
        short.append(s)
    if product.lower() in ("webtracking", "web_tracking"):
        return normalize_webtracking_dims(short)
    if product.lower() in ("ticketing", "tk"):
        return [_normalize_ticketing_dim(s) for s in short]
    return short


_TICKETING_DIM_ALIASES = {
    "agent_name": "assignee_name",
    "assigned_agent_name": "assignee_name",
}


def _normalize_ticketing_dim(name: str) -> str:
    n = str(name or "").strip()
    if "__" in n:
        n = n.split("__", 1)[-1]
    return _TICKETING_DIM_ALIASES.get(n, n)


_WINDOW_ALIAS_PERIODS = {
    "tickets_last_30_days": "last_30_days",
    "tickets_last_7_days": "last_7_days",
    "tickets_created_today_metric": "today",
}


def _prepared_with_alias_window(prepared: dict[str, Any], metric_id: str) -> dict[str, Any]:
    """Fill calendar last-N (today + previous N-1 days) when the client omitted time."""
    period = _WINDOW_ALIAS_PERIODS.get(metric_id)
    if not period:
        return prepared
    time_spec = dict(prepared.get("time") or {})
    if time_spec.get("start") or time_spec.get("end"):
        return prepared
    from semantic.time_resolver import resolve_time_window

    filled = resolve_time_window({"period": period, **time_spec})
    out = dict(prepared)
    out["time"] = filled
    return out


def _build_template_job(prepared: dict[str, Any], metric_id: str) -> ExecutorJob:
    from semantic.sql.product_aliases import normalize_sql_catalog_product

    prepared = _prepared_with_alias_window(prepared, metric_id)
    raw_product = str(prepared.get("execution_product") or prepared["product"])
    product = normalize_sql_catalog_product(raw_product)
    org_id = int(prepared["organizationId"])
    user_id = int(prepared["userId"])
    scope_obj = prepared.get("user_scope")
    if isinstance(scope_obj, UserScope):
        scope = scope_obj
    else:
        scope = lookup_user_scope(org_id, user_id, product=raw_product)
    channels: list[str] = []
    cap = get_metric_capabilities(metric_id, product=raw_product)
    data_scope = prepared.get("dataScope") or prepared.get("data_scope")
    user_filters = prepared.get("user_filters") or []
    from semantic.ticketing_scope import job_scope_fields

    scope_fields = job_scope_fields(
        scope,
        metric_id,
        product=raw_product,
        data_scope=data_scope,
        filters=user_filters,
    )
    meta = get_template(product, metric_id) or {}
    table = str(meta.get("table") or _default_table_for_product(product))
    engine = str(meta.get("engine") or "postgres")
    schema = str(meta.get("schema") or "")
    row_col = meta.get("row_scope_column")

    if meta.get("sql"):
        try:
            cat = load_product_catalog(product)
            engine = str(cat.get("engine") or engine)
            if not schema and table:
                try:
                    tbl = get_table(product, table)
                    schema = str(tbl.get("schema") or cat.get("default_schema") or "")
                    if not row_col:
                        row_col = tbl.get("row_scope_column")
                except ValueError:
                    schema = str(cat.get("default_schema") or schema)
        except ValueError:
            pass
    else:
        cat = load_product_catalog(product)
        engine = str(cat.get("engine") or engine)
        tbl = get_table(product, table) if table else {}
        schema = str(tbl.get("schema") or cat.get("default_schema") or "")
        if not row_col:
            row_col = tbl.get("row_scope_column")

    entitled_channels, channel_column = resolve_channel_filter(
        product,
        table,
        channel_scoped=bool(cap.get("channel_scoped")),
        channels=channels,
    )

    return ExecutorJob(
        job_id=f"tpl-{metric_id}",
        mode="metric_fallback",
        product=product,
        engine=engine,
        organization_id=org_id,
        user_id=user_id,
        table=table,
        schema=schema,
        select=[],
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
        filters=_filters_from_prepared(prepared),
        group_by=_group_by_from_prepared(prepared),
        limit=int(prepared.get("limit") or 50),
    )


def _default_table_for_product(product: str) -> str:
    defaults = {
        "ticketing": "mart_tickets",
        "ccaas": "mart_conversations",
        "crm": "mart_deals",
        "campaign": "mart_campaign_overview",
        "webtracking": "mart_web_sessions",
    }
    return defaults.get(product, "mart_tickets")


def execute_prepared_templates(prepared: dict[str, Any]) -> dict[str, Any]:
    """Execute one or more template metrics; merge rows for multi-metric scalars."""
    metrics = list(prepared["metrics"])
    product = str(prepared.get("execution_product") or prepared.get("product") or "")
    if product.lower() in ("webtracking", "web_tracking") and prepared.get(
        "group_by_requested"
    ):
        # Multi-metric + group_by not supported in one shot
        if len(metrics) > 1:
            raise ValueError(
                "webtracking group_by supports one metric at a time"
            )

    if len(metrics) == 1:
        job = _build_template_job(prepared, metrics[0])
        result = execute_metric_fallback(job)
        return {
            "rows": result.get("rows") or [],
            "sql": result.get("sql"),
        }

    combined: dict[str, Any] = {}
    sql_parts: list[str] = []
    for mid in metrics:
        job = _build_template_job(prepared, mid)
        part = execute_metric_fallback(job)
        rows = part.get("rows") or []
        if rows:
            combined[mid] = rows[0].get(mid)
        if part.get("sql"):
            sql_parts.append(str(part["sql"]))
    return {"rows": [combined] if combined else [], "sql": sql_parts}
