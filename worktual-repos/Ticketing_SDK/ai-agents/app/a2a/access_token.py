"""Mint and verify Hub access JWTs for Ticketing A2A spoke."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import uuid
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from typing import Any

from app.a2a.catalog import hub_skills, skill_version
from app.config import get_settings


def _b64url(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_json(obj: dict[str, Any]) -> str:
    return _b64url(json.dumps(obj, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def jwt_secret() -> str:
    settings = get_settings()
    secret = (settings.a2a_hub_jwt_secret or "").strip()
    if secret:
        return secret
    # Dev fallback — never use in production
    return (settings.coworker_tasks_secret or "").strip() or "ticketing-a2a-dev-secret"


def mint_access_token(*, client_id: str, a2a_server_name: str) -> tuple[str, datetime]:
    settings = get_settings()
    skills = hub_skills()
    ver = skill_version(skills)
    now = int(time.time())
    ttl = max(60, int(settings.a2a_access_token_ttl_seconds or 21600))
    payload = {
        "iss": (settings.a2a_access_token_issuer or "worktual-ticketing-a2a-access").strip(),
        "aud": (settings.a2a_hub_jwt_audience or "worktual-ticketing-a2a").strip(),
        "iat": now,
        "exp": now + ttl,
        "sub": client_id,
        "client_id": client_id,
        "a2a_server_name": a2a_server_name,
        "skillVersion": ver,
        "skills": [s["id"] for s in skills],
    }
    header = {"alg": "HS256", "typ": "JWT"}
    body = f"{_b64url_json(header)}.{_b64url_json(payload)}"
    sig = hmac.new(jwt_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    token = f"{body}.{_b64url(sig)}"
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl)
    return token, expires_at


def mint_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def verify_access_token(token: str) -> dict[str, Any]:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError as exc:
        raise ValueError("malformed_token") from exc
    body = f"{header_b64}.{payload_b64}"
    expected = hmac.new(
        jwt_secret().encode("utf-8"), body.encode("ascii"), hashlib.sha256
    ).digest()
    got = urlsafe_b64decode(sig_b64 + "=" * (-len(sig_b64) % 4))
    if not hmac.compare_digest(expected, got):
        raise ValueError("invalid_signature")
    payload_raw = urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4))
    payload = json.loads(payload_raw.decode("utf-8"))
    if int(payload.get("exp") or 0) < int(time.time()):
        raise ValueError("token_expired")
    settings = get_settings()
    aud = (settings.a2a_hub_jwt_audience or "worktual-ticketing-a2a").strip()
    if payload.get("aud") not in (None, aud):
        raise ValueError("audience_mismatch")
    live_ver = skill_version()
    if str(payload.get("skillVersion") or "") != live_ver:
        raise ValueError("skill_version_stale")
    return payload


def new_task_id() -> str:
    return str(uuid.uuid4())
