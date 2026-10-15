"""Resolve organization business_type from accounts.organizations."""

from __future__ import annotations

import logging
from typing import Any

from app.config import get_settings

log = logging.getLogger("ai-service.a2a.org")

_B2C_BLOCKED_SKILLS = frozenset(
    {
        "invoices",
        "quotes",
        "proposals",
        "deals",
        "invoice-escalation",
        "proposal-content",
        "audit-forecast",
    }
)


async def resolve_business_type(
    organization_id: str,
    fallback: str | None = None,
) -> str:
    hinted = (fallback or "").strip().lower()
    looked_up = await _lookup_business_type(organization_id)
    value = (looked_up or hinted or "b2b").strip().lower()
    if value not in {"b2b", "b2c", "b2b2c"}:
        return "b2b"
    return value


async def _lookup_business_type(organization_id: str) -> str | None:
    settings = get_settings()
    dsn = (settings.account_database_url or settings.database_url or "").strip()
    if not dsn:
        return None
    try:
        import asyncpg

        from app.mcp.db import _normalize_dsn

        clean, _search = _normalize_dsn(dsn)
        conn = await asyncpg.connect(clean)
        try:
            row: Any = await conn.fetchrow(
                """
                SELECT business_type
                FROM accounts.organizations
                WHERE id::text = $1
                LIMIT 1
                """,
                organization_id,
            )
        finally:
            await conn.close()
        if not row:
            return None
        raw = row["business_type"] if "business_type" in row else None
        return str(raw).strip().lower() if raw else None
    except Exception as exc:  # noqa: BLE001
        log.warning("business_type lookup failed for org %s: %s", organization_id, exc)
        return None


def assert_skill_allowed(skill_id: str, business_type: str) -> None:
    from app.a2a.errors import SpokeRejectError

    if business_type == "b2c" and skill_id in _B2C_BLOCKED_SKILLS:
        raise SpokeRejectError(
            f"Skill {skill_id} is not available for B2C organizations",
            code="b2c_finance",
        )
