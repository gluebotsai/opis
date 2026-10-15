"""Internal LLM queue selection for ACD voice routing."""

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field

from app.agents.queue_select import select_queue_with_llm
from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.schemas.bot import EmailQueueProfile


class VoiceQueueRoutingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    organization_id: str = Field(min_length=1, max_length=200)
    transcript: str = Field(min_length=1, max_length=100_000)
    queue_profiles: list[EmailQueueProfile] = Field(min_length=1, max_length=100)


class VoiceQueueRoutingResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    queue_id: str
    skills: list[str]


def create_voice_routing_router() -> APIRouter:
    router = APIRouter(prefix="/internal/v1/voice-routing", tags=["VoiceRouting"])

    @router.post("/select-queue", response_model=VoiceQueueRoutingResponse)
    async def select_voice_queue(
        request: VoiceQueueRoutingRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> VoiceQueueRoutingResponse:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "voice_routing.select_queue",
        )
        queue_id, skills = await select_queue_with_llm(
            llm,
            [profile.model_dump() for profile in request.queue_profiles],
            request.transcript,
        )
        # queue_profiles is non-empty, so the shared selector always has a fallback.
        return VoiceQueueRoutingResponse(
            queue_id=queue_id or request.queue_profiles[0].key,
            skills=skills,
        )

    return router
