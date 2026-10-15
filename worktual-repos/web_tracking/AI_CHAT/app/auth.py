"""JWT authentication for WebSocket connections."""

from __future__ import annotations

from jose import JWTError, jwt

from config import get_settings


class AuthError(Exception):
    pass


def decode_ws_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as exc:
        raise AuthError("Invalid or expired token") from exc

    site_id = payload.get("website_id")
    if site_id is None:
        site_id = payload.get("domain_id")
    if site_id is None:
        raise AuthError("Token missing website_id")

    org = payload.get("organization_id")
    return {
        "admin_id": int(payload["sub"]),
        "email": payload.get("email", ""),
        "website_id": int(site_id),
        "website_url": payload.get("website_url", payload.get("domain_name", "")),
        "organization_id": int(org) if org is not None else None,
    }
