"""Validate LLM-written Cypher and bind role scope parameters for Contact Center KG.

CRITICAL ARCHITECTURAL DECISION:
Org isolation is STRUCTURAL - the Neo4j client connects directly to the
org's dedicated database (e.g. org1000, org1012). LLM Cypher must NOT include
`organization_id` property filters. cypher_guard only injects role parameters
($user_id, $queue_ids) and enforces read-only safety, schema allowlists, and product fencing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .cypher_validate import (
    assert_allowlist,
    assert_product_fence,
    assert_read_only_cypher,
    cap_limit,
)

DEFAULT_ROW_CAP = 500


class CypherGuardError(ValueError):
    """Raised when Cypher violates safety, allowlist, or product fence rules."""


@dataclass
class GuardedCypher:
    cypher: str
    params: dict[str, Any]
    notes: list[str] = field(default_factory=list)


def guard_cypher(
    cypher: str,
    *,
    role: str,
    user_id: int,
    queue_ids: list[int] | None = None,
    params: dict[str, Any] | None = None,
    max_rows: int = DEFAULT_ROW_CAP,
) -> GuardedCypher:
    """Validate one LLM-written Cypher query and bind role scope parameters.

    Raises:
        CypherGuardError: If query is invalid, contains forbidden keywords,
                          violates allowlist/fence, or attempts mutations.
    """
    raw = (cypher or "").strip()
    if not raw:
        raise CypherGuardError("Cypher query is empty.")

    try:
        assert_read_only_cypher(raw)
        assert_allowlist(raw)
        assert_product_fence(raw)
    except ValueError as exc:
        raise CypherGuardError(str(exc)) from exc

    capped = cap_limit(raw, max_rows)
    notes: list[str] = []
    if capped != raw:
        notes.append(f"LIMIT capped to {max_rows}")

    bound: dict[str, Any] = dict(params or {})
    bound["user_id"] = int(user_id)
    bound["queue_ids"] = [int(q) for q in (queue_ids or [])]

    return GuardedCypher(cypher=capped, params=bound, notes=notes)
