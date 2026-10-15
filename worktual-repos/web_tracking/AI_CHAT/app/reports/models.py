"""Plans and tool calls for the reports domain agent."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.mas.models import SemanticPlan

AnswerType = Literal["kpi", "list", "breakdown", "ranking"]
PlanDepth = Literal["quick", "standard", "deep"]


class ReportTask(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = "t1"
    executor: Literal["semantic"] = "semantic"
    kpi: str | None = None
    goal: str = ""
    time: str | None = None
    scope: str = "website"
    answer_type: AnswerType = "kpi"
    depends_on: list[str] = Field(default_factory=list)


class DomainPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: Literal["plan"] = "plan"
    depth: PlanDepth = "quick"
    tasks: list[ReportTask] = Field(default_factory=list)
    clarify_question: str | None = None


class SemanticToolCall(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tool: Literal["run_semantic", "run_kpi"] = "run_semantic"
    kpi: str | None = None
    metrics: list[str] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    time: dict[str, Any] | None = None
    order_by: list[str] = Field(default_factory=list)
    sort_direction: str | None = None
    limit: int | None = None
    error_type: str | None = None
    error: str | None = None

    def to_semantic_plan(self) -> SemanticPlan:
        return SemanticPlan(
            metrics=list(self.metrics),
            group_by=list(self.group_by),
            filters=list(self.filters),
            time=self.time,
            order_by=list(self.order_by),
            sort_direction=self.sort_direction,
            limit=self.limit,
        )


class TaskExecutionResult(BaseModel):
    task_id: str
    status: Literal["ok", "error"] = "ok"
    store: Literal["clickhouse", "semantic"] = "semantic"
    kpi_id: str | None = None
    error_type: str | None = None
    error: str | None = None
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    sql_or_ref: str | None = None
    facts: str = ""
    semantic_plan: dict[str, Any] | None = None
    context_layer_request: dict[str, Any] | None = None
    context_layer_response: dict[str, Any] | None = None
