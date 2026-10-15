"""JWT and internal-service authentication with tenant rate limiting."""

import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import HTTPException
from jwt import InvalidTokenError, decode

from app.config import Settings, get_settings

_REQUESTS: dict[str, deque[float]] = defaultdict(deque)


@dataclass(frozen=True)
class AuthContext:
    tenant_id: str
    user_id: str = "system"
    role: str = "admin"
    authorization: str | None = None


def resolve_tenant_id(body_tenant: str | None, header_tenant: str | None) -> str:
    if body_tenant and header_tenant and body_tenant != header_tenant:
        raise HTTPException(status_code=403, detail="Tenant context mismatch")
    tenant_id = body_tenant or header_tenant
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Missing tenant context")
    return tenant_id


def enforce_internal_key(
    supplied_key: str | None,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    expected = settings.internal_service_key
    if not expected:
        if settings.internal_service_key_required and not settings.debug:
            raise HTTPException(
                status_code=503,
                detail="Internal service authentication unavailable",
            )
        return
    if supplied_key is None or not secrets.compare_digest(supplied_key, expected):
        raise HTTPException(status_code=401, detail="Invalid internal service key")


def enforce_rate_limit(
    tenant_id: str,
    route: str,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    limit = max(1, settings.internal_rate_limit_per_minute)
    now = time.monotonic()
    bucket = _REQUESTS[f"{tenant_id}:{route}"]
    while bucket and bucket[0] <= now - 60:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Tenant NLP rate limit exceeded")
    bucket.append(now)


def authenticate_internal(
    body_tenant: str | None,
    header_tenant: str | None,
    supplied_key: str | None,
    route: str,
    settings: Settings | None = None,
) -> AuthContext:
    settings = settings or get_settings()
    enforce_internal_key(supplied_key, settings)
    tenant_id = resolve_tenant_id(body_tenant, header_tenant)
    enforce_rate_limit(tenant_id, route, settings)
    return AuthContext(tenant_id=tenant_id)


def authenticate_jwt(
    authorization: str | None,
    header_tenant: str | None,
    *,
    body_tenant: str | None = None,
    body_user: str | None = None,
    body_role: str = "admin",
    settings: Settings | None = None,
) -> AuthContext:
    settings = settings or get_settings()
    if authorization and authorization.startswith("Bearer "):
        if not settings.jwt_secret:
            raise HTTPException(status_code=503, detail="JWT_SECRET is not configured")
        try:
            claims = decode(
                authorization.removeprefix("Bearer "),
                settings.jwt_secret,
                algorithms=["HS256"],
                audience=settings.jwt_audience,
                issuer=settings.jwt_issuer,
                options={
                    "verify_aud": bool(settings.jwt_audience),
                    "verify_iss": bool(settings.jwt_issuer),
                    "require": ["exp", "sub", "tenant_id", "role"],
                },
            )
            tenant_id = str(claims["tenant_id"])
            user_id = str(claims["sub"])
            role = str(claims["role"])
            if role not in {"admin", "agent"}:
                raise InvalidTokenError("Unsupported role")
            resolve_tenant_id(tenant_id, header_tenant)
            if body_tenant and body_tenant != tenant_id:
                raise HTTPException(status_code=403, detail="Tenant context mismatch")
            return AuthContext(tenant_id, user_id, role, authorization)
        except HTTPException:
            raise
        except (InvalidTokenError, KeyError) as error:
            raise HTTPException(status_code=401, detail="Invalid or expired token") from error
    if settings.debug and settings.nlp_allow_insecure_copilot_auth:
        tenant_id = resolve_tenant_id(body_tenant, header_tenant)
        return AuthContext(tenant_id, body_user or "system", body_role, authorization)
    raise HTTPException(status_code=401, detail="Missing bearer token")
