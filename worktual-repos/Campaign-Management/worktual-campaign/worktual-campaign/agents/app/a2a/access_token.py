"""Mint / verify Campaign A2A access JWTs for Hub."""

from __future__ import annotations

import time
from typing import Any

import jwt

from app.a2a.catalog import skill_ids, skill_version
from app.a2a.clients import new_refresh_token, save_tokens
from app.config import get_settings


class TokenError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def mint_access_claims(*, client_id: str) -> dict[str, Any]:
    s = get_settings()
    now = int(time.time())
    return {
        "iss": s.a2a_access_token_issuer,
        "aud": s.a2a_hub_jwt_audience,
        "sub": client_id,
        "iat": now,
        "exp": now + int(s.a2a_access_token_ttl_seconds),
        "a2a_server_name": s.a2a_server_name,
        "skills": skill_ids(),
        "skillVersion": skill_version(),
    }


def encode_access_token(claims: dict[str, Any]) -> str:
    s = get_settings()
    return jwt.encode(
        claims,
        s.a2a_hub_jwt_secret,
        algorithm="HS256",
    )


def decode_access_token(token: str) -> dict[str, Any]:
    s = get_settings()
    try:
        return jwt.decode(
            token,
            s.a2a_hub_jwt_secret,
            algorithms=["HS256"],
            audience=s.a2a_hub_jwt_audience,
            issuer=s.a2a_access_token_issuer,
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token_expired", "Access token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("invalid_token", f"Invalid access token: {exc}") from exc


async def issue_tokens_for_spoke(
    *,
    client_id: str,
    a2a_server_name: str,
    client_secret: str | None = None,
) -> dict[str, Any]:
    s = get_settings()
    if a2a_server_name != s.a2a_server_name:
        raise TokenError(
            "invalid_server",
            f"a2a_server_name must be {s.a2a_server_name}",
        )
    claims = mint_access_claims(client_id=client_id)
    access = encode_access_token(claims)
    refresh = new_refresh_token()
    await save_tokens(
        a2a_server_name,
        access_token=access,
        refresh_token=refresh,
        access_ttl_s=int(s.a2a_access_token_ttl_seconds),
        refresh_ttl_s=int(s.a2a_refresh_token_ttl_seconds),
        client_id=client_id,
        client_secret=client_secret or s.a2a_spoke_client_secret,
    )
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": int(s.a2a_access_token_ttl_seconds),
        "refresh_token": refresh,
        "a2a_server_name": a2a_server_name,
        "skillVersion": claims["skillVersion"],
    }
