"""Permission-scoped user preference memory and hard-rule verification."""

from __future__ import annotations

import re
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

from app.mcp.context import CcCoreHTTPAdapter, get_tool_context
from app.memory.cc_core import CcCoreAgentMemoryBackend

_PREFERENCE_KEY = re.compile(r"^[a-z][a-z0-9_]{1,63}$")


class PreferencesMCPServer:
    def __init__(self) -> None:
        self.mcp = FastMCP("preferences")
        self._register_tools()

    def _backend(self) -> CcCoreAgentMemoryBackend:
        return CcCoreAgentMemoryBackend(get_tool_context(), CcCoreHTTPAdapter())

    @staticmethod
    def _user_id() -> str:
        user_id = get_tool_context().user_id
        if not user_id:
            raise PermissionError("Preference memory requires an authenticated user")
        return user_id

    def _register_tools(self) -> None:
        @self.mcp.tool(
            name="get_user_preferences",
            description="Read the current user's scoped soft and hard preferences.",
        )
        async def get_user_preferences() -> dict[str, Any]:
            return await self.get_user_preferences()

        @self.mcp.tool(
            name="update_user_preference",
            description=(
                "Store one explicit user preference. Hard preferences are later "
                "enforced by verify_hard_preferences."
            ),
        )
        async def update_user_preference(
            key: str,
            value: str | bool | int | float | list[str],
            kind: Literal["soft", "hard"] = "soft",
        ) -> dict[str, Any]:
            return await self.update_user_preference(key, value, kind)

        @self.mcp.tool(
            name="verify_hard_preferences",
            description=(
                "Deterministically verify an intended action against the user's "
                "hard blocked actions/channels and confirmation requirements."
            ),
        )
        async def verify_hard_preferences(
            action_type: str,
            channel: str | None = None,
        ) -> dict[str, Any]:
            return await self.verify_hard_preferences(action_type, channel)

    @property
    def tool_names(self) -> tuple[str, ...]:
        return (
            "get_user_preferences",
            "update_user_preference",
            "verify_hard_preferences",
        )

    async def get_user_preferences(self) -> dict[str, Any]:
        context = get_tool_context()
        preferences = await self._backend().get(
            tenant_id=context.tenant_id,
            user_id=self._user_id(),
        )
        return {
            "soft": preferences.get("soft", {}),
            "hard": preferences.get("hard", {}),
        }

    async def update_user_preference(
        self,
        key: str,
        value: str | bool | int | float | list[str],
        kind: Literal["soft", "hard"] = "soft",
    ) -> dict[str, Any]:
        if not _PREFERENCE_KEY.fullmatch(key):
            return {"error": "Preference key must use lowercase snake_case"}
        if len(str(value)) > 2000:
            return {"error": "Preference value is too large"}
        context = get_tool_context()
        current = await self.get_user_preferences()
        section = dict(current.get(kind) or {})
        section[key] = value
        current[kind] = section
        saved = await self._backend().upsert(
            tenant_id=context.tenant_id,
            user_id=self._user_id(),
            patch=current,
        )
        return {"status": "updated", "preferences": saved}

    async def verify_hard_preferences(
        self,
        action_type: str,
        channel: str | None = None,
    ) -> dict[str, Any]:
        preferences = await self.get_user_preferences()
        hard = preferences.get("hard")
        hard = hard if isinstance(hard, dict) else {}
        blocked_actions = {str(value) for value in hard.get("blocked_actions", [])}
        blocked_channels = {str(value) for value in hard.get("blocked_channels", [])}
        confirmation_actions = {
            str(value) for value in hard.get("require_confirmation_actions", [])
        }
        if action_type in blocked_actions:
            return {
                "allowed": False,
                "reason": f"Action '{action_type}' is blocked by a hard preference.",
            }
        if channel and channel in blocked_channels:
            return {
                "allowed": False,
                "reason": f"Channel '{channel}' is blocked by a hard preference.",
            }
        return {
            "allowed": True,
            "requiresConfirmation": action_type in confirmation_actions,
            "verifiedRules": sorted(hard),
        }

