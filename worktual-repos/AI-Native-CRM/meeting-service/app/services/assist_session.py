from __future__ import annotations

import time

import jwt
from fastapi import HTTPException

from app.config import settings
from app.services import crm_users
from app.services.google_id import verify_google_id_token


def _mint(crm: dict, google_sub: str = "", google_name: str = "") -> dict:
    now = int(time.time())
    ttl = max(60, int(settings.assist_session_ttl_sec))
    token = jwt.encode(
        {
            "organization_id": crm["organization_id"],
            "sub": crm["sub"],
            "email": crm["email"],
            "scopes": crm.get("scopes") or ["meetings:write"],
            "google_sub": google_sub,
            "name": google_name,
            "iat": now,
            "exp": now + ttl,
            "iss": "meeting-service-assist",
        },
        settings.crm_service_jwt_secret,
        algorithm="HS256",
    )
    return {
        "token": token,
        "expires_in": ttl,
        "user": {
            "email": crm["email"],
            "crm_sub": crm["sub"],
            "google_sub": google_sub,
            "name": google_name,
            "organization_id": crm["organization_id"],
        },
    }


def create_session(google_id_token: str) -> dict:
    """Passwordless only when this Google account is the CRM-connected mailbox."""
    if not (settings.google_addon_client_id or "").strip():
        raise HTTPException(status_code=503, detail="Google add-on is not configured")
    verified = verify_google_id_token(google_id_token)
    email, google_sub = verified[0], verified[1]
    google_name = verified[2] if len(verified) > 2 else ""
    email_norm = email.strip().lower()
    try:
        crm = crm_users.lookup_by_email(email_norm)
    except HTTPException as exc:
        if exc.status_code in (403, 404):
            raise HTTPException(status_code=409, detail="crm_login_required") from exc
        raise
    connected = (crm.get("connected_google_email") or "").strip().lower()
    if not connected or email_norm != connected:
        raise HTTPException(status_code=409, detail="crm_login_required")
    return _mint(crm, google_sub, google_name)


def create_password_session(email: str, password: str) -> dict:
    crm = crm_users.verify_login(email, password)
    return _mint(crm)
