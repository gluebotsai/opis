"""Internal service key auth for SFT catalog (fail closed)."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from app.config import get_settings


def require_internal_service_key(
    x_internal_service_key: str | None = Header(default=None, alias="x-internal-service-key"),
) -> None:
    expected = str(get_settings().internal_service_key or "").strip()
    provided = str(x_internal_service_key or "").strip()
    if not expected or not provided or not hmac.compare_digest(expected, provided):
        raise HTTPException(status_code=401, detail="Invalid or missing x-internal-service-key")
