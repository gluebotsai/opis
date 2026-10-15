"""
FastAPI entrypoint for the Worktual LangGraph co-worker (AI tasks only).

Product CRUD stays on Express (`ui-backend`). This service owns chat routing,
UI actions, triage-assign, phrase, and related LLM tasks.

Run:
  uvicorn app.main:app --app-dir ai-agents --host 127.0.0.1 --port 8012
"""

import re

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import get_settings
from app.graph import run_chat
from app.agent_turn import run_agent_turn
from app.api.routes import router as native_ai_router
from app.tasks.pipeline import run_triage_assign
from app.tasks.schemas import TriageAssignRequest, TriageAssignResponse


def require_tasks_secret(
    x_coworker_tasks_key: str | None = Header(
        default=None, alias="X-Coworker-Tasks-Key"
    ),
) -> None:
    expected = (get_settings().coworker_tasks_secret or "").strip()
    if not expected:
        # Local/dev only — production Express refuses to start without a real secret.
        import os

        if os.environ.get("NODE_ENV") == "production":
            raise HTTPException(
                status_code=503,
                detail="COWORKER_TASKS_SECRET is not configured on agents service",
            )
        expected = "worktual-tasks-dev-secret"
    if not x_coworker_tasks_key or x_coworker_tasks_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing tasks API key")


_settings = get_settings()
_cors = [
    o.strip()
    for o in (_settings.cors_origins or "").split(",")
    if o.strip()
]


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    from app.proactive.runtime import start_worker

    start_worker()
    yield


app = FastAPI(
    title="Worktual Co-worker Agents",
    description="Native multi-agent chat router for ticketing modules (no LangGraph)",
    version="2.0.0",
    lifespan=_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors or [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "https://rebuild-ticketing.worktual.com",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(native_ai_router)


class HistoryItem(BaseModel):
    role: str
    text: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User message")
    page: str | None = Field(None, description="Optional UI page label for context")
    organization_id: str | None = Field(
        None, description="Tenant UUID for live DB queries"
    )
    session_id: str | None = Field(
        None, description="Stable chat session id (required for multi-module continuity)"
    )
    user_id: str | None = Field(None, description="Authenticated user id")
    user_name: str | None = Field(None, description="Authenticated display name")
    user_role: str | None = Field(None, description="admin|agent|resolver|customer|viewer")
    role: str | None = Field(
        None, description="Alias for user_role (some clients send role)"
    )
    can_create_ticket: bool | None = Field(
        None, description="Whether this role may start guided create-ticket"
    )
    history: list[HistoryItem] | None = Field(
        None, description="Client conversation history for session seeding"
    )
    ticket_draft: dict | None = Field(
        None, description="In-progress create-ticket draft from the UI"
    )
    next_step: str | None = Field(
        None, description="Backend-chosen next prompt (UI owns workflow)"
    )
    request_id: str | None = Field(
        None, description="Correlation id from Express gateway"
    )
    surface: str | None = Field(None, description="staff | portal")
    portal_authenticated: bool | None = None
    portal_auth_mode: str | None = None
    focused_entity: dict | None = Field(
        None,
        description="Currently open UI item {type, id, name} for shared last_entity",
    )
    portal_customer_id: str | None = None
    module: str | None = Field(
        None, description="UI module: tickets | teams | kb | customers | macros | admin | portal"
    )
    page_surface: str | None = Field(
        None, description="UI surface: list | create | detail (not staff|portal)"
    )
    draft: dict | None = Field(
        None, description="Generic in-progress form draft (alias of ticket_draft)"
    )
    session_memory: dict | None = None
    confirm_tool: dict | None = None
    kind: str | None = Field(None, description="greeting | turn")


class ChatResponse(BaseModel):
    reply: str
    agent: str
    session_id: str | None = None
    ui_actions: list[dict] = Field(default_factory=list)
    request_id: str | None = None
    schema_version: str = "1.0"
    data: dict = Field(default_factory=dict)


class AgentTurnResponse(BaseModel):
    assistantText: str = ""
    toolProposals: list[dict] = Field(default_factory=list)
    patch: dict | None = None
    sessionMemoryPatch: dict | None = None
    uiRefresh: dict | None = None
    reply: str = ""
    agent: str = "general"
    session_id: str | None = None
    ui_actions: list[dict] = Field(default_factory=list)
    request_id: str | None = None
    schema_version: str = "1.0"
    data: dict = Field(default_factory=dict)


class FocusRequest(BaseModel):
    organization_id: str
    session_id: str
    user_id: str | None = None
    user_name: str | None = None
    user_role: str | None = None
    focused_entity: dict | None = None
    request_id: str | None = None


class FocusResponse(BaseModel):
    ok: bool = True
    last_entity: dict | None = None


class PhraseRequest(BaseModel):
    module: str = Field(
        "ticket",
        description="ticket | team | greeting | nav | macro | kb | priority",
    )
    kind: str = Field("start")
    fallback: str = Field(..., min_length=1)
    user_text: str | None = None
    page_label: str | None = None
    context: dict | None = None
    validation_hint: str | None = None
    ticket_draft: dict | None = None


class PhraseResponse(BaseModel):
    reply: str


class UiActionsRequest(BaseModel):
    message: str = Field(..., min_length=1)
    page: str | None = None


class UiActionsResponse(BaseModel):
    reply_hint: str = ""
    actions: list[dict] = Field(default_factory=list)


class TicketReasonRequest(BaseModel):
    user_text: str = Field(..., min_length=1)
    step_id: str = Field(..., min_length=1)
    customer_name: str | None = None
    customer_email: str | None = None
    customer_phone: str | None = None
    issue: str | None = None
    subject: str | None = None
    fallback_reply: str = "Let's continue."


@app.get("/health")
def health():
    settings = get_settings()
    return {
        "status": "ok",
        "model": settings.model_name,
        "base_url": settings.model_url,
        "tasks": ["triage-assign", "phrase", "ticket-reason", "insights", "ui-actions"],
    }


@app.post(
    "/tasks/triage-assign",
    response_model=TriageAssignResponse,
    dependencies=[Depends(require_tasks_secret)],
)
def triage_assign(body: TriageAssignRequest):
    """
    Flows 2–4: categorize issue, pick team/queue, assign agent by skill + workload.
    Response shape matches Express /api/tickets/enrich for the existing create UI.
    """
    try:
        return run_triage_assign(body)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail=f"Triage-assign failed: {exc}"
        ) from exc


@app.post(
    "/chat",
    response_model=ChatResponse,
    dependencies=[Depends(require_tasks_secret)],
)
def chat(body: ChatRequest):
    """Route the message through the native supervisor/specialist runner."""
    from app.llm_log import log_llm

    if not (body.organization_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="organization_id is required",
        )

    msg = body.message.strip()
    effective_role = (body.user_role or body.role or "").strip().lower()
    can_create = body.can_create_ticket
    # Resolvers/viewers never create tickets, even if a client omits or mis-sets the flag.
    if effective_role in ("resolver", "viewer"):
        can_create = False
    elif can_create is None and effective_role:
        can_create = effective_role in (
            "admin",
            "agent",
            "customer",
            "portal_customer",
        )

    try:
        from app.agent_turn import resolve_client_form_drafts

        resolved = resolve_client_form_drafts(
            module=body.module,
            page=body.page,
            page_surface=body.page_surface,
            session_memory=body.session_memory
            if isinstance(body.session_memory, dict)
            else None,
            ticket_draft=body.ticket_draft,
            draft=body.draft,
        )
        result = run_chat(
            msg,
            page=body.page,
            organization_id=body.organization_id,
            session_id=body.session_id,
            history=[h.model_dump() for h in body.history] if body.history else None,
            user_id=body.user_id,
            user_name=body.user_name,
            user_role=effective_role or None,
            can_create_ticket=can_create,
            ticket_draft=resolved.get("ticket_draft"),
            customer_draft=resolved.get("customer_draft"),
            kb_draft=resolved.get("kb_draft"),
            macro_draft=resolved.get("macro_draft"),
            team_draft=resolved.get("team_draft"),
            priority_draft=resolved.get("priority_draft"),
            next_step=body.next_step,
            request_id=body.request_id,
            surface=body.surface,
            portal_customer_id=body.portal_customer_id,
            portal_auth_mode=body.portal_auth_mode,
            focused_entity=body.focused_entity,
            chat_module=body.module,
            chat_surface=body.page_surface,
            session_memory=body.session_memory
            if isinstance(body.session_memory, dict)
            else None,
        )
        return ChatResponse(
            reply=result["reply"],
            agent=result["agent"],
            session_id=result.get("session_id"),
            ui_actions=list(result.get("actions") or []),
            request_id=result.get("request_id") or body.request_id,
            data=dict(result.get("data") or {}),
        )
    except PermissionError as exc:
        log_llm(
            kind="chat_error",
            user_text=body.message,
            response="",
            page=body.page,
            session_id=body.session_id,
            organization_id=body.organization_id,
            user_id=body.user_id,
            error=str(exc),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="chat_error",
            user_text=body.message,
            response="",
            page=body.page,
            session_id=body.session_id,
            organization_id=body.organization_id,
            user_id=body.user_id,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail=f"Agent error: {exc}") from exc


@app.post(
    "/agent-turn",
    response_model=AgentTurnResponse,
    dependencies=[Depends(require_tasks_secret)],
)
def agent_turn(body: ChatRequest):
    """CRM envelope around the same native turn as /chat. Does not replace /chat."""
    from app.llm_log import log_llm

    if not (body.organization_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="organization_id is required",
        )

    msg = (body.message or "").strip() or (
        "hello" if str(body.kind or "").strip().lower() == "greeting" else ""
    )
    if not msg and body.confirm_tool:
        msg = "confirm"
    if not msg:
        raise HTTPException(status_code=400, detail="message is required")

    effective_role = (body.user_role or body.role or "").strip().lower()
    can_create = body.can_create_ticket
    if effective_role in ("resolver", "viewer"):
        can_create = False
    elif can_create is None and effective_role:
        can_create = effective_role in (
            "admin",
            "agent",
            "customer",
            "portal_customer",
        )

    try:
        result = run_agent_turn(
            msg,
            page=body.page,
            organization_id=body.organization_id,
            session_id=body.session_id,
            history=[h.model_dump() for h in body.history] if body.history else None,
            user_id=body.user_id,
            user_name=body.user_name,
            user_role=effective_role or None,
            can_create_ticket=can_create,
            ticket_draft=body.ticket_draft,
            draft=body.draft,
            next_step=body.next_step,
            request_id=body.request_id,
            surface=body.surface,
            portal_customer_id=body.portal_customer_id,
            portal_auth_mode=body.portal_auth_mode,
            focused_entity=body.focused_entity,
            module=body.module,
            page_surface=body.page_surface,
            session_memory=body.session_memory,
            confirm_tool=body.confirm_tool,
            kind=body.kind,
        )
        return AgentTurnResponse(
            assistantText=str(result.get("assistantText") or result.get("reply") or ""),
            toolProposals=list(result.get("toolProposals") or []),
            patch=result.get("patch"),
            sessionMemoryPatch=result.get("sessionMemoryPatch"),
            uiRefresh=result.get("uiRefresh"),
            reply=str(result.get("reply") or ""),
            agent=str(result.get("agent") or "general"),
            session_id=result.get("session_id"),
            ui_actions=list(result.get("ui_actions") or result.get("actions") or []),
            request_id=result.get("request_id") or body.request_id,
            data=dict(result.get("data") or {}),
        )
    except PermissionError as exc:
        log_llm(
            kind="agent_turn_error",
            user_text=body.message,
            response="",
            page=body.page,
            session_id=body.session_id,
            organization_id=body.organization_id,
            user_id=body.user_id,
            error=str(exc),
        )
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="agent_turn_error",
            user_text=body.message,
            response="",
            page=body.page,
            session_id=body.session_id,
            organization_id=body.organization_id,
            user_id=body.user_id,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail=f"Agent error: {exc}") from exc


@app.post(
    "/focus",
    response_model=FocusResponse,
    dependencies=[Depends(require_tasks_secret)],
)
def focus_entity(body: FocusRequest):
    """Fetch the open UI item from APIs and store it as last_entity."""
    from app.graph import persist_ui_focused_entity

    if not (body.organization_id or "").strip() or not (body.session_id or "").strip():
        raise HTTPException(
            status_code=400,
            detail="organization_id and session_id are required",
        )
    if not isinstance(body.focused_entity, dict):
        return FocusResponse(ok=True, last_entity=None)
    try:
        ctx = persist_ui_focused_entity(
            organization_id=body.organization_id,
            session_id=body.session_id,
            user_id=body.user_id,
            user_name=body.user_name,
            user_role=body.user_role,
            focused_entity=body.focused_entity,
            request_id=body.request_id,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Focus error: {exc}") from exc
    last = ctx.get("last_entity") if isinstance(ctx, dict) else None
    return FocusResponse(ok=True, last_entity=last if isinstance(last, dict) else None)


@app.post(
    "/phrase",
    response_model=PhraseResponse,
    dependencies=[Depends(require_tasks_secret)],
)
def phrase(body: PhraseRequest):
    """Natural-language phrasing for guided flows; caller owns nextStep."""
    from app.tasks.phrase import phrase_reply

    module = (
        body.module
        if body.module in ("ticket", "team", "greeting", "nav", "macro", "kb", "priority")
        else "ticket"
    )
    try:
        reply = phrase_reply(
            module=module,
            kind=body.kind or "start",
            fallback=body.fallback,
            user_text=body.user_text,
            page_label=body.page_label,
            context=body.context,
            validation_hint=body.validation_hint,
            ticket_draft=body.ticket_draft,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Phrase LLM error: {exc}") from exc
    return PhraseResponse(reply=reply)


@app.post(
    "/ui-actions",
    response_model=UiActionsResponse,
    dependencies=[Depends(require_tasks_secret)],
)
def ui_actions(body: UiActionsRequest):
    """Structured navigate/filter actions for the web UI to apply."""
    from app.tasks.ui_actions import resolve_ui_actions

    try:
        result = resolve_ui_actions(body.message.strip(), page=body.page)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"UI actions error: {exc}") from exc
    return UiActionsResponse(
        reply_hint=str(result.get("reply_hint") or ""),
        actions=list(result.get("actions") or []),
    )


@app.post("/ticket-reason", dependencies=[Depends(require_tasks_secret)])
def ticket_reason(body: TicketReasonRequest):
    """Classify a guided create-ticket turn and return intent + reply JSON."""
    from app.tasks.ticket_reason import ticket_reason_turn

    result = ticket_reason_turn(
        user_text=body.user_text.strip(),
        step_id=body.step_id.strip(),
        customer_name=body.customer_name,
        customer_email=body.customer_email,
        customer_phone=body.customer_phone,
        issue=body.issue,
        subject=body.subject,
        fallback_reply=body.fallback_reply,
    )
    if not result:
        raise HTTPException(status_code=502, detail="reason_unavailable")
    return result


class InsightsTicket(BaseModel):
    ticket_number: str | None = None
    subject: str | None = None
    priority: str | None = None
    status: str | None = None
    customer_name: str | None = None
    channel: str | None = None


class InsightsRequest(BaseModel):
    tickets: list[InsightsTicket] = Field(default_factory=list)


@app.post("/insights", dependencies=[Depends(require_tasks_secret)])
def insights(body: InsightsRequest):
    """LLM ticket insights for analytics — same model stack as chat."""
    from app.tasks.insights import ticket_insights

    rows = [t.model_dump() for t in body.tickets]
    return ticket_insights(rows)


class ProactiveEvent(BaseModel):
    id: str | None = None
    event_id: str | None = None
    event_type: str
    organization_id: str
    ticket_id: str | None = None
    ticket_number: str | None = None
    actor: str | None = None
    payload: dict = Field(default_factory=dict)


class ProactiveApprovalAction(BaseModel):
    organization_id: str
    approval_id: str
    accept: bool = True
    actor_id: str | None = None
    actor_role: str | None = None
    actor_name: str | None = None
    # Optional overrides applied before tool execution (e.g. CRDA edited draft).
    tool_args: dict | None = None
    edited_text: str | None = None


@app.post("/proactive/event", dependencies=[Depends(require_tasks_secret)])
def proactive_event(body: ProactiveEvent):
    from app.proactive.runtime import dispatch_event

    data = body.model_dump()
    if not data.get("id"):
        data["id"] = data.get("event_id")
    return {"ok": True, "results": dispatch_event(data)}


@app.get("/proactive/approvals", dependencies=[Depends(require_tasks_secret)])
def proactive_approvals(organization_id: str):
    from app.proactive.runtime import list_org_approvals

    return {"items": list_org_approvals(organization_id)}


@app.get("/proactive/recommendations", dependencies=[Depends(require_tasks_secret)])
def proactive_recommendations(organization_id: str, ticket_number: str | None = None):
    from app.proactive.runtime import list_org_recommendations

    return {"items": list_org_recommendations(organization_id, ticket_number)}


@app.post("/proactive/approvals/decide", dependencies=[Depends(require_tasks_secret)])
def proactive_approve(body: ProactiveApprovalAction):
    from app.proactive.runtime import confirm_approval

    return confirm_approval(
        body.organization_id,
        body.approval_id,
        accept=body.accept,
        actor_id=body.actor_id,
        actor_role=body.actor_role,
        actor_name=body.actor_name,
        tool_args_override=body.tool_args,
        edited_text=body.edited_text,
    )
