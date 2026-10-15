"""Resolve list-query scope (org vs assignee vs team) from role and plan hints."""

from __future__ import annotations

from typing import Any, Literal

from sql_agent.kpi_policy import get_metric_policy

_ORG_LIST_TABLES = frozenset(
    {
        ("ccaas", "mart_conversation_sla_state"),
        ("ticketing", "audit_events"),
        ("ticketing", "ticket_statuses"),
    }
)

_ORG_ROLES = frozenset({"admin", "viewer"})
ScopeMode = Literal["org", "assignee", "team", "created_by"]


def resolve_list_scope(
    *,
    product: str,
    table: str,
    instruction: str,
    has_row_scope: bool,
    metric_hint: str | None = None,
    caller_role: str | None = None,
    scope_mode: str | None = None,
    team_scope: bool = False,
) -> str:
    """Return 'org', 'assignee', 'team', or 'created_by' for SQL list/group jobs."""
    if scope_mode in ("org", "assignee", "team", "created_by"):
        return str(scope_mode)

    if (product, table) in _ORG_LIST_TABLES:
        return "org"

    if metric_hint:
        pol = get_metric_policy(metric_hint, product=product)
        if (pol.get("scope") or "org").lower() == "org":
            return "org"

    role = (caller_role or "agent").strip().lower()
    if product == "ticketing":
        if team_scope:
            return "team"
        if role in _ORG_ROLES:
            return "org"
        if has_row_scope:
            return "assignee"
        return "org"

    if has_row_scope:
        return "assignee"
    return "org"


def assert_ticketing_scope_allowed(
    scope: Any,
    *,
    filters: list[dict[str, Any]] | None,
    scope_mode: str,
    team_scope: bool = False,
) -> None:
    """Named-person filters: admin/viewer ok; agent/resolver only self or team."""
    from sql_agent.errors import SqlAgentError

    role = (getattr(scope, "role", None) or "agent").strip().lower()
    if role in _ORG_ROLES:
        return
    if team_scope and scope_mode == "team":
        return

    me = str(getattr(scope, "user_id", "") or "")
    person_cols = {
        "assignee_id",
        "resolver_id",
        "created_by_id",
        "assignee_name",
        "resolver_name",
    }
    for flt in filters or []:
        col = str(flt.get("column") or flt.get("dimension") or "").strip().lower()
        if col not in person_cols:
            continue
        vals = list(flt.get("values") or [])
        if not vals and flt.get("value") is not None:
            vals = [flt["value"]]
        if col.endswith("_id"):
            if any(str(v) != me for v in vals):
                raise SqlAgentError(
                    "Agent/resolver may only query their own tickets or team scope.",
                    code="scope_denied",
                )
        elif col.endswith("_name"):
            raise SqlAgentError(
                "Named staff filters require admin or viewer role.",
                code="scope_denied",
            )

    if scope_mode == "org":
        raise SqlAgentError(
            "Org-wide ticket queries require admin or viewer role.",
            code="scope_denied",
        )
