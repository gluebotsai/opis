#!/usr/bin/env python3
"""Send one 'hi' via Socket.IO (same path as UI) for TURN blocks in agents log."""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import jwt
import socketio

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

# Default: agents directly (daemon). Use CAMPAIGN_FE_ORIGIN + /agents-socket for Vite proxy.
FE_ORIGIN = os.environ.get("CAMPAIGN_SOCKET_URL", "http://127.0.0.1:8005").rstrip("/")
SOCKET_PATH = os.environ.get("CAMPAIGN_SOCKET_PATH", "/socket-io")


def _token(user_id: str = "1027") -> str:
    from app.config import get_settings

    return jwt.encode(
        {"sub": user_id},
        get_settings().jwt_secret,
        algorithm="HS256",
    )


async def main() -> int:
    token = _token()
    session_id = f"smoke-trace-{uuid.uuid4().hex[:12]}"
    done = asyncio.Event()
    reply: list[str] = []
    errors: list[str] = []

    sio = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)

    @sio.on("agent_message")
    async def _on_agent_message(data):
        if isinstance(data, dict):
            text = str(data.get("text") or "").strip()
            if text:
                reply.append(text[:200])
        done.set()

    @sio.on("error")
    async def _on_error(data):
        errors.append(str((data or {}).get("message") or data))
        done.set()

    await sio.connect(
        FE_ORIGIN,
        socketio_path=SOCKET_PATH,
        transports=["polling", "websocket"],
        auth={"token": token},
        wait_timeout=30,
    )
    await sio.emit(
        "join_session",
        {
            "session_id": session_id,
            "token": token,
            "module": "create_campaign",
            "skip_welcome": True,
        },
    )
    await asyncio.sleep(1.5)
    await sio.emit(
        "user_message",
        {
            "session_id": session_id,
            "token": token,
            "module": "create_campaign",
            "text": "hi",
        },
    )
    try:
        await asyncio.wait_for(done.wait(), timeout=120.0)
    except asyncio.TimeoutError:
        errors.append("timeout waiting for agent_message")
    await sio.disconnect()

    print(f"session_id={session_id}")
    if errors:
        print("errors:", "; ".join(errors))
        return 1
    print("reply_preview:", reply[0] if reply else "(empty)")
    print("grep log: grep -F", session_id, "agents/tmp/_agents_restart.log | grep TURN")
    return 0 if reply else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
