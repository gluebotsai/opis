"""Typed payloads for the established SSE wire contract."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class StatusEvent(BaseModel):
    phase: str
    label: str


class TextDeltaEvent(BaseModel):
    delta: str


class ToolCallEvent(BaseModel):
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class ActionEvent(BaseModel):
    type: str
    resource: str | None = None
    path: str | None = None


class ErrorEvent(BaseModel):
    code: str
    message: str


class ServerSentEvent(BaseModel):
    event: Literal[
        "status",
        "text_delta",
        "tool_call",
        "block",
        "contact_draft",
        "queue_draft",
        "confirmation_required",
        "action",
        "error",
        "done",
    ]
    data: dict[str, Any] = Field(default_factory=dict)
