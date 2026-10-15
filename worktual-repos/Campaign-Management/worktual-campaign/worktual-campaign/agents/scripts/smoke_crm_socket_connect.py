#!/usr/bin/env python3
"""Verify Socket.IO accepts a CRM-style JWT (same as CRM embed iframe chat)."""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

import jwt
import socketio

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _crm_token() -> str:
    import os

    os.chdir(_ROOT)
    from app.config import get_settings

    settings = get_settings()
    secret = (settings.crm_jwt_access_secret or "").strip()
    if not secret:
        raise SystemExit("CRM_JWT_ACCESS_SECRET not set in agents/.env")
    issuer = (settings.crm_jwt_issuer or "").strip()
    payload: dict[str, str | int] = {
        "sub": "1027",
        "email": "smoke@worktual.test",
        "role": "user",
        "organizationId": "1000",
        "branchId": "1000",
        "iat": int(time.time()),
        "exp": int(time.time()) + 900,
    }
    if issuer:
        payload["iss"] = issuer
    return jwt.encode(
        payload,
        secret,
        algorithm=settings.crm_jwt_algorithm or "HS256",
    )


async def _run(fe_origin: str, socket_path: str, join: bool) -> int:
    import uuid

    token = _crm_token()
    sio = socketio.AsyncClient(reconnection=False, logger=False, engineio_logger=False)
    errors: list[str] = []
    ready = asyncio.Event()

    @sio.on("error")
    async def _on_error(data):
        errors.append(str((data or {}).get("message") or data))

    @sio.on("session_ready")
    async def _on_ready(_data):
        ready.set()

    path = socket_path.strip().lstrip("/") or "agents-socket"
    try:
        await sio.connect(
            fe_origin.rstrip("/"),
            socketio_path=path,
            transports=["polling", "websocket"],
            auth={"token": token},
            wait_timeout=20,
        )
    except socketio.exceptions.ConnectionError as exc:
        print(
            f"connect failed: {exc} "
            "(if HTTP health is OK, restart agents :8005 after CRM_JWT_* sync)",
            file=sys.stderr,
        )
        return 1

    if not sio.connected:
        print("connect failed: not connected", file=sys.stderr)
        return 1

    if join:
        session_id = f"smoke-crm-{uuid.uuid4().hex[:12]}"
        await sio.emit(
            "join_session",
            {
                "session_id": session_id,
                "token": token,
                "module": "create_campaign",
                "hub_mode": False,
                "skip_welcome": True,
                "campaign_profile": {
                    "mode": "b2c",
                    "industry": "generic-b2c",
                },
            },
        )
        try:
            await asyncio.wait_for(ready.wait(), timeout=25)
        except asyncio.TimeoutError:
            print("join_session: no session_ready within 25s", file=sys.stderr)
            await sio.disconnect()
            return 1

    await sio.disconnect()
    if errors:
        print(f"socket errors: {errors}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fe-origin",
        default="http://127.0.0.1:5173",
        help="Campaign SPA origin (Vite/nginx); uses /agents-socket proxy",
    )
    parser.add_argument(
        "--socket-path",
        default="/agents-socket",
        help="Socket.IO path (default: UI proxy)",
    )
    parser.add_argument(
        "--join",
        action="store_true",
        help="Emit join_session and wait for session_ready",
    )
    args = parser.parse_args()
    return asyncio.run(_run(args.fe_origin, args.socket_path, args.join))


if __name__ == "__main__":
    raise SystemExit(main())
