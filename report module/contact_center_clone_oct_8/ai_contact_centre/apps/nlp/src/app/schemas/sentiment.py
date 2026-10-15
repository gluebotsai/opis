"""Schemas for workspace sentiment analysis."""

from typing import Literal

from pydantic import BaseModel, Field

SentimentLabel = Literal[
    "very_positive",
    "positive",
    "neutral",
    "negative",
    "very_negative",
]


class SentimentTranscriptTurn(BaseModel):
    role: Literal["customer", "agent", "system"]
    text: str = Field(min_length=1, max_length=4000)
    at: str = Field(min_length=1)


class SentimentTriggerTurn(BaseModel):
    role: Literal["customer", "agent"]
    text: str = Field(min_length=1, max_length=4000)
    message_id: str = Field(min_length=1)


class SentimentAxisResult(BaseModel):
    label: SentimentLabel
    score: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    rationale: str = Field(max_length=200)


class SentimentTurnRequest(BaseModel):
    organization_id: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    channel: str | None = None
    trigger_turn: SentimentTriggerTurn
    transcript: list[SentimentTranscriptTurn] = Field(default_factory=list, max_length=50)


class SentimentSignals(BaseModel):
    escalation_risk: Literal["low", "medium", "high"] = "low"
    customer_intent_shift: Literal["none", "worsening", "improving"] = "none"


class SentimentTurnResponse(BaseModel):
    customer: SentimentAxisResult
    agent: SentimentAxisResult
    signals: SentimentSignals = Field(default_factory=SentimentSignals)
    model_name: str = "worktual-gemma"


class SentimentSessionRequest(BaseModel):
    organization_id: str = Field(min_length=1)
    conversation_id: str = Field(min_length=1)
    channel: str | None = None
    transcript: list[SentimentTranscriptTurn] = Field(default_factory=list, max_length=200)


class SentimentSessionResponse(BaseModel):
    customer: SentimentAxisResult
    agent: SentimentAxisResult
    summary: str = Field(max_length=2000)
    model_name: str = "worktual-gemma"
