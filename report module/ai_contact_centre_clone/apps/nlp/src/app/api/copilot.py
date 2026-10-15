"""Co-worker REST and SSE API boundary."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.agents.coworker import create_coworker_agent
from app.agents.custom_booxoo_assist.assist import stream_booxoo_assist
from app.agents.custom_booxoo_assist.confirm import create_confirmed_ticket
from app.agents.custom_lola_assist.assist import stream_lola_assist
from app.api.auth import authenticate_jwt
from app.config import get_settings
from app.llm.assist_client import get_assist_llm_client
from app.llm.client import get_llm_client
from app.runtime.context import RunContext
from app.runtime.router import AgentRouter
from app.runtime.sse import sse_done, sse_error
from app.schemas.copilot import CopilotRequest, CopilotRole, CopilotSyncResponse
from app.services.period_resolver import apply_spoken_period

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@lru_cache
def get_agent_router() -> AgentRouter:
    return create_coworker_agent(
        llm=get_llm_client(),
        assist_llm=get_assist_llm_client(),
    )


def _run_context(
    request: CopilotRequest, authorization: str | None, tenant: str | None
) -> RunContext:
    auth = authenticate_jwt(
        authorization,
        tenant,
        body_tenant=request.tenant_id,
        body_user=request.user_id,
        body_role=request.role,
    )
    context = RunContext(
        tenant_id=auth.tenant_id,
        user_id=auth.user_id,
        role=auth.role,
        surface=request.context.surface,
        path=request.context.path,
        conversation_id=request.context.conversation_id,
        contact_id=request.context.contact_id,
        task_id=request.context.task_id,
        queue_id=request.context.queue_id,
        incident_id=request.context.incident_id,
        confirmed_actions=request.confirmed_actions,
        extra={
            "authorization": auth.authorization,
            "range": request.context.range,
            "start": request.context.start,
            "end": request.context.end,
            "record_label": request.context.record_label,
            "contact_name": request.context.contact_name,
            "contact_email": request.context.contact_email,
            "contact_phone": request.context.contact_phone,
            "source_message_id": request.context.source_message_id,
            "assist_revision": request.context.assist_revision,
            "assist_structured": request.context.assist_structured,
            "pending_confirmation": (
                request.context.pending_confirmation.model_dump()
                if request.context.pending_confirmation
                else None
            ),
            "contact_draft": request.context.contact_draft,
            "contact_draft_at_turn_start": (
                dict(request.context.contact_draft)
                if isinstance(request.context.contact_draft, dict)
                else None
            ),
            "queue_draft": request.context.queue_draft,
            "queue_draft_at_turn_start": (
                dict(request.context.queue_draft)
                if isinstance(request.context.queue_draft, dict)
                else None
            ),
        },
    )
    apply_spoken_period(context.extra, request.message)
    return context


class BooxooTicketConfirmRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    conversation_id: str = Field(min_length=1, alias="conversationId")
    collected_inputs: dict[str, Any] = Field(default_factory=dict, alias="collectedInputs")
    tenant_id: str | None = None
    user_id: str | None = None
    role: CopilotRole = "agent"


def _messages(request: CopilotRequest) -> list[dict[str, str]]:
    history = [{"role": item.role, "content": item.content} for item in request.history]
    return history + [{"role": "user", "content": request.message}]


async def _stream_agent(
    router: AgentRouter,
    request: CopilotRequest,
    context: RunContext,
    error_code: str = "copilot_turn_failed",
    direct_agent_name: str | None = None,
) -> AsyncIterator[str]:
    try:
        stream = (
            router.stream_direct(direct_agent_name, _messages(request), context)
            if direct_agent_name is not None
            else router.stream(_messages(request), context)
        )
        async for event in stream:
            yield event
    except Exception as error:
        yield sse_error(str(error), error_code)
        yield sse_done(route=router.select_agent(context.surface).definition.name)


def create_copilot_router(api_v1_base: str) -> APIRouter:
    router = APIRouter(prefix=f"{api_v1_base}/copilot", tags=["Copilot"])

    @router.post("", response_model=CopilotSyncResponse)
    async def copilot(
        request: CopilotRequest,
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
        agent_router: AgentRouter = Depends(get_agent_router),
    ) -> CopilotSyncResponse:
        context = _run_context(request, authorization, x_tenant_id)
        settings = get_settings()
        async with asyncio.timeout(settings.copilot_timeout_seconds):
            result = await agent_router.route_and_run(_messages(request), context)
        reply = str(result.get("reply") or "")
        route = str(
            result.get("agent") or agent_router.select_agent(context.surface).definition.name
        )
        return CopilotSyncResponse(
            turn_id=str(uuid.uuid4()),
            route=route,
            reply=reply,
            blocks=[{"type": "text", "text": reply}] if reply else [],
        )

    @router.post("/stream")
    async def copilot_stream(
        request: CopilotRequest,
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
        agent_router: AgentRouter = Depends(get_agent_router),
    ) -> StreamingResponse:
        context = _run_context(request, authorization, x_tenant_id)
        if _lola_workspace_coworker(context):
            return StreamingResponse(
                _stream_lola_assist(
                    _messages(request),
                    context,
                    audience="agent",
                    error_code="copilot_turn_failed",
                ),
                media_type="text/event-stream",
                headers=SSE_HEADERS,
            )
        if _booxoo_workspace_coworker(context):
            return StreamingResponse(
                _stream_booxoo_assist(
                    _messages(request),
                    context,
                    audience="agent",
                    error_code="copilot_turn_failed",
                ),
                media_type="text/event-stream",
                headers=SSE_HEADERS,
            )
        return StreamingResponse(
            _stream_agent(agent_router, request, context),
            media_type="text/event-stream",
            headers=SSE_HEADERS,
        )

    @router.post("/suggest-reply/stream")
    async def suggest_reply_stream(
        request: CopilotRequest,
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
        agent_router: AgentRouter = Depends(get_agent_router),
    ) -> StreamingResponse:
        context = _run_context(request, authorization, x_tenant_id)
        context.surface = "inbox"
        if not context.conversation_id:
            raise HTTPException(
                status_code=422,
                detail="context.conversationId is required for reply suggestions",
            )
        if context.tenant_id in get_settings().custom_lola_assist_org_id_set:
            return StreamingResponse(
                _stream_lola_assist(_messages(request), context),
                media_type="text/event-stream",
                headers=SSE_HEADERS,
            )
        if context.tenant_id in get_settings().custom_booxoo_bot_org_id_set:
            return StreamingResponse(
                _stream_booxoo_assist(_messages(request), context),
                media_type="text/event-stream",
                headers=SSE_HEADERS,
            )
        return StreamingResponse(
            _stream_agent(
                agent_router,
                request,
                context,
                "suggestion_failed",
                "conversation_assist",
            ),
            media_type="text/event-stream",
            headers=SSE_HEADERS,
        )

    @router.post("/suggest-reply/confirm")
    async def suggest_reply_confirm(
        request: BooxooTicketConfirmRequest,
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        auth = authenticate_jwt(
            authorization,
            x_tenant_id,
            body_tenant=request.tenant_id,
            body_user=request.user_id,
            body_role=request.role,
        )
        if auth.tenant_id not in get_settings().custom_booxoo_bot_org_id_set:
            raise HTTPException(status_code=404, detail="Not found")
        return await asyncio.to_thread(
            create_confirmed_ticket,
            organization_id=auth.tenant_id,
            conversation_id=request.conversation_id,
            collected_inputs=request.collected_inputs,
        )

    return router


def _booxoo_workspace_coworker(context: RunContext) -> bool:
    return bool(
        context.surface == "inbox"
        and context.conversation_id
        and context.tenant_id in get_settings().custom_booxoo_bot_org_id_set
    )


def _lola_workspace_coworker(context: RunContext) -> bool:
    return bool(
        context.surface == "inbox"
        and context.conversation_id
        and context.tenant_id in get_settings().custom_lola_assist_org_id_set
    )


async def _stream_booxoo_assist(
    messages: list[dict[str, str]],
    context: RunContext,
    audience: str = "customer",
    error_code: str = "suggestion_failed",
) -> AsyncIterator[str]:
    try:
        async for event in stream_booxoo_assist(messages, context, audience=audience):
            yield event
    except Exception as error:
        yield sse_error(str(error), error_code)
        yield sse_done(route="inbox", routing_chain=["custom_booxoo_assist"])


async def _stream_lola_assist(
    messages: list[dict[str, str]],
    context: RunContext,
    audience: str = "customer",
    error_code: str = "suggestion_failed",
) -> AsyncIterator[str]:
    try:
        async for event in stream_lola_assist(messages, context, audience=audience):
            yield event
    except Exception as error:
        yield sse_error(str(error), error_code)
        yield sse_done(route="inbox", routing_chain=["custom_lola_assist"])
