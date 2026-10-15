"""Trusted run context for agent and tool execution."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunContext:
    tenant_id: str
    user_id: str = "system"
    role: str = "admin"
    surface: str = "general"
    path: str = "/workspace"
    conversation_id: str | None = None
    contact_id: str | None = None
    task_id: str | None = None
    queue_id: str | None = None
    incident_id: str | None = None
    channel: str = "copilot"
    confirmed_actions: list[str] = field(default_factory=list)
    active_skills: dict[str, Any] = field(default_factory=dict)
    active_metrics: dict[str, Any] = field(default_factory=dict)
    active_schema: dict[str, Any] | None = None
    recent_tool_data: list[dict[str, Any]] = field(default_factory=list)
    executed_tool_results: dict[str, dict[str, Any]] = field(default_factory=dict)
    agent_memory: Any | None = None
    extra: dict[str, Any] = field(default_factory=dict)
