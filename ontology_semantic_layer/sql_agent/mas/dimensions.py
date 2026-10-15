"""Closed dimension map — unknown dimensions never guessed."""

from __future__ import annotations

# Synonym → canonical column on ticketing.tickets (and shared where noted)
TICKETING_DIMENSIONS: dict[str, str] = {
    "status": "status",
    "state": "status",
    "ticket_status": "status",
    "status_display_name": "status_display_name",
    "display_name": "status_display_name",
    "is_closed_by_status": "is_closed_by_status",
    "priority": "priority",
    "prio": "priority",
    "severity": "priority",
    "assignee": "assignee_id",
    "assignee_id": "assignee_id",
    "assignee_name": "assignee_name",
    "assignee_role": "assignee_role",
    "role": "assignee_role",
    "agent": "assignee_name",
    "owner": "assignee_name",
    "resolver": "resolver_id",
    "resolver_id": "resolver_id",
    "resolver_name": "resolver_name",
    "queue": "queue_name",
    "queue_name": "queue_name",
    "queue_id": "queue_id",
    "queue_type": "queue_type",
    "team": "queue_name",
    "channel": "channel",
    "customer": "customer_name",
    "customer_name": "customer_name",
    "customer_id": "customer_id",
    "customer_email": "customer_email",
    "email": "customer_email",
    "subject": "subject",
    "created_at": "created_at",
    "updated_at": "updated_at",
    "due_at": "due_at",
    "resolved_at": "resolved_at",
    "created_by": "created_by_id",
    "created_by_id": "created_by_id",
    "created_by_name": "created_by_name",
    "creator": "created_by_id",
    "category": "category",
    "skill": "skill",
    "account": "account_name",
    "account_name": "account_name",
    "organization": "organization_name",
    "organization_name": "organization_name",
    "organization_business_type": "organization_business_type",
    "business_type": "organization_business_type",
    "team_supports_ticketing": "team_supports_ticketing",
    "has_assignee": "has_assignee",
    "has_resolver": "has_resolver",
    "has_first_response": "has_first_response",
    "has_csat_rating": "has_csat_rating",
    "is_overdue": "is_overdue",
    "overdue": "is_overdue",
}

_STATUS_CANONICAL = {
    "open": "open",
    "pending": "pending",
    "resolved": "resolved",
    "closed": "closed",
    "overdue": "overdue",
    "reopened": "reopened",
    "on_hold": "on_hold",
    "onhold": "on_hold",
}

_PRIORITY_CANONICAL = {
    "p0": "urgent",
    "p1": "high",
    "p2": "medium",
    "p3": "low",
    "urgent": "urgent",
    "high": "high",
    "medium": "medium",
    "med": "medium",
    "low": "low",
    "critical": "urgent",
}


def resolve_dimension(raw: str, *, product: str = "ticketing") -> str | None:
    """Map synonym to canonical column; None if unknown (never guess)."""
    key = (raw or "").strip().lower().replace(" ", "_").replace("-", "_")
    if product in ("ticketing", "tk"):
        return TICKETING_DIMENSIONS.get(key)
    # Other products: identity only for now
    return key if key in TICKETING_DIMENSIONS.values() else None


def normalize_status(value: str) -> str:
    return _STATUS_CANONICAL.get(str(value).strip().lower(), str(value).strip())


def normalize_priority(value: str) -> str:
    return _PRIORITY_CANONICAL.get(str(value).strip().lower(), str(value).strip().lower())


def known_dimensions(*, product: str = "ticketing") -> frozenset[str]:
    if product in ("ticketing", "tk"):
        return frozenset(TICKETING_DIMENSIONS.keys())
    return frozenset()
