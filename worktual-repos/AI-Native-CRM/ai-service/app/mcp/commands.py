"""Forward curated business mutations to Fastify command services."""

from __future__ import annotations

from typing import Any
import re
import secrets

import httpx

from app.config import get_settings
from app.mcp.context import get_ctx


async def forward_business_command(
    command: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    ctx = get_ctx()
    if not ctx.execution_token:
        raise PermissionError("MCP execution token required for business commands")
    base = get_settings().crm_api_base_url.strip().rstrip("/")
    if not base:
        raise RuntimeError("CRM_API_BASE_URL is not configured")
    trace_id = ctx.trace_id.lower()
    traceparent = (
        f"00-{trace_id}-{secrets.token_hex(8)}-01"
        if re.fullmatch(r"[0-9a-f]{32}", trace_id)
        else None
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{base}/api/internal/mcp/commands",
            headers={
                "Authorization": f"Bearer {ctx.execution_token}",
                "Content-Type": "application/json",
                **({"traceparent": traceparent} if traceparent else {}),
            },
            json={"command": command, "arguments": arguments},
        )
    data = response.json() if response.content else {}
    if response.status_code >= 400 or not isinstance(data, dict) or not data.get("ok"):
        error = data.get("error") if isinstance(data, dict) else None
        raise RuntimeError(str(error or f"CRM command failed ({response.status_code})"))
    return data.get("data") if isinstance(data.get("data"), dict) else {}
