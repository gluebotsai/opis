"""Schemas for workspace wrap-up assist."""

from typing import Literal

from pydantic import BaseModel, Field


class WrapUpTranscriptTurn(BaseModel):
    role: Literal["customer", "agent", "system"]
    text: str = Field(min_length=1, max_length=4000)
    at: str = Field(min_length=1)


class WrapUpDispositionOption(BaseModel):
    code: str = Field(min_length=1)
    label: str = Field(min_length=1)
    description: str | None = None


class WrapUpSuggestRequest(BaseModel):
    organization_id: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    channel: str | None = None
    subject: str | None = None
    transcript: list[WrapUpTranscriptTurn] = Field(default_factory=list)
    dispositions: list[WrapUpDispositionOption] = Field(default_factory=list)


class WrapUpSuggestResponse(BaseModel):
    summary: str
    resolution: Literal["resolved", "unresolved", "transferred"]
    disposition_code: str | None = None


class FollowUpExtractRequest(BaseModel):
    organization_id: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    channel: str | None = None
    subject: str | None = None
    reference_time: str = Field(min_length=1)
    transcript: list[WrapUpTranscriptTurn] = Field(default_factory=list)


class FollowUpExtractResponse(BaseModel):
    has_follow_up: bool
    title: str = ""
    summary: str = ""
    notes: str | None = None
    due_at: str | None = None
