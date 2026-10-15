"""Ticket read tools — Express GET APIs (or MCP when tools_transport=mcp)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from app.tools.express_client import express_request
from app.tools.transport import invoke_tool

_TICKET_TIME_PRESETS = frozenset(
    {
        "today",
        "yesterday",
        "this_week",
        "last_week",
        "this_month",
        "last_month",
        "last_24h",
        "last_7d",
        "last_30d",
    }
)
_TICKET_TIME_ALIASES = {
    "past_month": "last_30d",
    "past_one_month": "last_30d",
    "one_month": "last_30d",
    "last30d": "last_30d",
    "last_30_days": "last_30d",
    "last30days": "last_30d",
    "30days": "last_30d",
    "30d": "last_30d",
    "month": "last_30d",
    "past_week": "last_7d",
    "last7d": "last_7d",
    "last_7_days": "last_7d",
    "last7days": "last_7d",
    "7days": "last_7d",
    "7d": "last_7d",
    "week": "last_7d",
    "past_day": "last_24h",
    "last24h": "last_24h",
    "last_24_hours": "last_24h",
    "24hours": "last_24h",
    "24h": "last_24h",
    "day": "last_24h",
}
_ISO_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ISO_SPAN_RE = re.compile(r"^\d{4}-\d{2}-\d{2}/\d{4}-\d{2}-\d{2}$")
_LIST_TICKET_FIELDS = (
    "id",
    "subject",
    "customerName",
    "customerEmail",
    "status",
    "priority",
    "assignee",
    "queue",
    "createdAt",
    "updatedAt",
    "dueAt",
    "orderId",
    "productId",
)


def normalize_ticket_time_range(raw: str | None) -> str:
    """Map LLM range aliases / ISO windows onto Express presets. Schema, not intent."""
    text = str(raw or "").strip().lower().replace(" ", "_")
    if not text:
        return ""
    if text in _TICKET_TIME_PRESETS:
        return text
    aliased = _TICKET_TIME_ALIASES.get(text)
    if aliased:
        return aliased
    if _ISO_DAY_RE.match(text) or _ISO_SPAN_RE.match(text):
        return text
    return text


def _slim_ticket_list_rows(rows: list[Any]) -> list[dict[str, Any]]:
    slim: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        slim.append({key: row.get(key) for key in _LIST_TICKET_FIELDS})
    return slim


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
    offset: int | None = None,
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
    params: dict[str, Any] = {"includeTotal": "1"}
    if scope:
        params["scope"] = scope
    page_size = 12
    if limit is not None:
        try:
            page_size = max(1, min(int(limit), 100))
        except (TypeError, ValueError):
            page_size = 12
    params["limit"] = page_size
    off = 0
    if offset is not None:
        try:
            off = max(0, int(offset))
        except (TypeError, ValueError):
            off = 0
    params["offset"] = off
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
    created_norm = normalize_ticket_time_range(created_range)
    updated_norm = normalize_ticket_time_range(updated_range)
    if created_norm:
        params["createdRange"] = created_norm
    if updated_norm:
        params["updatedRange"] = updated_norm
    sort_val = str(sort or "").strip().lower()
    if sort_val in {"latest", "oldest", "priority", "due"}:
        params["sort"] = sort_val
    args = {k: v for k, v in params.items()}

    def _express() -> dict[str, Any]:
        from app.contracts import tool_ok

        raw = express_request("GET", "/api/tickets", params=params or None)
        if not raw.get("success"):
            return raw
        payload = raw.get("payload")
        if isinstance(payload, dict) and isinstance(payload.get("data"), list):
            rows = list(payload.get("data") or [])
        elif isinstance(payload, list):
            rows = list(payload)
        else:
            rows = []
        slim = _slim_ticket_list_rows(rows)
        total = len(slim)
        has_more = False
        if isinstance(payload, dict):
            try:
                total = int(payload.get("totalRows") or total)
            except (TypeError, ValueError):
                total = len(slim)
            has_more = bool(payload.get("hasMore"))
        if not has_more:
            has_more = off + len(slim) < total
        return tool_ok(
            {
                "data": slim,
                "totalRows": total,
                "offset": off,
                "limit": page_size,
                "createdRange": created_norm or None,
                "updatedRange": updated_norm or None,
                "hasMore": has_more,
                "truncated": False,
            }
        )

    from app.memory import emit_workflow_event

    emit_workflow_event("tool_called", tool="list_tickets")
    result = invoke_tool("list_tickets", args, express_call=_express)
    emit_workflow_event(
        "tool_succeeded" if result.get("success") else "tool_failed",
        tool="list_tickets",
        error_code=result.get("error_code"),
    )
    return result
