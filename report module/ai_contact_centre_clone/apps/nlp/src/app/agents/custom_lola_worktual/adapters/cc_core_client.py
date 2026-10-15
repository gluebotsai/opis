"""HTTP client for cc-core internal APIs."""

from __future__ import annotations

from typing import Any

from app.mcp.context import CcCoreHTTPAdapter
from app.schemas.copilot import ToolContext


def _context(organization_id: str) -> ToolContext:
    return ToolContext(tenant_id=organization_id, role="agent")


def get_cc_core_client() -> CcCoreHTTPAdapter:
    return CcCoreHTTPAdapter()


async def get_conversation_state(
    organization_id: str,
    conversation_id: str,
) -> dict[str, Any]:
    client = get_cc_core_client()
    result = await client.request(
        "GET",
        f"/internal/v1/conversations/{conversation_id}/state",
        _context(organization_id),
        internal=True,
    )
    return result if isinstance(result, dict) else {}


async def resolve_contact(
    organization_id: str,
    *,
    email: str | None = None,
    phone: str | None = None,
) -> dict[str, Any] | None:
    if not email and not phone:
        return None
    params: dict[str, str] = {}
    if email:
        params["email"] = email
    if phone:
        params["phone"] = phone
    client = get_cc_core_client()
    try:
        result = await client.request(
            "GET",
            "/internal/v1/contacts/resolve",
            _context(organization_id),
            params=params,
            internal=True,
        )
        return result if isinstance(result, dict) else None
    except Exception:
        return None


async def create_bot_callback(
    organization_id: str,
    conversation_id: str,
    *,
    summary: str,
    notes: str | None = None,
    preferred_time: str | None = None,
    assigned_user_id: str | None = None,
) -> dict[str, Any]:
    client = get_cc_core_client()
    body: dict[str, Any] = {"summary": summary}
    if notes:
        body["notes"] = notes
    if preferred_time:
        body["preferredTime"] = preferred_time
    if assigned_user_id:
        body["assignedUserId"] = assigned_user_id
    result = await client.request(
        "POST",
        f"/internal/v1/conversations/{conversation_id}/bot-callback",
        _context(organization_id),
        json_body=body,
        internal=True,
    )
    return result if isinstance(result, dict) else {}
