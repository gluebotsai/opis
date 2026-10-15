"""Internal supervisor coaching APIs."""

from fastapi import APIRouter, Depends, Header

from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.schemas.supervisor import (
    AgentAttentionInsightRequest,
    AgentAttentionInsightResponse,
    build_agent_attention_insight_prompt,
)


def create_supervisor_router() -> APIRouter:
    router = APIRouter(prefix="/internal/v1/supervisor", tags=["Supervisor"])

    @router.post("/agent-attention-insight", response_model=AgentAttentionInsightResponse)
    async def agent_attention_insight(
        request: AgentAttentionInsightRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> AgentAttentionInsightResponse:
        authenticate_internal(
            None,
            x_tenant_id,
            x_internal_service_key,
            "supervisor.agent_attention_insight",
        )
        fallback_summary = (
            f"{request.agent_name} has been Not Ready for {request.not_ready_minutes} minutes "
            f"with {request.active_conversations} active conversations."
        )
        fallback_suggestion = (
            "Send a brief check-in and confirm when they expect to return Ready."
        )
        try:
            result = await llm.json(build_agent_attention_insight_prompt(request))
        except Exception:
            return AgentAttentionInsightResponse(
                summary=fallback_summary,
                suggestion=fallback_suggestion,
            )

        summary = str(result.get("summary", "")).strip()
        suggestion = str(result.get("suggestion", "")).strip()
        if not summary:
            summary = fallback_summary
        if not suggestion:
            suggestion = fallback_suggestion
        return AgentAttentionInsightResponse(summary=summary, suggestion=suggestion)

    return router
