"""Run LLM-written Cypher through cypher_guard and execute against Neo4j.

Enforces structural org isolation on the selected database, read-only guarantees,
and schema allowlists.
"""

from __future__ import annotations

from typing import Any

from .cypher_guard import CypherGuardError, guard_cypher
from .kg_client import execute_read, load_neo4j_settings, org_db_name


def run_cypher(
    cypher: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int] | None = None,
    params: dict[str, Any] | None = None,
    execute: bool = False,
    max_rows: int = 500,
) -> dict[str, Any]:
    """Validate and optionally execute Cypher on the tenant's Neo4j database."""
    queue_ids = list(queue_ids or [])
    try:
        guarded = guard_cypher(
            cypher,
            role=role,
            user_id=user_id,
            queue_ids=queue_ids,
            params=params,
            max_rows=max_rows,
        )
    except CypherGuardError as exc:
        msg = str(exc)
        low = msg.lower()
        if "not allowed" in low or "is a shared leaf" in low or "outside product" in low:
            error_type = "DENY"
        elif "label" in low or "relationship" in low or "property" in low or "hops" in low:
            error_type = "REPAIR"
        else:
            error_type = "REPLAN"
        return {
            "status": "error",
            "store": "kg",
            "error_type": error_type,
            "error": msg,
            "rows": [],
            "cypher": "",
        }

    out: dict[str, Any] = {
        "status": "compiled",
        "store": "kg",
        "cypher": guarded.cypher,
        "guard_notes": guarded.notes,
        "rows": [],
    }

    if execute:
        settings = load_neo4j_settings()
        if not (settings.get("uri") or "").strip():
            return {
                **out,
                "status": "error",
                "error_type": "REPLAN",
                "error": "NEO4J_URI not configured; Cypher compiled only.",
            }
        db_name = org_db_name(organization_id)
        from .errors import public_message

        try:
            out["rows"] = execute_read(guarded.cypher, guarded.params, db_name)
            out["status"] = "ok"
            out["database"] = db_name
        except Exception as exc:
            out["status"] = "error"
            out["error_type"] = "REPLAN"
            out["error"] = public_message(exc)
            out["database"] = db_name

    return out
