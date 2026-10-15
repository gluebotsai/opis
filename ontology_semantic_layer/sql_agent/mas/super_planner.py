"""SQL Super planner — Gemma LLM-first with preset routing."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from sql_agent.agent_policy import resolve_agent_policy
from sql_agent.errors import SqlAgentError
from sql_agent.job import SqlQueryRequest
from sql_agent.mas.cross_product import CrossProductError, assert_cross_product_allowed
from sql_agent.mas.gemma_client import (
    GemmaParseError,
    GemmaTimeoutError,
    GemmaUnavailableError,
    chat_json,
)
from sql_agent.mas.plan_schema import ConstrainedJob, SqlPlan
from sql_agent.presets.loader import list_preset_summaries, list_select_columns, load_preset
from sql_agent.product_aliases import normalize_sql_catalog_product
from sql_agent.router import default_table, normalize_product, route_product

_DEFAULT_PRESETS: dict[str, str] = {
    "ticketing": "tk.tickets",
    "ccaas": "cc.conversations",
    "crm": "crm.deals",
    "campaign": "camp.overview",
    "webtracking": "wt.sessions",
}


def _preset_catalog_product(preset_id: str) -> str:
    spec = load_preset(preset_id)
    return str(spec.get("product") or "")


def _align_preset_id(
    preset_id: str,
    default_product: str,
    req: SqlQueryRequest,
) -> str:
    """Keep preset aligned with origin product unless cross-product is entitled."""
    preset_product = _preset_catalog_product(preset_id)
    if not preset_product or preset_product == "any":
        return preset_id
    preset_product = normalize_product(preset_product)
    if preset_product == default_product:
        return preset_id
    try:
        assert_cross_product_allowed(
            origin_product=req.origin_product,
            target_product=preset_product,
            organization_id=req.organization_id,
        )
        return preset_id
    except CrossProductError:
        return _DEFAULT_PRESETS.get(default_product, preset_id)


def _plan_catalog_product(plan: SqlPlan) -> str:
    """Resolve warehouse catalog product from preset (source of truth)."""
    spec = load_preset(plan.preset_id)
    preset_product = str(spec.get("product") or plan.product)
    if preset_product == "any":
        return normalize_product(plan.product)
    return normalize_product(preset_product)


def _resolve_table_name(table: str, allowed: set[str], *, product: str = "") -> str:
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

_SUPER_SYSTEM = """You are the SQL Super planner for a read-only analytics agent.
Return ONLY valid JSON with keys:
  intent: list|count_scalar|count_grouped|kpi
  preset_id: one preset from the catalog
  product: canonical product id
  metric_id: optional certified metric id (kpi intent ONLY — never with list)
  template_id: optional certified template id (kpi only)
  table: optional default table when list intent is obvious
  select: optional column list for list intent
  filters: optional array of {column, op, values} — status Title Case (Open, Pending, Resolved); priority lowercase (high, medium, low, urgent)
  group_by: optional array of column names for count_grouped (e.g. queue_name, status, priority)
  scope_mode: optional org|assignee|team — omit to use role default
  team_scope: optional boolean when user asks for my team
  cdp_live: optional boolean when live customer email/name match via CDP is required
  cdp_email: optional email when cdp_live is true
  time_start: optional ISO date lower bound (inclusive)
  time_end: optional ISO date upper bound (inclusive through end of day)
  time_grain: optional day|week|month|hour for partition group_by on time columns
  limit: optional row limit (default 20, max 200)

Rules (instruction-first):
- Never emit SQL or sql fields.
- Instruction wording wins over metric_request hints.
- Time windows (last 7 days, today, a named calendar day such as September 23 2026, since DATE) belong in time_start/time_end only as YYYY-MM-DD. For a single day set both bounds to that date. Never put created_at (or created_range) into filters — including eq.
- Infer from the instruction, then break it down before filling JSON: (1) result kind — list of entities, scalar count, grouped breakdown, or certified KPI; (2) which entity/table the user wants; (3) constraints — filters, time window, scope, sort, limit (these restrict rows, they are not the full result shape); (4) extras — attributes the user named (dates, assignee, status, queue, …). Plan the job from that breakdown only. Do not invent filters, metrics, joins, or columns the instruction and catalog do not support.
- list: row retrieval verbs (list/show/get/find). NEVER set metric_id or template_id on list. select must identify the listed entity (preset default_select / identity fields) PLUS named extras. Never set select to only a time, sort, or filter column.
- count_scalar: "how many" / "number of" without group_by — prefer explicit filters over a mismatched metric.
- count_grouped: breakdown by queue/status/priority/channel — set group_by; never metric_id alone.
- kpi: only when a certified metric formula card matches the instruction filters exactly.
- list_only agents must use intent=list (never kpi).
- Ticketing: status on tickets.status; staff names use assignee_name/resolver_name; customers use customer_name/customer_email.
- Pick preset_id ONLY from preset_catalog in the payload.
"""


def plan_sql_query(req: SqlQueryRequest) -> SqlPlan:
    """Build a structured plan via Gemma; never emits raw SQL."""
    from sql_agent.mas.feature_flags import instruction_first_enabled
    from sql_agent.mas.intent_gate import run_intent_gate

    policy = resolve_agent_policy(
        organization_id=req.organization_id,
        user_id=req.user_id,
        origin_product=req.origin_product,
        origin_agent=req.origin_agent,
    )
    product = normalize_product(route_product(req.entity_hint, req.origin_product))

    gate = None
    try:
        # Gate always runs for telemetry; assignee DB resolve only when flag on
        gate = run_intent_gate(
            req.instruction,
            product=product,
            organization_id=req.organization_id,
        )
    except SqlAgentError:
        if instruction_first_enabled():
            raise
        gate = None

    try:
        plan = _gemma_plan(req, policy, product)
    except (GemmaTimeoutError, GemmaUnavailableError):
        raise
    except GemmaParseError:
        if product == "ticketing":
            raise SqlAgentError(
                "Could not plan this ticketing question. Rephrase as a list, "
                "scalar count, or certified KPI.",
                code="plan_failed",
            )
        fallback = _parse_fallback_plan(req, policy, product)
        if fallback is not None:
            plan = fallback
        else:
            raise SqlAgentError(
                "Could not plan this question. Try listing rows for your product "
                "or ask a certified KPI (e.g. conversation volume, open tickets).",
                code="plan_failed",
            )

    if gate is not None:
        plan.gate_hint = gate.hint
        if gate.scope_mode == "created_by":
            plan.scope_mode = "created_by"
        if gate.team_scope:
            plan.team_scope = True
        # Instruction calendar windows always win over Gemma.
        if gate.time_start:
            plan.time_start = gate.time_start
        if gate.time_end:
            plan.time_end = gate.time_end
        if gate.filters and not plan.filters:
            plan.filters = list(gate.filters)
        # Certified KPI wins for how-many/count-of when a template matches.
        if gate.hint == "count_scalar" and not plan.group_by:
            from sql_agent.kpi_certified import is_certified, resolve_metric_alias
            from sql_agent.mas.metric_validator import (
                suggest_certified_metric,
                validate_metric_against_instruction,
            )

            mid = resolve_metric_alias(
                plan.metric_id or plan.template_id or suggest_certified_metric(
                    req.instruction, product=product
                )
                or ""
            )
            if mid and is_certified(mid, product=product):
                validation = validate_metric_against_instruction(mid, req.instruction)
                if validation.ok:
                    plan.intent = "kpi"
                    plan.metric_id = mid
                    plan.template_id = mid
                else:
                    plan.intent = "count_scalar"
                    plan.metric_id = None
                    plan.template_id = None
                    if validation.fallback_filters and not plan.filters:
                        plan.filters = list(validation.fallback_filters)
            else:
                suggested = suggest_certified_metric(req.instruction, product=product)
                if suggested and is_certified(suggested, product=product):
                    plan.intent = "kpi"
                    plan.metric_id = suggested
                    plan.template_id = suggested
                else:
                    plan.intent = "count_scalar"
                    plan.metric_id = None
                    plan.template_id = None
        if instruction_first_enabled():
            # Instruction-first: prefer gate hint when Gemma disagrees on list vs metric
            if gate.hint == "list" and plan.intent == "kpi":
                plan.intent = "list"
                plan.metric_id = None
                plan.template_id = None
            elif gate.hint == "count_scalar" and plan.intent == "kpi" and not plan.metric_id:
                plan.intent = "count_scalar"
            elif gate.hint == "count_grouped" and gate.group_by:
                plan.intent = "count_grouped"
                plan.group_by = gate.group_by or plan.group_by
            if gate.filters and not plan.filters:
                plan.filters = list(gate.filters)
            # Soft-merge gate filters when instruction-first
            if gate.filters:
                plan.filters = list(gate.filters)
            if gate.scope_mode and not plan.scope_mode:
                plan.scope_mode = gate.scope_mode
            if gate.team_scope:
                plan.team_scope = True
    return plan


def _gemma_plan(
    req: SqlQueryRequest,
    policy: dict[str, Any],
    default_product: str,
) -> SqlPlan:
    from sql_agent.mas.feature_flags import instruction_first_enabled

    # Legacy force path — skipped when INSTRUCTION_FIRST is on
    if req.metric_request and not instruction_first_enabled():
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
    from sql_agent.mas.formula_cards import format_formula_cards_text

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
        "formula_cards": format_formula_cards_text(default_product),
    }
    if req.metric_request and instruction_first_enabled():
        # Soft hint only — instruction wins; do not force kpi
        user_payload["metric_request_hint"] = {
            "metrics": list(req.metric_request.get("metrics") or []),
            "note": "soft hint only; prefer instruction intent",
        }
    raw = chat_json(
        system=_SUPER_SYSTEM,
        user=json.dumps(user_payload, ensure_ascii=False),
    )
    plan = _parse_super_json(raw, req, default_product)
    if plan is not None:
        return plan
    if default_product == "ticketing":
        raise GemmaParseError("Invalid ticketing plan from Gemma")
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
    preset_id = _align_preset_id(preset_id, default_product, req)
    try:
        load_preset(preset_id)
    except KeyError:
        return None

    intent = str(raw.get("intent") or "list")
    from sql_agent.mas.intent_kinds import normalize_intent

    group_by = [str(g) for g in (raw.get("group_by") or []) if g]
    intent = normalize_intent(intent, has_group_by=bool(group_by))
    product = normalize_sql_catalog_product(
        str(raw.get("product") or default_product)
    )
    product = _plan_catalog_product(
        SqlPlan(
            plan_id="",
            preset_id=preset_id,
            product=product,
        )
    )
    if product != default_product:
        try:
            assert_cross_product_allowed(
                origin_product=req.origin_product,
                target_product=product,
                organization_id=req.organization_id,
            )
        except CrossProductError as exc:
            raise SqlAgentError(str(exc), code="cross_product_denied") from exc

    metric_id = raw.get("metric_id")
    template_id = raw.get("template_id") or metric_id
    filters = list(raw.get("filters") or [])
    scope_mode = raw.get("scope_mode")
    team_scope = bool(raw.get("team_scope"))
    cdp_live = bool(raw.get("cdp_live"))
    cdp_email = raw.get("cdp_email")
    time_start = raw.get("time_start")
    time_end = raw.get("time_end")
    time_grain = raw.get("time_grain")
    table = raw.get("table")
    select = raw.get("select")
    limit = int(raw.get("limit") or req.limit)

    if group_by and intent == "kpi" and not metric_id:
        intent = "count_grouped"

    plan = SqlPlan(
        plan_id=str(raw.get("plan_id") or uuid.uuid4()),
        preset_id=preset_id,
        intent=intent,  # type: ignore[arg-type]
        product=product,
        metric_id=str(metric_id) if metric_id else None,
        template_id=str(template_id) if template_id else None,
        filters=filters,
        group_by=group_by,
        scope_mode=str(scope_mode) if scope_mode else None,
        team_scope=team_scope,
        cdp_live=cdp_live,
        cdp_email=str(cdp_email) if cdp_email else None,
        time_start=str(time_start) if time_start else None,
        time_end=str(time_end) if time_end else None,
        time_grain=str(time_grain) if time_grain else None,
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
    from sql_agent.compiled_catalog import load_compiled_catalog

    spec = load_preset(plan.preset_id)
    product = _plan_catalog_product(plan)
    cat = load_compiled_catalog(product)
    allowed = set(spec.get("tables") or [])
    plan_table = plan.table if plan.table in allowed else None
    table = _resolve_table_name(
        str(
            plan_table
            or spec.get("default_table")
            or default_table(None, product)
        ),
        allowed,
        product=product,
    )
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


def _parse_fallback_plan(
    req: SqlQueryRequest,
    policy: dict[str, Any],
    product: str,
) -> SqlPlan | None:
    """Last-resort preset pick when Gemma JSON parse fails (not on timeout)."""
    text = (req.instruction or "").lower()
    preset_id = _DEFAULT_PRESETS.get(product, "tk.tickets")
    if re.search(r"\b(queue|team depth|membership)\b", text):
        preset_id = "tk.queue" if product == "ticketing" else "cc.queue"
    elif re.search(r"\b(note|comment|reply)\b", text):
        preset_id = "tk.notes"
    elif re.search(r"\b(audit|escalat|history)\b", text):
        preset_id = "tk.audit"
    elif re.search(r"\b(conversation|call|chat)\b", text) and product == "ccaas":
        preset_id = "cc.conversations"
    elif re.search(r"\b(sla|breach)\b", text) and product == "ccaas":
        preset_id = "cc.sla"
    elif re.search(r"\b(assignments?|offered)\b", text) and product == "ccaas":
        preset_id = "cc.assignments"
    elif re.search(r"\b(tasks?|follow[- ]?up)\b", text) and product == "ccaas":
        preset_id = "cc.tasks"
    elif re.search(r"\b(presence|available|availability)\b", text) and product == "ccaas":
        preset_id = "cc.presence"
    elif re.search(r"\b(agent assist|suggestion)\b", text) and product == "ccaas":
        preset_id = "cc.agent_assist"
    elif re.search(r"\b(agents?|roster)\b", text) and product == "ccaas":
        preset_id = "cc.agents"
    elif re.search(r"\b(deal|pipeline)\b", text) and product == "crm":
        preset_id = "crm.deals"
    elif re.search(r"\b(company|companies|account)\b", text) and product == "crm":
        preset_id = "crm.companies"
    elif re.search(r"\b(order|orders|revenue)\b", text) and product == "crm":
        preset_id = "crm.orders"
    elif re.search(r"\b(engagement|activity)\b", text) and product == "crm":
        preset_id = "crm.engagement"
    elif re.search(r"\b(contact|lead)\b", text) and product == "crm":
        preset_id = "crm.contacts"
    elif re.search(r"\b(campaign)\b", text) and product == "campaign":
        preset_id = "camp.overview"
    elif re.search(r"\b(touch|send|sent)\b", text) and product == "campaign":
        preset_id = "camp.touch"
    elif re.search(r"\b(delivery|delivered|bounce)\b", text) and product == "campaign":
        preset_id = "camp.delivery"
    elif re.search(r"\b(visitor|visitors)\b", text) and product == "webtracking":
        preset_id = "wt.visitors"
    elif re.search(r"\b(conversion|goal)\b", text) and product == "webtracking":
        preset_id = "wt.conversions"
    elif re.search(r"\b(pageview|page view)\b", text) and product == "webtracking":
        preset_id = "wt.pageviews"
    elif re.search(r"\b(how many|count|volume|csat|kpi|metric)\b", text):
        if policy.get("list_only"):
            return None
        preset_id = "metric.certified"

    try:
        load_preset(preset_id)
    except KeyError:
        preset_id = _DEFAULT_PRESETS.get(product, "tk.tickets")
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
        product=_plan_catalog_product(
            SqlPlan(plan_id="", preset_id=preset_id, product=product)
        ),
        limit=req.limit,
        products=[product],
        planner="regex_fallback",
    )
    spec = load_preset(preset_id)
    plan.table = spec.get("default_table")
    plan.select = list(spec.get("default_select") or [])
    if plan.is_executor_skippable():
        plan.constrained_job = _plan_to_constrained(plan)
    return plan
