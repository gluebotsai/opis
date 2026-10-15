"""Resolve analytics scope from access.yml (role matrix + KPI allowlists)."""

from __future__ import annotations

from typing import Any

from app.agents.reports_b2b.core.loader import load_access, load_kpis
from app.agents.reports_b2b.identity import normalize_role


def default_scope_for_role(role: str) -> str:
    role = normalize_role(role)
    access = load_access()
    roles_cfg = access.get("roles") or {}
    role_cfg = roles_cfg.get(role) or roles_cfg.get("viewer") or {}
    return str(role_cfg.get("default_scope") or "own").lower()


def _matrix_decision(matrix: dict[str, Any], scope_level: str, role: str) -> str | None:
    row = matrix.get(scope_level)
    if not isinstance(row, dict):
        return None
    val = row.get(role)
    return str(val).lower() if val is not None else None


def resolve_scope_level(
    *,
    role: str,
    requested: str | None,
    kpi_id: str | None = None,
) -> tuple[str, dict[str, Any] | None]:
    """
    Return (effective_scope, error_payload).

    When the plan asks for org-wide scope but the role matrix denies org, clamp to
    the role default (usually own) instead of failing the turn.
    """
    role = normalize_role(role)
    access = load_access()
    matrix = access.get("matrix") or {}
    default = default_scope_for_role(role)
    scope = str(requested or default).lower().strip()
    if not scope:
        scope = default

    decision = _matrix_decision(matrix, scope, role)
    if decision == "deny":
        if scope == "org" and default != "org":
            scope = default
            decision = _matrix_decision(matrix, scope, role)
        else:
            return scope, {
                "status": "error",
                "store": "sql",
                "error_type": "ACCESS_DENIED",
                "error": (
                    f"Scope '{requested or scope}' is not available for your role. "
                    "Try asking about your own pipeline, deals, or activities."
                ),
                "rows": [],
            }

    if decision not in {None, "all"}:
        return scope, {
            "status": "error",
            "store": "sql",
            "error_type": "ACCESS_DENIED",
            "error": "This metric is not available for your role at that scope.",
            "rows": [],
        }

    if kpi_id:
        meta = load_kpis().get(kpi_id)
        if isinstance(meta, dict):
            allowed_raw = meta.get("allowed_scope_levels") or ["org", "own"]
            allowed = [str(item).lower() for item in allowed_raw]
            if scope not in allowed:
                scope = default if default in allowed else allowed[0]

    return scope, None


def normalize_task_scope(task: dict[str, Any], *, role: str) -> None:
    """Mutate task scope in place to match access.yml."""
    requested = str(task.get("scope") or "").strip() or None
    kpi = task.get("kpi")
    kpi_key = str(kpi).strip() if kpi else None
    scope, _err = resolve_scope_level(role=role, requested=requested, kpi_id=kpi_key)
    task["scope"] = scope
