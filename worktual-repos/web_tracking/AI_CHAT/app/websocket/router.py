"""WebSocket chat router — thin transport layer."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.mas.messages import empty_message, service_unavailable
from app.mas.turn import agent
from app.auth import AuthError, decode_ws_token
from app.memory.store import memory_store
from app.websocket.manager import connection_manager

logger = logging.getLogger(__name__)
router = APIRouter()


def _chat_history(session_id: str) -> list[dict[str, str]]:
    turns = memory_store.get(session_id).turns
    return [{"role": t.role, "text": t.content} for t in turns[-20:]]


async def _reply(websocket: WebSocket, *, answer: str, payload: dict) -> None:
    await connection_manager.send_json(websocket, {
        "type": "answer",
        "message": answer,
        "payload": payload,
    })


@router.websocket("/ws/chat")
async def chat_ws(
    websocket: WebSocket,
    token: str = Query(default=""),
    session_id: str | None = Query(default=None),
) -> None:
    await websocket.accept()

    if not token:
        logger.warning("WS rejected: missing token")
        await websocket.close(code=4401, reason="Missing token")
        return

    try:
        user = decode_ws_token(token)
    except AuthError as exc:
        logger.warning("WS rejected: %s", exc)
        await websocket.close(code=4401, reason=str(exc))
        return

    client_id = str(uuid.uuid4())
    chat_session = session_id or str(uuid.uuid4())
    conn = await connection_manager.connect(
        websocket,
        client_id=client_id,
        session_id=chat_session,
        website_id=user["website_id"],
        email=user["email"],
    )

    await connection_manager.send_json(websocket, {
        "type": "connected",
        "payload": {
            "session_id": chat_session,
            "history": _chat_history(conn.session_id),
        },
    })

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")

            if msg_type == "ping":
                await connection_manager.send_json(websocket, {"type": "pong"})
                continue

            if msg_type == "reset_session":
                memory_store.clear(conn.session_id)
                await connection_manager.send_json(websocket, {
                    "type": "session_reset",
                    "payload": {"session_id": conn.session_id},
                })
                continue

            if msg_type != "message":
                continue

            message = (data.get("message") or "").strip()
            if not message:
                await connection_manager.send_json(websocket, {
                    "type": "error",
                    "message": empty_message(),
                })
                continue

            if not await connection_manager.send_json(websocket, {"type": "thinking"}):
                break

            try:
                response = await agent.run(
                    message=message,
                    website_id=conn.website_id,
                    session_id=conn.session_id,
                    dashboard_period=data.get("dashboard_period"),
                    organization_id=user.get("organization_id"),
                    user_id=user.get("admin_id"),
                )
                payload = response.model_dump()
                if not await _reply(websocket, answer=response.answer, payload=payload):
                    break
            except WebSocketDisconnect:
                break
            except Exception:
                logger.exception("Agent error for client=%s", client_id)
                if not await connection_manager.send_json(websocket, {
                    "type": "error",
                    "message": service_unavailable(),
                }):
                    break

    except WebSocketDisconnect:
        pass
    finally:
        await connection_manager.disconnect(client_id)
