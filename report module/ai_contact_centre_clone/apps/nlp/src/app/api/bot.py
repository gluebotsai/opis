"""Customer-channel APIs backed by one SupportBotAgent dependency."""

import uuid
from typing import Any, Protocol

from fastapi import APIRouter, Depends, Header

from app.agents import support_agent_registry
from app.api.auth import authenticate_internal
from app.llm.client import LLMClient, get_llm_client
from app.prompts.email import EMAIL_PRIORITY_PROMPT
from app.schemas.bot import (
    BotTurnResponse,
    EmailPriorityRequest,
    EmailPriorityResponse,
    EmailTurnRequest,
    EmailTurnResponse,
    WebchatBotRequest,
    WebchatBotResponse,
    WhatsAppBotRequest,
    WhatsAppBotResponse,
)


class SupportBotRunner(Protocol):
    async def run_turn(
        self,
        organization_id: str,
        conversation_id: str,
        message: str,
        channel: str = "webchat",
        tenant_context: dict[str, Any] | None = None,
        transcript: list[dict[str, Any]] | None = None,
    ): ...


def _response_payload(result: BotTurnResponse) -> dict[str, Any]:
    return result.model_dump()


async def _run_bot(
    organization_id: str,
    *,
    conversation_id: str,
    message: str,
    channel: str,
    tenant_context: dict[str, Any],
    transcript: list[dict[str, Any]],
) -> BotTurnResponse:
    agent = support_agent_registry.resolve_support_agent(organization_id)
    return await agent.run_turn(
        organization_id=organization_id,
        conversation_id=conversation_id,
        message=message,
        channel=channel,
        tenant_context=tenant_context,
        transcript=transcript,
    )


def create_bot_router(api_v1_base: str) -> APIRouter:
    router = APIRouter(tags=["Support Bot"])

    @router.post(f"{api_v1_base}/webchat/turn", response_model=WebchatBotResponse)
    async def webchat_turn(
        request: WebchatBotRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
    ) -> WebchatBotResponse:
        auth = authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "webchat",
        )
        if request.message_from == "agent":
            return WebchatBotResponse(
                reply="",
                confidence=1.0,
                model_name="agent-ingest",
            )
        result = await _run_bot(
            auth.tenant_id,
            conversation_id=request.conversation_id,
            message=request.message,
            channel="webchat",
            tenant_context=request.tenant_context,
            transcript=request.transcript,
        )
        return WebchatBotResponse.model_validate(_response_payload(result))

    @router.post(f"{api_v1_base}/whatsapp/turn", response_model=WhatsAppBotResponse)
    async def whatsapp_turn(
        request: WhatsAppBotRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
    ) -> WhatsAppBotResponse:
        auth = authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "whatsapp",
        )
        result = await _run_bot(
            auth.tenant_id,
            conversation_id=request.conversation_id,
            message=request.message,
            channel="whatsapp",
            tenant_context=request.tenant_context,
            transcript=request.transcript,
        )
        return WhatsAppBotResponse.model_validate(_response_payload(result))

    @router.post(f"{api_v1_base}/social/turn", response_model=WhatsAppBotResponse)
    async def social_turn(
        request: WhatsAppBotRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
    ) -> WhatsAppBotResponse:
        channel = str(request.tenant_context.get("channel") or "social")
        auth = authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            channel,
        )
        result = await _run_bot(
            auth.tenant_id,
            conversation_id=request.conversation_id,
            message=request.message,
            channel=channel,
            tenant_context=request.tenant_context,
            transcript=request.transcript,
        )
        return WhatsAppBotResponse.model_validate(_response_payload(result))

    @router.post(f"{api_v1_base}/email/turn", response_model=EmailTurnResponse)
    async def email_turn(
        request: EmailTurnRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
    ) -> EmailTurnResponse:
        auth = authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "email",
        )
        agent = support_agent_registry.resolve_email_agent(auth.tenant_id)
        result = await agent.run_turn(
            organization_id=auth.tenant_id,
            conversation_id=request.conversation_id,
            message=f"{request.subject}\n\n{request.message}",
            channel="email",
            tenant_context={
                **request.tenant_context,
                "queue_profiles": [item.model_dump() for item in request.queue_profiles],
            },
            transcript=[item.model_dump() for item in request.transcript],
        )
        return EmailTurnResponse(
            reply=result.reply,
            confidence=result.confidence,
            grounded=bool(result.reply),
            intent=result.intent,
            selected_queue_key=result.selected_queue_key,
            candidate_skills=result.candidate_skills,
            summary=result.summary,
            sentiment=result.sentiment,
            important_facts=result.important_facts,
            knowledge_used=result.knowledge_used,
            handoff_recommended=result.handoff_recommended,
            handoff_reason=result.handoff_reason,
            guard_passed=not result.handoff_recommended,
            guard_reasons=[] if not result.handoff_recommended else ["handoff_recommended"],
            urgency="normal",
            contact_entities=result.contact_entities,
            trace_id=result.trace_id or str(uuid.uuid4()),
            model_name=result.model_name,
        )

    @router.post(f"{api_v1_base}/email/priority", response_model=EmailPriorityResponse)
    async def email_priority(
        request: EmailPriorityRequest,
        x_tenant_id: str | None = Header(default=None),
        x_internal_service_key: str | None = Header(default=None),
        llm: LLMClient = Depends(get_llm_client),
    ) -> EmailPriorityResponse:
        authenticate_internal(
            request.organization_id,
            x_tenant_id,
            x_internal_service_key,
            "email",
        )
        urgency = "normal"
        try:
            payload = await llm.json(
                [
                    {
                        "role": "system",
                        "content": EMAIL_PRIORITY_PROMPT,
                    },
                    {
                        "role": "user",
                        "content": f"Subject: {request.subject}\nMessage: {request.message}",
                    },
                ]
            )
            candidate = str(payload.get("urgency", "normal")).lower()
            if candidate in {"normal", "high", "critical"}:
                urgency = candidate
        except Exception:
            pass
        return EmailPriorityResponse(
            urgency=urgency,
            trace_id=str(uuid.uuid4()),
            model_name=llm.model,
        )

    return router
