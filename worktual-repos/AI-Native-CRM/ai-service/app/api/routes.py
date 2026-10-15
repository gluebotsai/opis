from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
import httpx
from pydantic import BaseModel, Field

from app.agent_log import invoke_logged
from app.agents import get_agent
from app.auth import require_internal_secret
from app.config import get_settings
from app.operations import (
    ConcurrencyLimiter,
    RateLimiter,
    metrics,
    llm_circuit,
    mcp_circuit,
)

router = APIRouter()
_settings = get_settings()
_agent_concurrency = ConcurrencyLimiter(
    _settings.agent_global_concurrency, _settings.agent_tenant_concurrency
)
_agent_rate = RateLimiter(_settings.agent_requests_per_minute)


class ContactAgentRequest(BaseModel):
    contactId: str = Field(min_length=1)
    organizationId: str | None = None
    force: bool = False


class HelloRequest(BaseModel):
    message: str | None = None


class DealAgentRequest(BaseModel):
    dealId: str = Field(min_length=1)
    organizationId: str | None = None


class InvoiceAgentRequest(BaseModel):
    invoiceId: str = Field(min_length=1)
    organizationId: str | None = None


class ExpansionMatcherRequest(BaseModel):
    companyId: str = Field(min_length=1)
    organizationId: str | None = None


class CollectionRiskRequest(BaseModel):
    companyId: str = Field(min_length=1)
    organizationId: str | None = None


class RevenueGapForecastRequest(BaseModel):
    organizationId: str = Field(min_length=1)


class InvoiceDunningRequest(BaseModel):
    invoiceId: str = Field(min_length=1)
    organizationId: str | None = None


class AssignSalesRequest(BaseModel):
    organizationId: str | None = None
    businessType: str | None = None
    country: str | None = None
    city: str | None = None
    contactId: str | None = None
    companyId: str | None = None
    locationId: str | None = None
    estimatedAmount: float | None = None


class AnalyzeTranscriptRequest(BaseModel):
    transcript: str = Field(min_length=1)
    organizationId: str | None = None


class DispositionRequest(BaseModel):
    channel: str = Field(min_length=1, max_length=32)
    text: str = Field(min_length=1)
    subject: str | None = None
    direction: str | None = None
    organizationId: str | None = None


class AutoReplyEmailRequest(BaseModel):
    activityId: str = Field(min_length=1)
    contactId: str | None = None
    organizationId: str | None = None


class ChatRequest(BaseModel):
    system: str = Field(min_length=1)
    user: str = Field(min_length=1)
    maxTokens: int = 500
    timeoutMs: int = 20_000
    organizationId: str | None = None


class CrmAgentRequest(BaseModel):
    intent: str = "agent_turn"
    messages: list[dict[str, Any]] | None = None
    context: dict[str, Any] | None = None
    catalog: dict[str, Any] | None = None
    sessionMemory: dict[str, Any] | None = None
    organizationId: str | None = None
    role: str | None = None
    businessType: str | None = None
    actingUserId: str | None = None
    confirmTool: dict[str, Any] | None = None
    mcpExecutionToken: str | None = None
    executionMode: str | None = None
    conversationId: str | None = None
    runId: str | None = None
    traceId: str | None = None
    traceparent: str | None = None
    idempotencyKey: str | None = None


class InternalMeetingAssistRequest(BaseModel):
    task: str
    utterance: str | None = None
    question: str | None = None
    role: str | None = None
    context: str | None = None
    organizationId: str | None = None


class AssistMeetingRequest(BaseModel):
    query: str | None = None
    transcriptWindow: str | None = None
    mode: str = "auto"
    persona: str = "sales"
    liveAssist: bool = True
    contactId: str | None = None
    contactName: str | None = None
    companyName: str | None = None
    provider: str | None = None
    topic: str | None = None
    organizationId: str | None = None
    contextPack: dict[str, Any] | str | None = None
    sessionMemory: list[dict[str, Any]] | None = None
    timeZone: str | None = None


class WelcomeLeadRequest(BaseModel):
    contactId: str = Field(min_length=1)
    organizationId: str | None = None
    ownerUserId: str = Field(min_length=1)
    context: dict[str, Any] | None = None


class OwnerChangeNotifyRequest(BaseModel):
    contactId: str = Field(min_length=1)
    organizationId: str | None = None
    ownerUserId: str = Field(min_length=1)
    context: dict[str, Any] | None = None


class MeetingBriefEmailRequest(BaseModel):
    activityId: str = Field(min_length=1)
    contactId: str | None = None
    organizationId: str | None = None
    reminderWindow: str | None = None
    leadSummary: str | None = None
    audience: str = "owner"
    context: dict[str, Any] | None = None
    participantFirstName: str | None = None
    organizerName: str | None = None


class ComposeEmailRequest(BaseModel):
    instruction: str = Field(min_length=1)
    contactId: str | None = None
    contactName: str | None = None
    companyName: str | None = None
    # Sender tenant display name — never confuse with companyName (customer).
    senderOrganizationName: str | None = None
    subject: str | None = None
    currentBody: str | None = None
    inboundBody: str | None = None
    isReply: bool = False
    organizationId: str | None = None
    # Tenant sellable products — preferred grounding over sales-KB module docs.
    productCatalog: str | None = None


class MeetingMomRequest(BaseModel):
    transcript: str = Field(min_length=1)
    contactName: str | None = None
    topic: str | None = None
    companyName: str | None = None
    heuristic: dict[str, Any] | None = None
    organizationId: str | None = None
    activityId: str | None = None
    contactId: str | None = None
    whenLabel: str | None = None
    ownerName: str | None = None
    sellerName: str | None = None
    orgLogoUrl: str | None = None
    meetLink: str | None = None
    contactHref: str | None = None
    transcriptExcerpt: str | None = None


class SalesCoachRequest(BaseModel):
    transcript: str = Field(min_length=1)
    repName: str | None = None
    contactName: str | None = None
    companyName: str | None = None
    priorGrowthAreas: list[str] | None = None
    organizationId: str | None = None
    activityId: str | None = None
    contactId: str | None = None


class CompliancePrivacyRequest(BaseModel):
    subject: str = ""
    body: str = Field(min_length=1)
    contactName: str | None = None
    organizationId: str | None = None
    activityId: str | None = None
    contactId: str | None = None


class MeetingMissEscalationRequest(BaseModel):
    context: dict[str, Any] = Field(default_factory=dict)
    organizationId: str | None = None
    activityId: str | None = None


class PostMeetingProcessRequest(BaseModel):
    transcript: str = Field(min_length=1)
    seller: dict[str, Any] | None = None
    contactName: str | None = None
    heuristic: dict[str, Any] | None = None
    organizationId: str | None = None
    timeZone: str | None = None
    referenceNowIso: str | None = None
    activityId: str | None = None
    contactId: str | None = None


class DocumentTemplateRequest(BaseModel):
    kind: str = Field(default="proposal", pattern="^(proposal|quote|invoice)$")
    brief: str = ""
    sampleText: str = ""
    organizationName: str | None = None
    existingSections: list[dict[str, Any]] | None = None
    sampleFileBase64: str | None = None
    sampleFilename: str | None = None
    organizationId: str | None = None


class DocumentTemplateChatRequest(BaseModel):
    kind: str = Field(default="proposal", pattern="^(proposal|quote|invoice)$")
    message: str = ""
    currentStep: str = "idle"
    turnHint: str = ""
    createName: str = ""
    templateNames: list[str] | None = None
    hasSample: bool = False
    templateContext: dict[str, Any] | None = None
    organizationId: str | None = None


class ProposalContentRequest(BaseModel):
    sections: list[dict[str, Any]] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    vendorName: str | None = None
    organizationId: str | None = None


class DocumentClonePersonalizeRequest(BaseModel):
    kind: str = Field(default="proposal", pattern="^(proposal|quote|invoice)$")
    visibleTextPreview: str = ""
    pageIndex: int | None = None
    pageCount: int | None = None
    pageRole: str | None = None
    pageId: str | None = None
    textFragments: list[dict[str, Any]] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)
    alreadyApplied: list[str] | None = None
    sectionOutline: list[dict[str, Any]] = Field(default_factory=list)
    sectionBodies: list[dict[str, Any]] = Field(default_factory=list)
    contentFill: bool = False
    organizationId: str | None = None


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def readiness() -> JSONResponse:
    settings = get_settings()
    checks: dict[str, str] = {
        "llm": "ok" if settings.llm_base_url.strip() else "disabled",
        "mcp": "unavailable",
        "redis": "disabled",
    }
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{settings.mcp_base_url.rstrip('/')}/health")
        checks["mcp"] = "ok" if response.status_code < 500 else "unavailable"
    except Exception:  # noqa: BLE001
        checks["mcp"] = "unavailable"
    if settings.orchestrator_stm_enabled or settings.readiness_require_redis:
        checks["redis"] = "unavailable"
        try:
            from redis.asyncio import Redis

            redis = Redis.from_url(settings.orchestrator_redis_url)
            checks["redis"] = "ok" if await redis.ping() else "unavailable"
            await redis.aclose()
        except Exception:  # noqa: BLE001
            checks["redis"] = "unavailable"
    ready = checks["mcp"] == "ok" and checks["redis"] != "unavailable"
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


@router.get("/operations/metrics")
async def operational_metrics(
    _: None = Depends(require_internal_secret),
) -> dict[str, Any]:
    return {
        **metrics.snapshot(),
        "dependencies": {
            "llmCircuit": llm_circuit.state,
            "mcpCircuit": mcp_circuit.state,
        },
    }


@router.post("/ai/v1/agents/hello/run")
async def run_hello(
    body: HelloRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("hello")
    return await invoke_logged(
        "hello",
        lambda: agent(body.message),
        user_text=body.message,
    )


async def _run_contact_agent(name: str, body: ContactAgentRequest) -> dict[str, Any]:
    try:
        agent = get_agent(name)

        async def _go() -> dict[str, Any]:
            if name == "summarize-lead":
                return await agent(body.contactId, body.organizationId, body.force)
            return await agent(body.contactId, body.organizationId)

        return await invoke_logged(
            name,
            _go,
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/enrich-lead/run")
async def run_enrich_lead(
    body: ContactAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    return await _run_contact_agent("enrich-lead", body)


@router.post("/ai/v1/agents/score-lead/run")
async def run_score_lead(
    body: ContactAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    return await _run_contact_agent("score-lead", body)


@router.post("/ai/v1/agents/summarize-lead/run")
async def run_summarize_lead(
    body: ContactAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    return await _run_contact_agent("summarize-lead", body)


@router.post("/ai/v1/agents/nurture-lead/run")
async def run_nurture_lead(
    body: ContactAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    return await _run_contact_agent("nurture-lead", body)


@router.post("/ai/v1/agents/lifecycle-lead/run")
async def run_lifecycle_lead(
    body: ContactAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    return await _run_contact_agent("lifecycle-lead", body)


@router.post("/ai/v1/agents/hygiene/run")
async def run_hygiene(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("hygiene")
    return await invoke_logged("hygiene", lambda: agent(body or {}))


@router.post("/ai/v1/agents/daily-briefing/run")
async def run_daily_briefing(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("daily-briefing")
    return await invoke_logged("daily-briefing", lambda: agent(body or {}))


@router.post("/ai/v1/agents/sales-guide/run")
async def run_sales_guide(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("sales-guide")
    return await invoke_logged("sales-guide", lambda: agent(body or {}))


@router.post("/ai/v1/agents/identify-decision-makers/run")
async def run_identify_decision_makers(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("identify-decision-makers")
    return await invoke_logged(
        "identify-decision-makers",
        lambda: agent(body or {}),
    )


@router.post("/ai/v1/agents/assign-sales/run")
async def run_assign_sales(
    body: AssignSalesRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("assign-sales")
        return await invoke_logged(
            "assign-sales",
            lambda: agent(
                organization_id=body.organizationId,
                business_type=body.businessType,
                country=body.country,
                city=body.city,
                contact_id=body.contactId,
                company_id=body.companyId,
                location_id=body.locationId,
                estimated_amount=body.estimatedAmount,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/audit-forecast/run")
async def run_audit_forecast(
    body: DealAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("audit-forecast")
        return await invoke_logged(
            "audit-forecast",
            lambda: agent(body.dealId, body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/invoice-escalation/run")
async def run_invoice_escalation(
    body: InvoiceAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("invoice-escalation")
        return await invoke_logged(
            "invoice-escalation",
            lambda: agent(body.invoiceId, body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/company-collection-risk/run")
async def run_company_collection_risk(
    body: CollectionRiskRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("company-collection-risk")
        return await invoke_logged(
            "company-collection-risk",
            lambda: agent(body.companyId, body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/revenue-gap-forecast/run")
async def run_revenue_gap_forecast(
    body: RevenueGapForecastRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("revenue-gap-forecast")
        return await invoke_logged(
            "revenue-gap-forecast",
            lambda: agent(body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/invoice-dunning/run")
async def run_invoice_dunning(
    body: InvoiceDunningRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("invoice-dunning")
        return await invoke_logged(
            "invoice-dunning",
            lambda: agent(body.invoiceId, body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/expansion-matcher/run")
async def run_expansion_matcher(
    body: ExpansionMatcherRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("expansion-matcher")
        return await invoke_logged(
            "expansion-matcher",
            lambda: agent(body.companyId, body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/disposition/run")
async def run_disposition(
    body: DispositionRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("disposition")
        return await invoke_logged(
            "disposition",
            lambda: agent(
                body.channel,
                body.text,
                body.subject,
                body.direction,
                body.organizationId,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/analyze-transcript/run")
async def run_analyze_transcript(
    body: AnalyzeTranscriptRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("analyze-transcript")
        return await invoke_logged(
            "analyze-transcript",
            lambda: agent(body.transcript, body.organizationId),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/auto-reply-email/run")
async def run_auto_reply_email(
    body: AutoReplyEmailRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("auto-reply-email")
        return await invoke_logged(
            "auto-reply-email",
            lambda: agent(body.activityId, body.contactId, body.organizationId),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/chat/run")
async def run_chat(
    body: ChatRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("chat")
        return await invoke_logged(
            "chat",
            lambda: agent(
                body.system,
                body.user,
                body.maxTokens,
                body.timeoutMs,
                body.organizationId,
            ),
            user_text=body.user,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/crm-agent/run")
async def run_crm_agent(
    body: CrmAgentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        from app.agents.coworker_shared import last_user_text

        agent = get_agent("crm-agent")
        ctx = body.context or {}
        limit_key = f"{body.organizationId or 'unknown'}:crm-agent"
        if not _agent_rate.allow(limit_key):
            raise HTTPException(status_code=429, detail="Agent rate limit exceeded")

        async def execute() -> dict:
            return await invoke_logged(
                "crm-agent",
                lambda: agent(
                    intent=body.intent,
                    messages=body.messages,
                    context=body.context,
                    catalog=body.catalog,
                    sessionMemory=body.sessionMemory,
                    organizationId=body.organizationId,
                    role=body.role,
                    businessType=body.businessType,
                    actingUserId=body.actingUserId,
                    confirmTool=body.confirmTool,
                    mcpExecutionToken=body.mcpExecutionToken,
                    executionMode=body.executionMode,
                    conversationId=body.conversationId,
                    runId=body.runId,
                    traceId=body.traceId,
                    traceparent=body.traceparent,
                    idempotencyKey=body.idempotencyKey,
                ),
                intent=body.intent,
                module=str(ctx.get("module") or "") or None,
                surface=str(ctx.get("surface") or "") or None,
                user_text=last_user_text(body.messages),
                trace_id=body.traceId,
                turn_session_id=body.conversationId,
                turn_org_id=body.organizationId,
                turn_user_id=body.actingUserId,
                turn_request_id=body.runId or body.traceId,
            )

        return await _agent_concurrency.run(limit_key, execute)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=str(exc) or type(exc).__name__,
        ) from exc


@router.post("/ai/v1/agents/assist-meeting/run")
async def run_assist_meeting(
    body: AssistMeetingRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("assist-meeting")
        return await invoke_logged(
            "assist-meeting",
            lambda: agent(
                query=body.query,
                transcript_window=body.transcriptWindow,
                mode=body.mode,
                persona=body.persona,
                live_assist=body.liveAssist,
                contact_id=body.contactId,
                contact_name=body.contactName,
                company_name=body.companyName,
                provider=body.provider,
                topic=body.topic,
                organization_id=body.organizationId,
                context_pack=body.contextPack,
                session_memory=body.sessionMemory,
                time_zone=body.timeZone,
            ),
            user_text=body.query,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/assist-internal-meeting/run")
async def run_assist_internal_meeting(
    body: InternalMeetingAssistRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("assist-internal-meeting")
        return await invoke_logged(
            "assist-internal-meeting",
            lambda: agent(
                task=body.task,
                utterance=body.utterance,
                question=body.question,
                role=body.role,
                context=body.context,
                organization_id=body.organizationId,
            ),
            user_text=body.utterance,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/welcome-lead/run")
async def run_welcome_lead(
    body: WelcomeLeadRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("welcome-lead")
        return await invoke_logged(
            "welcome-lead",
            lambda: agent(
                body.contactId,
                body.organizationId,
                owner_user_id=body.ownerUserId,
                context=body.context,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/owner-change-notify/run")
async def run_owner_change_notify(
    body: OwnerChangeNotifyRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("owner-change-notify")
        return await invoke_logged(
            "owner-change-notify",
            lambda: agent(
                body.contactId,
                body.organizationId,
                owner_user_id=body.ownerUserId,
                context=body.context,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/meeting-brief-email/run")
async def run_meeting_brief_email(
    body: MeetingBriefEmailRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("meeting-brief-email")
        return await invoke_logged(
            "meeting-brief-email",
            lambda: agent(
                body.activityId,
                body.contactId,
                body.organizationId,
                reminder_window=body.reminderWindow,
                lead_summary=body.leadSummary,
                audience=body.audience or "owner",
                context=body.context,
                participant_first_name=body.participantFirstName,
                organizer_name=body.organizerName,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/meeting-mom/run")
async def run_meeting_mom(
    body: MeetingMomRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("meeting-mom")
        return await invoke_logged(
            "meeting-mom",
            lambda: agent(
                transcript=body.transcript,
                contactName=body.contactName,
                topic=body.topic,
                companyName=body.companyName,
                heuristic=body.heuristic,
                organization_id=body.organizationId,
                activityId=body.activityId,
                contactId=body.contactId,
                whenLabel=body.whenLabel,
                ownerName=body.ownerName,
                sellerName=body.sellerName,
                orgLogoUrl=body.orgLogoUrl,
                meetLink=body.meetLink,
                contactHref=body.contactHref,
                transcriptExcerpt=body.transcriptExcerpt,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/sales-coach/run")
async def run_sales_coach(
    body: SalesCoachRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("sales-coach")
        return await invoke_logged(
            "sales-coach",
            lambda: agent(
                transcript=body.transcript,
                repName=body.repName,
                contactName=body.contactName,
                companyName=body.companyName,
                priorGrowthAreas=body.priorGrowthAreas,
                organization_id=body.organizationId,
                activityId=body.activityId,
                contactId=body.contactId,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/compliance-privacy/run")
async def run_compliance_privacy(
    body: CompliancePrivacyRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("compliance-privacy")
        return await invoke_logged(
            "compliance-privacy",
            lambda: agent(
                subject=body.subject,
                body=body.body,
                contactName=body.contactName,
                organization_id=body.organizationId,
                activityId=body.activityId,
                contactId=body.contactId,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/meeting-miss-escalation/run")
async def run_meeting_miss_escalation(
    body: MeetingMissEscalationRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("meeting-miss-escalation")
        return await invoke_logged(
            "meeting-miss-escalation",
            lambda: agent(
                context=body.context,
                organization_id=body.organizationId,
                activity_id=body.activityId,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/post-meeting-process/run")
async def run_post_meeting_process(
    body: PostMeetingProcessRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("post-meeting-process")
        return await invoke_logged(
            "post-meeting-process",
            lambda: agent(
                transcript=body.transcript,
                seller=body.seller,
                contactName=body.contactName,
                heuristic=body.heuristic,
                organization_id=body.organizationId,
                timeZone=body.timeZone,
                referenceNowIso=body.referenceNowIso,
                activityId=body.activityId,
                contactId=body.contactId,
            ),
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/prospect-search/run")
async def run_prospect_search(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("prospect-search")
    return await invoke_logged("prospect-search", lambda: agent(body or {}))


@router.post("/ai/v1/agents/prospect-qualify/run")
async def run_prospect_qualify(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("prospect-qualify")
    return await invoke_logged("prospect-qualify", lambda: agent(body or {}))


@router.post("/ai/v1/agents/prospect-personnel/run")
async def run_prospect_personnel(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    from app.agents import get_agent

    agent = get_agent("prospect-personnel")
    return await invoke_logged("prospect-personnel", lambda: agent(body or {}))


@router.post("/ai/v1/agents/compose-email/run")
async def run_compose_email(
    body: ComposeEmailRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("compose-email")
        return await invoke_logged(
            "compose-email",
            lambda: agent(
                instruction=body.instruction,
                contact_id=body.contactId,
                contact_name=body.contactName,
                company_name=body.companyName,
                subject=body.subject,
                current_body=body.currentBody,
                inbound_body=body.inboundBody,
                is_reply=body.isReply,
                organization_id=body.organizationId,
                product_catalog=body.productCatalog,
                sender_organization_name=body.senderOrganizationName,
            ),
            user_text=body.instruction,
            contact_id=body.contactId,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/document-template/run")
async def run_document_template(
    body: DocumentTemplateRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("document-template")
        return await invoke_logged(
            "document-template",
            lambda: agent(
                kind=body.kind,
                brief=body.brief,
                sampleText=body.sampleText,
                organizationName=body.organizationName,
                existingSections=body.existingSections,
                sampleFileBase64=body.sampleFileBase64,
                sampleFilename=body.sampleFilename,
                organization_id=body.organizationId,
            ),
            intent=body.kind,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/document-template-chat/run")
async def run_document_template_chat(
    body: DocumentTemplateChatRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("document-template-chat")
        return await invoke_logged(
            "document-template-chat",
            lambda: agent(
                kind=body.kind,
                message=body.message,
                currentStep=body.currentStep,
                turnHint=body.turnHint,
                createName=body.createName,
                templateNames=body.templateNames,
                hasSample=body.hasSample,
                templateContext=body.templateContext,
                organization_id=body.organizationId,
            ),
            intent=body.kind,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/document-template-edit/run")
async def run_document_template_edit(
    body: DocumentTemplateChatRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("document-template-edit")
        ctx = body.templateContext or {}
        blueprint = ctx.get("blueprint") if isinstance(ctx.get("blueprint"), dict) else {}
        return await invoke_logged(
            "document-template-edit",
            lambda: agent(
                kind=body.kind,
                message=body.message,
                templateName=str(ctx.get("templateName") or body.createName or ""),
                blueprintMode=str(blueprint.get("mode") or ""),
                blueprintHtml=str(blueprint.get("html") or ""),
                sections=ctx.get("sections") if isinstance(ctx.get("sections"), list) else [],
                organization_id=body.organizationId,
            ),
            intent=body.kind,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/document-clone-personalize/run")
async def run_document_clone_personalize(
    body: DocumentClonePersonalizeRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("document-clone-personalize")
        return await invoke_logged(
            "document-clone-personalize",
            lambda: agent(
                kind=body.kind,
                visibleTextPreview=body.visibleTextPreview,
                pageIndex=body.pageIndex,
                pageCount=body.pageCount,
                pageRole=body.pageRole,
                pageId=body.pageId,
                textFragments=body.textFragments,
                context=body.context,
                alreadyApplied=body.alreadyApplied,
                sectionOutline=body.sectionOutline,
                sectionBodies=body.sectionBodies,
                contentFill=body.contentFill,
                organization_id=body.organizationId,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/proposal-content/run")
async def run_proposal_content(
    body: ProposalContentRequest,
    _: None = Depends(require_internal_secret),
) -> dict:
    try:
        agent = get_agent("proposal-content")
        return await invoke_logged(
            "proposal-content",
            lambda: agent(
                sections=body.sections,
                context=body.context,
                vendorName=body.vendorName or "",
                organization_id=body.organizationId,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/ai/v1/agents/proposal-corpus-ingest/run")
async def run_proposal_corpus_ingest(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-ingest")
    return await invoke_logged(
        "proposal-corpus-ingest", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-extract/run")
async def run_proposal_corpus_extract(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-extract")
    return await invoke_logged(
        "proposal-corpus-extract", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-playbook-freeze/run")
async def run_proposal_playbook_freeze(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-playbook-freeze")
    return await invoke_logged(
        "proposal-playbook-freeze", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-structure/run")
async def run_proposal_corpus_structure(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-structure")
    return await invoke_logged(
        "proposal-corpus-structure", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-design-geometry/run")
async def run_proposal_corpus_design_geometry(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-design-geometry")
    return await invoke_logged(
        "proposal-corpus-design-geometry", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-design-critique/run")
async def run_proposal_corpus_design_critique(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-design-critique")
    return await invoke_logged(
        "proposal-corpus-design-critique", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-section-deep/run")
async def run_proposal_corpus_section_deep(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-section-deep")
    return await invoke_logged(
        "proposal-corpus-section-deep", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-features/run")
async def run_proposal_corpus_features(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-features")
    return await invoke_logged(
        "proposal-corpus-features", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-pair/run")
async def run_proposal_corpus_pair(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-pair")
    return await invoke_logged(
        "proposal-corpus-pair", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-corpus-case-study/run")
async def run_proposal_corpus_case_study(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-corpus-case-study")
    return await invoke_logged(
        "proposal-corpus-case-study", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-playbook-synthesize/run")
async def run_proposal_playbook_synthesize(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-playbook-synthesize")
    return await invoke_logged(
        "proposal-playbook-synthesize", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-playbook-cluster/run")
async def run_proposal_playbook_cluster(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-playbook-cluster")
    return await invoke_logged(
        "proposal-playbook-cluster", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-playbook-qa/run")
async def run_proposal_playbook_qa(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-playbook-qa")
    return await invoke_logged(
        "proposal-playbook-qa", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-requirement-profile/run")
async def run_proposal_requirement_profile(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-requirement-profile")
    return await invoke_logged(
        "proposal-requirement-profile", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-playbook-match/run")
async def run_proposal_playbook_match(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-playbook-match")
    return await invoke_logged(
        "proposal-playbook-match", lambda: agent(body or {})
    )


@router.post("/ai/v1/agents/proposal-outline/run")
async def run_proposal_outline(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-outline")
    return await invoke_logged("proposal-outline", lambda: agent(body or {}))


@router.post("/ai/v1/agents/proposal-plan/run")
async def run_proposal_plan(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-plan")
    return await invoke_logged("proposal-plan", lambda: agent(body or {}))


@router.post("/ai/v1/agents/proposal-brief/run")
async def run_proposal_brief(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-brief")
    return await invoke_logged("proposal-brief", lambda: agent(body or {}))


@router.post("/ai/v1/agents/proposal-kb-retrieve/run")
async def run_proposal_kb_retrieve(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-kb-retrieve")
    return await invoke_logged("proposal-kb-retrieve", lambda: agent(body or {}))


@router.post("/ai/v1/agents/proposal-generate/run")
async def run_proposal_generate(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-generate")
    try:
        return await invoke_logged(
            "proposal-generate", lambda: agent(body or {})
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "sections": [],
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/proposal-fill-template/run")
async def run_proposal_fill_template(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-fill-template")
    try:
        return await invoke_logged(
            "proposal-fill-template", lambda: agent(body or {})
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "sections": [],
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/quote-brd-lines/run")
async def run_quote_brd_lines(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("quote-brd-lines")
    try:
        return await invoke_logged("quote-brd-lines", lambda: agent(body or {}))
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "columns": [],
            "rows": [],
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/invoice-sheet-fill/run")
async def run_invoice_sheet_fill(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("invoice-sheet-fill")
    try:
        return await invoke_logged("invoice-sheet-fill", lambda: agent(body or {}))
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "sheet": [],
            "lines": [],
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/quote-fill-template/run")
async def run_quote_fill_template(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("quote-fill-template")
    try:
        return await invoke_logged(
            "quote-fill-template", lambda: agent(body or {})
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "sections": [],
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/invoice-fill-template/run")
async def run_invoice_fill_template(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("invoice-fill-template")
    try:
        return await invoke_logged(
            "invoice-fill-template", lambda: agent(body or {})
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "sections": [],
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/proposal-generate-section/run")
async def run_proposal_generate_section(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-generate-section")
    try:
        return await invoke_logged(
            "proposal-generate-section", lambda: agent(body or {})
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": True,
            "status": "failed",
            "source": "heuristic",
            "reason": f"llm_error:{type(exc).__name__}",
            "section": {},
            "error": str(exc)[:400],
        }


@router.post("/ai/v1/agents/proposal-title/run")
async def run_proposal_title(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-title")
    return await invoke_logged("proposal-title", lambda: agent(body or {}))


@router.post("/ai/v1/agents/proposal-content-qa/run")
async def run_proposal_content_qa(
    body: dict,
    _: None = Depends(require_internal_secret),
) -> dict:
    agent = get_agent("proposal-content-qa")
    return await invoke_logged(
        "proposal-content-qa", lambda: agent(body or {})
    )