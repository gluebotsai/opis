from __future__ import annotations

import logging

from fastapi import HTTPException, status

from app.config import settings

log = logging.getLogger(__name__)


def _oauth_id_token_audiences() -> list[str]:
    """OAuth client IDs allowed as ID token ``aud`` (addon panel + optional CRM login client)."""
    seen: set[str] = set()
    out: list[str] = []
    for blob in (
        settings.google_addon_client_id,
        settings.google_client_id,
        settings.google_oauth_extra_client_ids,
    ):
        for part in str(blob or "").split(","):
            cid = part.strip()
            if cid and cid not in seen:
                seen.add(cid)
                out.append(cid)
    return out


def verify_google_id_token(token: str) -> tuple[str, str, str]:
    """Return (email, google_sub, name) after verifying the ID token.

    ``name`` is the Google account display name Meet uses by default for the
    tile glow. Callers that only need email and sub can ignore the third value.
    """
    raw = (token or "").strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google_id_token required")
    audiences = _oauth_id_token_audiences()
    if not audiences:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google addon not configured")
    try:
        from google.auth.transport import requests as greq
        from google.oauth2 import id_token
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="google token verify is unavailable") from exc
    req = greq.Request()
    info = None
    last_exc: Exception | None = None
    audience_arg: str | list[str] = audiences[0] if len(audiences) == 1 else audiences
    try:
        info = id_token.verify_oauth2_token(
            raw,
            req,
            audience_arg,
            clock_skew_in_seconds=10,
        )
    except Exception as exc:
        last_exc = exc
        if len(audiences) > 1:
            for aud in audiences:
                try:
                    info = id_token.verify_oauth2_token(
                        raw,
                        req,
                        aud,
                        clock_skew_in_seconds=10,
                    )
                    last_exc = None
                    break
                except Exception as inner:
                    last_exc = inner
    if info is None:
        exc = last_exc or ValueError("token verify failed")
        log.warning(
            "google_id_token_verify_failed",
            extra={"audiences": audiences, "error": type(exc).__name__, "detail": str(exc)[:200]},
        )
        detail = "invalid google_id_token"
        if settings.enable_test_ui:
            detail = f"invalid google_id_token ({type(exc).__name__})"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail) from exc
    email = str(info.get("email") or "").strip().lower()
    sub = str(info.get("sub") or "")
    name = str(info.get("name") or "").strip()
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google token missing email")
    return email, sub, name


def resolve_assist_user(principal, google_id_token: str | None) -> dict:
    crm_email = (principal.email or "").strip().lower() or None
    google_email = None
    google_sub = getattr(principal, "google_sub", None)
    raw = (google_id_token or "").strip()
    addon_on = bool((settings.google_addon_client_id or "").strip())
    session_ok = getattr(principal, "iss", None) == "meeting-service-assist" and bool(crm_email)
    if raw:
        verified = verify_google_id_token(raw)
        google_email, google_sub = verified[0], verified[1]
        if crm_email and google_email != crm_email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="google email does not match CRM user",
            )
    elif addon_on and not session_ok:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="google_id_token required")
    return {
        "email": google_email or crm_email,
        "crm_sub": principal.sub,
        "google_sub": google_sub,
    }
