"""Bearer access JWT verification for JSON-RPC invoke."""

from __future__ import annotations

from typing import Any

from app.a2a.access_token import verify_access_token


class AuthError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def parse_bearer(authorization: str | None) -> str:
    raw = str(authorization or "").strip()
    if not raw.lower().startswith("bearer "):
        raise AuthError(-32001, "Missing or invalid Authorization header")
    token = raw[7:].strip()
    if not token:
        raise AuthError(-32001, "Empty bearer token")
    return token


def verify_invoke_token(authorization: str | None) -> dict[str, Any]:
    token = parse_bearer(authorization)
    try:
        return verify_access_token(token)
    except ValueError as exc:
        reason = str(exc)
        if reason == "skill_version_stale":
            raise AuthError(-32010, "skill_version_stale") from exc
        if reason == "token_expired":
            raise AuthError(-32001, "access token expired") from exc
        raise AuthError(-32001, f"Invalid access token: {reason}") from exc
