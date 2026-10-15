"""Structured plan + job schema for SQL Data MAS (no raw SQL from models)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from sql_agent.mas.intent_kinds import IntentKind, normalize_intent

StepKind = Literal["fetch_rows", "run_metric", "merge"]
# Legacy alias; prefer IntentKind
PlanIntent = IntentKind


@dataclass
class PlanStep:
    kind: StepKind
    product: str
    table: str | None = None
    metric_id: str | None = None
    filters: list[dict[str, Any]] = field(default_factory=list)
    limit: int = 50
    merge_on: list[str] = field(default_factory=list)
    template_id: str | None = None
    select: list[str] | None = None


@dataclass
class ConstrainedJob:
    """Product executor output — table/select/filters only (never SQL)."""

    product: str
    table: str
    schema: str
    select: list[str]
    filters: list[dict[str, Any]] = field(default_factory=list)
    order_by: list[str] = field(default_factory=list)
    limit: int = 20
    scope: Literal["org", "assignee"] = "org"
    template_id: str | None = None
    metric_id: str | None = None
    joins: list[dict[str, Any]] = field(default_factory=list)
    group_by: list[str] = field(default_factory=list)
    scope_mode: str | None = None
    team_scope: bool = False
    cdp_live: bool = False
    cdp_email: str | None = None
    time_start: str | None = None
    time_end: str | None = None
    time_grain: str | None = None


@dataclass
class SqlPlan:
    plan_id: str
    preset_id: str
    intent: IntentKind = "list"
    product: str = "ticketing"
    metric_id: str | None = None
    template_id: str | None = None
    filters: list[dict[str, Any]] = field(default_factory=list)
    group_by: list[str] = field(default_factory=list)
    scope_mode: str | None = None
    team_scope: bool = False
    cdp_live: bool = False
    cdp_email: str | None = None
    time_start: str | None = None
    time_end: str | None = None
    time_grain: str | None = None
    table: str | None = None
    select: list[str] | None = None
    limit: int = 20
    steps: list[PlanStep] = field(default_factory=list)
    products: list[str] = field(default_factory=list)
    planner: str = "gemma"
    constrained_job: ConstrainedJob | None = None
    gate_hint: IntentKind | None = None
    guard_action: str | None = None

    def normalized_intent(self) -> IntentKind:
        return normalize_intent(str(self.intent), has_group_by=bool(self.group_by))

    def is_executor_skippable(self) -> bool:
        if self.constrained_job is not None:
            return True
        intent = self.normalized_intent()
        if intent == "kpi":
            return bool(self.template_id or self.metric_id)
        if intent == "count_scalar":
            return True
        try:
            from sql_agent.presets.loader import load_preset

            spec = load_preset(self.preset_id)
            has_defaults = bool(spec.get("default_table") and spec.get("default_select"))
        except KeyError:
            has_defaults = False
        if intent == "list":
            # Executor must complete projection from the instruction.
            if self.select:
                return False
            return has_defaults
        if intent == "count_grouped":
            if self.table and self.select:
                return True
            return has_defaults
        return False
