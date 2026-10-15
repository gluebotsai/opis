"""Request/response shapes for triage-assign (matches Express enrich JSON)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Priority = Literal["low", "medium", "high", "urgent"]
CreatedByRole = Literal["customer", "admin", "agent"]


class TriageAssignRequest(BaseModel):
    organization_id: str | None = Field(
        None, description="Tenant UUID — required for live triage (no default org fallback)"
    )
    customer_name: str = Field(..., min_length=1)
    customer_email: str | None = None
    customer_phone: str | None = None
    issue: str = Field(..., min_length=1)
    """Who is creating the ticket — drives L1 agent vs self-assign."""
    created_by_role: CreatedByRole = "customer"
    """When created_by_role=agent, force L1 assignee to this user."""
    force_assignee_id: str | None = None
    force_assignee_name: str | None = None


class TriageAssignResponse(BaseModel):
    subject: str
    description: str
    priority: Priority
    assignee: str
    queue: str
    channel: Literal["Web"] = "Web"
    rationale: str
    enrichedByAi: bool = False
    category: str | None = None
    skill: str | None = None
    assignee_id: str | None = None
    resolver: str | None = None
    resolver_id: str | None = None
    resolver_confidence: float | None = None
