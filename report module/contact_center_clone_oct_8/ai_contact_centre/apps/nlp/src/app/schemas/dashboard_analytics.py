"""Dashboard analytics structured LLM schemas."""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DiagnosticReviewRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: int = Field(alias="schemaVersion", ge=1)
    prompt_version: str = Field(alias="promptVersion", min_length=1, max_length=64)
    task: Literal["review_diagnostic_candidate"]
    candidate: dict[str, Any]
    previous_incident: dict[str, Any] | None = Field(default=None, alias="previousIncident")
    current_facts: dict[str, Any] = Field(alias="currentFacts")
    baseline_facts: dict[str, Any] = Field(alias="baselineFacts")
    allowed_evidence_ids: list[str] = Field(default_factory=list, alias="allowedEvidenceIds")
    allowed_recommendation_keys: list[str] = Field(
        default_factory=list,
        alias="allowedRecommendationKeys",
    )


class DiagnosticReviewPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["update", "no_change"]
    same_incident: bool = Field(default=True, alias="sameIncident")
    headline: str = Field(default="", max_length=200)
    summary: str = Field(default="", max_length=1000)
    evidence_ids: list[str] = Field(default_factory=list, alias="evidenceIds", max_length=8)
    recommendation_keys: list[str] = Field(
        default_factory=list,
        alias="recommendationKeys",
        max_length=8,
    )
    unsupported_claims: list[str] = Field(default_factory=list, alias="unsupportedClaims", max_length=8)


class DiagnosticReviewResponse(BaseModel):
    decision: Literal["update", "no_change"]
    same_incident: bool = Field(default=True, alias="sameIncident")
    headline: str = ""
    summary: str = ""
    evidence_ids: list[str] = Field(default_factory=list, alias="evidenceIds")
    recommendation_keys: list[str] = Field(default_factory=list, alias="recommendationKeys")
    unsupported_claims: list[str] = Field(default_factory=list, alias="unsupportedClaims")
    model_name: str | None = Field(default=None, alias="modelName")


class ForecastAdjustmentRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: int = Field(alias="schemaVersion", ge=1)
    prompt_version: str = Field(alias="promptVersion", min_length=1, max_length=64)
    task: Literal["adjust_seven_day_contact_forecast"]
    history: dict[str, Any]
    baseline_forecast: dict[str, Any] = Field(alias="baselineForecast")
    multiplier_bounds: dict[str, float] | None = Field(default=None, alias="multiplierBounds")


class ForecastAdjustmentResponse(BaseModel):
    decision: Literal["adjust", "no_adjustment"]
    confidence: Literal["low", "medium", "high"] = "medium"
    organization_daily_multipliers: list[dict[str, Any]] = Field(
        default_factory=list,
        alias="organizationDailyMultipliers",
    )
    scope_adjustments: list[dict[str, Any]] = Field(default_factory=list, alias="scopeAdjustments")
    peak_windows: list[dict[str, Any]] = Field(default_factory=list, alias="peakWindows")
    risk_labels: list[dict[str, Any]] = Field(default_factory=list, alias="riskLabels")
    summary: str = ""
    model_name: str | None = Field(default=None, alias="modelName")


class WorkforcePlanRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: int = Field(alias="schemaVersion", ge=1)
    prompt_version: str = Field(alias="promptVersion", min_length=1, max_length=64)
    task: Literal["build_daily_workforce_plan"]
    forecast_date: str = Field(alias="forecastDate")
    forecast_version: str = Field(alias="forecastVersion")
    input_signature: str = Field(alias="inputSignature")
    previous_plan: dict[str, Any] | None = Field(default=None, alias="previousPlan")
    diagnostic: dict[str, Any] | None = None
    predictive: dict[str, Any] | None = None
    queue_requirements: list[dict[str, Any]] = Field(default_factory=list, alias="queueRequirements")
    allowed_decisions: list[str] = Field(default_factory=list, alias="allowedDecisions")


class WorkforcePlanResponse(BaseModel):
    decision: Literal["update", "no_change"]
    same_as_previous: bool = Field(default=False, alias="sameAsPrevious")
    plan_fingerprint: str | None = Field(default=None, alias="planFingerprint")
    forecast_date: str | None = Field(default=None, alias="forecastDate")
    queue_plans: list[dict[str, Any]] = Field(default_factory=list, alias="queuePlans")
    reason: str | None = None
    model_name: str | None = Field(default=None, alias="modelName")


def build_diagnostic_review_prompt(payload: DiagnosticReviewRequest) -> list[dict[str, str]]:
    grounded = {
        "candidate": payload.candidate,
        "previousIncident": payload.previous_incident,
        "currentFacts": payload.current_facts,
        "baselineFacts": payload.baseline_facts,
        "allowedEvidenceIds": payload.allowed_evidence_ids,
        "allowedRecommendationKeys": payload.allowed_recommendation_keys,
    }
    return [
        {
            "role": "system",
            "content": (
                "Review a deterministic contact-center diagnostic candidate. "
                "Use only supplied facts; never calculate or invent metrics. "
                "Compare previousIncident with currentFacts. "
                "Return update or no_change. "
                "Use only allowlisted evidence IDs and recommendation keys. "
                "Do not claim causation; describe concentration or association. "
                "Return strict JSON only with keys decision, sameIncident, headline, summary, "
                "evidenceIds, recommendationKeys, unsupportedClaims."
            ),
        },
        {"role": "user", "content": json.dumps(grounded, ensure_ascii=False)},
    ]


def build_forecast_adjustment_prompt(payload: ForecastAdjustmentRequest) -> list[dict[str, str]]:
    grounded = {
        "history": payload.history,
        "baselineForecast": payload.baseline_forecast,
        "multiplierBounds": payload.multiplier_bounds or {"minimum": 0.75, "maximum": 1.25},
    }
    return [
        {
            "role": "system",
            "content": (
                "Adjust a seven-day contact-center volume forecast using only supplied aggregate facts. "
                "Return bounded multipliers between 0.75 and 1.25 unless an approved event signal is present. "
                "Do not invent queue IDs, dates, or volumes. "
                "Return strict JSON only with keys decision, confidence, organizationDailyMultipliers, "
                "scopeAdjustments, peakWindows, riskLabels, summary."
            ),
        },
        {"role": "user", "content": json.dumps(grounded, ensure_ascii=False)},
    ]


def build_workforce_plan_prompt(payload: WorkforcePlanRequest) -> list[dict[str, str]]:
    grounded = {
        "forecastDate": payload.forecast_date,
        "forecastVersion": payload.forecast_version,
        "inputSignature": payload.input_signature,
        "previousPlan": payload.previous_plan,
        "diagnostic": payload.diagnostic,
        "predictive": payload.predictive,
        "queueRequirements": payload.queue_requirements,
        "allowedDecisions": payload.allowed_decisions,
    }
    return [
        {
            "role": "system",
            "content": (
                "Build a daily workforce plan from supplied queue requirements. "
                "Select only eligible agent IDs from queueRequirements. "
                "Never exceed allowedAddCount for any queue. "
                "Return update or no_change. "
                "Return strict JSON only with keys decision, sameAsPrevious, planFingerprint, "
                "forecastDate, queuePlans, reason."
            ),
        },
        {"role": "user", "content": json.dumps(grounded, ensure_ascii=False)},
    ]
