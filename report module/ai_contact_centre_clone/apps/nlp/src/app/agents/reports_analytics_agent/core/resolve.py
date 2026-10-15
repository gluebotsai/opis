"""Resolve agent / queue / team / customer names to the canonical label. Never invent ids."""

from __future__ import annotations

from typing import Any

from . import db as pg
from .errors import AmbiguousName, UnmatchedName


def _one(rows: list[dict[str, Any]], kind: str, mention: str) -> str:
    if not rows:
        raise UnmatchedName(kind, mention)
    exact = [r for r in rows if str(r.get("label") or "").lower() == mention.strip().lower()]
    if len(exact) == 1:
        return str(exact[0]["label"])
    if len(rows) > 1 and str(rows[0].get("label") or "").lower() != mention.strip().lower():
        raise AmbiguousName(kind, mention, rows)
    return str(rows[0]["label"])


def resolve_agent_name(dsn: str, *, organization_id: int, mention: str) -> str:
    rows = pg.fetchall(
        dsn,
        """
        SELECT display_name AS label
        FROM ccass.agents
        WHERE organization_id = %(org)s
          AND display_name ILIKE %(pat)s
        ORDER BY length(display_name) ASC, id ASC
        LIMIT 8
        """,
        {"org": organization_id, "pat": f"%{mention.strip()}%"},
    )
    return _one(rows, "agent", mention)


def resolve_queue_name(dsn: str, *, organization_id: int, mention: str) -> str:
    rows = pg.fetchall(
        dsn,
        """
        SELECT name AS label
        FROM ccass.queues
        WHERE organization_id = %(org)s
          AND name ILIKE %(pat)s
        ORDER BY length(name) ASC, id ASC
        LIMIT 8
        """,
        {"org": organization_id, "pat": f"%{mention.strip()}%"},
    )
    return _one(rows, "queue", mention)


def resolve_team_name(dsn: str, *, organization_id: int, mention: str) -> str:
    rows = pg.fetchall(
        dsn,
        """
        SELECT name AS label
        FROM accounts.setup_teams
        WHERE organization_id = %(org)s
          AND name ILIKE %(pat)s
        ORDER BY length(name) ASC, id ASC
        LIMIT 8
        """,
        {"org": organization_id, "pat": f"%{mention.strip()}%"},
    )
    return _one(rows, "team", mention)


def resolve_customer_name(dsn: str, *, organization_id: int, mention: str) -> str:
    rows = pg.fetchall(
        dsn,
        """
        SELECT trim(both from concat_ws(' ', first_name, last_name)) AS label
        FROM cdp.customer_profile
        WHERE organization_id = %(org)s
          AND trim(both from concat_ws(' ', first_name, last_name)) ILIKE %(pat)s
        ORDER BY length(trim(both from concat_ws(' ', first_name, last_name))) ASC
        LIMIT 8
        """,
        {"org": organization_id, "pat": f"%{mention.strip()}%"},
    )
    return _one(rows, "customer", mention)


def resolve_filter_names(
    dsn: str,
    *,
    organization_id: int,
    filters: dict[str, Any],
) -> dict[str, Any]:
    """Replace agent/queue/team mentions with canonical names. Customer stays a pattern."""
    out = dict(filters)
    if out.get("agent"):
        out["agent"] = resolve_agent_name(dsn, organization_id=organization_id, mention=str(out["agent"]))
    if out.get("queue"):
        out["queue"] = resolve_queue_name(dsn, organization_id=organization_id, mention=str(out["queue"]))
    if out.get("team"):
        out["team"] = resolve_team_name(dsn, organization_id=organization_id, mention=str(out["team"]))
    return out
