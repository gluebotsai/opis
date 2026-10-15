"""Role and scope. Identity comes only from trusted UI context. Deny is final."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class AccessDenied(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
        self.error_type = "DENY"


@dataclass
class Identity:
    organization_id: int
    user_id: int
    role: str
    queue_ids: list[int] = field(default_factory=list)
    scope_level: str = "org"


def normalize_role(role: str | None, access: dict[str, Any] | None = None) -> str:
    name = (role or "agent").strip().lower()
    roles = (access or {}).get("roles") or {}
    for rid, spec in roles.items():
        stored = [str(s).lower() for s in (spec.get("stored_names") or [])]
        if name == rid or name in stored:
            return str(rid)
    if name in {"admin", "administrator", "manager", "supervisor"}:
        return "admin"
    return "agent"


_SCOPE_ALIASES = {
    "org": "org",
    "organization": "org",
    "all": "org",
    "own": "own",
    "mine": "own",
    "my": "own",
    "queue": "queue",
    "queues": "queue",
}


def normalize_scope_level(raw: str | None, role: str, access: dict[str, Any] | None = None) -> str:
    key = str(raw or "").strip().lower().replace(" ", "_")
    if not key:
        roles = (access or {}).get("roles") or {}
        default = (roles.get(role) or {}).get("default_scope")
        key = str(default or ("org" if role == "admin" else "own"))
    return _SCOPE_ALIASES.get(key, "org" if role == "admin" else "own")


def assert_scope_allowed(role: str, scope_level: str, access: dict[str, Any]) -> None:
    matrix = access.get("matrix") or {}
    grant = (matrix.get(scope_level) or {}).get(role, "deny")
    if grant == "deny":
        raise AccessDenied(f"scope_denied: role '{role}' is denied scope '{scope_level}'.")
    if scope_level == "queue" and role == "agent":
        # Engine must bind UI queue_ids. Empty list is a deny, not org-wide.
        pass


def grant_for(role: str, scope_level: str, access: dict[str, Any]) -> str:
    matrix = access.get("matrix") or {}
    return str((matrix.get(scope_level) or {}).get(role, "deny"))
