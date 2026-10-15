"""Customer-channel request and response contracts."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ContactEntities(BaseModel):
    email: str | None = None
    phone: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None = None
    company: str | None = None
    city: str | None = None
    country: str | None = None


class ChannelTurnRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    organization_id: str | None = None
    conversation_id: str
    message: str = Field(min_length=1, max_length=20_000)
    tenant_context: dict[str, Any] = Field(default_factory=dict)
    transcript: list[dict[str, str]] = Field(default_factory=list, max_length=100)
    message_from: Literal["customer", "agent"] = Field(default="customer", alias="from")
    agent_name: str | None = Field(default=None, max_length=200)


class WebchatBotRequest(ChannelTurnRequest):
    pass


class WhatsAppBotRequest(ChannelTurnRequest):
    pass


class BotTurnRequest(ChannelTurnRequest):
    channel: str = "webchat"


class BotTurnResponse(BaseModel):
    reply: str
    confidence: float = 0.5
    intent: str | None = None
    candidate_skills: list[str] = Field(default_factory=list)
    selected_queue_key: str | None = None
    summary: str | None = None
    sentiment: str | None = None
    important_facts: list[str] = Field(default_factory=list)
    contact_entities: ContactEntities = Field(default_factory=ContactEntities)
    knowledge_used: list[str] = Field(default_factory=list)
    handoff_recommended: bool = False
    handoff_reason: str | None = None
    trace_id: str | None = None
    model_name: str = "unknown"


class WebchatBotResponse(BotTurnResponse):
    pass


class WhatsAppBotResponse(BotTurnResponse):
    pass


class BotModelResponse(BaseModel):
    reply: str
    confidence: float = Field(default=0.5, ge=0, le=1)
    intent: str | None = None
    candidate_skills: list[str] = Field(default_factory=list)
    selected_queue_key: str | None = None
    summary: str | None = None
    sentiment: str | None = None
    important_facts: list[str] = Field(default_factory=list)
    knowledge_used: list[str] = Field(default_factory=list)
    handoff_recommended: bool = False
    handoff_reason: str | None = None
    contact_entities: ContactEntities = Field(default_factory=ContactEntities)


class TranscriptItem(BaseModel):
    role: str
    content: str


TenantContext = dict[str, Any]


class ContactEntityExtractionRequest(BaseModel):
    organization_id: str | None = None
    conversation_id: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=20_000)
    channel: Literal["webchat", "whatsapp", "instagram", "facebook", "email"]


class ContactEntityExtractionResponse(BaseModel):
    contact_entities: ContactEntities
    trace_id: str
    model_name: str


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class EmailTranscriptMessage(_StrictModel):
    role: str = Field(min_length=1, max_length=50)
    content: str = Field(min_length=1, max_length=20_000)


class EmailQueueProfile(_StrictModel):
    key: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=300)
    description: str = Field(max_length=2_000)
    intents: list[str] = Field(max_length=100)
    skills: list[str] = Field(max_length=100)


class EmailTurnRequest(_StrictModel):
    organization_id: str = Field(min_length=1, max_length=200)
    conversation_id: str = Field(min_length=1, max_length=200)
    subject: str = Field(max_length=2_000)
    message: str = Field(min_length=1, max_length=100_000)
    tenant_context: dict[str, Any]
    transcript: list[EmailTranscriptMessage]
    queue_profiles: list[EmailQueueProfile]
    confidence_threshold: float = Field(default=0.8, ge=0, le=1)


EmailUrgency = Literal["normal", "high", "critical"]


class EmailTurnResponse(_StrictModel):
    reply: str | None
    confidence: float = Field(ge=0, le=1)
    grounded: bool
    intent: str | None
    selected_queue_key: str | None
    candidate_skills: list[str]
    summary: str | None
    sentiment: str | None
    important_facts: list[str]
    knowledge_used: list[str]
    handoff_recommended: bool
    handoff_reason: str | None
    guard_passed: bool
    guard_reasons: list[str]
    urgency: EmailUrgency = "normal"
    contact_entities: ContactEntities = Field(default_factory=ContactEntities)
    trace_id: str
    model_name: str


class EmailPriorityRequest(_StrictModel):
    organization_id: str = Field(min_length=1, max_length=200)
    conversation_id: str = Field(min_length=1, max_length=200)
    subject: str = Field(max_length=2_000)
    message: str = Field(min_length=1, max_length=100_000)


class EmailPriorityResponse(_StrictModel):
    urgency: EmailUrgency
    trace_id: str
    model_name: str
