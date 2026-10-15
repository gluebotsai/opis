"""Role and scope. Never trust names from the user for access.

V2 note: `Identity` and `AccessDenied` are the live exports used by run_kpi, run_sql,
run_cypher and validate. `apply_scope` is retained for reference but is no longer called
by the V2 execution path (which builds scope_sql directly in run_kpi.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol


class _FrameLike(Protocol):
    """Minimal interface of a frame object (V1 QueryFrame compat)."""

    @property
    def scope(self) -> Any: ...


@dataclass
class Identity:
    organization_id: int
    user_id: int
    role: Literal["admin", "agent", "resolver"]
    my_queue_ids: list[int] = field(default_factory=list)


class AccessDenied(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def apply_scope(
    frame: Any,
    identity: Identity,
    access: dict[str, Any],
    *,
    kpi_id: str | None,
    target_ids: list[int] | None,
) -> dict[str, Any]:
    """Compute scope row-filter info from a frame and identity.

    Retained for backward compatibility. V2 callers build scope_sql directly.
    """
    role = identity.role
    level = frame.scope.level
    matrix = access["matrix"]
    if level not in matrix:
        raise AccessDenied(f"Unknown scope level {level}")
    grant = matrix[level].get(role, "deny")
    if grant == "deny":
        raise AccessDenied(f"Your role cannot use {level} scope.")

    if grant == "ticket_count_in_my_queues":
        if kpi_id != "ticket_count":
            raise AccessDenied(
                "For your queue or other resolvers in your queue, only ticket count is allowed."
            )
        return _queue_limited(identity, target_ids, level)

    if grant == "all_in_my_queues":
        return _queue_limited(identity, target_ids, level)

    if level == "own":
        col = access["roles"][role]["my_tickets_column"]
        return {"column": col, "ids": [identity.user_id]}

    if level == "created_by_me":
        col = access["roles"][role].get("created_by_me_column")
        if not col:
            raise AccessDenied("Created-by-me is not used for this role.")
        return {"column": col, "ids": [identity.user_id]}

    if level == "org":
        return {"column": None, "ids": None}

    if level in {"queue", "agent", "resolver"}:
        if role != "admin":
            raise AccessDenied(f"Your role cannot use {level} scope.")
        col = {"queue": "queue_id", "agent": "assignee_id", "resolver": "resolver_id"}[level]
        return {"column": col, "ids": target_ids}

    raise AccessDenied(f"Unhandled scope {level}")


def _queue_limited(identity: Identity, target_ids: list[int] | None, level: str) -> dict[str, Any]:
    allowed = set(identity.my_queue_ids)
    if not allowed:
        raise AccessDenied("You have no queues in context.")
    if level == "queue":
        ids = set(target_ids or allowed)
        if not ids.issubset(allowed):
            raise AccessDenied("That queue is not in your set.")
        return {"column": "queue_id", "ids": list(ids)}
    if level == "resolver":
        return {"column": "resolver_id", "ids": target_ids, "queue_ids": list(allowed)}
    return {"column": "queue_id", "ids": list(allowed)}

