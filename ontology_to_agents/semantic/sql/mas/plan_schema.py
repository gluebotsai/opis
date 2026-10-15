"""Structured plan + job schema for SQL Data MAS (no raw SQL from models)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

StepKind = Literal["fetch_rows", "run_metric", "merge"]
PlanIntent = Literal["list", "kpi", "count", "merge"]


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
    limit: int = 50
    scope: Literal["org", "assignee"] = "org"
    template_id: str | None = None
    metric_id: str | None = None
    joins: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class SqlPlan:
    plan_id: str
    preset_id: str
    intent: PlanIntent = "list"
    product: str = "ticketing"
    metric_id: str | None = None
    template_id: str | None = None
    filters: list[dict[str, Any]] = field(default_factory=list)
    table: str | None = None
    select: list[str] | None = None
    limit: int = 50
    steps: list[PlanStep] = field(default_factory=list)
    products: list[str] = field(default_factory=list)
    planner: str = "gemma"
    constrained_job: ConstrainedJob | None = None

    def is_executor_skippable(self) -> bool:
        if self.constrained_job is not None:
            return True
        if self.intent == "kpi":
            return bool(self.template_id or self.metric_id)
        if self.intent == "list":
            if self.select:
                return False
            return bool(self.table)
        if self.intent == "count":
            return bool(self.table and self.select)
        return False
