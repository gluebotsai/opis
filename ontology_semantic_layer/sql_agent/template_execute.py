"""Run certified scalar metrics via pre-approved SQL templates (semantic fast path)."""

from __future__ import annotations

from typing import Any

from semantic.capabilities import get_metric_capabilities
from semantic.scope import UserScope, lookup_user_scope
from sql_agent.agent_policy import metric_scope_mode
from sql_agent.catalog_loader import (
    get_table,
    load_product_catalog,
    resolve_channel_filter,
)
from sql_agent.job import ExecutorJob
from sql_agent.metric_fallback import execute_metric_fallback
from sql_agent.kpi_template_registry import get_template
def can_use_sql_template(prepared: dict[str, Any]) -> bool:
    """True when a mart template can answer without warehouse compile."""
    from sql_agent.product_aliases import normalize_sql_catalog_product

    metrics = prepared.get("metrics") or []
    if not metrics:
        return False
    if prepared.get("group_by_requested"):
        return False
    time_spec = prepared.get("time") or {}
    if time_spec.get("grain"):
        return False
    if prepared.get("user_filters"):
        return False

    product = normalize_sql_catalog_product(
        str(prepared.get("execution_product") or prepared.get("product") or "")
    )
    for mid in metrics:
        if not get_template(product, mid):
            return False
    return True


def _build_template_job(prepared: dict[str, Any], metric_id: str) -> ExecutorJob:
    from sql_agent.product_aliases import normalize_sql_catalog_product

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
    scope_mode = metric_scope_mode(metric_id, raw_product)
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
        scope=scope_mode,
        visible_user_ids=list(scope.visible_user_ids),
        row_scope_column=str(row_col) if row_col else None,
        entitled_channels=entitled_channels,
        channel_column=channel_column,
        time_column=meta.get("time_column"),
    )


def _default_table_for_product(product: str) -> str:
    defaults = {
        "ticketing": "tickets",
        "ccaas": "mart_conversations",
        "crm": "mart_deals",
        "campaign": "mart_campaign_overview",
        "webtracking": "mart_web_sessions",
    }
    return defaults.get(product, "tickets")


def execute_prepared_templates(prepared: dict[str, Any]) -> dict[str, Any]:
    """Execute one or more template metrics; merge rows for multi-metric scalars."""
    metrics = list(prepared["metrics"])
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
