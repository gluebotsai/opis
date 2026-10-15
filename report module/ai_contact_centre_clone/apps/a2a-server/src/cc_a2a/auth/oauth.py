"""OAuth2 client-credentials + refresh-token endpoint for Hub workloads."""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from cc_a2a.auth import HUB_ALL_TENANTS_ID
from cc_a2a.catalog import scopes_for_skills
from cc_a2a.config import A2ASettings

logger = logging.getLogger("a2a.oauth")

DEFAULT_TOKEN_TTL_SECONDS = 3600
DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 3600  # 30 days


class TokenError(Exception):
    def __init__(self, error: str, description: str, *, status_code: int = 400) -> None:
        super().__init__(description)
        self.error = error
        self.description = description
        self.status_code = status_code


def _resolved_issuer(settings: A2ASettings) -> str:
    return (settings.a2a_oauth_issuer or settings.a2a_public_url).rstrip("/")


def _resolved_token_url(settings: A2ASettings) -> str:
    if settings.a2a_oauth_token_url:
        return settings.a2a_oauth_token_url.rstrip("/")
    return f"{settings.a2a_public_url.rstrip('/')}/oauth/token"


def _signing_secret(settings: A2ASettings) -> str:
    secret = (settings.a2a_token_signing_secret or "").strip()
    if not secret:
        raise TokenError(
            "server_error",
            "A2A_TOKEN_SIGNING_SECRET is not configured",
            status_code=503,
        )
    return secret


def _parse_basic_auth(authorization: str | None) -> tuple[str, str] | None:
    if not authorization or not authorization.lower().startswith("basic "):
        return None
    import base64

    try:
        decoded = base64.b64decode(authorization.split(" ", 1)[1]).decode("utf-8")
        client_id, client_secret = decoded.split(":", 1)
        return client_id, client_secret
    except Exception as error:  # noqa: BLE001
        raise TokenError("invalid_client", "Invalid Basic authorization") from error


def _authenticate_client(
    settings: A2ASettings,
    *,
    client_id: str | None,
    client_secret: str | None,
    authorization: str | None,
) -> str:
    basic = _parse_basic_auth(authorization)
    if basic:
        client_id, client_secret = basic
    if not client_id or not client_secret:
        raise TokenError(
            "invalid_client",
            "client_id and client_secret are required",
            status_code=401,
        )

    expected_id = settings.a2a_hub_client_id.strip()
    expected_secret = settings.a2a_hub_client_secret.strip()
    if not expected_id or not expected_secret:
        raise TokenError(
            "server_error",
            "Hub client credentials are not configured on the spoke",
            status_code=503,
        )
    if not (
        secrets.compare_digest(client_id, expected_id)
        and secrets.compare_digest(client_secret, expected_secret)
    ):
        raise TokenError("invalid_client", "Invalid client credentials", status_code=401)
    return client_id


def _resolve_hub_organization_ids(raw_organization_id: str) -> tuple[str, list[str]]:
    """Map token request org to JWT claims.

    Empty organization_id → cross-tenant Hub token (all organizations).
    Explicit id → single-tenant token (backward compatible).
    """
    organization_id = raw_organization_id.strip()
    if not organization_id or organization_id == HUB_ALL_TENANTS_ID:
        return HUB_ALL_TENANTS_ID, [HUB_ALL_TENANTS_ID]
    return organization_id, [organization_id]


def _normalize_scopes(requested: str | None) -> str:
    available = scopes_for_skills()
    if not requested or not requested.strip():
        return " ".join(sorted(available))
    requested_scopes = [item for item in requested.replace(",", " ").split() if item]
    unknown = [scope for scope in requested_scopes if scope not in available and scope != "*"]
    if unknown:
        raise TokenError("invalid_scope", f"Unsupported scopes: {', '.join(unknown)}")
    return " ".join(requested_scopes)


def _mint_pair(
    settings: A2ASettings,
    *,
    client_id: str,
    organization_id: str,
    organization_ids: list[str],
    scopes: str,
    access_ttl: int,
    refresh_ttl: int,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    access_expires_at = now + timedelta(seconds=access_ttl)
    refresh_expires_at = now + timedelta(seconds=refresh_ttl)
    access_jti = uuid.uuid4().hex
    refresh_jti = uuid.uuid4().hex
    subject = f"hub:{client_id}"
    issuer = _resolved_issuer(settings)
    secret = _signing_secret(settings)
    skill_version = settings.a2a_catalog_skill_version or settings.a2a_catalog_version

    access_claims = {
        "iss": issuer,
        "sub": subject,
        "aud": settings.a2a_oauth_audience,
        "iat": int(now.timestamp()),
        "exp": int(access_expires_at.timestamp()),
        "jti": access_jti,
        "client_id": client_id,
        "organization_id": organization_id,
        "organization_ids": organization_ids,
        "scope": scopes,
        "execution_profile": "hub-delegated",
        "token_use": "access",
        "skill_version": skill_version,
    }
    refresh_claims = {
        "iss": issuer,
        "sub": subject,
        "aud": settings.a2a_oauth_audience,
        "iat": int(now.timestamp()),
        "exp": int(refresh_expires_at.timestamp()),
        "jti": refresh_jti,
        "client_id": client_id,
        "organization_id": organization_id,
        "organization_ids": organization_ids,
        "scope": scopes,
        "execution_profile": "hub-delegated",
        "token_use": "refresh",
        "skill_version": skill_version,
    }
    access_token = jwt.encode(access_claims, secret, algorithm="HS256")
    refresh_token = jwt.encode(refresh_claims, secret, algorithm="HS256")

    logger.info(
        "Issued A2A access+refresh tokens",
        extra={
            "audit": {
                "event": "a2a_oauth_token_issued",
                "clientId": client_id,
                "organizationId": organization_id,
                "accessJti": access_jti,
                "refreshJti": refresh_jti,
                "accessExpiresAt": access_expires_at.isoformat(),
                "refreshExpiresAt": refresh_expires_at.isoformat(),
                "skillVersion": skill_version,
                "scopeCount": len(scopes.split()),
                "accessFingerprint": hashlib.sha256(access_token.encode()).hexdigest()[:12],
            }
        },
    )

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "expires_in": access_ttl,
        "refresh_expires_in": refresh_ttl,
        "scope": scopes,
        "organization_id": organization_id,
        "skill_version": skill_version,
        "access_expires_at": access_expires_at,
        "refresh_expires_at": refresh_expires_at,
    }


async def issue_token_response(
    settings: A2ASettings,
    *,
    form: dict[str, Any],
    authorization: str | None,
) -> dict[str, Any]:
    grant_type = str(form.get("grant_type") or "").strip()
    access_ttl = int(
        form.get("expires_in")
        or settings.a2a_token_ttl_seconds
        or DEFAULT_TOKEN_TTL_SECONDS
    )
    access_ttl = max(60, min(access_ttl, 86_400))
    refresh_ttl = int(settings.a2a_refresh_ttl_seconds or DEFAULT_REFRESH_TTL_SECONDS)
    refresh_ttl = max(access_ttl, min(refresh_ttl, 90 * 24 * 3600))

    if grant_type == "client_credentials":
        client_id = _authenticate_client(
            settings,
            client_id=(str(form["client_id"]) if form.get("client_id") is not None else None),
            client_secret=(
                str(form["client_secret"]) if form.get("client_secret") is not None else None
            ),
            authorization=authorization,
        )
        raw_organization_id = str(
            form.get("organization_id")
            or form.get("organizationId")
            or form.get("tenant_id")
            or form.get("tenantId")
            or ""
        ).strip()
        organization_id, organization_ids = _resolve_hub_organization_ids(raw_organization_id)
        scopes = _normalize_scopes(str(form.get("scope") or "") or None)
        minted = _mint_pair(
            settings,
            client_id=client_id,
            organization_id=organization_id,
            organization_ids=organization_ids,
            scopes=scopes,
            access_ttl=access_ttl,
            refresh_ttl=refresh_ttl,
        )
    elif grant_type == "refresh_token":
        refresh_token = str(form.get("refresh_token") or "").strip()
        if not refresh_token:
            raise TokenError("invalid_request", "refresh_token is required")
        client_id = _authenticate_client(
            settings,
            client_id=(str(form["client_id"]) if form.get("client_id") is not None else None),
            client_secret=(
                str(form["client_secret"]) if form.get("client_secret") is not None else None
            ),
            authorization=authorization,
        )
        try:
            claims = jwt.decode(
                refresh_token,
                _signing_secret(settings),
                algorithms=["HS256"],
                audience=settings.a2a_oauth_audience,
                issuer=_resolved_issuer(settings),
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as error:
            raise TokenError(
                "invalid_grant",
                "Invalid or expired refresh token",
                status_code=400,
            ) from error
        if claims.get("token_use") != "refresh":
            raise TokenError("invalid_grant", "Token is not a refresh token")
        if str(claims.get("client_id") or "") != client_id:
            raise TokenError("invalid_grant", "refresh_token client mismatch", status_code=400)
        raw_organization_id = str(
            form.get("organization_id")
            or form.get("organizationId")
            or form.get("tenant_id")
            or form.get("tenantId")
            or ""
        ).strip()
        if raw_organization_id:
            organization_id, organization_ids = _resolve_hub_organization_ids(
                raw_organization_id
            )
        else:
            organization_id = str(claims.get("organization_id") or "").strip()
            if not organization_id:
                raise TokenError("invalid_grant", "refresh token missing organization_id")
            raw_org_ids = claims.get("organization_ids")
            if isinstance(raw_org_ids, list):
                organization_ids = [
                    str(item).strip() for item in raw_org_ids if str(item).strip()
                ]
            else:
                organization_ids = []
            if not organization_ids:
                organization_ids = [organization_id]
        scopes = _normalize_scopes(str(form.get("scope") or claims.get("scope") or "") or None)
        minted = _mint_pair(
            settings,
            client_id=client_id,
            organization_id=organization_id,
            organization_ids=organization_ids,
            scopes=scopes,
            access_ttl=access_ttl,
            refresh_ttl=refresh_ttl,
        )
    else:
        raise TokenError(
            "unsupported_grant_type",
            "Supported grant_types: client_credentials, refresh_token",
        )

    # Public OAuth response (Hub persists into accounts.a2a_spoke_clients).
    return {
        "access_token": minted["access_token"],
        "refresh_token": minted["refresh_token"],
        "token_type": "Bearer",
        "expires_in": minted["expires_in"],
        "refresh_expires_in": minted["refresh_expires_in"],
        "scope": minted["scope"],
        "organization_id": minted["organization_id"],
        "skill_version": minted["skill_version"],
    }


# Back-compat alias used by older imports/tests.
async def issue_client_credentials_token(
    settings: A2ASettings,
    *,
    form: dict[str, Any],
    authorization: str | None,
) -> dict[str, Any]:
    return await issue_token_response(settings, form=form, authorization=authorization)


def decode_spoke_access_token(settings: A2ASettings, token: str) -> dict[str, Any]:
    """Validate a spoke-issued HS256 access token."""
    claims = jwt.decode(
        token,
        _signing_secret(settings),
        algorithms=["HS256"],
        audience=settings.a2a_oauth_audience,
        issuer=_resolved_issuer(settings),
        options={"require": ["exp", "iat", "sub"]},
    )
    if claims.get("token_use") not in {None, "access"}:
        raise jwt.InvalidTokenError("Not an access token")
    return claims


def token_endpoint_metadata(settings: A2ASettings) -> dict[str, Any]:
    return {
        "issuer": _resolved_issuer(settings),
        "token_endpoint": _resolved_token_url(settings),
        "grant_types_supported": ["client_credentials", "refresh_token"],
        "token_endpoint_auth_methods_supported": [
            "client_secret_post",
            "client_secret_basic",
        ],
        "scopes_supported": sorted(scopes_for_skills()),
        "response_types_supported": ["token"],
    }
