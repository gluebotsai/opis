"""Internal scheduled report summary API."""

from fastapi import APIRouter, Depends, Header

from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.schemas.reports import (
    AgentPerformanceSummaryRequest,
    ExecutiveSummaryRequest,
    ExecutiveSummaryResponse,
    build_agent_performance_summary_prompt,
    build_executive_summary_prompt,
)


def create_reports_router() -> APIRouter:
    router = APIRouter(prefix="/internal/v1/reports", tags=["Reports"])

    @router.post("/executive-summary", response_model=ExecutiveSummaryResponse)
    async def executive_summary(
        request: ExecutiveSummaryRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> ExecutiveSummaryResponse:
        authenticate_internal(
            None,
            x_tenant_id,
            x_internal_service_key,
            "reports.executive_summary",
        )
        try:
            result = await llm.json(build_executive_summary_prompt(request))
        except Exception:
            return ExecutiveSummaryResponse(
                summary=(
                    f"Performance report for {request.period_label}. "
                    "Review the attached dashboard and agent table for details."
                ),
                highlights=[],
                improvementSuggestions=[],
            )

        summary = str(result.get("summary", "")).strip()
        highlights_raw = result.get("highlights", [])
        highlights = [
            str(item).strip()
            for item in highlights_raw
            if isinstance(item, (str, int, float)) and str(item).strip()
        ][:3]
        suggestions_raw = result.get("improvementSuggestions", result.get("improvement_suggestions", []))
        improvement_suggestions = [
            str(item).strip()
            for item in suggestions_raw
            if isinstance(item, (str, int, float)) and str(item).strip()
        ][:5]
        if not summary:
            summary = (
                f"Performance report for {request.period_label}. "
                "Key metrics are included in the attached report."
            )
        return ExecutiveSummaryResponse(
            summary=summary,
            highlights=highlights,
            improvementSuggestions=improvement_suggestions,
        )

    @router.post("/agent-performance-summary", response_model=ExecutiveSummaryResponse)
    async def agent_performance_summary(
        request: AgentPerformanceSummaryRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> ExecutiveSummaryResponse:
        authenticate_internal(
            None,
            x_tenant_id,
            x_internal_service_key,
            "reports.agent_performance_summary",
        )
        try:
            result = await llm.json(build_agent_performance_summary_prompt(request))
        except Exception:
            return ExecutiveSummaryResponse(
                summary=(
                    f"Personal performance report for {request.period_label}. "
                    "Review the attached KPIs for details."
                ),
                highlights=[],
                improvementSuggestions=[],
            )

        summary = str(result.get("summary", "")).strip()
        highlights_raw = result.get("highlights", [])
        highlights = [
            str(item).strip()
            for item in highlights_raw
            if isinstance(item, (str, int, float)) and str(item).strip()
        ][:3]
        suggestions_raw = result.get("improvementSuggestions", result.get("improvement_suggestions", []))
        improvement_suggestions = [
            str(item).strip()
            for item in suggestions_raw
            if isinstance(item, (str, int, float)) and str(item).strip()
        ][:5]
        if not summary:
            summary = (
                f"Personal performance report for {request.period_label}. "
                "Key metrics are included in the attached report."
            )
        return ExecutiveSummaryResponse(
            summary=summary,
            highlights=highlights,
            improvementSuggestions=improvement_suggestions,
        )

    return router
