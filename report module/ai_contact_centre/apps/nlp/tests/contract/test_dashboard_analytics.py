"""Dashboard analytics schema contract tests."""

from app.schemas.dashboard_analytics import (
    DiagnosticReviewRequest,
    DiagnosticReviewResponse,
    ForecastAdjustmentRequest,
    ForecastAdjustmentResponse,
    WorkforcePlanRequest,
    WorkforcePlanResponse,
)


def test_diagnostic_review_request_accepts_camel_case_payload() -> None:
    payload = DiagnosticReviewRequest.model_validate(
        {
            "schemaVersion": 1,
            "promptVersion": "dashboard-analytics-v1",
            "task": "review_diagnostic_candidate",
            "candidate": {"fingerprint": "missed_contact:1:whatsapp:42:no_agent_available"},
            "currentFacts": {"missedContactRate": 12.5},
            "baselineFacts": {"missedContactRate": 6.8},
        }
    )
    assert payload.current_facts["missedContactRate"] == 12.5


def test_diagnostic_review_response_requires_known_decision() -> None:
    response = DiagnosticReviewResponse.model_validate(
        {
            "decision": "update",
            "sameIncident": True,
            "headline": "Missed contacts elevated",
            "summary": "Rate increased.",
            "evidenceIds": ["rate_delta"],
            "recommendationKeys": ["increase_ready_coverage"],
            "unsupportedClaims": [],
        }
    )
    assert response.decision == "update"


def test_forecast_adjustment_response_defaults() -> None:
    response = ForecastAdjustmentResponse.model_validate({"decision": "no_adjustment"})
    assert response.organization_daily_multipliers == []


def test_workforce_plan_request_accepts_queue_requirements() -> None:
    payload = WorkforcePlanRequest.model_validate(
        {
            "schemaVersion": 1,
            "promptVersion": "dashboard-analytics-v1",
            "task": "build_daily_workforce_plan",
            "forecastDate": "2026-08-28",
            "forecastVersion": "volume-2026-08-27",
            "inputSignature": "abc123",
            "queueRequirements": [{"queueId": "42", "allowedAddCount": 2}],
            "allowedDecisions": ["update", "no_change"],
        }
    )
    assert payload.queue_requirements[0]["queueId"] == "42"


def test_workforce_plan_response_no_change() -> None:
    response = WorkforcePlanResponse.model_validate(
        {
            "decision": "no_change",
            "sameAsPrevious": True,
            "reason": "Inputs unchanged",
        }
    )
    assert response.decision == "no_change"
