"""Internal dashboard analytics APIs."""

from fastapi import APIRouter, Depends, Header

from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.schemas.dashboard_analytics import (
    DiagnosticReviewRequest,
    DiagnosticReviewResponse,
    ForecastAdjustmentRequest,
    ForecastAdjustmentResponse,
    WorkforcePlanRequest,
    WorkforcePlanResponse,
    build_diagnostic_review_prompt,
    build_forecast_adjustment_prompt,
    build_workforce_plan_prompt,
)


def create_dashboard_analytics_router() -> APIRouter:
    router = APIRouter(prefix="/internal/v1/dashboard-analytics", tags=["DashboardAnalytics"])

    @router.post("/diagnostic-review", response_model=DiagnosticReviewResponse)
    async def diagnostic_review(
        request: DiagnosticReviewRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> DiagnosticReviewResponse:
        authenticate_internal(
            None,
            x_tenant_id,
            x_internal_service_key,
            "dashboard_analytics.diagnostic_review",
        )
        current = request.current_facts
        baseline = request.baseline_facts
        queue_name = current.get("queueName") or current.get("channel") or "the queue"
        current_rate = float(current.get("missedContactRate") or 0)
        baseline_rate = float(baseline.get("missedContactRate") or 0)
        fallback = DiagnosticReviewResponse(
            decision="update",
            same_incident=True,
            headline=f"Missed contacts elevated in {queue_name}",
            summary=(
                f"The missed-contact rate moved from the {baseline_rate:.1f}% baseline "
                f"to {current_rate:.1f}%."
            ),
            evidence_ids=["rate_delta", "top_driver"],
            recommendation_keys=["increase_ready_coverage"],
            unsupported_claims=[],
        )
        try:
            result = await llm.json(build_diagnostic_review_prompt(request))
            payload = DiagnosticReviewResponse.model_validate(result)
            if payload.decision == "no_change":
                return payload
            if not payload.headline.strip():
                payload.headline = fallback.headline
            if not payload.summary.strip():
                payload.summary = fallback.summary
            return payload
        except Exception:
            return fallback

    @router.post("/forecast-adjustment", response_model=ForecastAdjustmentResponse)
    async def forecast_adjustment(
        request: ForecastAdjustmentRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> ForecastAdjustmentResponse:
        authenticate_internal(
            None,
            x_tenant_id,
            x_internal_service_key,
            "dashboard_analytics.forecast_adjustment",
        )
        fallback = ForecastAdjustmentResponse(decision="no_adjustment", confidence="medium")
        try:
            result = await llm.json(build_forecast_adjustment_prompt(request))
            return ForecastAdjustmentResponse.model_validate(result)
        except Exception:
            return fallback

    @router.post("/workforce-plan", response_model=WorkforcePlanResponse)
    async def workforce_plan(
        request: WorkforcePlanRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> WorkforcePlanResponse:
        authenticate_internal(
            None,
            x_tenant_id,
            x_internal_service_key,
            "dashboard_analytics.workforce_plan",
        )
        fallback = WorkforcePlanResponse(decision="no_change", reason="Rule-based fallback")
        try:
            result = await llm.json(build_workforce_plan_prompt(request))
            return WorkforcePlanResponse.model_validate(result)
        except Exception:
            return fallback

    return router
