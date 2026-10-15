"""CRM-issued A2A access + refresh tokens.

Access JWT is a skill catalog snapshot (cannot be patched). Refresh is opaque
and stored on accounts.a2a_spoke_clients for Hub to read. On refresh, both
tokens are replaced.
"""

from __future__ import annotations

import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.a2a.catalog import list_spoke_skills, spoke_card_version
from app.a2a.clients import (
    ensure_seed_row,
    load_client,
    persist_tokens,
    secrets_equal,
    this_server_name,
)
from app.config import get_settings

TOKEN_TYPE = "access"
ACCESS_TTL_MAX = 21_600  # 6 hours
REFRESH_TTL_MAX = 5_184_000  # 60 days (~2 months)
SERVER_NAME_CLAIM = "a2a_server_name"


def current_skill_snapshot() -> tuple[str, list[str]]:
    skills = list_spoke_skills()
    version = spoke_card_version(skills)
    ids = [item.id for item in skills]
    return version, ids


def access_ttl_seconds() -> int:
    settings = get_settings()
    return max(60, min(ACCESS_TTL_MAX, int(settings.a2a_access_token_ttl_seconds or ACCESS_TTL_MAX)))


def refresh_ttl_seconds() -> int:
    settings = get_settings()
    return max(
        3600,
        min(REFRESH_TTL_MAX, int(settings.a2a_refresh_token_ttl_seconds or REFRESH_TTL_MAX)),
    )


def issue_access_token(
    *,
    subject: str,
    client_id: str,
    organization_id: str | None = None,
    server_name: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.a2a_hub_jwt_secret.strip()
    version, skill_ids = current_skill_snapshot()
    now = int(time.time())
    ttl = access_ttl_seconds()
    refresh_ttl = refresh_ttl_seconds()
    spoke = (server_name or this_server_name()).strip()
    refresh = secrets.token_urlsafe(48)
    payload: dict[str, Any] = {
        "iss": settings.a2a_access_token_issuer,
        "aud": settings.a2a_hub_jwt_audience,
        "sub": subject,
        "client_id": client_id,
        SERVER_NAME_CLAIM: spoke,
        "token_type": TOKEN_TYPE,
        "skillVersion": version,
        "skills": skill_ids,
        "iat": now,
        "exp": now + ttl,
        "jti": str(uuid.uuid4()),
    }
    if organization_id:
        payload["organizationId"] = organization_id
    body: dict[str, Any] = {
        "a2a_server_name": spoke,
        "access_token": "",
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": ttl,
        "refresh_expires_in": refresh_ttl,
        "skillVersion": version,
        "skills": skill_ids,
    }
    if not secret:
        body["claims"] = payload
        return body
    raw = jwt.encode(payload, secret, algorithm="HS256")
    body["access_token"] = raw if isinstance(raw, str) else raw.decode("utf-8")
    return body


def _oauth_error(status: int, error: str, description: str, **hub: Any) -> JSONResponse:
    from app.a2a.log import log_a2a

    log_a2a(
        step="token",
        ok=False,
        hub=hub or None,
        crm={"error": error, "message": description, "http": status},
    )
    return JSONResponse(
        status_code=status,
        content={"error": error, "error_description": description},
    )


async def _parse_token_body(request: Request) -> dict[str, Any]:
    ctype = (request.headers.get("content-type") or "").lower()
    if "application/x-www-form-urlencoded" in ctype:
        try:
            form = await request.form()
            return {str(key): str(value) for key, value in form.items()}
        except Exception:  # noqa: BLE001
            return {}
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return body if isinstance(body, dict) else {}


async def handle_token_request(request: Request) -> JSONResponse:
    await ensure_seed_row()
    body = await _parse_token_body(request)
    grant = str(body.get("grant_type") or "").strip()
    client_id = str(body.get("client_id") or "").strip()
    client_secret = str(body.get("client_secret") or "").strip()
    requested_server = str(body.get("a2a_server_name") or this_server_name()).strip()
    spoke = this_server_name()

    if requested_server != spoke:
        return _oauth_error(
            400,
            "invalid_request",
            f"a2a_server_name must be {spoke}",
            grant_type=grant,
            client_id=client_id,
            a2a_server_name=requested_server,
        )
    if grant not in {"client_credentials", "refresh_token"}:
        return _oauth_error(
            400,
            "unsupported_grant_type",
            "Use client_credentials or refresh_token",
            grant_type=grant,
            client_id=client_id,
        )
    if not client_id or not client_secret:
        return _oauth_error(
            401,
            "invalid_client",
            "client_id and client_secret are required",
            grant_type=grant,
            client_id=client_id,
        )

    record = await load_client(client_id=client_id, server_name=spoke)
    if record is None or record.a2a_server_name != spoke:
        return _oauth_error(
            401,
            "invalid_client",
            "Unknown client_id for this spoke",
            grant_type=grant,
            client_id=client_id,
        )
    if not secrets_equal(record.client_secret, client_secret):
        return _oauth_error(
            401,
            "invalid_client",
            "Invalid client_secret",
            grant_type=grant,
            client_id=client_id,
        )

    if grant == "refresh_token":
        presented = str(body.get("refresh_token") or "").strip()
        if not presented or not record.refresh_token:
            return _oauth_error(
                401,
                "invalid_grant",
                "refresh_token is required",
                grant_type=grant,
                client_id=client_id,
            )
        if not secrets_equal(record.refresh_token, presented):
            return _oauth_error(
                401,
                "invalid_grant",
                "Invalid refresh_token",
                grant_type=grant,
                client_id=client_id,
            )
        expires = record.refresh_expires_at
        if expires is not None:
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires <= datetime.now(timezone.utc):
                return _oauth_error(
                    401,
                    "invalid_grant",
                    "refresh_token expired",
                    grant_type=grant,
                    client_id=client_id,
                )

    issued = issue_access_token(subject=client_id, client_id=client_id, server_name=spoke)
    now = datetime.now(timezone.utc)
    await persist_tokens(
        client_id=client_id,
        server_name=spoke,
        access_token=str(issued["access_token"]),
        access_expires_at=now + timedelta(seconds=int(issued["expires_in"])),
        refresh_token=str(issued["refresh_token"]),
        refresh_expires_at=now + timedelta(seconds=int(issued["refresh_expires_in"])),
        skill_version=str(issued["skillVersion"]),
        client_secret=record.client_secret,
    )
    from app.a2a.log import log_a2a

    log_a2a(
        step="token",
        ok=True,
        hub={
            "grant_type": grant,
            "client_id": client_id,
            "a2a_server_name": spoke,
        },
        crm={
            "expires_in": issued["expires_in"],
            "refresh_expires_in": issued["refresh_expires_in"],
            "skillVersion": issued["skillVersion"],
            "rotated": grant == "refresh_token",
            "stored": "accounts.a2a_spoke_clients",
        },
    )
    return JSONResponse(content=issued)
