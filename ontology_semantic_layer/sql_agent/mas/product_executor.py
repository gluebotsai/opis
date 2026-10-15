"""Gemma product executor — fill ConstrainedJob from preset slice."""

from __future__ import annotations

import json
from typing import Any

from sql_agent.compiled_catalog import load_compiled_catalog
from sql_agent.mas.super_planner import _plan_catalog_product
from sql_agent.router import default_table
from sql_agent.job import SqlQueryRequest
from sql_agent.mas.gemma_client import GemmaParseError, chat_json
from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan
from sql_agent.presets.loader import list_select_columns, load_preset, preset_executor_slice


def _resolve_table_name(table: str, allowed: set[str], *, product: str = "") -> str:
    if not allowed:
        return table
    if table in allowed:
        return table
    if product == "ticketing":
        return table
    if not table.startswith("mart_"):
        candidate = f"mart_{table}"
        if candidate in allowed:
            return candidate
    if table.endswith("s") and not table.startswith("mart_") and product != "ticketing":
        candidate = f"mart_{table}"
        if candidate in allowed:
            return candidate
    return table


_EXECUTOR_SYSTEM = """You are a read-only SQL job builder for Postgres marts.
Return ONLY valid JSON with keys:
  table: allowlisted table name
  select: array of column names (or empty for KPI templates)
  filters: array of {column, op, values}
  order_by: optional array of "column asc|desc"
  limit: optional integer
  template_id: optional certified template id (kpi only)
  metric_id: optional certified metric id (kpi only)
  joins: optional array of allowlisted join specs (from catalog only)

Never emit SQL or a sql field. Use only tables/columns from the preset catalog.

Instruction breakdown (every job):
- Re-read the user instruction. Infer result kind (entity list vs scalar vs grouped vs KPI), the entity, constraints (filters/time/scope/sort/limit), and named extras.
- Constraints go in filters, time bounds, order_by, and limit. They must not shrink select to those columns alone.
- Time windows go in time_start/time_end as YYYY-MM-DD (same date on both for a named day). Never emit created_at filters, including eq.
- list: start from catalog.default_select, then add extras the instruction names that exist on the table. Return enough columns to identify the entity, not a single attribute.
- Do not invent tables, columns, joins, filters, or metrics.
"""


def build_constrained_job(
    req: SqlQueryRequest,
    plan: SqlPlan,
) -> ConstrainedJob:
    """Map planner output to a constrained executor job (no raw SQL)."""
    if plan.constrained_job is not None:
        return plan.constrained_job
    if plan.is_executor_skippable():
        return _from_plan(plan)
    try:
        return _gemma_executor(req, plan)
    except GemmaParseError:
        return _from_plan(plan)


def _from_plan(plan: SqlPlan) -> ConstrainedJob:
    spec = load_preset(plan.preset_id)
    product = _plan_catalog_product(plan)
    cat = load_compiled_catalog(product)
    allowed = set(spec.get("tables") or [])
    table = plan.table or spec.get("default_table") or default_table(None, product)
    table = _resolve_table_name(str(table), allowed, product=product)
    schema = str(cat.get("default_schema") or "")
    for tbl in cat.get("tables") or []:
        if tbl.get("name") == table:
            schema = str(tbl.get("schema") or schema)
            break
    intent = str(plan.intent or "list")
    select = list_select_columns(intent, plan.select, spec)
    if intent == "kpi" and not plan.group_by:
        mid = plan.metric_id or plan.template_id or ""
        return ConstrainedJob(
            product=product,
            table=str(table),
            schema=schema,
            select=[],
            filters=list(plan.filters),
            limit=1,
            template_id=str(plan.template_id or mid),
            metric_id=str(mid) if mid else None,
            group_by=list(plan.group_by),
            scope_mode=plan.scope_mode,
            team_scope=plan.team_scope,
            cdp_live=plan.cdp_live,
            cdp_email=plan.cdp_email,
            time_start=plan.time_start,
            time_end=plan.time_end,
            time_grain=plan.time_grain,
        )
    if intent == "count_scalar":
        return ConstrainedJob(
            product=product,
            table=str(table),
            schema=schema,
            select=[],
            filters=list(plan.filters),
            limit=1,
            metric_id=plan.metric_id,
            template_id=plan.template_id,
            scope_mode=plan.scope_mode,
            team_scope=plan.team_scope,
            cdp_live=plan.cdp_live,
            cdp_email=plan.cdp_email,
            time_start=plan.time_start,
            time_end=plan.time_end,
            time_grain=plan.time_grain,
        )
    return ConstrainedJob(
        product=product,
        table=str(table),
        schema=schema,
        select=list(select),
        filters=list(plan.filters),
        limit=plan.limit,
        metric_id=plan.metric_id,
        template_id=plan.template_id,
        group_by=list(plan.group_by),
        scope_mode=plan.scope_mode,
        team_scope=plan.team_scope,
        cdp_live=plan.cdp_live,
        cdp_email=plan.cdp_email,
        time_start=plan.time_start,
        time_end=plan.time_end,
        time_grain=plan.time_grain,
    )


def _gemma_executor(req: SqlQueryRequest, plan: SqlPlan) -> ConstrainedJob:
    slice_doc = preset_executor_slice(plan.preset_id)
    user_payload = {
        "instruction": req.instruction,
        "intent": plan.intent,
        "product": plan.product,
        "preset_id": plan.preset_id,
        "metric_id": plan.metric_id,
        "template_id": plan.template_id,
        "filters": plan.filters,
        "limit": plan.limit,
        "planner_select_hint": list(plan.select or []),
        "catalog": slice_doc,
    }
    raw = chat_json(
        system=_EXECUTOR_SYSTEM,
        user=json.dumps(user_payload, ensure_ascii=False),
    )
    return _parse_executor_json(raw, plan)


def _parse_executor_json(raw: dict[str, Any], plan: SqlPlan) -> ConstrainedJob:
    if raw.get("sql"):
        raise GemmaParseError("Executor must not return sql field")
    spec = load_preset(plan.preset_id)
    product = _plan_catalog_product(plan)
    cat = load_compiled_catalog(product)
    allowed_tables = set(spec.get("tables") or [])
    table = str(
        raw.get("table")
        or plan.table
        or spec.get("default_table")
        or default_table(None, product)
        or ""
    )
    table = _resolve_table_name(table, allowed_tables, product=product)
    if allowed_tables and table not in allowed_tables:
        synonyms = (cat.get("synonyms") or {})
        rev = {v: k for k, v in synonyms.items()}
        if table in rev and rev[table] in allowed_tables:
            table = rev[table]
        elif spec.get("default_table") in allowed_tables:
            table = str(spec.get("default_table"))
        else:
            table = str(spec.get("default_table") or table)
    schema = str(cat.get("default_schema") or "")
    for tbl in cat.get("tables") or []:
        if tbl.get("name") == table:
            schema = str(tbl.get("schema") or schema)
            break
    intent = str(plan.intent or "list")
    requested = raw.get("select")
    if requested is None:
        requested = plan.select
    if intent in ("kpi", "count_scalar") and not plan.group_by:
        select = []
    else:
        select = list_select_columns(intent, requested, spec)
    return ConstrainedJob(
        product=product,
        table=table,
        schema=schema,
        select=list(select) if select else [],
        filters=list(raw.get("filters") or plan.filters),
        order_by=list(raw.get("order_by") or []),
        limit=int(raw.get("limit") or plan.limit),
        template_id=str(raw.get("template_id") or plan.template_id or "")
        or None,
        metric_id=str(raw.get("metric_id") or plan.metric_id or "") or None,
        joins=list(raw.get("joins") or []),
        group_by=list(plan.group_by),
        scope_mode=plan.scope_mode,
        team_scope=plan.team_scope,
        cdp_live=plan.cdp_live,
        cdp_email=plan.cdp_email,
        time_start=plan.time_start,
        time_end=plan.time_end,
        time_grain=plan.time_grain,
    )
