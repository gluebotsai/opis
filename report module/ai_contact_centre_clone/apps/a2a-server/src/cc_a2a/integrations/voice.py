"""Outbound voice-bot call adapter. cc-core publishes the campaign message."""

from __future__ import annotations

from typing import Any

import httpx

from cc_a2a.audit_log import log_a2a_trace
from cc_a2a.config import A2ASettings


class VoiceBotTriggerError(Exception):
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


async def trigger_auto_bot_call(
    settings: A2ASettings,
    *,
    organization_id: str,
    number: str,
    data: dict[str, Any] | None = None,
    instruction: str = "",
    command_id: str | None = None,
) -> dict[str, Any]:
    """POST the internal auto-bot call. Organization comes from the Hub envelope."""
    path = "/internal/v1/voice/auto-bot-call"
    body = {
        "organizationId": organization_id,
        "number": number,
        "data": data or {},
        "instruction": instruction,
    }
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-tenant-id": organization_id,
    }
    if settings.internal_service_key:
        headers["x-internal-service-key"] = settings.internal_service_key

    log_a2a_trace(
        "STEP",
        command_id=command_id,
        step="cc_core_trigger_auto_bot_call",
        organizationId=organization_id,
        hasInstruction=bool(instruction),
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
        step="cc_core_trigger_auto_bot_call_response",
        organizationId=organization_id,
        httpStatus=response.status_code,
    )

    if response.status_code >= 400:
        try:
            payload = response.json()
        except ValueError:
            payload = {"error": response.text}
        if not isinstance(payload, dict):
            payload = {"error": str(payload)}
        message = str(payload.get("message") or payload.get("error") or "voice bot trigger failed")
        raise VoiceBotTriggerError(
            message,
            outcome="failed",
            status_code=response.status_code,
            retryable=response.status_code >= 500,
            payload=payload,
        )

    published = response.json()
    if not isinstance(published, dict):
        published = {}
    return {
        "ok": True,
        "outcome": "succeeded",
        "organizationId": organization_id,
        "sessionId": published.get("sessionId"),
        "channel": published.get("channel"),
        "domainName": published.get("domainName"),
        "cli": published.get("cli"),
    }
