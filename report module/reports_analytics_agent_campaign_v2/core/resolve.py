"""Resolve campaign and contact names to ids. No CDP join to send facts."""

from __future__ import annotations

from typing import Any

from . import db as pg
from .errors import AmbiguousName, UnmatchedName


def resolve_campaign_name(
    dsn: str,
    *,
    organization_id: int,
    branch_id: int,
    user_id: int,
    role: str,
    mention: str,
) -> int:
    sql = """
        SELECT id, name AS label
        FROM campaign.campaigns
        WHERE organization_id = %(org)s
          AND branch_id = %(branch)s
          AND name ILIKE %(pat)s
    """
    params: dict[str, Any] = {
        "org": organization_id,
        "branch": branch_id,
        "pat": f"%{mention.strip()}%",
    }
    if role != "admin":
        sql += " AND created_by_user_id = %(user)s"
        params["user"] = user_id
    sql += " ORDER BY length(name) ASC, id ASC LIMIT 8"
    rows = pg.fetchall(dsn, sql, params)
    if not rows:
        raise UnmatchedName("campaign", mention)
    if len(rows) > 1 and rows[0]["label"].lower() != mention.strip().lower():
        raise AmbiguousName("campaign", mention, rows)
    return int(rows[0]["id"])
