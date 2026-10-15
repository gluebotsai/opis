"""HTTP chat routes — reliable co-worker transport (no WebSocket required)."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.mas.messages import service_unavailable
from app.mas.turn import agent
from app.auth import AuthError, decode_ws_token
from app.memory.store import memory_store
from app.models.schemas import AgentResponse, ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatResetRequest(BaseModel):
    session_id: str | None = None


def _user_from_auth(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        return decode_ws_token(authorization[7:])
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.post("/message", response_model=AgentResponse)
async def chat_message(
    body: ChatRequest,
    authorization: str | None = Header(default=None),
) -> AgentResponse:
    user = _user_from_auth(authorization)
    session_id = (body.session_id or "").strip() or str(uuid.uuid4())
    try:
        return await agent.run(
            message=body.message.strip(),
            website_id=user["website_id"],
            session_id=session_id,
            dashboard_period=body.dashboard_period,
            organization_id=user.get("organization_id"),
            user_id=user.get("admin_id"),
        )
    except Exception:
        logger.exception("HTTP chat failed")
        return AgentResponse(answer=service_unavailable())


@router.post("/reset")
async def chat_reset(
    body: ChatResetRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    user = _user_from_auth(authorization)
    session_id = (body.session_id or "").strip()
    if session_id:
        memory_store.clear(session_id)
    org = user.get("organization_id")
    uid = user.get("admin_id")
    if org is not None and uid is not None:
        from app.services.context_layer import context_layer

        context_layer.invalidate(int(org), int(uid))
    return {"status": "ok"}
