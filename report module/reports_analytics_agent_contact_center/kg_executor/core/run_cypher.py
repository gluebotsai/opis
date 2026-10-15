"""Run LLM-written Cypher through cypher_guard and execute against Neo4j for Contact Center.

Enforces structural org isolation on the selected database, read-only guarantees,
and schema allowlists. Supports certified KG templates from product/kg/templates.yml.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .cypher_guard import CypherGuardError, guard_cypher
from .kg_client import execute_read, load_neo4j_settings, org_db_name
from .paths import KG_DIR


def load_kg_templates() -> dict[str, Any]:
    path = KG_DIR / "templates.yml"
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    return data.get("templates", {})


def run_cypher(
    cypher: str = "",
    *,
    template_name: str | None = None,
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
    bound_params = dict(params or {})

    if template_name:
        templates = load_kg_templates()
        if template_name not in templates:
            return {
                "status": "error",
                "store": "kg",
                "error_type": "REPLAN",
                "error": f"Certified Cypher template '{template_name}' not found.",
                "rows": [],
                "cypher": "",
            }
        t_meta = templates[template_name]
        cypher = t_meta.get("cypher", "")

    raw_cypher = (cypher or "").strip()
    if not raw_cypher:
        return {
            "status": "error",
            "store": "kg",
            "error_type": "REPLAN",
            "error": "Cypher query is empty.",
            "rows": [],
            "cypher": "",
        }

    # Dynamic parameter binding from runtime arguments if not already specified in params
    if "$queue_id" in raw_cypher and "queue_id" not in bound_params:
        if queue_ids:
            bound_params["queue_id"] = queue_ids[0]
    if "$agent_id" in raw_cypher and "agent_id" not in bound_params:
        if user_id:
            bound_params["agent_id"] = user_id
    if "$contact_id" in raw_cypher and "contact_id" not in bound_params:
        if "contact_id" in bound_params:
            pass  # already bound if provided in params

    try:
        guarded = guard_cypher(
            raw_cypher,
            role=role,
            user_id=user_id,
            queue_ids=queue_ids,
            params=bound_params,
            max_rows=max_rows,
        )
    except CypherGuardError as exc:
        msg = str(exc)
        low = msg.lower()
        if "not allowed" in low or "is a shared leaf" in low or "outside product" in low or "forbidden" in low or "another product domain" in low:
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
    if template_name:
        out["template"] = template_name

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
        from reports_analytics_agent_contact_center.core.errors import public_message

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
