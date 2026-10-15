"""Postgres-backed memory adapters through trusted cc-core internal routes."""

from __future__ import annotations

import json
from typing import Any

from app.mcp.context import CcCoreHTTPAdapter
from app.schemas.copilot import ToolContext


class CcCoreAgentMemoryBackend:
    """Implements long-term and preference protocols with one scoped client."""

    def __init__(
        self,
        context: ToolContext,
        adapter: CcCoreHTTPAdapter | None = None,
    ) -> None:
        self.context = context
        self.adapter = adapter or CcCoreHTTPAdapter()

    def _assert_scope(self, tenant_id: str, user_id: str) -> None:
        if tenant_id != self.context.tenant_id or user_id != self.context.user_id:
            raise PermissionError("Agent memory scope does not match trusted context")

    async def _read(
        self,
        *,
        tenant_id: str,
        user_id: str,
        memory_type: str,
        conversation_id: str | None = None,
    ) -> list[dict[str, Any]]:
        self._assert_scope(tenant_id, user_id)
        params: dict[str, Any] = {
            "organizationId": tenant_id,
            "userId": user_id,
            "memoryType": memory_type,
        }
        if conversation_id:
            params["conversationId"] = conversation_id
        payload = await self.adapter.request(
            "GET",
            "/internal/v1/agent-memory",
            self.context,
            params=params,
            internal=True,
        )
        memories = payload.get("memories", []) if isinstance(payload, dict) else []
        return [item for item in memories if isinstance(item, dict)]

    async def store(
        self,
        *,
        tenant_id: str,
        user_id: str,
        conversation_id: str,
        item: dict[str, Any],
    ) -> str:
        self._assert_scope(tenant_id, user_id)
        payload = await self.adapter.request(
            "PUT",
            "/internal/v1/agent-memory",
            self.context,
            json_body={
                "organizationId": tenant_id,
                "userId": user_id,
                "conversationId": conversation_id,
                "memoryType": "long_term",
                "mode": "append",
                "content": {"items": [item]},
            },
            internal=True,
        )
        memory = payload.get("memory", {}) if isinstance(payload, dict) else {}
        return str(memory.get("id") or "")

    @staticmethod
    def _items(memories: list[dict[str, Any]]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for memory in memories:
            content = memory.get("content")
            values = content.get("items", []) if isinstance(content, dict) else []
            for value in values:
                if isinstance(value, dict):
                    items.append(value)
        return items

    async def search(
        self,
        *,
        tenant_id: str,
        user_id: str,
        query: str,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        memories = await self._read(
            tenant_id=tenant_id,
            user_id=user_id,
            memory_type="long_term",
        )
        terms = {term for term in query.casefold().split() if len(term) > 2}
        items = self._items(memories)
        scored = sorted(
            items,
            key=lambda item: sum(
                term in json.dumps(item, ensure_ascii=False).casefold()
                for term in terms
            ),
            reverse=True,
        )
        return scored[:limit]

    async def get_recent(
        self,
        *,
        tenant_id: str,
        user_id: str,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        memories = await self._read(
            tenant_id=tenant_id,
            user_id=user_id,
            memory_type="long_term",
        )
        return self._items(memories)[-limit:]

    async def get(self, *, tenant_id: str, user_id: str) -> dict[str, Any]:
        memories = await self._read(
            tenant_id=tenant_id,
            user_id=user_id,
            memory_type="preference_scratchpad",
        )
        if not memories:
            return {}
        content = memories[0].get("content")
        return dict(content) if isinstance(content, dict) else {}

    async def upsert(
        self,
        *,
        tenant_id: str,
        user_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        self._assert_scope(tenant_id, user_id)
        payload = await self.adapter.request(
            "PUT",
            "/internal/v1/agent-memory",
            self.context,
            json_body={
                "organizationId": tenant_id,
                "userId": user_id,
                "conversationId": None,
                "memoryType": "preference_scratchpad",
                "mode": "merge",
                "content": patch,
            },
            internal=True,
        )
        memory = payload.get("memory", {}) if isinstance(payload, dict) else {}
        content = memory.get("content")
        return dict(content) if isinstance(content, dict) else {}

