from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import settings

log = logging.getLogger(__name__)


def _uses_dummy(base: str) -> bool:
    lower = base.lower()
    return lower in {"", "internal", "dummy"}


def lookup_by_email(email: str) -> dict[str, Any]:
    addr = (email or "").strip().lower()
    if not addr:
        raise HTTPException(status_code=403, detail="not a CRM user")
    base = (settings.crm_users_base_url or "").rstrip("/")
    if _uses_dummy(base):
        org = (settings.crm_assist_dummy_org_id or "").strip()
        if not org:
            raise HTTPException(status_code=503, detail="CRM users is not configured")
        return {
            "organization_id": org,
            "sub": addr,
            "email": addr,
            "scopes": ["meetings:write"],
            "connected_google_email": addr,
        }
    headers = {"Accept": "application/json"}
    if settings.crm_users_api_key:
        headers["X-CRM-Users-Key"] = settings.crm_users_api_key
    elif settings.crm_bot_api_key:
        headers["X-CRM-Bot-Key"] = settings.crm_bot_api_key
    try:
        with httpx.Client(timeout=settings.llm_timeout_sec) as client:
            r = client.get(f"{base}/v1/users/by-email", params={"email": addr}, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("crm_users_unreachable", extra={"error": type(exc).__name__})
        raise HTTPException(status_code=503, detail="CRM users unreachable") from exc
    if r.status_code == 404:
        raise HTTPException(status_code=403, detail="not a CRM user")
    if r.status_code >= 400:
        raise HTTPException(status_code=503, detail="CRM users lookup failed")
    try:
        data = r.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    org = str(data.get("organization_id") or data.get("org_id") or "").strip()
    sub = str(data.get("sub") or data.get("id") or addr).strip()
    if not org:
        raise HTTPException(status_code=403, detail="not a CRM user")
    scopes = data.get("scopes") or ["meetings:write"]
    if isinstance(scopes, str):
        scopes = scopes.split()
    connected = str(data.get("connected_google_email") or "").strip().lower()
    return {
        "organization_id": org,
        "sub": sub,
        "email": str(data.get("email") or addr).strip().lower(),
        "scopes": list(scopes),
        "connected_google_email": connected or None,
    }


def verify_login(email: str, password: str) -> dict[str, Any]:
    """Verify CRM credentials without creating a browser session."""
    addr = (email or "").strip().lower()
    if not addr or not password:
        raise HTTPException(status_code=422, detail="Email and password are required.")
    base = (settings.crm_users_base_url or "").rstrip("/")
    if _uses_dummy(base):
        raise HTTPException(status_code=503, detail="CRM users is not configured")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.crm_users_api_key:
        headers["X-CRM-Users-Key"] = settings.crm_users_api_key
    elif settings.crm_bot_api_key:
        headers["X-CRM-Bot-Key"] = settings.crm_bot_api_key
    try:
        with httpx.Client(timeout=settings.llm_timeout_sec) as client:
            r = client.post(
                f"{base}/v1/users/verify-login",
                json={"email": addr, "password": password},
                headers=headers,
            )
    except httpx.HTTPError as exc:
        log.warning("crm_users_unreachable", extra={"error": type(exc).__name__})
        raise HTTPException(status_code=503, detail="CRM users unreachable") from exc
    if r.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if r.status_code >= 400:
        raise HTTPException(status_code=503, detail="CRM login failed")
    try:
        data = r.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    org = str(data.get("organization_id") or "").strip()
    sub = str(data.get("sub") or "").strip()
    if not org or not sub:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    scopes = data.get("scopes") or ["meetings:write"]
    if isinstance(scopes, str):
        scopes = scopes.split()
    connected = str(data.get("connected_google_email") or "").strip().lower()
    return {
        "organization_id": org,
        "sub": sub,
        "email": str(data.get("email") or addr).strip().lower(),
        "scopes": list(scopes),
        "connected_google_email": connected or None,
    }
