"""Ticket read tools — Express GET APIs (or MCP when tools_transport=mcp)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from app.tools.express_client import express_request
from app.tools.transport import invoke_tool


def get_ticket(ticket_number: str) -> dict[str, Any]:
    tn = (ticket_number or "").strip()
    if not tn:
        from app.contracts import tool_err

        return tool_err("BAD_INPUT", "ticket_number is required")
    # Keep leading # so Express matches UI ids like "#12938"
    lookup = tn
    if not lookup.startswith("#") and lookup.lstrip("#").isdigit():
        lookup = f"#{lookup.lstrip('#')}"

    def _express() -> dict[str, Any]:
        return express_request("GET", f"/api/tickets/{quote(lookup, safe='')}")

    return invoke_tool(
        "get_ticket",
        {"ticket_number": lookup},
        express_call=_express,
    )


def get_ticket_progress(ticket_number: str) -> dict[str, Any]:
    tn = (ticket_number or "").strip()
    if not tn:
        from app.contracts import tool_err

        return tool_err("BAD_INPUT", "ticket_number is required")
    lookup = tn
    if not lookup.startswith("#") and lookup.lstrip("#").isdigit():
        lookup = f"#{lookup.lstrip('#')}"

    def _express() -> dict[str, Any]:
        return express_request(
            "GET", f"/api/tickets/{quote(lookup, safe='')}/progress"
        )

    return invoke_tool(
        "get_ticket_progress",
        {"ticket_number": lookup},
        express_call=_express,
    )


def list_ticket_notes(ticket_number: str) -> dict[str, Any]:
    """Recent notes for TSAA grounding (same GET as TicketsView Activity)."""
    tn = (ticket_number or "").strip()
    if not tn:
        from app.contracts import tool_err

        return tool_err("BAD_INPUT", "ticket_number is required")
    lookup = tn
    if not lookup.startswith("#") and lookup.lstrip("#").isdigit():
        lookup = f"#{lookup.lstrip('#')}"

    def _express() -> dict[str, Any]:
        return express_request(
            "GET", f"/api/tickets/{quote(lookup, safe='')}/notes"
        )

    return invoke_tool(
        "list_ticket_notes",
        {"ticket_number": lookup},
        express_call=_express,
    )


def list_tickets(
    *,
    scope: str | None = None,
    limit: int | None = None,
    created_by: str | None = None,
    assigned_to: str | None = None,
    status: str | None = None,
    priority: str | None = None,
    channel: str | None = None,
    query: str | None = None,
    queue: str | None = None,
    customer: str | None = None,
    due: str | None = None,
    created_range: str | None = None,
    updated_range: str | None = None,
    sort: str | None = None,
) -> dict[str, Any]:
    params: dict[str, Any] = {}
    if scope:
        params["scope"] = scope
    if limit is not None:
        params["limit"] = max(1, min(int(limit), 100))
    if str(created_by or "").strip().upper() == "SELF":
        params["createdBy"] = "SELF"
    assigned = str(assigned_to or "").strip()
    if assigned:
        params["assignedTo"] = "SELF" if assigned.upper() == "SELF" else assigned
    if status:
        params["status"] = str(status).strip()
    if priority:
        params["priority"] = str(priority).strip()
    if channel:
        params["channel"] = str(channel).strip()
    if query:
        params["q"] = str(query).strip()[:200]
    if queue:
        params["queue"] = str(queue).strip()[:128]
    if customer:
        params["customer"] = str(customer).strip()[:128]
    due_val = str(due or "").strip().lower()
    if due_val in {"today", "overdue"}:
        params["due"] = due_val
    if created_range:
        params["createdRange"] = str(created_range).strip()
    if updated_range:
        params["updatedRange"] = str(updated_range).strip()
    sort_val = str(sort or "").strip().lower()
    if sort_val in {"latest", "oldest", "priority", "due"}:
        params["sort"] = sort_val
    args = {k: v for k, v in params.items()}

    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/tickets", params=params or None)

    from app.memory import emit_workflow_event

    emit_workflow_event("tool_called", tool="list_tickets")
    result = invoke_tool("list_tickets", args, express_call=_express)
    emit_workflow_event(
        "tool_succeeded" if result.get("success") else "tool_failed",
        tool="list_tickets",
        error_code=result.get("error_code"),
    )
    return result
