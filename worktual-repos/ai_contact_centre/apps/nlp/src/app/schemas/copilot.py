"""Copilot HTTP contracts."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

CopilotRole = Literal["admin", "agent"]


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class PendingConfirmation(BaseModel):
    id: str = Field(min_length=1)
    tool: str = Field(min_length=1)
    args: dict[str, Any]


class CopilotContext(BaseModel):
    model_config = ConfigDict(extra="allow")

    path: str
    surface: str = "other"
    queue_id: str | None = Field(default=None, alias="queueId")
    contact_id: str | None = Field(default=None, alias="contactId")
    contact_name: str | None = Field(default=None, alias="contactName")
    contact_email: str | None = Field(default=None, alias="contactEmail")
    contact_phone: str | None = Field(default=None, alias="contactPhone")
    task_id: str | None = Field(default=None, alias="taskId")
    conversation_id: str | None = Field(default=None, alias="conversationId")
    source_message_id: str | None = Field(default=None, alias="sourceMessageId")
    assist_revision: int | None = Field(default=None, ge=1, alias="assistRevision")
    assist_structured: bool = Field(default=False, alias="assistStructured")
    record_label: str | None = Field(default=None, alias="recordLabel")
    pending_confirmation: PendingConfirmation | None = Field(
        default=None,
        alias="pendingConfirmation",
    )
    contact_draft: dict[str, Any] | None = Field(default=None, alias="contactDraft")
    queue_draft: dict[str, Any] | None = Field(default=None, alias="queueDraft")
    incident_id: str | None = Field(default=None, alias="incidentId")
    # My Performance page date window (progressive SQL scoping)
    range: str | None = None
    start: str | None = None
    end: str | None = None


class CopilotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    role: CopilotRole = "admin"
    context: CopilotContext
    history: list[HistoryMessage] = Field(default_factory=list, max_length=100)
    tenant_id: str | None = None
    user_id: str | None = None
    confirmed_actions: list[str] = Field(default_factory=list)


class CopilotSyncResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    turn_id: str = Field(alias="turnId")
    route: str
    blocks: list[dict[str, Any]]
    reply: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    config_updates: dict[str, Any] = Field(default_factory=dict)


class ToolContext(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    tenant_id: str
    user_id: str | None = None
    authorization: str | None = None
    role: CopilotRole
    queue_id: str | None = None
    contact_id: str | None = None
    task_id: str | None = None
    conversation_id: str | None = None
    confirmed_actions: set[str] = Field(default_factory=set)
    period_range: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    # Progressive skills / metrics loaded during this turn
    active_skills: dict[str, Any] = Field(default_factory=dict)
    allowed_skills: set[str] = Field(default_factory=set)
    active_metrics: dict[str, Any] = Field(default_factory=dict)
    active_schema: dict[str, Any] | None = None
    # Rows from sql_analytics / generate_performance_report for plot grounding
    recent_tool_data: list[dict[str, Any]] = Field(default_factory=list)
    # Idempotency cache for repeated LLM tool calls in one turn
    executed_tool_results: dict[str, dict[str, Any]] = Field(default_factory=dict)
    contact_draft: dict[str, Any] | None = None
    contact_draft_at_turn_start: dict[str, Any] | None = None
    queue_draft: dict[str, Any] | None = None
    queue_draft_at_turn_start: dict[str, Any] | None = None
    incident_id: str | None = None
