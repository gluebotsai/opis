"""Proactive webchat engagement adapter (existing Chat Service WebSocket path)."""

from __future__ import annotations

from typing import Any

import httpx

from cc_a2a.audit_log import log_a2a_trace
from cc_a2a.config import A2ASettings


class WebchatEngagementError(Exception):
    def __init__(
        self,
        message: str,
        *,
        outcome: str = "failed",
        status_code: int = 500,
        retryable: bool = False,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.outcome = outcome
        self.status_code = status_code
        self.retryable = retryable
        self.payload = payload or {}


async def resolve_default_active_webchat(
    settings: A2ASettings,
    *,
    organization_id: str,
) -> dict[str, Any] | None:
    """Return first active webchat widget for the organization, or None."""
    path = f"/internal/v1/organizations/{organization_id}/webchat/default"
    headers = {
        "accept": "application/json",
        "x-tenant-id": organization_id,
    }
    if settings.internal_service_key:
        headers["x-internal-service-key"] = settings.internal_service_key

    async with httpx.AsyncClient(
        base_url=settings.cc_core_url.rstrip("/"),
        timeout=10.0,
    ) as client:
        response = await client.get(path, headers=headers)

    log_a2a_trace(
        "STEP",
        step="cc_core_get_default_webchat",
        organizationId=organization_id,
        httpStatus=response.status_code,
        path=path,
    )

    if response.status_code == 404:
        return None

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": response.text}
        raise WebchatEngagementError(
            str(payload.get("message") or payload.get("error") or "webchat lookup failed"),
            outcome="failed",
            status_code=response.status_code,
            retryable=response.status_code >= 500,
            payload=payload if isinstance(payload, dict) else {},
        )

    data = response.json()
    webchat_id = data.get("webchatId")
    if not webchat_id:
        return None
    return data


async def trigger_proactive_engagement(
    settings: A2ASettings,
    *,
    organization_id: str,
    webchat_id: str,
    visitor_id: str,
    text: str | None = None,
    auto_session_start: bool | None = None,
    reason: str | None = None,
    page_url: str | None = None,
    command_id: str | None = None,
) -> dict[str, Any]:
    """Call cc-core public webchat trigger; tenant must match resolved widget org.

    openMode is intentionally not exposed on the A2A skill — chat-service defaults
    to panel so Hub does not need to choose bubble/panel.
    """
    path = (
        f"/api/v1/public/webchat/{webchat_id}/visitors/{visitor_id}/trigger-bot"
    )
    body: dict[str, Any] = {}
    if text is not None:
        body["text"] = text
    if auto_session_start is not None:
        body["autoSessionStart"] = auto_session_start
    if reason is not None:
        body["reason"] = reason
    if page_url is not None:
        body["pageUrl"] = page_url
    if command_id is not None:
        body["commandId"] = command_id

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-tenant-id": organization_id,
        "x-a2a-organization-id": organization_id,
    }
    if settings.webchat_trigger_api_key:
        headers["x-api-key"] = settings.webchat_trigger_api_key
    elif settings.internal_service_key:
        headers["x-internal-service-key"] = settings.internal_service_key

    # Never log personalized text or visitor PII beyond ids.
    log_a2a_trace(
        "STEP",
        command_id=command_id,
        step="cc_core_trigger_webchat",
        organizationId=organization_id,
        webchatId=webchat_id,
        visitorId=visitor_id,
        hasText=bool(text),
        textLength=len(text.strip()) if isinstance(text, str) else 0,
        autoSessionStart=auto_session_start,
        reason=reason,
        path=path,
    )

    async with httpx.AsyncClient(
        base_url=settings.cc_core_url.rstrip("/"),
        timeout=20.0,
    ) as client:
        response = await client.post(path, headers=headers, json=body)

    log_a2a_trace(
        "STEP",
        command_id=command_id,
        step="cc_core_trigger_webchat_response",
        organizationId=organization_id,
        webchatId=webchat_id,
        visitorId=visitor_id,
        httpStatus=response.status_code,
    )

    if response.status_code == 404:
        # Map offline / not found to completed visitor_offline so Hub does not retry forever.
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": response.text}
        error_text = str(payload.get("error") or payload.get("message") or "not found")
        if "webchat" in error_text.lower() and "not found" in error_text.lower():
            raise WebchatEngagementError(
                "Webchat widget not found",
                outcome="failed",
                status_code=404,
                retryable=False,
                payload=payload,
            )
        return {
            "ok": False,
            "outcome": "visitor_offline",
            "message": "Visitor is not connected on webchat",
            "webchatId": webchat_id,
            "visitorId": visitor_id,
            "detail": error_text,
        }

    if response.status_code == 403:
        raise WebchatEngagementError(
            "Webchat organization does not match authenticated tenant",
            outcome="rejected",
            status_code=403,
            retryable=False,
        )

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": response.text}
        raise WebchatEngagementError(
            str(payload.get("message") or payload.get("error") or "webchat trigger failed"),
            outcome="failed",
            status_code=response.status_code,
            retryable=response.status_code >= 500,
            payload=payload if isinstance(payload, dict) else {},
        )

    data = response.json()
    return {
        "ok": True,
        "outcome": "delivered",
        "organizationId": data.get("organizationId") or organization_id,
        "conversationId": data.get("conversationId"),
        "sessionStarted": bool(data.get("sessionStarted")),
        "webchatId": webchat_id,
        "visitorId": visitor_id,
    }
