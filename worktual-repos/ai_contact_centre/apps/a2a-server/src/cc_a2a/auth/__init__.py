"""JWT/JWKS workload authentication and caller context."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from cc_a2a.config import A2ASettings

logger = logging.getLogger("a2a.auth")

# Hub tokens without a specific tenant use this marker (all CC organizations).
HUB_ALL_TENANTS_ID = "*"


class AuthError(Exception):
    def __init__(self, message: str, *, status_code: int = 401) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class CallerContext:
    subject: str
    client_id: str
    organization_ids: frozenset[str]
    scopes: frozenset[str]
    execution_profile: str
    token_claims: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def service_actor(self) -> str:
        return f"hub:{self.client_id}"


_jwks_clients: dict[str, PyJWKClient] = {}


def _jwks_client(url: str) -> PyJWKClient:
    client = _jwks_clients.get(url)
    if client is None:
        client = PyJWKClient(url, cache_keys=True, lifespan=3600)
        _jwks_clients[url] = client
    return client


def _claim_list(claims: dict[str, Any], *keys: str) -> list[str]:
    for key in keys:
        value = claims.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            return [item.strip() for item in value.replace(",", " ").split() if item.strip()]
        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]
    return []


def parse_bearer(authorization: str | None) -> str:
    if not authorization:
        raise AuthError("Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise AuthError("Authorization must be Bearer <token>")
    return parts[1].strip()


def authenticate_request(
    settings: A2ASettings,
    *,
    authorization: str | None,
    tenant_header: str | None = None,
    client_header: str | None = None,
) -> CallerContext:
    token = parse_bearer(authorization)

    if settings.a2a_allow_dev_auth and token in {"dev", "dev-token"}:
        tenant = (tenant_header or "").strip()
        client_id = (client_header or "dev-hub").strip() or "dev-hub"
        if not tenant:
            raise AuthError("Dev auth requires X-Tenant-Id")
        return CallerContext(
            subject=f"hub:{client_id}",
            client_id=client_id,
            organization_ids=frozenset({tenant}),
            scopes=frozenset({"*"}),
            execution_profile="hub-delegated",
            token_claims={"dev": True},
        )

    claims: dict[str, Any] | None = None

    # Prefer spoke-issued HS256 tokens from POST /oauth/token.
    if settings.a2a_token_signing_secret.strip():
        try:
            from cc_a2a.auth.oauth import decode_spoke_access_token

            claims = decode_spoke_access_token(settings, token)
        except Exception:  # noqa: BLE001 — fall through to JWKS / error
            claims = None

    if claims is None and settings.a2a_oauth_jwks_url and settings.a2a_oauth_issuer:
        try:
            signing_key = _jwks_client(settings.a2a_oauth_jwks_url).get_signing_key_from_jwt(
                token
            )
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=settings.a2a_oauth_audience,
                issuer=settings.a2a_oauth_issuer,
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as error:
            logger.info("A2A JWT validation failed: %s", type(error).__name__)
            raise AuthError("Invalid or expired access token") from error

    if claims is None:
        if settings.a2a_token_signing_secret.strip() or settings.a2a_oauth_jwks_url:
            raise AuthError("Invalid or expired access token")
        raise AuthError("A2A OAuth is not configured", status_code=503)

    client_id = str(claims.get("client_id") or claims.get("azp") or claims.get("sub"))
    orgs = _claim_list(claims, "organization_ids", "tenant_ids", "org_ids", "tenants")
    if not orgs and claims.get("organization_id"):
        orgs = [str(claims["organization_id"])]
    if not orgs and claims.get("tenant_id"):
        orgs = [str(claims["tenant_id"])]
    scopes = _claim_list(claims, "scope", "scopes", "scp")
    profile = str(claims.get("execution_profile") or "hub-delegated")
    if profile != "hub-delegated":
        raise AuthError("executionProfile must be hub-delegated", status_code=403)

    return CallerContext(
        subject=str(claims.get("sub") or f"hub:{client_id}"),
        client_id=client_id,
        organization_ids=frozenset(orgs),
        scopes=frozenset(scopes) if scopes else frozenset(),
        execution_profile=profile,
        token_claims=dict(claims),
    )


def caller_has_all_tenant_access(caller: CallerContext) -> bool:
    return HUB_ALL_TENANTS_ID in caller.organization_ids


def resolve_caller_organization_id(
    caller: CallerContext,
    *,
    organization_id: str | None = None,
    tenant_header: str | None = None,
) -> str:
    """Pick tenant for task APIs; wildcard tokens require an explicit org."""
    explicit = (organization_id or tenant_header or "").strip()
    if explicit:
        return explicit
    non_wildcard = [
        org_id for org_id in caller.organization_ids if org_id != HUB_ALL_TENANTS_ID
    ]
    if len(non_wildcard) == 1:
        return non_wildcard[0]
    return ""


def assert_tenant_access(caller: CallerContext, organization_id: str) -> None:
    if organization_id not in caller.organization_ids and not caller_has_all_tenant_access(
        caller
    ):
        logger.info(
            "A2A tenant access denied caller=%s tokenOrgs=%s envelopeOrg=%s",
            caller.client_id,
            sorted(caller.organization_ids),
            organization_id,
        )
        raise AuthError("organizationId is not authorized for this caller", status_code=403)


def has_scope(caller: CallerContext, scope: str) -> bool:
    if "*" in caller.scopes or "cc.*" in caller.scopes:
        return True
    if scope in caller.scopes:
        return True
    # Prefix grants: cc.contact.write covers itself; cc.contact.* covers family.
    parts = scope.rsplit(".", 1)
    if len(parts) == 2 and f"{parts[0]}.*" in caller.scopes:
        return True
    return False


class RateLimiter:
    """Simple in-memory per-client/tenant rate limiter."""

    def __init__(self) -> None:
        self._events: dict[str, list[float]] = {}

    def check(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        now = time.monotonic()
        bucket = [ts for ts in self._events.get(key, []) if now - ts < window_seconds]
        if len(bucket) >= limit:
            raise AuthError("Rate limit exceeded", status_code=429)
        bucket.append(now)
        self._events[key] = bucket


_rate_limiter = RateLimiter()


def enforce_rate_limit(settings: A2ASettings, caller: CallerContext, organization_id: str) -> None:
    key = f"{caller.client_id}:{organization_id}"
    _rate_limiter.check(key, settings.a2a_rate_limit_per_minute)


async def probe_jwks(settings: A2ASettings) -> bool:
    if not settings.a2a_oauth_jwks_url:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(settings.a2a_oauth_jwks_url)
            return response.status_code < 500
    except httpx.HTTPError:
        return False
