"""JWT helpers for Socket.IO auth (Campaign SPA JWT + CRM embed JWT)."""

from __future__ import annotations

from typing import Any

import jwt

from app.config import get_settings


def _user_id_from_payload(payload: dict[str, Any]) -> str:
    settings = get_settings()
    claim = settings.crm_jwt_user_id_claim or "sub"
    raw = (
        payload.get(claim)
        or payload.get("sub")
        or payload.get("userId")
        or payload.get("id")
    )
    if raw is None:
        return ""
    if isinstance(raw, (int, float)):
        return str(int(raw)).strip()
    return str(raw).strip()


def _decode_spa_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )


def _decode_crm_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.crm_jwt_access_secret.strip()
    if not secret:
        raise jwt.InvalidTokenError("CRM JWT not configured")
    decode_kwargs: dict[str, Any] = {
        "algorithms": [settings.crm_jwt_algorithm or "HS256"],
        "options": {"verify_aud": False},
    }
    issuer = settings.crm_jwt_issuer.strip()
    if issuer:
        decode_kwargs["issuer"] = issuer
    return jwt.decode(token, secret, **decode_kwargs)


def decode_token(token: str) -> dict[str, Any]:
    """Campaign SPA JWT first, then Worktual CRM access JWT (same order as API)."""
    try:
        return _decode_spa_token(token)
    except jwt.PyJWTError:
        return _decode_crm_token(token)


def user_id_from_token(token: str) -> str | None:
    try:
        payload = decode_token(token)
    except jwt.PyJWTError:
        return None
    user_id = _user_id_from_payload(payload)
    return user_id or None
