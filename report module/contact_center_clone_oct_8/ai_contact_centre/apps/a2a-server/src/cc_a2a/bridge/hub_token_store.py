"""Persist and retrieve outbound Hub OAuth tokens via cc-core internal APIs."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

import httpx

from cc_a2a.config import A2ASettings

logger = logging.getLogger("a2a.hub.tokens")


class HubTokenStoreError(Exception):
    def __init__(self, message: str, *, status_code: int = 500) -> None:
        super().__init__(message)
        self.status_code = status_code


class HubTokenStore:
    def __init__(self, settings: A2ASettings) -> None:
        self.settings = settings
        self.base_url = settings.cc_core_url.rstrip("/")

    def _headers(self, organization_id: str) -> dict[str, str]:
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "x-tenant-id": organization_id,
        }
        if self.settings.internal_service_key:
            headers["x-internal-service-key"] = self.settings.internal_service_key
        return headers

    async def get_token(self, organization_id: str) -> dict[str, Any] | None:
        path = "/internal/v1/a2a/hub/token"
        async with httpx.AsyncClient(base_url=self.base_url, timeout=20.0) as client:
            response = await client.get(path, headers=self._headers(organization_id))
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise HubTokenStoreError(
                f"hub token lookup failed: {response.status_code}",
                status_code=response.status_code,
            )
        return response.json()

    async def upsert_token(
        self,
        organization_id: str,
        *,
        access_token: str,
        access_expires_at: str,
        refresh_token: str | None = None,
        refresh_expires_at: str | None = None,
        skill_version: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "organizationId": organization_id,
            "a2aServerName": self.settings.hub_a2a_server_name,
            "clientId": self.settings.hub_a2a_client_id,
            "accessToken": access_token,
            "accessExpiresAt": access_expires_at,
        }
        if refresh_token:
            body["refreshToken"] = refresh_token
        if refresh_expires_at:
            body["refreshExpiresAt"] = refresh_expires_at
        if skill_version:
            body["skillVersion"] = skill_version

        async with httpx.AsyncClient(base_url=self.base_url, timeout=20.0) as client:
            response = await client.post(
                "/internal/v1/a2a/hub/token",
                headers=self._headers(organization_id),
                json=body,
            )
        if response.status_code >= 400:
            raise HubTokenStoreError(
                f"hub token upsert failed: {response.status_code}",
                status_code=response.status_code,
            )
        return response.json()

    @staticmethod
    def is_expired(access_expires_at: str | None, *, skew_seconds: int = 60) -> bool:
        if not access_expires_at:
            return True
        try:
            normalized = access_expires_at.replace("Z", "+00:00")
            expires = datetime.fromisoformat(normalized)
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=UTC)
            return expires.timestamp() <= datetime.now(UTC).timestamp() + skew_seconds
        except ValueError:
            return True
