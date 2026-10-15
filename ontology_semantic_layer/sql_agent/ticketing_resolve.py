"""Shared ticketing person-name resolve for SQL list and semantic templates.

Do not query ticketing.agents.name — that column does not exist.
Names live on ticket rows (assignee_name / resolver_name / created_by_name).
"""

from __future__ import annotations

from typing import Any

PERSON_NAME_COLUMNS = frozenset(
    {
        "assignee_name",
        "resolver_name",
        "created_by_name",
        "customer_name",
    }
)

_NAME_TO_ID = {
    "assignee_name": "assignee_id",
    "resolver_name": "resolver_id",
    "created_by_name": "created_by_id",
}

_SELF_NAME_TOKENS = frozenset(
    {
        "me",
        "admin",
        "caller",
        "current user",
        "signed-in user",
        "signed in user",
        "the current user",
        "the current signed-in user",
        "the current signed in user",
    }
)


def like_token(value: object) -> str:
    token = "".join(ch for ch in str(value).strip() if ch not in "%_")
    return token


def is_self_name_token(value: object) -> bool:
    return str(value or "").strip().lower() in _SELF_NAME_TOKENS


def lookup_person_matches(
    *,
    name_column: str,
    token: str,
    organization_id: int | None,
) -> list[dict[str, str]]:
    """Distinct people on tickets matching ILIKE %token%."""
    col = (name_column or "").strip().lower()
    id_col = _NAME_TO_ID.get(col)
    needle = like_token(token)
    if not needle or not id_col or organization_id is None:
        return []
    try:
        from sql_agent.db import run_postgres_query
    except Exception:
        return []
    sql = (
        f"SELECT DISTINCT {id_col}::text AS id, {col} AS name "
        f"FROM ticketing.tickets "
        f"WHERE organization_id = %s AND {col} ILIKE %s "
        f"AND {id_col} IS NOT NULL "
        f"ORDER BY 2 LIMIT 11"
    )
    try:
        rows = run_postgres_query(
            sql,
            [str(organization_id), f"%{needle}%"],
            schema="ticketing",
            table="tickets",
        )
    except Exception:
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in rows or []:
        pid = str(row.get("id") or "")
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append({"id": pid, "name": str(row.get("name") or "")})
    return out


def resolve_person_name_values(
    values: list[Any],
    *,
    name_column: str,
    organization_id: int | None,
) -> tuple[list[Any], str, str]:
    """Return (values, column, op). Prefer id when one person matches.

    0 matches → keep name column + ilike.
    2+ people → raise needs_clarification.
    """
    from sql_agent.errors import SqlAgentError

    col = (name_column or "").strip().lower()
    id_col = _NAME_TO_ID.get(col, col)
    resolved_ids: list[str] = []
    unresolved: list[str] = []
    for raw in values:
        s = str(raw).strip()
        if not s or is_self_name_token(s):
            continue
        if s.isdigit():
            resolved_ids.append(s)
            continue
        matches = lookup_person_matches(
            name_column=col,
            token=s,
            organization_id=organization_id,
        )
        if len(matches) == 0:
            unresolved.append(s)
            continue
        if len(matches) > 1:
            raise SqlAgentError(
                f"Multiple people match '{s}'. Specify which one.",
                code="needs_clarification",
                reason="person_ambiguous",
                missing=[s],
                candidates=[f"{m['id']}:{m['name']}" for m in matches[:10]],
            )
        resolved_ids.append(matches[0]["id"])
    if resolved_ids and not unresolved:
        return resolved_ids, id_col, "in" if len(resolved_ids) > 1 else "eq"
    return unresolved or [str(v) for v in values], col, "ilike"


def drop_self_name_filters(filters: list[Any]) -> list[Any]:
    """Drop created_by_name/assignee_name = me|admin from Gemma plans."""
    kept: list[Any] = []
    for flt in filters:
        if isinstance(flt, dict):
            col = str(flt.get("column") or flt.get("dimension") or "").strip().lower()
            vals = list(flt.get("values") or [])
            if not vals and flt.get("value") is not None:
                vals = [flt["value"]]
        else:
            col = str(getattr(flt, "column", "") or "").strip().lower()
            vals = list(getattr(flt, "values", None) or [])
        if col in PERSON_NAME_COLUMNS and vals and all(is_self_name_token(v) for v in vals):
            continue
        kept.append(flt)
    return kept
