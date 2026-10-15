"""Pydantic schemas for proactive analytics insights."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class InsightsGenerateRequest(BaseModel):
    website_id: int
    period: str
    snapshot: dict[str, Any]
    organization_id: int | None = None
    user_id: int | None = None


class ContributingFactor(BaseModel):
    label: str
    pct: float


class SupportingEvidence(BaseModel):
    title: str
    detail: str


class DiagnosticInsight(BaseModel):
    metric: str
    severity: Literal["normal", "warning", "critical"] = "normal"
    headline: str
    stat: str
    observation: str
    contributing_factors: list[ContributingFactor] = Field(default_factory=list)
    supporting_evidence: list[SupportingEvidence] = Field(default_factory=list)


class RiskSignal(BaseModel):
    level: Literal["warning", "muted"] = "muted"
    title: str
    detail: str


class PredictiveNarrative(BaseModel):
    volume_narrative: str
    bounce_narrative: str
    risk_signals: list[RiskSignal] = Field(default_factory=list)


class Recommendation(BaseModel):
    priority: Literal["High", "Medium", "Low"]
    title: str
    impact: str
    reason: str
    action_label: str
    action_href: str


class PrescriptiveNarrative(BaseModel):
    hint: str
    recommendations: list[Recommendation] = Field(default_factory=list)


class InsightsNarrativeResponse(BaseModel):
    diagnostic: DiagnosticInsight
    predictive: PredictiveNarrative
    prescriptive: PrescriptiveNarrative
