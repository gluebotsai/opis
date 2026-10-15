from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import (
    AssistAskOut,
    AssistAskRequest,
    AssistExecuteActionRequest,
    AssistMeetBootstrapOut,
    AssistMeetBootstrapRequest,
    AssistPasswordSessionRequest,
    AssistSessionOut,
    AssistSessionRequest,
    AssistSyncLiveRequest,
    TokenPrincipal,
)
from app.services import assist_session, crm_bot
from app.services.auth import bearer_token, get_principal
from app.services.google_id import resolve_assist_user
from app.services.lookup import inflight_by_url

router = APIRouter(prefix="/v1/assist", tags=["assist"])


@router.post("/session", response_model=AssistSessionOut)
def assist_session_create(body: AssistSessionRequest) -> AssistSessionOut:
    token = (body.google_id_token or "").strip()
    if not token:
        raise HTTPException(status_code=422, detail="google_id_token is required")
    return AssistSessionOut(**assist_session.create_session(token))


@router.post("/session/login", response_model=AssistSessionOut)
def assist_password_session(body: AssistPasswordSessionRequest) -> AssistSessionOut:
    email = (body.email or "").strip()
    password = body.password or ""
    if not email or not password:
        raise HTTPException(status_code=422, detail="Email and password are required.")
    return AssistSessionOut(**assist_session.create_password_session(email, password))


@router.post("/meet-bootstrap", response_model=AssistMeetBootstrapOut)
def assist_meet_bootstrap(
    body: AssistMeetBootstrapRequest,
    principal: TokenPrincipal = Depends(get_principal),
    authorization: str | None = Header(None),
) -> AssistMeetBootstrapOut:
    data = crm_bot.meet_bootstrap(
        {
            "meeting_url": body.meeting_url.strip(),
            "time_zone": (body.time_zone or "").strip(),
        },
        bearer_token(authorization),
    )
    return AssistMeetBootstrapOut(
        session_id=str(data.get("session_id") or ""),
        activity_id=str(data.get("activity_id") or ""),
        panel_token=str(data.get("panel_token") or ""),
        events_path=str(data.get("events_path") or ""),
        segments_synced=int(data.get("segments_synced") or 0),
        last_heard=data.get("last_heard") if isinstance(data.get("last_heard"), dict) else None,
        last_suggestions=(
            data.get("last_suggestions") if isinstance(data.get("last_suggestions"), dict) else None
        ),
        meeting_kind=str(data.get("meeting_kind") or "") or None,
        contact_id=str(data.get("contact_id") or "") or None,
        contact_name=str(data.get("contact_name") or "") or None,
        contact_card=data.get("contact_card") if isinstance(data.get("contact_card"), dict) else None,
        chat_history=data.get("chat_history") if isinstance(data.get("chat_history"), list) else [],
        customer_pool=data.get("customer_pool") if isinstance(data.get("customer_pool"), list) else [],
    )


@router.post("/execute-action")
def assist_execute_action(
    body: AssistExecuteActionRequest,
    principal: TokenPrincipal = Depends(get_principal),
    authorization: str | None = Header(None),
) -> dict:
    meeting_url = (body.meeting_url or "").strip()
    if not meeting_url:
        raise HTTPException(status_code=422, detail="meeting_url is required")
    if not isinstance(body.action, dict):
        raise HTTPException(status_code=422, detail="action is required")
    return crm_bot.execute_action(
        {
            "meeting_url": meeting_url,
            "time_zone": (body.time_zone or "").strip(),
            "action": body.action,
        },
        bearer_token(authorization),
    )


@router.post("/sync-live")
def assist_sync_live(
    body: AssistSyncLiveRequest,
    principal: TokenPrincipal = Depends(get_principal),
    authorization: str | None = Header(None),
) -> dict:
    return crm_bot.sync_live(
        {
            "meeting_url": (body.meeting_url or "").strip(),
            "activity_id": (body.activity_id or "").strip(),
            "time_zone": (body.time_zone or "").strip(),
        },
        bearer_token(authorization),
    )


@router.post("/ask", response_model=AssistAskOut)
def assist_ask(
    body: AssistAskRequest,
    db: Session = Depends(get_db),
    principal: TokenPrincipal = Depends(get_principal),
    authorization: str | None = Header(None),
) -> AssistAskOut:
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=422, detail="query is required")
    meeting = inflight_by_url(db, principal.organization_id, body.meeting_url)
    user = resolve_assist_user(principal, body.google_id_token)
    payload = {
        "meeting_id": meeting.id,
        "organization_id": meeting.org_id,
        "entity_type": meeting.entity_type,
        "entity_id": meeting.entity_id,
        "query": query,
        "intent": body.intent,
        "user": user,
        "time_zone": (body.time_zone or "").strip(),
    }
    data = crm_bot.ask(payload, bearer_token(authorization), db)
    suggestions = data.get("suggestions")
    next_questions = data.get("nextQuestions")
    return AssistAskOut(
        meeting_id=meeting.id,
        reply=str(data.get("reply") or ""),
        user=user,
        ok=data.get("ok") if isinstance(data.get("ok"), bool) else None,
        talkTrack=str(data.get("talkTrack") or "") or None,
        suggestions=suggestions if isinstance(suggestions, list) else [],
        nextQuestions=next_questions if isinstance(next_questions, list) else [],
        conversationContext=(
            data.get("conversationContext")
            if isinstance(data.get("conversationContext"), dict)
            else None
        ),
        nextBestAction=str(data.get("nextBestAction") or "") or None,
        sentimentCoachHint=str(data.get("sentimentCoachHint") or "") or None,
        sentiment=str(data.get("sentiment") or "") or None,
        query=str(data.get("query") or query) or None,
    )
