"""Role scope clamp — agent/resolver cannot honor plan org scope."""

from __future__ import annotations

from typing import Any

_ORG_ROLES = frozenset({"admin", "viewer"})


def clamp_scope_mode(
    *,
    caller_role: str | None,
    requested: str | None,
    team_scope: bool = False,
) -> tuple[str | None, bool]:
    """Return (effective_scope_mode, clamped).

    Agents/resolvers requesting org are forced to assignee.
    """
    role = (caller_role or "agent").strip().lower()
    mode = (requested or "").strip().lower() or None
    if team_scope:
        return "team", False
    if role in _ORG_ROLES:
        return mode, False
    if mode == "org":
        return "assignee", True
    if mode is None:
        # Default for agents is assignee (resolver uses same for list)
        return "assignee", False
    return mode, False


def should_clamp_org(caller_role: str | None, scope_mode: str | None) -> bool:
    role = (caller_role or "agent").strip().lower()
    return role not in _ORG_ROLES and (scope_mode or "").lower() == "org"
