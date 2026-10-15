"""Worktual Semrush gateway client (CRM never talks to Semrush OAuth/MCP)."""

from __future__ import annotations

import hashlib
import logging
import os
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

APP_KEY = "semrush"
DEFAULT_BASE_URL = "http://173.234.75.165:8090"
ALLOWED_COUNTRIES = frozenset({"US", "UK", "IN", "AE"})


def _settings_token() -> str:
    try:
        from app.config import get_settings

        return (get_settings().semrush_gateway_token or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def _settings_url() -> str:
    try:
        from app.config import get_settings

        return (get_settings().semrush_gateway_url or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def semrush_gateway_base_url() -> str:
    return (
        os.environ.get("SEMRUSH_GATEWAY_URL", "").strip()
        or _settings_url()
        or DEFAULT_BASE_URL
    ).rstrip("/")


def semrush_gateway_token() -> str:
    return (
        os.environ.get("SEMRUSH_GATEWAY_TOKEN", "").strip() or _settings_token()
    )


def is_semrush_gateway_configured() -> bool:
    return bool(semrush_gateway_token())


def gateway_country(location: str | None) -> str:
    raw = re.sub(r"[^A-Za-z]", "", (location or "US")).strip().upper()
    aliases = {
        "USA": "US",
        "UNITEDSTATES": "US",
        "GB": "UK",
        "GREATBRITAIN": "UK",
        "UNITEDKINGDOM": "UK",
        "INDIA": "IN",
        "UAE": "AE",
        "UNITEDARABEMIRATES": "AE",
    }
    mapped = aliases.get(raw, raw)
    return mapped if mapped in ALLOWED_COUNTRIES else "US"


def keyword_metrics_idempotency_key(
    organization_id: str,
    keyword: str,
    country: str,
    month: str | None = None,
) -> str:
    seed = f"{organization_id}|{keyword.strip().lower()}|{country}|{month or ''}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:20]
    return f"crm-semrush-{digest}"


class SemrushGatewayError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "SEMRUSH_GATEWAY_ERROR",
        request_id: str | None = None,
        status: int = 502,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.request_id = request_id
        self.status = status


def _parse_error(payload: Any, status: int, fallback_text: str) -> SemrushGatewayError:
    err = payload.get("error") if isinstance(payload, dict) else None
    code = "SEMRUSH_GATEWAY_ERROR"
    message = fallback_text[:300]
    request_id = None
    if isinstance(payload, dict):
        raw_id = payload.get("request_id")
        request_id = raw_id.strip() if isinstance(raw_id, str) and raw_id.strip() else None
    if isinstance(err, dict):
        code = str(err.get("code") or code)
        message = str(err.get("message") or message)
    return SemrushGatewayError(
        message,
        code=code,
        request_id=request_id,
        status=status,
    )


def semrush_gateway_call(
    *,
    organization_id: str,
    tool_name: str,
    parameters: dict[str, Any],
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """POST /v1/semrush/tools/call — Bearer token only, never in the body."""
    if not is_semrush_gateway_configured():
        raise SemrushGatewayError(
            "SEMRUSH_GATEWAY_TOKEN is not configured",
            code="GATEWAY_NOT_CONFIGURED",
            status=503,
        )
    org = (organization_id or "").strip()
    if not org:
        raise SemrushGatewayError(
            "organizationId is required for Semrush gateway",
            code="INVALID_ORGANIZATION",
            status=400,
        )

    headers = {
        "Authorization": f"Bearer {semrush_gateway_token()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    url = f"{semrush_gateway_base_url()}/v1/semrush/tools/call"
    body = {
        "organizationId": org,
        "appKey": APP_KEY,
        "toolName": tool_name,
        "parameters": parameters,
    }
    with httpx.Client(timeout=45.0) as client:
        res = client.post(url, headers=headers, json=body)
        try:
            payload = res.json()
        except Exception:  # noqa: BLE001
            payload = {"success": False, "error": {"message": (res.text or "")[:400]}}

    if res.status_code >= 400 or not payload.get("success"):
        exc = _parse_error(payload, res.status_code, (res.text or "")[:300])
        logger.warning(
            "semrush_gateway_call failed tool=%s status=%s code=%s request_id=%s",
            tool_name,
            res.status_code,
            exc.code,
            exc.request_id,
        )
        raise exc

    data = payload.get("data")
    return data if isinstance(data, dict) else {"raw": data}
