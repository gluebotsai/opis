"""Worktual ZoomInfo gateway client (CRM never talks to ZoomInfo OAuth/MCP)."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

ZOOMINFO_GATEWAY_API_KEY = "__gateway__"
APP_KEY = "zoominfo"


def _settings_token() -> str:
    try:
        from app.config import get_settings

        return (get_settings().zoominfo_gateway_token or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def _settings_url() -> str:
    try:
        from app.config import get_settings

        return (get_settings().zoominfo_gateway_url or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def zoominfo_gateway_base_url() -> str:
    return (
        os.environ.get("ZOOMINFO_GATEWAY_URL", "").strip()
        or _settings_url()
        or "http://173.234.75.165:8199"
    ).rstrip("/")


def zoominfo_gateway_token() -> str:
    return (
        os.environ.get("ZOOMINFO_GATEWAY_TOKEN", "").strip() or _settings_token()
    )


def is_zoominfo_gateway_configured() -> bool:
    return bool(zoominfo_gateway_token())


def uses_zoominfo_gateway(api_key: str | None) -> bool:
    key = (api_key or "").strip()
    return key == ZOOMINFO_GATEWAY_API_KEY or (
        is_zoominfo_gateway_configured() and not key
    )


async def zoominfo_gateway_call(
    *,
    organization_id: str,
    tool_name: str,
    parameters: dict[str, Any],
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """
    POST /v1/zoominfo/tools/call

    Returns parsed JSON. Raises RuntimeError with gateway error code/message on failure.
    """
    if not is_zoominfo_gateway_configured():
        raise RuntimeError("ZOOMINFO_GATEWAY_TOKEN is not configured")
    org = (organization_id or "").strip()
    if not org:
        raise RuntimeError("organizationId is required for ZoomInfo gateway")

    headers = {
        "Authorization": f"Bearer {zoominfo_gateway_token()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key

    url = f"{zoominfo_gateway_base_url()}/v1/zoominfo/tools/call"
    body = {
        "organizationId": org,
        "appKey": APP_KEY,
        "toolName": tool_name,
        "parameters": parameters,
    }
    async with httpx.AsyncClient(timeout=45.0) as client:
        res = await client.post(url, headers=headers, json=body)
        try:
            payload = res.json()
        except Exception:  # noqa: BLE001
            payload = {"success": False, "error": {"message": res.text[:400]}}

    if res.status_code >= 400 or not payload.get("success"):
        err = payload.get("error") if isinstance(payload, dict) else None
        code = ""
        message = res.text[:300]
        if isinstance(err, dict):
            code = str(err.get("code") or "")
            message = str(err.get("message") or message)
        request_id = (
            payload.get("request_id") if isinstance(payload, dict) else None
        )
        logger.warning(
            "zoominfo_gateway_call failed tool=%s status=%s code=%s request_id=%s msg=%s",
            tool_name,
            res.status_code,
            code,
            request_id,
            message,
        )
        raise RuntimeError(f"{code or 'ZOOMINFO_GATEWAY_ERROR'}: {message}")

    data = payload.get("data")
    return data if isinstance(data, dict) else {"raw": data}


async def zoominfo_gateway_list_tools(organization_id: str) -> list[dict[str, Any]]:
    if not is_zoominfo_gateway_configured():
        return []
    org = (organization_id or "").strip()
    if not org:
        return []
    url = f"{zoominfo_gateway_base_url()}/v1/zoominfo/tools/list"
    headers = {
        "Authorization": f"Bearer {zoominfo_gateway_token()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(
            url,
            headers=headers,
            json={"organizationId": org, "appKey": APP_KEY},
        )
        payload = res.json() if res.content else {}
    if not payload.get("success"):
        return []
    tools = payload.get("tools")
    return tools if isinstance(tools, list) else []
