"""Name to id. Case-insensitive exact, then token AND ILIKE. Never filter SQL by raw name."""

from __future__ import annotations

from typing import Any, Callable

Fetch = Callable[[str, tuple[Any, ...]], list[dict[str, Any]]]

# Denormalized labels on ticketing.tickets (same as staging).
LOOKUPS = {
    "queue": ("ticketing.tickets", "queue_name", "queue_id"),
    "agent": ("ticketing.tickets", "assignee_name", "assignee_id"),
    "resolver": ("ticketing.tickets", "resolver_name", "resolver_id"),
    "customer": ("ticketing.tickets", "customer_name", "customer_id"),
    "created_by": ("ticketing.tickets", "created_by_name", "created_by_id"),
}

NAME_FIELDS = frozenset(LOOKUPS)
NAME_COLUMNS = {kind: spec[1] for kind, spec in LOOKUPS.items()}


def escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def escape_literal(text: str) -> str:
    return text.replace("'", "''")


def as_int_mention(mention: str) -> int | None:
    raw = mention.strip()
    if raw.isdigit():
        return int(raw)
    return None


def name_tokens(mention: str) -> list[str]:
    return [part for part in mention.strip().split() if part]


def like_tokens(mention: str) -> list[str]:
    return [part for part in name_tokens(mention) if len(part) >= 2]


class ResolveResult:
    def __init__(self, *, ids: list[int] | None, unmatched: str | None, ambiguous: list[dict[str, Any]] | None) -> None:
        self.ids = ids
        self.unmatched = unmatched
        self.ambiguous = ambiguous or []

    @property
    def ok(self) -> bool:
        return self.unmatched is None and not self.ambiguous and self.ids is not None


def _ids(rows: list[dict[str, Any]]) -> list[int]:
    seen: list[int] = []
    for row in rows:
        n = int(row["id"])
        if n not in seen:
            seen.append(n)
    return seen


def _labels(rows: list[dict[str, Any]]) -> set[str]:
    return {(str(row.get("label") or "")).strip().lower() for row in rows}


def decide_rows(mention: str, exact_rows: list[dict[str, Any]], like_rows: list[dict[str, Any]]) -> ResolveResult:
    if exact_rows:
        labels = _labels(exact_rows)
        if len(labels) <= 1:
            return ResolveResult(ids=_ids(exact_rows), unmatched=None, ambiguous=None)
        return ResolveResult(ids=None, unmatched=None, ambiguous=exact_rows)
    if like_rows:
        labels = _labels(like_rows)
        if len(labels) <= 1:
            return ResolveResult(ids=_ids(like_rows), unmatched=None, ambiguous=None)
        return ResolveResult(ids=None, unmatched=None, ambiguous=like_rows)
    return ResolveResult(ids=None, unmatched=mention, ambiguous=None)


def resolve_mention(
    kind: str,
    mention: str,
    organization_id: int,
    *,
    fetch: Fetch | None = None,
) -> ResolveResult:
    n = as_int_mention(mention)
    if n is not None:
        return ResolveResult(ids=[n], unmatched=None, ambiguous=None)
    if fetch is None:
        return ResolveResult(ids=None, unmatched=mention, ambiguous=None)
    if kind not in LOOKUPS:
        return ResolveResult(ids=None, unmatched=mention, ambiguous=None)
    table, col, id_col = LOOKUPS[kind]
    org = int(organization_id)
    exact_sql = (
        f"SELECT DISTINCT {id_col} AS id, {col} AS label FROM {table} "
        f"WHERE organization_id = %s AND {id_col} IS NOT NULL AND {col} ILIKE %s ESCAPE '\\'"
    )
    exact_rows = fetch(exact_sql, (org, mention.strip()))
    tokens = like_tokens(mention)
    if not tokens:
        return decide_rows(mention, exact_rows, [])
    like_clauses = " AND ".join(f"{col} ILIKE %s ESCAPE '\\'" for _ in tokens)
    like_sql = (
        f"SELECT DISTINCT {id_col} AS id, {col} AS label FROM {table} "
        f"WHERE organization_id = %s AND {id_col} IS NOT NULL AND {like_clauses}"
    )
    like_params: list[Any] = [org]
    like_params.extend(f"%{escape_like(tok)}%" for tok in tokens)
    like_rows = fetch(like_sql, tuple(like_params))
    return decide_rows(mention, exact_rows, like_rows)
