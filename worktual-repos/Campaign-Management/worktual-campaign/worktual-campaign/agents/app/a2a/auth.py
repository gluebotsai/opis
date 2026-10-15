"""Bearer access JWT auth for Hub invoke."""

from __future__ import annotations

from typing import Any

from app.a2a.access_token import TokenError, decode_access_token
from app.a2a.catalog import skill_version


def verify_bearer(authorization: str | None) -> dict[str, Any]:
    raw = str(authorization or "").strip()
    if not raw.lower().startswith("bearer "):
        raise TokenError("unauthorized", "Authorization Bearer required")
    token = raw[7:].strip()
    if not token:
        raise TokenError("unauthorized", "Empty Bearer token")
    claims = decode_access_token(token)
    live = skill_version()
    token_ver = str(claims.get("skillVersion") or "")
    if token_ver and token_ver != live:
        raise TokenError(
            "skill_version_stale",
            "Access token skillVersion is stale; call /token again",
        )
    return claims
