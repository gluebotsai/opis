"""Mint MCP execution JWTs for Hub-originated coworker turns."""

from __future__ import annotations

import time
import uuid
from typing import Any

import jwt

from app.config import get_settings


def issue_hub_mcp_token(
    *,
    organization_id: str,
    actor_id: str,
    business_type: str,
    agent_name: str = "crm-agent",
    module: str = "contact",
    surface: str = "list",
    run_id: str | None = None,
    trace_id: str | None = None,
    idempotency_key: str | None = None,
    execution_mode: str = "native",
) -> str | None:
    settings = get_settings()
    secret = settings.mcp_execution_jwt_secret.strip()
    if not secret:
        return None
    now = int(time.time())
    ttl = max(15, min(120, int(settings.mcp_execution_jwt_ttl_seconds or 60)))
    payload: dict[str, Any] = {
        "iss": settings.mcp_execution_jwt_issuer,
        "aud": settings.mcp_execution_jwt_audience,
        "iat": now,
        "exp": now + ttl,
        "jti": str(uuid.uuid4()),
        "agentName": agent_name,
        "executionMode": execution_mode,
        "businessType": business_type,
        "module": module,
        "surface": surface,
        "policyVersion": settings.mcp_policy_version,
        "organizationId": organization_id,
        "actorId": actor_id,
        "role": "admin",
        "runId": run_id or str(uuid.uuid4()),
        "traceId": trace_id or str(uuid.uuid4()),
        "idempotencyKey": idempotency_key or str(uuid.uuid4()),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    return token if isinstance(token, str) else token.decode("utf-8")
