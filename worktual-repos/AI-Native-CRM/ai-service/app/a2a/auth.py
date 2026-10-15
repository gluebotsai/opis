"""Hub identity JWT and CRM-issued access tokens for A2A."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import jwt
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import get_settings


class AuthenticationError(Exception):
    pass


class SkillVersionStaleError(Exception):
    def __init__(self, current_version: str) -> None:
        self.current_version = current_version
        super().__init__(
            "Access token skillVersion is stale; call POST /token to re-issue"
        )


@dataclass(frozen=True)
class HubIdentity:
    subject: str
    client_id: str
    actor_id: str
    organization_id: str | None = None
    token_kind: str = "hub"
    skill_version: str | None = None
    skill_ids: tuple[str, ...] = field(default_factory=tuple)
    a2a_server_name: str | None = None


def _unauthorized(message: str, *, extra: dict | None = None) -> JSONResponse:
    content: dict = {"error": "unauthorized", "message": message}
    if extra:
        content.update(extra)
    return JSONResponse(
        status_code=401,
        content=content,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _identity_from_payload(payload: dict, *, token_kind: str) -> HubIdentity:
    subject = str(payload.get("sub") or "").strip()
    if not subject:
        raise AuthenticationError("Token missing sub")
    client_id = str(payload.get("client_id") or payload.get("clientId") or subject).strip()
    org = str(payload.get("organizationId") or payload.get("organization_id") or "").strip()
    skills_raw = payload.get("skills") or []
    skill_ids = tuple(str(item) for item in skills_raw if str(item).strip())
    version = str(payload.get("skillVersion") or "").strip() or None
    server = str(payload.get("a2a_server_name") or payload.get("a2aServerName") or "").strip() or None
    return HubIdentity(
        subject=subject,
        client_id=client_id,
        actor_id=f"hub:{client_id}",
        organization_id=org or None,
        token_kind=token_kind,
        skill_version=version,
        skill_ids=skill_ids,
        a2a_server_name=server,
    )


def verify_hub_token(token: str) -> HubIdentity:
    settings = get_settings()
    secret = settings.a2a_hub_jwt_secret.strip()
    if not secret:
        if settings.app_env.strip().lower() == "production":
            raise AuthenticationError("A2A Hub JWT is not configured")
        subject = token[:80] or "hub"
        return HubIdentity(
            subject=subject,
            client_id=subject,
            actor_id=f"hub:{subject}",
            token_kind="hub",
        )
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=settings.a2a_hub_jwt_audience,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise AuthenticationError("Invalid or expired Hub token") from exc
    issuer = str(payload.get("iss") or "")
    if issuer == settings.a2a_access_token_issuer:
        identity = _identity_from_payload(payload, token_kind="access")
        expected = (settings.a2a_server_name or "worktual-crm").strip() or "worktual-crm"
        if identity.a2a_server_name and identity.a2a_server_name != expected:
            raise AuthenticationError("Access token is for a different A2A spoke")
        return identity
    if issuer == settings.a2a_hub_jwt_issuer:
        return _identity_from_payload(payload, token_kind="hub")
    raise AuthenticationError("Unknown token issuer")


def authenticate_request(request: Request) -> HubIdentity:
    header = request.headers.get("Authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthenticationError("Missing Bearer token")
    return verify_hub_token(token.strip())


_PUBLIC_PATHS = frozenset(
    {
        "/health",
        "/token",
        "/oauth/token",
        "/.well-known/agent-card.json",
        "/.well-known/oauth-authorization-server",
    }
)
_SFT_CATALOG_PREFIX = "/internal/v1/agents"


def _is_public_path(path: str) -> bool:
    if path in _PUBLIC_PATHS:
        return True
    return path.startswith("/a2a/contracts/")


def _sft_internal_key_identity(request: Request) -> HubIdentity | None:
    if not request.url.path.startswith(_SFT_CATALOG_PREFIX):
        return None
    offered = (request.headers.get("x-internal-service-key") or "").strip()
    if not offered:
        return None
    settings = get_settings()
    expected = (settings.a2a_spoke_client_secret or "").strip()
    if not expected:
        return None
    from app.a2a.clients import secrets_equal

    if not secrets_equal(offered, expected):
        raise AuthenticationError("Invalid internal service key")
    client_id = (settings.a2a_spoke_client_id or "sft").strip() or "sft"
    return HubIdentity(
        subject=client_id,
        client_id=client_id,
        actor_id="sft:catalog",
        token_kind="internal",
    )


async def a2a_auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS" or _is_public_path(request.url.path):
        return await call_next(request)
    try:
        identity = _sft_internal_key_identity(request)
        if identity is None:
            identity = authenticate_request(request)
    except AuthenticationError as exc:
        if request.url.path not in _PUBLIC_PATHS and not request.url.path.startswith(
            "/a2a/contracts/"
        ):
            from app.a2a.log import log_a2a

            log_a2a(
                step="auth_denied",
                ok=False,
                hub={"path": request.url.path, "method": request.method},
                crm={"error": str(exc)},
            )
        return _unauthorized(str(exc))
    request.state.hub_identity = identity
    return await call_next(request)


def hub_identity_from_request(request: Request) -> Optional[HubIdentity]:
    return getattr(request.state, "hub_identity", None)


def require_fresh_access_skills(identity: HubIdentity | None) -> None:
    """Reject invoke when a CRM access token's catalog snapshot is stale."""
    if identity is None or identity.token_kind != "access":
        return
    from app.a2a.catalog import spoke_card_version

    current = spoke_card_version()
    if identity.skill_version and identity.skill_version != current:
        raise SkillVersionStaleError(current)
