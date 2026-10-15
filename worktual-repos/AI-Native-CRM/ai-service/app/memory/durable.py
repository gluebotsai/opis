"""Authenticated Fastify durable-memory client with explicit slot allowlists."""

from __future__ import annotations

from typing import Any, Mapping, Optional

import httpx

ALLOWED_DURABLE_SLOTS = frozenset(
    {"prefs", "last_intent", "open_ask", "entity_hint", "tone", "follow_up", "note"}
)
ALLOWED_SCOPES = frozenset({"org", "user", "contact", "deal"})


class DurableMemoryClient:
    def __init__(
        self,
        *,
        base_url: str,
        execution_token: str,
        timeout_seconds: float = 8.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.url = base_url.rstrip("/") + "/api/internal/mcp/agent-memory"
        self.execution_token = execution_token.strip()
        self.timeout_seconds = timeout_seconds
        self.transport = transport

    def _headers(self) -> dict[str, str]:
        if not self.execution_token:
            raise ValueError("An authenticated MCP execution token is required")
        return {"Authorization": f"Bearer {self.execution_token}"}

    @staticmethod
    def validate_write(write: Mapping[str, Any]) -> dict[str, Any]:
        scope_type = str(write.get("scopeType") or "user").strip()
        slot_key = str(write.get("slotKey") or "").strip()
        if scope_type not in ALLOWED_SCOPES:
            raise ValueError("Unsupported durable memory scope")
        if slot_key not in ALLOWED_DURABLE_SLOTS:
            raise ValueError("Unsupported durable memory slot")
        expires = write.get("expiresInSeconds")
        if expires is not None and (
            isinstance(expires, bool)
            or not isinstance(expires, int)
            or expires < 60
            or expires > 31_536_000
        ):
            raise ValueError("expiresInSeconds must be between 60 and 31536000")
        return {
            "scopeType": scope_type,
            "scopeId": str(write.get("scopeId") or "").strip(),
            "slotKey": slot_key,
            "slotValue": write.get("slotValue"),
            "clear": write.get("clear") is True,
            **({"expiresInSeconds": expires} if expires is not None else {}),
        }

    async def list(self, *, contact_id: str = "", deal_id: str = "") -> dict[str, Any]:
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds, transport=self.transport
        ) as client:
            response = await client.get(
                self.url,
                params={"contactId": contact_id, "dealId": deal_id},
                headers=self._headers(),
            )
        response.raise_for_status()
        return response.json()

    async def write(self, value: Mapping[str, Any]) -> dict[str, Any]:
        body = self.validate_write(value)
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds, transport=self.transport
        ) as client:
            response = await client.post(self.url, json=body, headers=self._headers())
        response.raise_for_status()
        return response.json()

    async def forget(
        self, *, scope_type: str, scope_id: str, slot_key: str
    ) -> dict[str, Any]:
        body = self.validate_write(
            {
                "scopeType": scope_type,
                "scopeId": scope_id,
                "slotKey": slot_key,
                "clear": True,
            }
        )
        async with httpx.AsyncClient(
            timeout=self.timeout_seconds, transport=self.transport
        ) as client:
            response = await client.request(
                "DELETE", self.url, json=body, headers=self._headers()
            )
        response.raise_for_status()
        return response.json()

