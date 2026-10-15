"""Resolve Campaign API Bearer for Hub skill execution.

Order:
1) Hub-provided campaignToken (optional)
2) A2A_CAMPAIGN_API_TOKEN env (optional static fallback)
3) Mint a short-lived Campaign SPA JWT for Hub organizationId
   (JWT_SECRET + ACCOUNT_DATABASE_URL — Hub does not need to send a token)
"""

from __future__ import annotations

import logging
import time
from typing import Any

import asyncpg
import jwt

from app.a2a.clients import _normalize_dsn  # noqa: PLC2701 — shared DSN helper
from app.a2a.payload import resolve_campaign_api_token as resolve_from_payload_or_env
from app.config import get_settings

_log = logging.getLogger(__name__)

# Cache minted tokens briefly so multi-skill pipelines reuse one JWT.
_mint_cache: dict[str, tuple[str, float]] = {}
_MINT_TTL_S = 50 * 60  # token exp 1h; refresh cache before that


async def resolve_campaign_api_bearer(flat: dict[str, Any]) -> str:
    """Return Bearer JWT for Campaign REST, or '' if none can be resolved."""
    existing = resolve_from_payload_or_env(flat)
    if existing:
        return existing

    organization_id = str(flat.get("organization_id") or "").strip()
    if not organization_id:
        return ""

    try:
        return await mint_campaign_spa_token_for_org(organization_id)
    except Exception as exc:  # noqa: BLE001
        _log.warning(
            "mint Campaign SPA token for org=%s failed: %s",
            organization_id,
            exc,
        )
        return ""


async def mint_campaign_spa_token_for_org(organization_id: str) -> str:
    """
    Mint Campaign SPA JWT for an active user in the Hub organization.

    Backend validateSession only needs `sub` (user id); other claims are informational.
    """
    org = str(organization_id or "").strip()
    if not org:
        raise ValueError("organization_id required to mint campaign token")

    now = time.time()
    cached = _mint_cache.get(org)
    if cached and cached[1] > now:
        return cached[0]

    s = get_settings()
    secret = str(s.jwt_secret or "").strip()
    if not secret:
        raise RuntimeError("JWT_SECRET is empty — cannot mint Campaign API token")
    if secret == "change-me-in-production-campaign":
        _log.warning(
            "JWT_SECRET is the placeholder default — minted tokens only work if "
            "backend uses the same value"
        )
    dsn = _normalize_dsn(str(s.account_database_url or "").strip())
    if not dsn:
        raise RuntimeError(
            "ACCOUNT_DATABASE_URL is empty — cannot resolve org user for Hub skills"
        )

    user = await _pick_org_user(dsn, org)
    if not user:
        raise RuntimeError(
            f"No active setup_users row for organization_id={org!r}"
        )

    payload = {
        "sub": str(user["id"]),
        "email": str(user.get("email") or "hub-a2a@worktual.local"),
        "role": str(user.get("role") or "user"),
        "organizationId": str(user.get("organization_id") or org),
        "branchId": str(user.get("branch_id") or org),
        "mode": "b2b",
        "industry": "generic-b2b",
        "iat": int(now),
        "exp": int(now) + 3600,
        "iss": "worktual-campaign-a2a-hub",
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    if isinstance(token, bytes):
        token = token.decode("utf-8")

    _mint_cache[org] = (token, now + _MINT_TTL_S)
    _log.info(
        "minted Campaign SPA JWT for Hub org=%s user=%s",
        org,
        user["id"],
    )
    return token


async def _pick_org_user(dsn: str, organization_id: str) -> dict[str, str] | None:
    """Prefer an admin with campaign product access; else any active user in org."""
    conn = await asyncpg.connect(dsn)
    try:
        row = await conn.fetchrow(
            """
            SELECT
              u.id::text AS id,
              u.work_email AS email,
              u.organization_id::text AS organization_id,
              COALESCE(
                (
                  SELECT r.name
                  FROM accounts.setup_user_product_access a
                  JOIN accounts.setup_roles r ON r.id = a.role_id
                  WHERE a.user_id = u.id
                    AND a.organization_id::text = u.organization_id::text
                  ORDER BY CASE WHEN lower(r.name) = 'admin' THEN 0 ELSE 1 END, r.name
                  LIMIT 1
                ),
                'user'
              ) AS role
            FROM accounts.setup_users u
            WHERE u.organization_id::text = $1::text
              AND lower(coalesce(u.status, '')) = 'active'
            ORDER BY
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM accounts.setup_user_product_access a
                  JOIN accounts.setup_roles r ON r.id = a.role_id
                  WHERE a.user_id = u.id
                    AND a.organization_id::text = u.organization_id::text
                    AND lower(r.name) = 'admin'
                ) THEN 0
                ELSE 1
              END,
              u.id
            LIMIT 1
            """,
            organization_id,
        )
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "email": str(row["email"] or ""),
            "organization_id": str(row["organization_id"] or organization_id),
            "role": str(row["role"] or "user"),
            "branch_id": organization_id,
        }
    finally:
        await conn.close()
