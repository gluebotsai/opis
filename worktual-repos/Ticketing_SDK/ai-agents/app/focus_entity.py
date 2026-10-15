"""Hydrate the UI-focused item into shared conversation_context from live APIs."""

from __future__ import annotations

from typing import Any

from app.workflow_state import (
    ENTITY_CUSTOMER,
    ENTITY_KB,
    ENTITY_MACRO,
    ENTITY_TEAM,
    ENTITY_TICKET,
    entity,
    normalize_conversation_context,
    normalize_last_entity,
    remember_last_entity,
)

_TYPE_ALIASES = {
    "ticket": ENTITY_TICKET,
    "tickets": ENTITY_TICKET,
    "article": ENTITY_KB,
    "kb": ENTITY_KB,
    "customer": ENTITY_CUSTOMER,
    "team": ENTITY_TEAM,
    "queue": ENTITY_TEAM,
    "macro": ENTITY_MACRO,
    "priority": "priority",
    "status": "status",
}


def _rows(result: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(result, dict) or not result.get("success"):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        return [data]
    if payload.get("id") or payload.get("title") or payload.get("name"):
        return [payload]
    return []


def _clip(value: Any, limit: int = 280) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _match_row(rows: list[dict[str, Any]], hint_id: str, hint_name: str) -> dict[str, Any] | None:
    hid = hint_id.strip().lower()
    hname = hint_name.strip().lower()
    for row in rows:
        rid = str(row.get("id") or row.get("externalId") or "").strip().lower()
        names = {
            str(row.get(key) or "").strip().lower()
            for key in ("name", "title", "queueName", "ticketNumber", "displayName")
        }
        if hid and rid and (hid == rid or hid.lstrip("#") == rid.lstrip("#")):
            return row
        if hname and hname in names:
            return row
    return rows[0] if len(rows) == 1 else None


def _ticket_entity(row: dict[str, Any], hint_id: str, hint_name: str) -> dict[str, Any]:
    tn = str(
        row.get("ticketNumber")
        or row.get("ticket_number")
        or row.get("id")
        or hint_id
        or hint_name
        or ""
    ).strip()
    if tn and not tn.startswith("#") and tn.lstrip("#").isdigit():
        tn = f"#{tn.lstrip('#')}"
    cdp = str(
        row.get("cdpId")
        or row.get("cdp_id")
        or row.get("customerCdpId")
        or ""
    ).strip()
    email = str(row.get("customerEmail") or "").strip()
    if not cdp and email:
        try:
            from app.tools.catalog_tools import list_customers

            listed = list_customers(query=email)
            for crow in _rows(listed):
                if str(crow.get("email") or "").strip().lower() == email.lower():
                    cdp = str(crow.get("cdpId") or crow.get("cdp_id") or "").strip()
                    if cdp:
                        break
        except Exception:  # noqa: BLE001
            pass
    return entity(
        type=ENTITY_TICKET,
        id=str(row.get("id") or tn),
        name=tn.lstrip("#") or hint_name,
        extra={
            "subject": _clip(row.get("subject") or row.get("title"), 180),
            "status": str(row.get("status") or "").strip(),
            "priority": str(row.get("priority") or "").strip(),
            "customerName": str(row.get("customerName") or row.get("customer") or "").strip(),
            "customerEmail": email,
            "description": _clip(row.get("description") or row.get("issue")),
            "assignee": str(row.get("assignee") or row.get("assignee_name") or "").strip(),
            "resolver": str(row.get("resolver") or row.get("resolver_name") or "").strip(),
            "cdp_id": cdp,
            "cdpId": cdp,
        },
    )


def fetch_focused_entity(hint: dict[str, Any] | None) -> dict[str, Any] | None:
    """Load the open UI item from Express (Postgres via APIs). Never invent rows."""
    raw = hint if isinstance(hint, dict) else {}
    kind = _TYPE_ALIASES.get(str(raw.get("type") or "").strip().lower(), "")
    hint_id = str(raw.get("id") or "").strip()
    hint_name = str(raw.get("name") or "").strip()
    if not kind or (not hint_id and not hint_name):
        return None
    fallback = entity(type=kind, id=hint_id, name=hint_name)
    try:
        if kind == ENTITY_TICKET:
            from app.tools.ticket_read import get_ticket

            lookup = hint_id or hint_name
            result = get_ticket(lookup)
            rows = _rows(result)
            row = rows[0] if rows else None
            if not row and result.get("success") and isinstance(result.get("payload"), dict):
                row = result["payload"]
            return _ticket_entity(row, hint_id, hint_name) if row else fallback
        if kind == ENTITY_KB:
            from app.tools.catalog_tools import get_kb, list_kb

            row = None
            if hint_id:
                got = get_kb(hint_id)
                rows = _rows(got)
                row = rows[0] if rows else None
            if row is None:
                listed = list_kb(query=hint_name or hint_id or None)
                row = _match_row(_rows(listed), hint_id, hint_name)
            if not row:
                return fallback
            return entity(
                type=ENTITY_KB,
                id=str(row.get("id") or hint_id),
                name=str(row.get("title") or row.get("name") or hint_name),
                extra={
                    "status": str(row.get("status") or "").strip(),
                    "category": str(row.get("category") or "").strip(),
                    "excerpt": _clip(row.get("content") or row.get("body")),
                },
            )
        if kind == ENTITY_CUSTOMER:
            from app.tools.catalog_tools import list_customers

            listed = list_customers(query=hint_name or hint_id or None)
            row = _match_row(_rows(listed), hint_id, hint_name)
            if not row:
                return fallback
            return entity(
                type=ENTITY_CUSTOMER,
                id=str(row.get("id") or hint_id),
                name=str(row.get("name") or hint_name),
                extra={
                    "email": str(row.get("email") or "").strip(),
                    "phone": str(row.get("phone") or "").strip(),
                    "status": str(row.get("status") or "").strip(),
                    "cdp_id": str(
                        row.get("cdpId") or row.get("cdp_id") or ""
                    ).strip(),
                    "cdpId": str(
                        row.get("cdpId") or row.get("cdp_id") or ""
                    ).strip(),
                },
            )
        if kind == ENTITY_TEAM:
            from app.tools.catalog_tools import list_queues

            listed = list_queues(query=hint_name or None)
            row = _match_row(_rows(listed), hint_id, hint_name)
            if not row:
                return fallback
            members = row.get("members") or row.get("memberDetails") or []
            member_names: list[str] = []
            if isinstance(members, list):
                for m in members:
                    if isinstance(m, dict):
                        name = str(m.get("name") or "").strip()
                        if name:
                            member_names.append(name)
                    else:
                        name = str(m or "").strip()
                        if name:
                            member_names.append(name)
            member_ids = row.get("memberIds") or row.get("member_ids") or []
            if not isinstance(member_ids, list):
                member_ids = []
            return entity(
                type=ENTITY_TEAM,
                id=str(row.get("id") or hint_id),
                name=str(row.get("queueName") or row.get("name") or hint_name),
                extra={
                    "description": _clip(row.get("description")),
                    "openTickets": row.get("openTickets") or row.get("open_tickets"),
                    "members": member_names,
                    "memberIds": [str(x) for x in member_ids if str(x).strip()],
                },
            )
        if kind == ENTITY_MACRO:
            from app.tools.catalog_tools import list_macros

            listed = list_macros(query=hint_name or None)
            row = _match_row(_rows(listed), hint_id, hint_name)
            if not row:
                return fallback
            return entity(
                type=ENTITY_MACRO,
                id=str(row.get("id") or hint_id),
                name=str(row.get("title") or row.get("name") or hint_name),
                extra={"excerpt": _clip(row.get("body") or row.get("content"))},
            )
        if kind in {"priority", "status"}:
            from app.tools.catalog_tools import list_priorities, list_statuses

            listed = list_priorities() if kind == "priority" else list_statuses()
            row = _match_row(_rows(listed), hint_id, hint_name)
            if not row:
                return fallback
            return entity(
                type=kind,
                id=str(row.get("id") or hint_id),
                name=str(row.get("name") or row.get("label") or hint_name),
                extra={"active": row.get("active")},
            )
    except Exception:  # noqa: BLE001
        return fallback
    return fallback


def apply_ui_focused_entity(
    context: dict[str, Any] | None,
    hint: dict[str, Any] | None,
    *,
    organization_id: str,
    user_id: str | None,
    user_role: str | None,
    user_name: str | None,
    request_id: str | None = None,
) -> dict[str, Any]:
    """Merge a live-fetched UI focus into conversation_context."""
    out = normalize_conversation_context(context)
    raw = hint if isinstance(hint, dict) else {}
    if not str(raw.get("type") or "").strip():
        return out
    from app.tools.express_client import ToolActor, tool_actor_scope

    actor = ToolActor(
        user_id=str(user_id or "").strip(),
        organization_id=str(organization_id or "").strip(),
        user_role=user_role,
        user_name=user_name,
        request_id=request_id,
    )
    with tool_actor_scope(actor):
        focused = fetch_focused_entity(raw)
    if not focused:
        focused = normalize_last_entity(raw)
    return remember_last_entity(out, focused)
