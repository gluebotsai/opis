"""SQL Super planner — Gemma LLM-first with preset routing."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from semantic.sql.agent_policy import resolve_agent_policy
from semantic.sql.job import SqlQueryRequest
from semantic.sql.mas.cross_product import assert_cross_product_allowed
from semantic.sql.mas.gemma_client import (
    GemmaParseError,
    GemmaTimeoutError,
    GemmaUnavailableError,
    chat_json,
)
from semantic.sql.mas.plan_schema import ConstrainedJob, SqlPlan
from semantic.sql.presets.loader import list_preset_summaries, list_select_columns, load_preset
from semantic.sql.product_aliases import normalize_sql_catalog_product
from semantic.sql.router import normalize_product, route_product


def _resolve_table_name(table: str, allowed: set[str]) -> str:
    if not allowed or not table:
        return table
    if table in allowed:
        return table
    if not table.startswith("mart_"):
        candidate = f"mart_{table}"
        if candidate in allowed:
            return candidate
    return table

_SUPER_SYSTEM = """You are the SQL Super planner for a read-only analytics agent.
Return ONLY valid JSON with keys:
  intent: list|kpi|count
  preset_id: one preset from the catalog
  product: canonical product id
  metric_id: optional certified metric id (kpi only)
  template_id: optional certified template id (kpi only)
  table: optional default table when list intent is obvious
  select: optional column list for list intent
  filters: optional array of {column, op, values}
  limit: optional row limit (default 50)

Rules:
- Never emit SQL or sql fields.
- Infer from the instruction, then break it down before filling JSON: result kind, entity/table, constraints (filters/time/sort/limit — row restrictions, not the full result shape), and named extras. Plan only from that breakdown. Do not invent filters, metrics, joins, or columns.
- list select must identify the listed entity (preset default_select / identity fields) PLUS named extras. Never select only a time, sort, or filter column.
- list_only agents must use intent=list (never kpi).
- Use metric.certified preset for KPI/count questions.
- Pick the most specific preset (tk.audit for history, tk.queue for queues, etc.).
"""


def plan_sql_query(req: SqlQueryRequest) -> SqlPlan:
    """Build a structured plan via Gemma; never emits raw SQL."""
    policy = resolve_agent_policy(
        organization_id=req.organization_id,
        user_id=req.user_id,
        origin_product=req.origin_product,
        origin_agent=req.origin_agent,
    )
    product = normalize_product(route_product(req.entity_hint, req.origin_product))
    try:
        return _gemma_plan(req, policy, product)
    except (GemmaTimeoutError, GemmaUnavailableError):
        raise
    except GemmaParseError:
        fallback = _parse_fallback_plan(req, policy, product)
        if fallback is not None:
            return fallback
        raise


def _gemma_plan(
    req: SqlQueryRequest,
    policy: dict[str, Any],
    default_product: str,
) -> SqlPlan:
    if req.metric_request:
        mid = (req.metric_request.get("metrics") or [None])[0]
        return SqlPlan(
            plan_id=str(uuid.uuid4()),
            preset_id="metric.certified",
            intent="kpi",
            product=default_product,
            metric_id=str(mid) if mid else None,
            template_id=str(mid) if mid else None,
            limit=req.limit,
            products=[default_product],
            planner="gemma",
        )

    presets = list_preset_summaries(product=default_product)
    user_payload = {
        "instruction": req.instruction,
        "origin_product": req.origin_product,
        "origin_agent": req.origin_agent,
        "entity_hint": req.entity_hint,
        "limit": req.limit,
        "policy": {
            "list_only": bool(policy.get("list_only")),
            "allowed_metrics": list(policy.get("allowed_metrics") or []),
        },
        "preset_catalog": presets,
    }
    raw = chat_json(
        system=_SUPER_SYSTEM,
        user=json.dumps(user_payload, ensure_ascii=False),
    )
    plan = _parse_super_json(raw, req, default_product)
    if plan is not None:
        return plan
    fallback = _parse_fallback_plan(req, policy, default_product)
    if fallback is not None:
        return fallback
    raise GemmaParseError("Super returned an empty or invalid plan")


def _parse_super_json(
    raw: dict[str, Any],
    req: SqlQueryRequest,
    default_product: str,
) -> SqlPlan | None:
    preset_id = str(raw.get("preset_id") or "").strip()
    if not preset_id:
        return None
    try:
        load_preset(preset_id)
    except KeyError:
        return None

    intent = str(raw.get("intent") or "list")
    if intent not in ("list", "kpi", "count"):
        intent = "list"
    product = normalize_sql_catalog_product(
        str(raw.get("product") or default_product)
    )
    if product != default_product:
        assert_cross_product_allowed(
            origin_product=req.origin_product,
            target_product=product,
            organization_id=req.organization_id,
        )

    metric_id = raw.get("metric_id")
    template_id = raw.get("template_id") or metric_id
    filters = list(raw.get("filters") or [])
    table = raw.get("table")
    select = raw.get("select")
    limit = int(raw.get("limit") or req.limit)

    plan = SqlPlan(
        plan_id=str(raw.get("plan_id") or uuid.uuid4()),
        preset_id=preset_id,
        intent=intent,  # type: ignore[arg-type]
        product=product,
        metric_id=str(metric_id) if metric_id else None,
        template_id=str(template_id) if template_id else None,
        filters=filters,
        table=str(table) if table else None,
        select=list(select) if select else None,
        limit=limit,
        products=[product],
        planner="gemma",
    )
    if plan.is_executor_skippable():
        plan.constrained_job = _plan_to_constrained(plan)
    return plan


def _plan_to_constrained(plan: SqlPlan) -> ConstrainedJob:
    from semantic.sql.compiled_catalog import load_compiled_catalog

    spec = load_preset(plan.preset_id)
    product = plan.product
    cat = load_compiled_catalog(product)
    allowed = set(spec.get("tables") or [])
    table = _resolve_table_name(
        str(plan.table or spec.get("default_table") or "mart_tickets"),
        allowed,
    )
    schema = str(cat.get("default_schema") or "")
    for tbl in cat.get("tables") or []:
        if tbl.get("name") == table:
            schema = str(tbl.get("schema") or schema)
            break
    intent = str(plan.intent or "list")
    select = list_select_columns(intent, plan.select, spec)
    if plan.intent == "kpi":
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
        )
    return ConstrainedJob(
        product=product,
        table=str(table),
        schema=schema,
        select=list(select),
        filters=list(plan.filters),
        limit=plan.limit,
    )


def _parse_fallback_plan(
    req: SqlQueryRequest,
    policy: dict[str, Any],
    product: str,
) -> SqlPlan | None:
    """Last-resort preset pick when Gemma JSON parse fails (not on timeout)."""
    text = (req.instruction or "").lower()
    preset_id = "tk.tickets"
    if re.search(r"\b(queue|team depth|membership)\b", text):
        preset_id = "tk.queue" if product == "ticketing" else "cc.queue"
    elif re.search(r"\b(note|comment|reply)\b", text):
        preset_id = "tk.notes"
    elif re.search(r"\b(audit|escalat|history)\b", text):
        preset_id = "tk.audit"
    elif re.search(r"\b(conversation|call|chat)\b", text) and product == "ccaas":
        preset_id = "cc.conversations"
    elif re.search(r"\b(deal|pipeline)\b", text) and product == "crm":
        preset_id = "crm.deals"
    elif re.search(r"\b(contact|lead)\b", text) and product == "crm":
        preset_id = "crm.contacts"
    elif re.search(r"\b(campaign)\b", text) and product == "campaign":
        preset_id = "camp.overview"
    elif re.search(r"\b(how many|count|volume|csat|kpi|metric)\b", text):
        if policy.get("list_only"):
            return None
        preset_id = "metric.certified"

    try:
        load_preset(preset_id)
    except KeyError:
        defaults = {
            "ticketing": "tk.tickets",
            "ccaas": "cc.conversations",
            "crm": "crm.deals",
            "campaign": "camp.overview",
            "webtracking": "wt.sessions",
        }
        preset_id = defaults.get(product, "tk.tickets")
        try:
            load_preset(preset_id)
        except KeyError:
            return None

    intent: str = "list"
    if preset_id == "metric.certified":
        intent = "kpi"
    plan = SqlPlan(
        plan_id=str(uuid.uuid4()),
        preset_id=preset_id,
        intent=intent,  # type: ignore[arg-type]
        product=product,
        limit=req.limit,
        products=[product],
        planner="regex_fallback",
    )
    spec = load_preset(preset_id)
    plan.table = spec.get("default_table")
    plan.select = list(spec.get("default_select") or [])
    return plan
