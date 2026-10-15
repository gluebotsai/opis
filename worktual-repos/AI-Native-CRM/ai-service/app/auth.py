from __future__ import annotations

from fastapi import Header, HTTPException, status

from app.config import get_settings


def require_internal_secret(
    x_internal_secret: str | None = Header(default=None),
) -> None:
    settings = get_settings()
    expected = settings.internal_secret
    if not expected:
        if settings.app_env == "production":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ENRICH_INTERNAL_SECRET not configured",
            )
        return
    if (x_internal_secret or "") != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
