"""Role and scope. Identity comes only from trusted context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass
class Identity:
    organization_id: int
    user_id: int
    branch_id: int
    role: Literal["admin", "operator"]


class AccessDenied(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def normalize_role(role: str | None) -> str:
    """Campaign only inspects whether the Accounts role name is admin."""
    name = (role or "user").strip().lower()
    return "admin" if name == "admin" else "operator"


_SCOPE_ALIASES = {
    "org": "org",
    "organization": "org",
    "branch": "org",
    "workspace": "org",
    "all": "org",
    "all_branch": "org",
    "org_wide": "org",
    "org-wide": "org",
    "branch-wide": "org",
    "branch_wide": "org",
    "mine": "mine",
    "my": "mine",
    "own": "own",
    "created_by_me": "created_by_me",
    "created-by-me": "created_by_me",
}


def normalize_scope_level(raw: str | None, role: str) -> str:
    """Map LLM scope words onto access.yml levels. Operators are always mine."""
    if role != "admin":
        return "mine"
    key = str(raw or "org").strip().lower().replace(" ", "_")
    return _SCOPE_ALIASES.get(key, "org")
