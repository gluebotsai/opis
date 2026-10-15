"""Authentication and claim binding for the production MCP service."""

from __future__ import annotations

import hmac
from typing import Any, Optional

import jwt
from fastapi import Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import get_settings


class ExecutionClaims(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    issuer: str = Field(alias="iss")
    audience: str | list[str] = Field(alias="aud")
    expires_at: int = Field(alias="exp")
    issued_at: int = Field(alias="iat")
    jwt_id: str = Field(alias="jti", min_length=1)
    agent_name: str = Field(alias="agentName", min_length=1)
    execution_mode: str = Field(alias="executionMode", min_length=1)
    business_type: str = Field(alias="businessType", min_length=1)
    module: str = Field(min_length=1)
    surface: str = Field(min_length=1)
    policy_version: str = Field(alias="policyVersion", min_length=1)
    organization_id: str = Field(alias="organizationId", min_length=1)
    actor_id: str = Field(alias="actorId", min_length=1)
    role: str = Field(min_length=1)
    run_id: str = Field(alias="runId", min_length=1)
    trace_id: str = Field(alias="traceId", min_length=1)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=1)
    allowed_tools: Optional[list[str]] = Field(default=None, alias="allowedTools")


def _unauthorized(detail: str = "Unauthorized") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_execution_token(token: str) -> ExecutionClaims:
    settings = get_settings()
    secret = settings.mcp_execution_jwt_secret.strip()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MCP execution JWT is not configured",
        )
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=settings.mcp_execution_jwt_issuer,
            audience=settings.mcp_execution_jwt_audience,
            options={
                "require": [
                    "iss",
                    "aud",
                    "exp",
                    "iat",
                    "jti",
                    "agentName",
                    "executionMode",
                    "businessType",
                    "module",
                    "surface",
                    "policyVersion",
                    "organizationId",
                    "actorId",
                    "role",
                    "runId",
                    "traceId",
                    "idempotencyKey",
                ]
            },
        )
        claims = ExecutionClaims.model_validate(payload)
    except (jwt.PyJWTError, ValidationError) as exc:
        raise _unauthorized("Invalid or expired MCP execution token") from exc
    if claims.policy_version != settings.mcp_policy_version:
        raise _unauthorized("Unsupported MCP policy version")
    return claims


def authenticate_mcp_request(
    authorization: Optional[str] = Header(default=None),
    x_internal_secret: Optional[str] = Header(default=None),
) -> ExecutionClaims | None:
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise _unauthorized()
        return verify_execution_token(token.strip())

    settings = get_settings()
    legacy_allowed = (
        settings.mcp_allow_legacy_secret_auth
        and settings.app_env.strip().lower() in {"development", "test"}
    )
    if legacy_allowed:
        expected = settings.internal_secret
        if expected and hmac.compare_digest(x_internal_secret or "", expected):
            return None
    raise _unauthorized()


_CLAIM_CONTEXT_FIELDS = {
    "agentName": "agent_name",
    "executionMode": "execution_mode",
    "businessType": "business_type",
    "module": "module",
    "surface": "surface",
    "policyVersion": "policy_version",
    "organizationId": "organization_id",
    "actingUserId": "actor_id",
    "role": "role",
    "runId": "run_id",
    "traceId": "trace_id",
    "idempotencyKey": "idempotency_key",
}


def verify_context_matches_claims(
    context: dict[str, Any], claims: ExecutionClaims | None
) -> None:
    missing = [key for key in _CLAIM_CONTEXT_FIELDS if not str(context.get(key) or "").strip()]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing MCP execution context: {', '.join(missing)}",
        )
    if claims is None:
        return
    for body_key, claim_attr in _CLAIM_CONTEXT_FIELDS.items():
        if str(context.get(body_key)) != str(getattr(claims, claim_attr)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"MCP scope mismatch: {body_key}",
            )
