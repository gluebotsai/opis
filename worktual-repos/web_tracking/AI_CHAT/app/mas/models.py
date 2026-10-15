"""Structured JSON shapes from LLM layers."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


RouteAction = Literal["analytics", "greet", "refuse", "clarify"]
DomainId = Literal["site_kpi", "breakdown", "ranking", "drilldown"]


class RouteDecision(BaseModel):
    action: RouteAction
    domain: DomainId | None = None
    objective: str | None = None
    clarify_question: str | None = None
    greet_reply: str | None = None
    refuse_reply: str | None = None


class SemanticPlan(BaseModel):
    metrics: list[str] = Field(default_factory=list)
    group_by: list[str] = Field(default_factory=list)
    filters: list[dict[str, Any]] = Field(default_factory=list)
    time: dict[str, Any] | None = None
    order_by: list[str] = Field(default_factory=list)
    limit: int | None = None
    sort_direction: str | None = None  # asc | desc for rankings (most vs least)
    error: str | None = None
    clarify_question: str | None = None
