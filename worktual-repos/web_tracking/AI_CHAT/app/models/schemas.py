"""Pydantic models for AI chat."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    session_id: str | None = None
    """Dashboard period pill when user asks from analytics UI: today | week | month | overall."""
    dashboard_period: str | None = None


class StreamEvent(BaseModel):
    type: Literal[
        "thinking",
        "sql",
        "executing",
        "dashboard",
        "answer",
        "error",
        "pong",
        "connected",
    ]
    data: str | None = None
    message: str | None = None
    dashboard: dict[str, Any] | None = None
    payload: dict[str, Any] | None = None


class DashboardWidget(BaseModel):
    type: str
    title: str | None = None
    columns: list[str] | None = None
    rows: list[list[Any]] | None = None
    x: list[Any] | None = None
    y: list[Any] | None = None
    labels: list[str] | None = None
    values: list[Any] | None = None
    value: Any | None = None


class DashboardPayload(BaseModel):
    widgets: list[dict[str, Any]] = Field(default_factory=list)


class AgentResponse(BaseModel):
    answer: str
    sql: str | None = None
    dashboard: dict[str, Any] = Field(default_factory=dict)
    summary: dict[str, Any] = Field(default_factory=dict)
    suggested_questions: list[str] = Field(default_factory=list)

