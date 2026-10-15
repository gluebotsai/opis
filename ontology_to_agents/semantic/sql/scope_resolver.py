"""Resolve list-query scope (org vs assignee) from intent and policy."""

from __future__ import annotations

import re

from semantic.lookup import get_metric_policy

_ORG_INTENT = re.compile(
    r"\b(queue|org|organization|all open|open conversations? in|sla|breach)\b",
    re.I,
)
_ASSIGNEE_INTENT = re.compile(
    r"\b(my |mine|assigned to me|my conversations?|my tickets?)\b",
    re.I,
)

# Tables that are org-scoped for list queries regardless of row_scope_column
_ORG_LIST_TABLES = frozenset(
    {
        ("ccaas", "mart_conversation_sla_state"),
        ("ticketing", "mart_audit_events"),
    }
)


def resolve_list_scope(
    *,
    product: str,
    table: str,
    instruction: str,
    has_row_scope: bool,
    metric_hint: str | None = None,
    caller_role: str | None = None,
) -> str:
    """Return 'org' or 'assignee' for SQL list jobs."""
    if (product, table) in _ORG_LIST_TABLES:
        return "org"

    if metric_hint:
        pol = get_metric_policy(metric_hint, product=product)
        if (pol.get("scope") or "org").lower() == "org":
            return "org"

    text = instruction or ""
    if _ASSIGNEE_INTENT.search(text):
        return "assignee" if has_row_scope else "org"
    if _ORG_INTENT.search(text):
        return "org"

    # open conversation / queue depth snapshots are org-scoped per catalog rules
    lower = text.lower()
    if "open" in lower and "conversation" in lower:
        return "org"
    if "open" in lower and "ticket" in lower:
        return "org"
    if product == "ticketing" and table == "mart_tickets" and "list" in lower:
        return "org"

    role = (caller_role or "").strip().lower()
    if product == "ticketing" and role in ("admin", "viewer"):
        return "org"

    if has_row_scope:
        return "assignee"
    return "org"
