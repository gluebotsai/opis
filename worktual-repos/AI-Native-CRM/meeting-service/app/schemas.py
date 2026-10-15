from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EntityType = Literal["contact", "deal", "team"]


class TokenPrincipal(BaseModel):
    organization_id: str
    sub: str = "crm"
    scopes: list[str] = Field(default_factory=list)
    email: str | None = None
    iss: str | None = None
    google_sub: str | None = None


class CreateMeetingRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    organization_id: str = ""
    entity_type: EntityType
    entity_id: str
    meeting_url: str
    bot_name: str | None = None
    consent_captured: bool = False
    join_at: datetime | None = None
    expected_end_at: datetime | None = None
    # None = use VEXA_RECORDING_ENABLED. True stores Vexa audio+video; costs RAM/CPU.
    recording_enabled: bool | None = None


class ReleaseBotRequest(BaseModel):
    meeting_url: str


class MeetingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    entity_type: str
    entity_id: str
    status: str
    error_code: str | None = None
    error_message: str | None = None
    platform: str
    native_meeting_id: str
    bot_name: str
    meeting_url: str
    join_at: datetime | None = None
    expected_end_at: datetime | None = None
    created_at: datetime
    admitted_at: datetime | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    recording_enabled: bool = False


class SegmentOut(BaseModel):
    segment_id: str
    speaker: str = ""
    text: str
    start: float | None = None
    end: float | None = None
    completed: bool = True
    # Meet mic id (`ch-0:1`). CRM locks the customer from this, not the display name.
    speaker_key: str = ""


class ExtractOut(BaseModel):
    meeting_id: str
    organization_id: str
    entity_type: str
    entity_id: str
    status: str
    summary: str = ""
    next_step: str = ""
    action_items: list[Any] = Field(default_factory=list)
    pain_points: list[Any] = Field(default_factory=list)
    products: list[Any] = Field(default_factory=list)
    speakers: list[Any] = Field(default_factory=list)


class MeetingExtractSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    summary: str = ""
    next_step: str = ""
    action_items: list[str] = Field(default_factory=list)
    pain_points: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    speakers: list[str] = Field(default_factory=list)


class LiveTipSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    missing_fields: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    suggested_question: str = ""


class AssistSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    google_id_token: str


class AssistPasswordSessionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    email: str
    password: str


class AssistSessionOut(BaseModel):
    token: str
    expires_in: int
    user: dict[str, Any] = Field(default_factory=dict)


class AssistAskRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    meeting_url: str
    query: str
    intent: Literal["ask", "assist"] = "ask"
    google_id_token: str | None = None
    time_zone: str | None = None


class AssistAskOut(BaseModel):
    meeting_id: str
    reply: str = ""
    user: dict[str, Any] = Field(default_factory=dict)
    ok: bool | None = None
    talkTrack: str | None = None
    suggestions: list[Any] = Field(default_factory=list)
    nextQuestions: list[str] = Field(default_factory=list)
    conversationContext: dict[str, Any] | None = None
    nextBestAction: str | None = None
    sentimentCoachHint: str | None = None
    sentiment: str | None = None
    query: str | None = None


class AssistMeetBootstrapRequest(BaseModel):
    meeting_url: str
    time_zone: str | None = None


class AssistMeetBootstrapOut(BaseModel):
    session_id: str
    activity_id: str
    panel_token: str
    events_path: str
    segments_synced: int = 0
    last_heard: dict[str, Any] | None = None
    last_suggestions: dict[str, Any] | None = None
    meeting_kind: str | None = None
    contact_id: str | None = None
    contact_name: str | None = None
    contact_card: dict[str, Any] | None = None
    chat_history: list[Any] = Field(default_factory=list)
    # Bounded "mark as customer" picker options for this meeting — the
    # customer plus any guest emails outside the org's internal domains.
    customer_pool: list[dict[str, Any]] = Field(default_factory=list)


class AssistSyncLiveRequest(BaseModel):
    meeting_url: str = ""
    activity_id: str = ""
    time_zone: str | None = None


class AssistExecuteActionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    meeting_url: str
    time_zone: str | None = None
    action: dict[str, Any] | None = None
