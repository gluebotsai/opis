"""Outbound Intelligent Hub A2A remote-agent client."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from cc_a2a.bridge.hub_token_store import HubTokenStore, HubTokenStoreError
from cc_a2a.config import A2ASettings
from cc_a2a.contracts import HubDelegationResult, HubHelpRequest

logger = logging.getLogger("a2a.hub.client")

TERMINAL_TASK_STATES = frozenset(
    {"completed", "failed", "canceled", "rejected", "auth_required", "input_required"}
)


class HubClientError(Exception):
    def __init__(
        self,
        message: str,
        *,
        outcome: str = "failed",
        retryable: bool = False,
        status_code: int = 500,
        payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.outcome = outcome
        self.retryable = retryable
        self.status_code = status_code
        self.payload = payload or {}


def _iso_expiry(seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()


def build_hub_remainder_payload(
    settings: A2ASettings,
    request: HubHelpRequest,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "organization_id": int(request.organizationId),
        "spoke": settings.hub_a2a_spoke_label,
        "recent_event": {
            "channel": request.channel,
            "query": request.query,
        },
    }
    if request.cdpId:
        payload["cdp_id"] = request.cdpId
    return payload


def build_message_send_body(
    settings: A2ASettings,
    request: HubHelpRequest,
) -> dict[str, Any]:
    message_id = str(uuid.uuid4())
    return {
        "jsonrpc": "2.0",
        "id": message_id,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "messageId": message_id,
                "metadata": {"source": "ccaas"},
                "parts": [
                    {
                        "kind": "data",
                        "data": build_hub_remainder_payload(settings, request),
                    }
                ],
            }
        },
    }


class HubRemoteAgentClient:
    """Call Hub as a remote sub-agent for CCaaS-originated remainder queries."""

    def __init__(self, settings: A2ASettings) -> None:
        self.settings = settings
        self.token_store = HubTokenStore(settings)

    def _hub_base_url(self) -> str:
        base = (self.settings.hub_a2a_base_url or "").rstrip("/")
        if not base:
            raise HubClientError(
                "HUB_A2A_URL is not configured",
                outcome="rejected",
                retryable=False,
            )
        return base

    def _hub_token_url(self) -> str:
        if self.settings.hub_a2a_token_url:
            return self.settings.hub_a2a_token_url.rstrip("/")
        return f"{self._hub_base_url()}/token"

    async def _mint_token(
        self,
        organization_id: str,
        *,
        grant_type: str,
        refresh_token: str | None = None,
    ) -> dict[str, Any]:
        secret = self.settings.hub_a2a_client_secret.strip()
        if not secret:
            raise HubClientError(
                "HUB_A2A_CLIENT_SECRET is not configured",
                outcome="rejected",
                retryable=False,
            )

        body: dict[str, Any] = {
            "grant_type": grant_type,
            "client_id": self.settings.hub_a2a_client_id,
            "client_secret": secret,
            "a2a_server_name": self.settings.hub_a2a_server_name,
            "organization_id": organization_id,
        }
        if grant_type == "refresh_token" and refresh_token:
            body["refresh_token"] = refresh_token

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(self._hub_token_url(), json=body)

        if response.status_code >= 400:
            try:
                payload = response.json()
            except ValueError:
                payload = {"error": response.text}
            raise HubClientError(
                str(payload.get("error_description") or payload.get("error") or "token mint failed"),
                outcome="failed",
                retryable=response.status_code >= 500,
                status_code=response.status_code,
                payload=payload if isinstance(payload, dict) else {},
            )

        data = response.json()
        access_token = str(data.get("access_token") or "")
        if not access_token:
            raise HubClientError("Hub token response missing access_token", outcome="failed")

        expires_in = int(data.get("expires_in") or 3600)
        refresh_expires_in = int(data.get("refresh_expires_in") or 2_592_000)
        await self.token_store.upsert_token(
            organization_id,
            access_token=access_token,
            access_expires_at=_iso_expiry(expires_in),
            refresh_token=str(data.get("refresh_token") or "") or None,
            refresh_expires_at=_iso_expiry(refresh_expires_in)
            if data.get("refresh_token")
            else None,
            skill_version=str(data.get("skill_version") or "") or None,
        )
        return data

    async def get_access_token(self, organization_id: str) -> str:
        stored = await self.token_store.get_token(organization_id)
        if stored and not HubTokenStore.is_expired(stored.get("accessExpiresAt")):
            return str(stored["accessToken"])

        refresh_token = (stored or {}).get("refreshToken")
        if refresh_token and not HubTokenStore.is_expired(
            (stored or {}).get("refreshExpiresAt"),
            skew_seconds=0,
        ):
            await self._mint_token(
                organization_id,
                grant_type="refresh_token",
                refresh_token=str(refresh_token),
            )
        else:
            await self._mint_token(organization_id, grant_type="client_credentials")

        refreshed = await self.token_store.get_token(organization_id)
        if not refreshed or not refreshed.get("accessToken"):
            raise HubClientError("Unable to obtain Hub access token", outcome="failed", retryable=True)
        return str(refreshed["accessToken"])

    async def _jsonrpc(
        self,
        *,
        access_token: str,
        body: dict[str, Any],
        retry_auth: bool,
        organization_id: str,
    ) -> dict[str, Any]:
        headers = {
            "authorization": f"Bearer {access_token}",
            "content-type": "application/json",
            "accept": "application/json",
        }
        timeout = float(self.settings.hub_a2a_timeout_seconds)
        async with httpx.AsyncClient(base_url=self._hub_base_url(), timeout=timeout) as client:
            response = await client.post("/", headers=headers, json=body)

        if response.status_code == 401 and retry_auth:
            await self._mint_token(organization_id, grant_type="client_credentials")
            new_token = await self.get_access_token(organization_id)
            return await self._jsonrpc(
                access_token=new_token,
                body=body,
                retry_auth=False,
                organization_id=organization_id,
            )

        try:
            payload = response.json()
        except ValueError as error:
            raise HubClientError(
                "Invalid Hub JSON-RPC response",
                outcome="failed",
                retryable=True,
                status_code=response.status_code,
            ) from error

        if not isinstance(payload, dict):
            raise HubClientError("Invalid Hub JSON-RPC response", outcome="failed", retryable=True)

        if payload.get("error"):
            error = payload["error"]
            code = error.get("code") if isinstance(error, dict) else None
            message = (
                error.get("message") if isinstance(error, dict) else str(error)
            ) or "Hub JSON-RPC error"
            retryable = response.status_code >= 500 or code in {-32603}
            raise HubClientError(
                str(message),
                outcome="failed",
                retryable=retryable,
                status_code=response.status_code,
                payload=error if isinstance(error, dict) else {"message": message},
            )

        if response.status_code >= 400:
            raise HubClientError(
                f"Hub invoke failed with HTTP {response.status_code}",
                outcome="failed",
                retryable=response.status_code >= 500,
                status_code=response.status_code,
            )

        result = payload.get("result")
        return result if isinstance(result, dict) else {"raw": result}

    async def _poll_task(
        self,
        *,
        access_token: str,
        organization_id: str,
        task_id: str,
        deadline: float,
    ) -> dict[str, Any]:
        while True:
            if time.monotonic() >= deadline:
                raise HubClientError(
                    "Hub task polling timed out",
                    outcome="timeout",
                    retryable=True,
                )
            body = {
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "tasks/get",
                "params": {"id": task_id, "organizationId": organization_id},
            }
            task = await self._jsonrpc(
                access_token=access_token,
                body=body,
                retry_auth=True,
                organization_id=organization_id,
            )
            state = str((task.get("status") or {}).get("state") or "").lower()
            if state in TERMINAL_TASK_STATES:
                return task
            await asyncio.sleep(self.settings.hub_a2a_poll_interval_seconds)

    async def delegate(self, request: HubHelpRequest) -> HubDelegationResult:
        logger.info(
            "ccaas hub delegation",
            extra={
                "audit": {
                    "event": "ccaas_instruct",
                    "organizationId": request.organizationId,
                    "commandId": request.commandId,
                    "channel": request.channel,
                    "hasCdpId": bool(request.cdpId),
                    "hopCount": request.hopCount,
                }
            },
        )

        try:
            access_token = await self.get_access_token(request.organizationId)
        except (HubClientError, HubTokenStoreError) as error:
            return HubDelegationResult(
                commandId=request.commandId,
                outcome="failed",
                message=str(error),
                retryable=getattr(error, "retryable", True),
            )

        send_body = build_message_send_body(self.settings, request)
        try:
            task = await self._jsonrpc(
                access_token=access_token,
                body=send_body,
                retry_auth=True,
                organization_id=request.organizationId,
            )
        except HubClientError as error:
            outcome = "timeout" if error.outcome == "timeout" else "failed"
            return HubDelegationResult(
                commandId=request.commandId,
                outcome=outcome,  # type: ignore[arg-type]
                message=str(error),
                retryable=error.retryable,
                evidence=error.payload,
            )

        task_id = str(task.get("id") or "")
        state = str((task.get("status") or {}).get("state") or "").lower()
        if state and state not in TERMINAL_TASK_STATES and task_id:
            deadline = time.monotonic() + float(self.settings.hub_a2a_timeout_seconds)
            try:
                task = await self._poll_task(
                    access_token=access_token,
                    organization_id=request.organizationId,
                    task_id=task_id,
                    deadline=deadline,
                )
                state = str((task.get("status") or {}).get("state") or "").lower()
            except HubClientError as error:
                return HubDelegationResult(
                    commandId=request.commandId,
                    outcome="timeout" if error.outcome == "timeout" else "failed",
                    hubTaskId=task_id or None,
                    hubTaskState=state or None,
                    message=str(error),
                    retryable=error.retryable,
                    evidence=error.payload,
                )

        outcome = "succeeded" if state == "completed" else "failed"
        if state in {"rejected", "canceled"}:
            outcome = "failed"

        result = HubDelegationResult(
            commandId=request.commandId,
            outcome=outcome,  # type: ignore[arg-type]
            hubTaskId=task_id or None,
            hubTaskState=state or None,
            evidence={"hubTask": task},
            retryable=state in {"failed"} and state != "completed",
        )
        logger.info(
            "hub delegation reply",
            extra={
                "audit": {
                    "event": "hub_reply",
                    "organizationId": request.organizationId,
                    "commandId": request.commandId,
                    "hubTaskId": result.hubTaskId,
                    "hubTaskState": result.hubTaskState,
                    "outcome": result.outcome,
                }
            },
        )
        return result
