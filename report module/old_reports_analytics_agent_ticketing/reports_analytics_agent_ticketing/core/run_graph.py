"""Run a Domain graph frame. Compile always; Neo4j execute when URI is set."""

from __future__ import annotations

from typing import Any

from .cypher_compiler import compile_graph_frame
from .errors import AmbiguousName, UnmatchedName, public_message
from .kg_client import execute_read, load_neo4j_settings, org_db_name
from .prepare import prepare_frame
from .query_frame import Identity, QueryFrame, frame_from_dict
from .run_analytics import bind_names


def execute_graph(
    frame: QueryFrame | dict[str, Any],
    identity: Identity,
    *,
    fetch=None,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
    execute: bool = False,
) -> dict[str, Any]:
    if isinstance(frame, dict):
        frame = frame_from_dict(frame)
    frame = prepare_frame(frame)
    try:
        targets, bound_filters = bind_names(
            frame,
            identity,
            fetch=fetch,
            resolved_targets=resolved_targets,
            filter_ids=filter_ids,
        )
        return run_graph(
            frame,
            identity,
            resolved_targets=targets,
            filter_ids=bound_filters,
            execute=execute,
        )
    except (UnmatchedName, AmbiguousName):
        raise
    except Exception as exc:
        from .access import AccessDenied

        if isinstance(exc, AccessDenied):
            raise
        return {
            "status": "error",
            "store": "kg",
            "cypher": "",
            "params": {},
            "echo": "",
            "rows": [],
            "error": public_message(exc),
        }


def run_graph(
    frame: QueryFrame,
    identity: Identity,
    *,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
    execute: bool = False,
) -> dict[str, Any]:
    cypher, params, echo = compile_graph_frame(
        frame,
        identity,
        resolved_targets=resolved_targets,
        filter_ids=filter_ids,
    )
    out: dict[str, Any] = {
        "status": "compiled",
        "store": "kg",
        "cypher": cypher,
        "params": params,
        "echo": echo,
        "rows": [],
    }
    if not execute:
        return out
    settings = load_neo4j_settings()
    if not (settings.get("uri") or "").strip():
        out["error"] = "NEO4J_URI is not set; Cypher was compiled only"
        return out
    db_name = org_db_name(identity.organization_id)
    try:
        rows = execute_read(cypher, params, db_name)
    except Exception as exc:
        out["error"] = public_message(exc)
        out["database"] = db_name
        return out
    out["status"] = "ok"
    out["rows"] = rows
    out["database"] = db_name
    return out


__all__ = [
    "run_graph",
    "execute_graph",
    "compile_graph_frame",
    "UnmatchedName",
    "AmbiguousName",
]
