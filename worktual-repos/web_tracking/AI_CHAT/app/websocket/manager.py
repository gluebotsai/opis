"""WebSocket connection manager."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)


@dataclass
class ClientConnection:
    websocket: WebSocket
    session_id: str
    website_id: int
    email: str
    last_pong: float = 0.0


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, ClientConnection] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        *,
        client_id: str,
        session_id: str,
        website_id: int,
        email: str,
    ) -> ClientConnection:
        conn = ClientConnection(
            websocket=websocket,
            session_id=session_id,
            website_id=website_id,
            email=email,
        )
        async with self._lock:
            old = self._connections.get(client_id)
            if old is not None:
                try:
                    await old.websocket.close()
                except Exception:
                    pass
            self._connections[client_id] = conn
        logger.info("WS connected client=%s domain=%s", client_id, website_id)
        return conn

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            self._connections.pop(client_id, None)
        logger.info("WS disconnected client=%s", client_id)

    async def send_json(self, websocket: WebSocket, payload: dict) -> bool:
        if websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await websocket.send_json(payload)
            return True
        except RuntimeError:
            logger.debug("WebSocket closed before send completed")
            return False

    @property
    def active_count(self) -> int:
        return len(self._connections)


connection_manager = ConnectionManager()
