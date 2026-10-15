"""Tool-call and tool-result contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


ToolKind = Literal[
    "read",
    "draft_patch",
    "ui_directive",
    "propose",
    "mutation",
    "clarify",
    "route",
]


class ToolCall(BaseModel):
    """Normalized model tool call (id, name, parsed arguments)."""

    id: str
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolResult(BaseModel):
    """Structured tool execution result returned to the model / runtime."""

    tool_call_id: str
    name: str
    success: bool
    data: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    error_code: str | None = None


# Backward-compatible aliases used by early drafts / callers.
ToolCallRequest = ToolCall
ToolCallResult = ToolResult


class ToolDefinition(BaseModel):
    name: str
    description: str = ""
    input_schema: dict[str, Any] = Field(default_factory=dict)
    kind: ToolKind = "read"
    risk: str = "low"
    requires_confirm: bool = False
    roles: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)
    agents: list[str] = Field(default_factory=list)

    def to_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema
                or {"type": "object", "properties": {}},
            },
        }
