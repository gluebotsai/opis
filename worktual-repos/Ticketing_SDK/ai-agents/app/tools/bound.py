"""Native tool wrappers for allowlisted domain tools.

Tool bodies live in ticket_*/catalog_tools/macro_write and route via
transport (Express or Ticketing MCP) under the current ToolActor.
"""

from __future__ import annotations

import json
from contextvars import ContextVar
from typing import Any, Callable

from app.tools import (
    add_ticket_note,
    auto_assign_ticket,
    clear_notifications,
    create_automation_rule,
    create_customer,
    create_integration_key,
    create_kb_article,
    draft_kb_article,
    create_macro,
    create_priority,
    create_queue,
    create_status,
    create_ticket as create_ticket_api,
    create_widget,
    delete_automation_rule,
    enrich_ticket,
    delete_macro,
    delete_priority,
    delete_queue,
    delete_status,
    decide_ticket_reassignment,
    escalate_ticket,
    export_analytics,
    export_kb,
    get_analytics,
    ask_semantic_layer,
    ask_sql_layer,
    ask_knowledge_graph,
    ask_hub,
    get_csat_reports,
    get_customer_360,
    get_customer_order,
    get_dashboard_chart,
    get_kb,
    get_metrics,
    get_org_preferences,
    get_user_preferences,
    get_ticket,
    get_ticket_progress,
    get_triage_stats,
    import_customers,
    import_kb_articles,
    list_automation_rules,
    list_activities,
    list_agents,
    list_audit,
    list_customers,
    list_escalation_directory,
    list_integration_keys,
    list_kb,
    list_kb_categories,
    search_kb,
    list_macros,
    list_priorities,
    list_statuses,
    list_widgets,
    manage_kb_category,
    portal_create_ticket,
    portal_list_tickets,
    publish_kb_article,
    list_notifications,
    list_queues,
    list_reassignment_requests,
    request_ticket_reassignment,
    list_ticket_notes,
    list_ticket_recommendations,
    list_tickets,
    mark_all_notifications_read,
    mark_notification_read,
    resolve_ticket_person,
    revoke_integration_key,
    search_long_term_memory,
    send_staff_notification,
    store_long_term_memory,
    update_automation_rule,
    update_kb_article,
    update_macro,
    update_org_preferences,
    update_priority,
    update_queue,
    update_status,
    update_ticket,
    update_user_preference,
    update_widget,
    verify_hard_preferences,
    verify_ticket_customer,
)
from app.tools.registry import (
    assert_tool_allowed,
    module_matches_agent,
    tools_for_agent,
    tools_for_module,
    validate_specialist_tool,
)

# Harness injects these; never forward into bound fn kwargs (avoids TypeError on
# fixed-arity wrappers). Idempotency is read via context in write helpers.
_INTERNAL_INVOKE_KEYS = frozenset({"confirmed", "auto", "_idempotency_key"})
_IDEMPOTENCY_KEY: ContextVar[str] = ContextVar("bound_tool_idempotency_key", default="")
_TICKET_CREATE_PIN: ContextVar[dict[str, Any] | None] = ContextVar(
    "bound_ticket_create_pin", default=None
)


def _current_idempotency_key() -> str:
    return str(_IDEMPOTENCY_KEY.get() or "").strip()


def set_ticket_create_pin_draft(draft: dict[str, Any] | None) -> None:
    """Chat ticket.create pin — bound create/portal refuse without the stamp."""
    _TICKET_CREATE_PIN.set(dict(draft) if isinstance(draft, dict) else None)


def _refuse_unchecked_create() -> dict[str, Any] | None:
    from app.tools.ticket_write import (
        precreate_duplicate_blocked,
        precreate_order_check_blocked,
    )

    pin = _TICKET_CREATE_PIN.get()
    if pin is None:
        return None
    return precreate_order_check_blocked(pin) or precreate_duplicate_blocked(pin)


class _NativeTool:
    """Minimal tool wrapper (replaces LangChain StructuredTool)."""

    def __init__(self, fn: Callable[..., Any], *, name: str, description: str = ""):
        self.fn = fn
        self.name = name
        self.description = description

    def invoke(self, args: dict[str, Any] | None = None) -> Any:
        payload = dict(args or {}) if isinstance(args, dict) else {}
        # Never pass harness-only keys into tool callables.
        for key in _INTERNAL_INVOKE_KEYS:
            payload.pop(key, None)
        return self.fn(**payload)


def _structured_tool(fn: Callable[..., Any], *, name: str, description: str = ""):
    return _NativeTool(fn, name=name, description=description)


def _tool_list_array_keys(payload: dict[str, Any]) -> tuple[str, ...]:
    """Keys whose value is a list of row dicts on this TOOL RESULT."""
    ranked: list[tuple[int, str]] = []
    for key, value in payload.items():
        if not isinstance(value, list) or not value:
            continue
        if all(isinstance(item, dict) for item in value):
            ranked.append((len(value), str(key)))
    if ranked:
        longest = max(size for size, _ in ranked)
        return tuple(key for size, key in ranked if size == longest)
    empty: list[str] = []
    for key, value in payload.items():
        if isinstance(value, list) and not value:
            empty.append(str(key))
    return tuple(empty)


def _shrink_list_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    keys = _tool_list_array_keys(payload)
    if not keys:
        return None
    source_key = keys[0]
    rows = [
        dict(row) if isinstance(row, dict) else row
        for row in (payload.get(source_key) or [])
    ]
    capped = rows[:12]
    out = dict(payload)
    for key in keys:
        current = payload.get(key)
        if current == payload.get(source_key) or key == source_key:
            out[key] = [dict(row) if isinstance(row, dict) else row for row in capped]
        elif isinstance(current, list):
            out[key] = [
                dict(row) if isinstance(row, dict) else row for row in current[:12]
            ]
    try:
        existing_total = out.get("totalRows")
        out["totalRows"] = int(existing_total) if existing_total is not None else len(rows)
    except (TypeError, ValueError):
        out["totalRows"] = len(rows)
    out["truncated"] = True
    out["hasMore"] = True
    return out


def _json_dump(result: Any) -> str:
    try:
        raw = json.dumps(result, default=str)
        if len(raw) <= 8000:
            return raw
        if isinstance(result, dict):
            bounded = dict(result)
            payload = bounded.get("payload")
            if isinstance(payload, dict):
                shrunk = _shrink_list_payload(payload)
                if shrunk is not None:
                    bounded["payload"] = shrunk
                    raw = json.dumps(bounded, default=str)
                    keys = _tool_list_array_keys(shrunk)
                    source_key = "rows" if "rows" in keys else (keys[0] if keys else "")
                    while (
                        len(raw) > 8000
                        and source_key
                        and isinstance(shrunk.get(source_key), list)
                        and shrunk[source_key]
                    ):
                        shrunk[source_key].pop()
                        for key in keys:
                            if key != source_key:
                                shrunk[key] = list(shrunk[source_key])
                        raw = json.dumps(bounded, default=str)
                    if len(raw) <= 8000 and source_key and shrunk.get(source_key):
                        return raw
            return json.dumps(
                {
                    "success": bounded.get("success", False),
                    "error_code": bounded.get("error_code"),
                    "message": bounded.get("message"),
                    "payload": {},
                    "truncated": True,
                },
                default=str,
            )
        return json.dumps({"payload": {}, "truncated": True})
    except Exception:  # noqa: BLE001
        return json.dumps({"payload": {}, "serialization_error": True})


def _create_ticket(**kwargs: Any) -> dict[str, Any]:
    """Accept LLM camelCase or snake_case field names into Express create body."""
    raw = dict(kwargs or {})
    aliases = {
        "customer_name": "customerName",
        "customer_id": "customerId",
        "customer_email": "customerEmail",
        "customer_phone": "customerPhone",
        "assignee_id": "assigneeId",
        "resolver_id": "resolverId",
        "ai_summary": "aiSummary",
    }
    body: dict[str, Any] = {}
    for key, value in raw.items():
        if value is None or value == "":
            continue
        if key in _INTERNAL_INVOKE_KEYS:
            continue
        canon = aliases.get(key, key)
        body[canon] = value
    idem = _current_idempotency_key()
    if idem:
        body["_idempotency_key"] = idem
    if not str(body.get("customerName") or "").strip() and not str(
        body.get("subject") or ""
    ).strip():
        from app.contracts import tool_err

        return tool_err("BAD_INPUT", "customerName or subject is required")
    blocked = _refuse_unchecked_create()
    if blocked:
        return blocked
    pin = _TICKET_CREATE_PIN.get() or {}
    oid = str(pin.get("orderId") or pin.get("order_id") or "").strip()
    pid = str(pin.get("productId") or pin.get("product_id") or "").strip()
    from app.tools.ticket_write import _truthy_draft_flag, create_ticket as _create_ticket_api

    desc = str(body.get("description") or body.get("issue") or "")
    if oid and _truthy_draft_flag(pin.get("orderVerified")):
        if oid not in desc:
            body["description"] = f"{desc}\nOrder {oid}".strip() if desc else f"Order {oid}"
        if not str(body.get("orderId") or "").strip():
            body["orderId"] = oid
        if pid and not str(body.get("productId") or "").strip():
            body["productId"] = pid
    return _create_ticket_api(body)


def _enrich_ticket(**kwargs: Any) -> dict[str, Any]:
    """Native tool entry — kwargs from the LLM become the enrich payload."""
    return enrich_ticket(dict(kwargs))


def _verify_ticket_customer(**kwargs: Any) -> dict[str, Any]:
    return verify_ticket_customer(dict(kwargs))


def _create_macro(**kwargs: Any) -> dict[str, Any]:
    from app.tools.macro_write import create_macro as _create

    raw = dict(kwargs or {})
    for drop in ("confirmed", "auto", "kind", "awaiting", "step"):
        raw.pop(drop, None)
    title = str(raw.get("title") or raw.get("name") or "").strip()
    body = str(raw.get("body") or raw.get("content") or raw.get("reply") or "").strip()
    return _create(title=title, body=body)


def _update_macro(macro_id: str, title: str | None = None, body: str | None = None) -> dict[str, Any]:
    from app.tools.macro_write import update_macro as _update

    return _update(macro_id, title=title, body=body)


def _delete_macro(macro_id: str) -> dict[str, Any]:
    from app.tools.macro_write import delete_macro as _delete

    return _delete(macro_id)


def _create_queue(**kwargs: Any) -> dict[str, Any]:
    """Create team/queue; ignore confirm-gate flags (stripped by execute_tool_call too)."""
    from app.tools.catalog_tools import create_queue as _create

    raw = dict(kwargs or {})
    for drop in ("confirmed", "auto", "kind", "awaiting", "step"):
        raw.pop(drop, None)
    name = str(raw.get("name") or raw.get("queueName") or "").strip()
    description = str(raw.get("description") or "").strip()
    members = raw.get("members")
    member_ids = raw.get("member_ids") or raw.get("memberIds")
    if members is not None and not isinstance(members, list):
        members = [members]
    if member_ids is not None and not isinstance(member_ids, list):
        member_ids = [member_ids]
    return _create(
        name=name,
        description=description,
        members=members if isinstance(members, list) else None,
        member_ids=member_ids if isinstance(member_ids, list) else None,
    )


def _update_queue(**kwargs: Any) -> dict[str, Any]:
    """Update team/queue; ignore confirm-gate flags (same as create_queue)."""
    from app.tools.catalog_tools import update_queue as _update

    raw = dict(kwargs or {})
    for drop in ("confirmed", "auto", "kind", "awaiting", "step", "flow", "workflow"):
        raw.pop(drop, None)
    queue_id = str(raw.get("queue_id") or raw.get("id") or "").strip()
    members = raw.get("members")
    member_ids = raw.get("member_ids") or raw.get("memberIds")
    if members is not None and not isinstance(members, list):
        members = [members]
    if member_ids is not None and not isinstance(member_ids, list):
        member_ids = [member_ids]
    add_members = bool(raw.get("add_members") or raw.get("addMembers"))
    name = raw.get("name") or raw.get("queueName")
    description = raw.get("description")
    return _update(
        queue_id,
        name=str(name).strip() if name is not None else None,
        description=str(description).strip() if description is not None else None,
        members=members if isinstance(members, list) else None,
        add_members=add_members,
        member_ids=member_ids if isinstance(member_ids, list) else None,
    )


def _delete_queue(queue_id: str) -> dict[str, Any]:
    from app.tools.catalog_tools import delete_queue as _delete

    return _delete(queue_id)


def _publish_kb(article_id: str) -> dict[str, Any]:
    from app.tools.catalog_tools import publish_kb_article as _publish

    return _publish(article_id)


def _delete_priority(
    priority_id: str = "",
    priority_ids: list[str] | None = None,
) -> dict[str, Any]:
    from app.tools.catalog_tools import delete_priority as _delete

    return _delete(priority_id=priority_id or None, priority_ids=priority_ids)


def _delete_status(
    status_id: str = "",
    status_ids: list[str] | None = None,
) -> dict[str, Any]:
    from app.tools.catalog_tools import delete_status as _delete

    return _delete(status_id=status_id or None, status_ids=status_ids)


def _create_kb(
    title: str,
    content: str = "",
    category: str = "",
    body: str = "",
) -> dict[str, Any]:
    from app.tools.catalog_tools import create_kb_article as _create

    return _create(title=title, content=content or body, category=category)


def _draft_kb(
    title: str,
    content: str = "",
    category: str = "",
    body: str = "",
) -> dict[str, Any]:
    from app.tools.catalog_tools import draft_kb_article as _draft

    return _draft(title=title, content=content or body, category=category)


def _update_ticket(
    ticket_number: str,
    status: str | None = None,
    priority: str | None = None,
    assignee: str | None = None,
    resolver: str | None = None,
    queue: str | None = None,
    note: str | None = None,
    subject: str | None = None,
    description: str | None = None,
    category: str | None = None,
    ai_summary: str | None = None,
    attachments: list[str] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    from app.tools.ticket_write import add_ticket_note as _note
    from app.tools.ticket_write import update_ticket as _update

    for drop in ("confirmed", "auto", "kind", "awaiting", "step", "person", "target_role"):
        kwargs.pop(drop, None)
    # CamelCase aliases from LLM / proactive tool_args.
    if description is None:
        description = kwargs.pop("description", None)
    if category is None:
        category = kwargs.pop("category", None)
    if ai_summary is None:
        ai_summary = kwargs.pop("ai_summary", None)
    if ai_summary is None:
        ai_summary = kwargs.pop("aiSummary", None)
    kwargs.pop("description", None)
    kwargs.pop("category", None)
    kwargs.pop("ai_summary", None)
    kwargs.pop("aiSummary", None)
    from app.tools.ticket_write import _upload_attachment_urls

    raw_atts = attachments if attachments is not None else kwargs.pop("attachments", None)
    urls = _upload_attachment_urls(raw_atts)
    if not urls:
        pin = _TICKET_CREATE_PIN.get() or {}
        urls = _upload_attachment_urls(pin.get("attachments"))
    atts = urls or None
    result = _update(
        ticket_number,
        status=status,
        priority=priority,
        assignee=assignee,
        resolver=resolver,
        queue=queue,
        subject=subject,
        description=description,
        category=category,
        ai_summary=ai_summary,
        attachments=atts,
    )
    if note and result.get("success"):
        _note(ticket_number, note)
    return result


def _auto_assign_ticket(ticket_number: str) -> dict[str, Any]:
    from app.tools.ticket_write import auto_assign_ticket as _auto

    return _auto(ticket_number)


def _escalate_ticket(ticket_number: str, **kwargs: Any) -> dict[str, Any]:
    from app.tools.ticket_write import escalate_ticket as _esc

    for drop in ("confirmed", "auto", "kind", "awaiting", "step", "person", "target_role"):
        kwargs.pop(drop, None)
    return _esc(ticket_number, **kwargs)


def _send_staff_notification(
    user_id: str | None = None,
    title: str = "",
    message: str = "",
    kind: str = "update",
    ticket_uuid: str | None = None,
    customer_name: str | None = None,
    user_ids: list[str] | tuple[str, ...] | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Fan-out PNA recipients; drop unexpected proactive kwargs."""
    for drop in ("confirmed", "auto", "kind_label"):
        kwargs.pop(drop, None)
    ids: list[str] = []
    raw = user_ids if user_ids is not None else kwargs.pop("user_ids", None)
    if isinstance(raw, (list, tuple)):
        ids.extend(str(x).strip() for x in raw if str(x).strip())
    single = str(user_id or kwargs.pop("user_id", "") or "").strip()
    if single:
        ids.append(single)
    ids = list(dict.fromkeys(ids))
    if not ids:
        return send_staff_notification(
            user_id="",
            title=str(title or ""),
            message=str(message or ""),
            kind=str(kind or "update"),
            ticket_uuid=ticket_uuid,
            customer_name=customer_name,
        )
    results = [
        send_staff_notification(
            user_id=uid,
            title=str(title or ""),
            message=str(message or ""),
            kind=str(kind or "update"),
            ticket_uuid=ticket_uuid,
            customer_name=customer_name,
        )
        for uid in ids
    ]
    if len(results) == 1:
        return results[0]
    if any(isinstance(r, dict) and r.get("success") is False for r in results):
        return {
            "success": False,
            "error_code": "NOTIFY_PARTIAL_FAILURE",
            "message": "One or more staff notifications failed",
            "results": results,
        }
    return {"success": True, "payload": {"ok": True, "results": results}}


def _update_prefs(
    ticket_prefix: str | None = None,
    portal_label: str | None = None,
    display_timezone: str | None = None,
    portal_auth_mode: str | None = None,
    business_type: str | None = None,
) -> dict[str, Any]:
    from app.tools.catalog_tools import update_org_preferences as _update

    return _update(
        ticket_prefix=ticket_prefix,
        portal_label=portal_label,
        display_timezone=display_timezone,
        portal_auth_mode=portal_auth_mode,
        business_type=business_type,
    )


def _update_priority(
    priority_id: str,
    display_name: str = "",
    resolution_hours: float | None = None,
    active: bool | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    from app.tools.catalog_tools import update_priority as _update

    name = str(
        display_name
        or kwargs.get("displayName")
        or kwargs.get("name")
        or kwargs.get("label")
        or ""
    ).strip()
    hours = resolution_hours
    if hours is None:
        hours = kwargs.get("resolutionHours")
        if hours is None:
            hours = kwargs.get("hours")
    return _update(
        priority_id,
        display_name=name or None,
        resolution_hours=hours,
        active=active if active is not None else kwargs.get("active"),
    )


def _update_status(
    status_id: str,
    display_name: str = "",
    active: bool | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    from app.tools.catalog_tools import update_status as _update

    name = str(
        display_name
        or kwargs.get("displayName")
        or kwargs.get("name")
        or kwargs.get("label")
        or ""
    ).strip()
    return _update(
        status_id,
        display_name=name or None,
        active=active if active is not None else kwargs.get("active"),
    )


def _create_priority(**kwargs: Any) -> dict[str, Any]:
    from app.tools.catalog_tools import create_priority as _create

    raw = dict(kwargs or {})
    for drop in ("confirmed", "auto", "kind", "awaiting", "step"):
        raw.pop(drop, None)
    name = str(
        raw.get("display_name")
        or raw.get("displayName")
        or raw.get("name")
        or raw.get("label")
        or ""
    ).strip()
    hours_raw = raw.get("resolution_hours")
    if hours_raw is None:
        hours_raw = raw.get("resolutionHours")
    if hours_raw is None:
        hours_raw = raw.get("hours")
    try:
        hours = float(hours_raw)
    except (TypeError, ValueError):
        hours = 0.0
    return _create(display_name=name, resolution_hours=hours)


def _create_status(**kwargs: Any) -> dict[str, Any]:
    from app.tools.catalog_tools import create_status as _create

    raw = dict(kwargs or {})
    for drop in ("confirmed", "auto", "kind", "awaiting", "step"):
        raw.pop(drop, None)
    name = str(
        raw.get("display_name")
        or raw.get("displayName")
        or raw.get("name")
        or raw.get("label")
        or ""
    ).strip()
    return _create(display_name=name)


def _create_customer(
    name: str,
    email: str = "",
    phone: str = "",
    account_name: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Create customer; harness ``_idempotency_key`` arrives via context, not kwargs."""
    from app.tools.catalog_tools import create_customer as _create

    for drop in ("confirmed", "auto", "kind", "awaiting", "step", "_idempotency_key"):
        kwargs.pop(drop, None)
    if not account_name:
        account_name = str(kwargs.pop("accountName", "") or "")
    return _create(
        name=name,
        email=email or "",
        phone=phone or "",
        account_name=account_name or "",
        _idempotency_key=_current_idempotency_key(),
    )


def _portal_create_ticket(
    issue: str = "",
    subject: str = "",
    description: str = "",
    force_create: bool = False,
    **kwargs: Any,
) -> dict[str, Any]:
    for drop in _INTERNAL_INVOKE_KEYS:
        kwargs.pop(drop, None)
    blocked = _refuse_unchecked_create()
    if blocked:
        return blocked
    pin = _TICKET_CREATE_PIN.get() or {}
    desc = description or issue
    oid = str(pin.get("orderId") or pin.get("order_id") or "").strip()
    pid = str(pin.get("productId") or pin.get("product_id") or "").strip()
    from app.tools.ticket_write import _truthy_draft_flag

    verified_order = bool(oid and _truthy_draft_flag(pin.get("orderVerified")))
    if verified_order and oid not in desc:
        desc = f"{desc}\nOrder {oid}".strip()
    raw_atts = kwargs.pop("attachments", None)
    if not isinstance(raw_atts, list):
        raw_atts = pin.get("attachments")
    atts: list[str] = []
    if isinstance(raw_atts, list):
        for item in raw_atts:
            text = str(item or "").strip()
            if text.startswith("/uploads/") and ".." not in text and "\\" not in text:
                atts.append(text)
    return portal_create_ticket(
        issue=issue,
        subject=subject,
        description=desc,
        force_create=bool(force_create or kwargs.pop("forceCreate", False)),
        attachments=atts,
        orderId=oid if verified_order else "",
        productId=pid if verified_order else "",
        _idempotency_key=_current_idempotency_key(),
    )


def _create_widget(
    name: str,
    allowed_origins: str = "",
    button_label: str = "",
) -> dict[str, Any]:
    return create_widget(
        name=name,
        allowed_origins=allowed_origins or None,
        button_label=button_label or None,
    )

_TOOL_BUILDERS: dict[str, Callable[[], StructuredTool]] = {
    "get_ticket": lambda: _structured_tool(
        get_ticket,
        name="get_ticket",
        description="Get one ticket by ticket_number (e.g. 12345 or #12345).",
    ),
    "get_ticket_progress": lambda: _structured_tool(
        get_ticket_progress,
        name="get_ticket_progress",
        description="Get ticket progress/history by ticket_number.",
    ),
    "list_ticket_notes": lambda: _structured_tool(
        list_ticket_notes,
        name="list_ticket_notes",
        description="List recent ticket notes by ticket_number.",
    ),
    "list_tickets": lambda: _structured_tool(
        list_tickets,
        name="list_tickets",
        description=(
            "List tickets. Optional scope, filters, sort, and limit. "
            "created_range/updated_range: today, yesterday, this_week, last_week, "
            "this_month, last_month, last_24h, last_7d, last_30d "
            "(past_month → last_30d), or ISO YYYY-MM-DD or YYYY-MM-DD/YYYY-MM-DD."
        ),
    ),
    "escalate_ticket": lambda: _structured_tool(
        _escalate_ticket,
        name="escalate_ticket",
        description="Escalate a ticket by ticket_number; optional assignee/agent/rationale.",
    ),
    "request_ticket_reassignment": lambda: _structured_tool(
        request_ticket_reassignment,
        name="request_ticket_reassignment",
        description=(
            "Resolver: ask the ticket agent to approve moving L2 to a listed teammate. "
            "Requires ticket_number, person/resolver, and reason."
        ),
    ),
    "list_reassignment_requests": lambda: _structured_tool(
        list_reassignment_requests,
        name="list_reassignment_requests",
        description="List pending reassignment requests for the current ticket agent.",
    ),
    "decide_ticket_reassignment": lambda: _structured_tool(
        decide_ticket_reassignment,
        name="decide_ticket_reassignment",
        description="Agent: approve or deny a pending reassignment request by request_id.",
    ),
    "auto_assign_ticket": lambda: _structured_tool(
        _auto_assign_ticket,
        name="auto_assign_ticket",
        description="Auto-assign a ticket via backend routing. Never invent the assignee.",
    ),
    "update_ticket": lambda: _structured_tool(
        _update_ticket,
        name="update_ticket",
        description=(
            "Update ticket fields (status, priority, assignee, subject, …). "
            "To add files, pass attachments as /uploads/ URLs from this turn's "
            "ticket_draft (chat +). Never invent URLs or ticket numbers."
        ),
    ),
    "add_ticket_note": lambda: _structured_tool(
        add_ticket_note,
        name="add_ticket_note",
        description="Add a note to a ticket by ticket_number.",
    ),
    "create_ticket": lambda: _structured_tool(
        _create_ticket,
        name="create_ticket",
        description="Create a ticket with customer_name (optional subject/description).",
    ),
    "enrich_ticket": lambda: _structured_tool(
        _enrich_ticket,
        name="enrich_ticket",
        description=(
            "After customerName + contact + issue are collected: run ticket categorization, "
            "prioritization, and routing (triage) into the draft. Then ask the user to confirm "
            "filing. Do not invent subject/priority/queue yourself — this tool owns them."
        ),
    ),
    "verify_ticket_customer": lambda: _structured_tool(
        _verify_ticket_customer,
        name="verify_ticket_customer",
        description=(
            "After customerName + email/phone on create-ticket: check directory/CDP "
            "immediately (no pre-verify user confirm). If exists=false, state no "
            "matching customer record for the exact contact. If exists=true, customer "
            "is verified — ask for the issue next; never ask to confirm the match."
        ),
    ),
    "list_queues": lambda: _structured_tool(
        list_queues,
        name="list_queues",
        description=(
            "List teams. For the members of one team, set query to that team's name. "
            "For every team, set list_all true and omit query."
        ),
    ),
    "list_agents": lambda: _structured_tool(
        list_agents,
        name="list_agents",
        description="List assignable staff for team membership.",
    ),
    "resolve_ticket_person": lambda: _structured_tool(
        resolve_ticket_person,
        name="resolve_ticket_person",
        description=(
            "Fetch live agents/resolvers for reassign or escalate. "
            "Call when the user wants to change assignee/resolver, asks who is "
            "available, or names a person. Resolve short/misspelled names only "
            "against person_data; ask Did you mean <name>? before writing."
        ),
    ),
    "list_ticket_recommendations": lambda: _structured_tool(
        list_ticket_recommendations,
        name="list_ticket_recommendations",
        description="List proactive recommendations, optionally for one ticket.",
    ),
    "create_queue": lambda: _structured_tool(
        _create_queue,
        name="create_queue",
        description="Create a queue/team by name.",
    ),
    "update_queue": lambda: _structured_tool(
        _update_queue,
        name="update_queue",
        description="Update a queue/team.",
    ),
    "delete_queue": lambda: _structured_tool(
        _delete_queue,
        name="delete_queue",
        description="Delete a queue/team by id.",
    ),
    "list_kb": lambda: _structured_tool(
        list_kb,
        name="list_kb",
        description=(
            "List knowledge base articles, 10 per page. "
            "First page: offset 0. Next page of the same list: offset from the prior nextOffset."
        ),
    ),
    "search_kb": lambda: _structured_tool(
        search_kb,
        name="search_kb",
        description=(
            "Retrieve the single best published KB article for how-to / troubleshooting. "
            "Uses the Meilisearch index (one article). Quote this TOOL RESULT only. "
            "Do not use this to browse or open an article list — use list_kb / get_kb."
        ),
    ),
    "list_kb_categories": lambda: _structured_tool(
        list_kb_categories,
        name="list_kb_categories",
        description="List available KB category labels from live articles.",
    ),
    "manage_kb_category": lambda: _structured_tool(
        manage_kb_category,
        name="manage_kb_category",
        description="Add a KB category label (mode=add, name=...) or list categories (mode=list).",
    ),
    "export_kb": lambda: _structured_tool(
        export_kb,
        name="export_kb",
        description="Export KB articles for download. Optional fmt=json|csv|md|txt|pdf|doc and category filter.",
    ),
    "import_kb_articles": lambda: _structured_tool(
        import_kb_articles,
        name="import_kb_articles",
        description="Import KB articles from a JSON array string of {title, content, category}.",
    ),
    "get_kb": lambda: _structured_tool(
        get_kb,
        name="get_kb",
        description="Get one knowledge article by id.",
    ),
    "update_kb_article": lambda: _structured_tool(
        update_kb_article,
        name="update_kb_article",
        description="Update a KB article (title, content, category, status).",
    ),
    "publish_kb_article": lambda: _structured_tool(
        _publish_kb,
        name="publish_kb_article",
        description="Publish a KB article by id.",
    ),
    "get_customer_order": lambda: _structured_tool(
        get_customer_order,
        name="get_customer_order",
    ),
    "portal_list_tickets": lambda: _structured_tool(
        portal_list_tickets,
        name="portal_list_tickets",
        description=(
            "List the signed-in customer's own tickets. "
            "Optional limit (default 10) and offset for the next page."
        ),
    ),
    "portal_create_ticket": lambda: _structured_tool(
        _portal_create_ticket,
        name="portal_create_ticket",
        description="File a ticket for the signed-in customer from an issue description.",
    ),
    "create_kb_article": lambda: _structured_tool(
        _create_kb,
        name="create_kb_article",
        description="Create and publish a KB article with title, content, category.",
    ),
    "draft_kb_article": lambda: _structured_tool(
        _draft_kb,
        name="draft_kb_article",
        description="Save a KB article as a staff-only draft with title, content, category.",
    ),
    "list_customers": lambda: _structured_tool(
        list_customers,
        name="list_customers",
        description="List customers in the directory. Optional query, status, exact email/phone.",
    ),
    "get_customer_360": lambda: _structured_tool(
        get_customer_360,
        name="get_customer_360",
        description="Get customer ticket history and counts by email.",
    ),
    "import_customers": lambda: _structured_tool(
        import_customers,
        name="import_customers",
        description="Import customers from CSV text via Express. Do not invent rows.",
    ),
    "create_customer": lambda: _structured_tool(
        _create_customer,
        name="create_customer",
        description="Add a customer to the directory (name, email, and phone).",
    ),
    "list_macros": lambda: _structured_tool(
        list_macros,
        name="list_macros",
        description="List macros. Optional query search.",
    ),
    "create_macro": lambda: _structured_tool(
        _create_macro,
        name="create_macro",
        description="Create a macro with title and body.",
    ),
    "update_macro": lambda: _structured_tool(
        _update_macro,
        name="update_macro",
        description="Update a macro title and/or body.",
    ),
    "delete_macro": lambda: _structured_tool(
        _delete_macro,
        name="delete_macro",
        description="Delete a macro.",
    ),
    "list_priorities": lambda: _structured_tool(
        list_priorities,
        name="list_priorities",
        description="List priority catalog entries.",
    ),
    "create_priority": lambda: _structured_tool(
        _create_priority,
        name="create_priority",
        description="Create a priority (display name + resolution hours).",
    ),
    "update_priority": lambda: _structured_tool(
        _update_priority,
        name="update_priority",
        description="Update a priority (display name, SLA hours, active).",
    ),
    "delete_priority": lambda: _structured_tool(
        _delete_priority,
        name="delete_priority",
        description=(
            "Delete one or more priorities in a single call. Pass priority_ids "
            "with every numeric id from list_priorities they asked to remove, "
            "or priority_id for one row. Do not call this tool more than once "
            "this turn."
        ),
    ),
    "list_statuses": lambda: _structured_tool(
        list_statuses,
        name="list_statuses",
        description="List ticket status catalog entries.",
    ),
    "create_status": lambda: _structured_tool(
        _create_status,
        name="create_status",
        description="Create a ticket status.",
    ),
    "update_status": lambda: _structured_tool(
        _update_status,
        name="update_status",
        description="Update a ticket status (display name, active).",
    ),
    "delete_status": lambda: _structured_tool(
        _delete_status,
        name="delete_status",
        description=(
            "Delete one or more statuses in a single call. Pass status_ids "
            "with every numeric id from list_statuses they asked to remove, "
            "or status_id for one row. Do not call this tool more than once "
            "this turn."
        ),
    ),
    "get_csat_reports": lambda: _structured_tool(
        get_csat_reports,
        name="get_csat_reports",
        description="Get CSAT reports for 7days, 30days, or 90days.",
    ),
    "export_analytics": lambda: _structured_tool(
        export_analytics,
        name="export_analytics",
        description="Prepare analytics CSV download (do not dump CSV into chat).",
    ),
    "list_audit": lambda: _structured_tool(
        list_audit,
        name="list_audit",
        description="List audit log events. Optional action, actor, ticket, range.",
    ),
    "list_escalation_directory": lambda: _structured_tool(
        list_escalation_directory,
        name="list_escalation_directory",
        description="List escalation directory teams/members/skills.",
    ),
    "list_widgets": lambda: _structured_tool(
        list_widgets,
        name="list_widgets",
        description="List help widgets.",
    ),
    "create_widget": lambda: _structured_tool(
        _create_widget,
        name="create_widget",
        description="Create a help widget.",
    ),
    "update_widget": lambda: _structured_tool(
        update_widget,
        name="update_widget",
        description="Update a help widget by widget_id.",
    ),
    "list_integration_keys": lambda: _structured_tool(
        list_integration_keys,
        name="list_integration_keys",
        description="List integration API keys metadata only (masked prefix).",
    ),
    "create_integration_key": lambda: _structured_tool(
        create_integration_key,
        name="create_integration_key",
        description="Create an integration API key and return its secret once.",
    ),
    "revoke_integration_key": lambda: _structured_tool(
        revoke_integration_key,
        name="revoke_integration_key",
        description="Revoke an integration API key by key_id.",
    ),
    "list_automation_rules": lambda: _structured_tool(
        list_automation_rules,
        name="list_automation_rules",
        description="List automation rules for the organization.",
    ),
    "create_automation_rule": lambda: _structured_tool(
        create_automation_rule,
        name="create_automation_rule",
        description="Create a ticket.created or ticket.updated automation rule.",
    ),
    "update_automation_rule": lambda: _structured_tool(
        update_automation_rule,
        name="update_automation_rule",
        description="Update an automation rule by rule_id.",
    ),
    "delete_automation_rule": lambda: _structured_tool(
        delete_automation_rule,
        name="delete_automation_rule",
        description="Delete an automation rule by rule_id.",
    ),
    "get_metrics": lambda: _structured_tool(
        get_metrics,
        name="get_metrics",
        description=(
            "Structured Home dashboard snapshot only (scope=org|self). "
            "NOT for natural-language questions like 'how many open tickets' — "
            "those MUST use ask_semantic_layer instead."
        ),
    ),
    "get_triage_stats": lambda: _structured_tool(
        get_triage_stats,
        name="get_triage_stats",
        description="Get created-by-me / reassigned-out / open-on-my-teams counts.",
    ),
    "get_dashboard_chart": lambda: _structured_tool(
        get_dashboard_chart,
        name="get_dashboard_chart",
        description="Get dashboard workload chart for 24hours, 7days, or 30days.",
    ),
    "list_activities": lambda: _structured_tool(
        list_activities,
        name="list_activities",
        description="Get recent Home dashboard activity.",
    ),
    "get_analytics": lambda: _structured_tool(
        get_analytics,
        name="get_analytics",
        description=(
            "Structured analytics snapshot / export parity from Express. "
            "NOT for NL 'how many / CSAT / SLA %' questions — use ask_semantic_layer. "
            "NOT for why/drivers — use ask_knowledge_graph."
        ),
    ),
    "ask_semantic_layer": lambda: _structured_tool(
        ask_semantic_layer,
        name="ask_semantic_layer",
        description=(
            "Certified KPI numbers via POST /v1/semantic/query. "
            "Read every certified metric and dimension in this turn's ontology "
            "slice, then pass the best-fit metrics[] ids — never the user sentence "
            "and never the first/least-relevant row. "
            "Optional group_by only for a requested break-down, filters "
            "[{dimension, op, value|values}] only for named constraints, "
            "order_by, time only if they named a window "
            "{period: last_7_days|last_30_days|today|overall or start/end YYYY-MM-DD}, "
            "limit, dataScope org|mine. Runtime fills organizationId, userId, product, agent. "
            "Values only — not why (pair ask_knowledge_graph). Not ticket row lists."
        ),
    ),
    "ask_knowledge_graph": lambda: _structured_tool(
        ask_knowledge_graph,
        name="ask_knowledge_graph",
        description=(
            "Why / what-about-data narrative via the knowledge graph (DB-backed). "
            "Use when the user asks why metrics moved, what is driving issues, "
            "or what themes/relationships exist in the data. "
            "NOT for exact KPI numbers alone — call ask_semantic_layer for values. "
            "NOT for list/show ticket rows — call ask_sql_layer. "
            "Combined value+why asks: call ask_semantic_layer then this. "
            "organization_id and session_id come from login/session."
        ),
    ),
    "ask_sql_layer": lambda: _structured_tool(
        ask_sql_layer,
        name="ask_sql_layer",
        description=(
            "List / show / search ticket-shaped ROWS via POST /v1/sql/query. "
            "Required: instruction (one English sentence). Recommended: entityHint=wt:Ticket. "
            "Optional: filters [{dimension, op, value|values}], limit. "
            "Runtime fills organizationId, userId, originProduct, originAgent. "
            "No SQL, no table names, no empty args. Success with rows=[] is zero "
            "tickets — do not also call list_tickets. list_tickets only if this "
            "tool fails. NOT for how-many / CSAT / SLA % (ask_semantic_layer on "
            "a reporting executor). Do not set metricRequest."
        ),
    ),
    "ask_hub": lambda: _structured_tool(
        ask_hub,
        name="ask_hub",
        description=(
            "Send a leftover / out-of-product ask to the Worktual Hub A2A server "
            "(campaign, marketing, CCaaS, CVM, or other non-Ticketing work). "
            "Requires a focused customer with cdp_id. Do not invent cross-product "
            "answers — call this instead when Ticketing tools cannot own the task."
        ),
    ),
    "get_org_preferences": lambda: _structured_tool(
        get_org_preferences,
        name="get_org_preferences",
        description="Get org preferences.",
    ),
    "get_user_preferences": lambda: _structured_tool(
        get_user_preferences,
        name="get_user_preferences",
        description="Get the actor's soft/hard preference scratchpad.",
    ),
    "update_org_preferences": lambda: _structured_tool(
        _update_prefs,
        name="update_org_preferences",
        description="Update org preferences (non-secret fields).",
    ),
    "update_user_preference": lambda: _structured_tool(
        update_user_preference,
        name="update_user_preference",
        description=(
            "Upsert one user preference. kind=soft injects into prompts; "
            "kind=hard is enforced by verify_hard_preferences."
        ),
    ),
    "verify_hard_preferences": lambda: _structured_tool(
        verify_hard_preferences,
        name="verify_hard_preferences",
        description=(
            "Check a proposed tool action against hard preferences. "
            "Returns allow, block, or approval_required."
        ),
    ),
    "store_long_term_memory": lambda: _structured_tool(
        store_long_term_memory,
        name="store_long_term_memory",
        description="Store a durable cross-session memory fact for the actor.",
    ),
    "search_long_term_memory": lambda: _structured_tool(
        search_long_term_memory,
        name="search_long_term_memory",
        description="Search tenant/user-scoped long-term memory (bounded results).",
    ),
    "list_notifications": lambda: _structured_tool(
        list_notifications,
        name="list_notifications",
        description="List notifications.",
    ),
    "mark_all_notifications_read": lambda: _structured_tool(
        mark_all_notifications_read,
        name="mark_all_notifications_read",
        description="Mark all notifications read.",
    ),
    "mark_notification_read": lambda: _structured_tool(
        mark_notification_read,
        name="mark_notification_read",
        description="Mark one notification read.",
    ),
    "clear_notifications": lambda: _structured_tool(
        clear_notifications,
        name="clear_notifications",
        description="Clear all notifications for the current actor.",
    ),
    "send_staff_notification": lambda: _structured_tool(
        _send_staff_notification,
        name="send_staff_notification",
        description="Send a grounded notification to one or more staff users.",
    ),
}


def registered_bound_tool_names() -> frozenset[str]:
    """Code-owned inventory of tools executable through MCP dispatch."""
    return frozenset(_TOOL_BUILDERS)


def native_tools_for_agent(
    agent: str,
    *,
    module: str | None = None,
    surface: str | None = None,
    extra_tools: frozenset[str] | None = None,
) -> list[_NativeTool]:
    """Build native tool adapters for the agent's allowlist (empty if none).

    When module+surface match this specialist, intersect with the smaller
    CRM page allowlist so idle routing is tools + page context.
    extra_tools unions armed write tools (confirm step) even off the create surface.
    """
    allowed = tools_for_agent(agent)
    if module and module_matches_agent(module, agent):
        scoped = tools_for_module(module, surface)
        if scoped:
            allowed = allowed & scoped
    if extra_tools:
        allowed = allowed | (frozenset(extra_tools) & tools_for_agent(agent))
    out: list[_NativeTool] = []
    for name in sorted(allowed):
        builder = _TOOL_BUILDERS.get(name)
        if not builder:
            continue
        try:
            assert_tool_allowed(agent, name)
            out.append(builder())
        except Exception:  # noqa: BLE001
            continue
    return out


# Backward-compatible name used by legacy specialist helpers / tests.
langchain_tools_for_agent = native_tools_for_agent


# Confirm-gate / harness-only flags — never forward into bound callables.
_GATE_ONLY_ARG_KEYS = frozenset(_INTERNAL_INVOKE_KEYS)
_CL_TOOL_ARG_ALIASES = {
    "entityHint": "entity_hint",
    "groupBy": "group_by",
    "orderBy": "order_by",
    "dataScope": "data_scope",
    "metricRequest": "metric_request",
}


def _filter_tool_invoke_args(fn: Callable[..., Any], args: dict[str, Any]) -> dict[str, Any]:
    """Drop gate/harness-only keys and kwargs the bound fn cannot accept."""
    import inspect

    cleaned: dict[str, Any] = {}
    for key, value in dict(args or {}).items():
        if key in _GATE_ONLY_ARG_KEYS:
            continue
        cleaned[_CL_TOOL_ARG_ALIASES.get(key, key)] = value
    try:
        sig = inspect.signature(fn)
    except (TypeError, ValueError):
        return cleaned
    params = sig.parameters
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return cleaned
    allowed = {
        name
        for name, p in params.items()
        if p.kind
        in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        )
    }
    return {k: v for k, v in cleaned.items() if k in allowed}


def execute_tool_call(
    agent: str,
    name: str,
    args: dict[str, Any] | None,
    *,
    operation: str | None = None,
    role: str | None = None,
    workflow: str | None = None,
    action: str | None = None,
    last_query: dict[str, Any] | None = None,
    draft: dict[str, Any] | None = None,
    workflow_id: str | None = None,
    draft_key: str | None = None,
) -> str:
    """Execute one allowlisted tool by name; return JSON string."""
    gate = validate_specialist_tool(
        agent=agent,
        tool_name=name,
        operation=operation,
        role=role,
        workflow=workflow,
        action=action,
        last_query=last_query,
        args=args if isinstance(args, dict) else None,
        draft=draft,
        workflow_id=workflow_id,
        draft_key=draft_key,
    )
    if not gate.get("success"):
        return _json_dump(
            {
                "success": False,
                "error_code": gate.get("error_code") or "FORBIDDEN",
                "message": gate.get("message") or "Tool was not authorized.",
                "kind": gate.get("kind"),
                "retryable": False,
            }
        )
    builder = _TOOL_BUILDERS.get(name)
    if not builder:
        return _json_dump(
            {
                "success": False,
                "error_code": "TOOL_NOT_REGISTERED",
                "message": f"unknown tool {name}",
                "retryable": False,
            }
        )
    tool = builder()
    raw_args = dict(args or {})
    idem = str(raw_args.get("_idempotency_key") or "").strip()
    fn = getattr(tool, "fn", None)
    if callable(fn):
        invoke_args = _filter_tool_invoke_args(fn, raw_args)
    else:
        invoke_args = {
            k: v for k, v in raw_args.items() if k not in _GATE_ONLY_ARG_KEYS
        }
    token = _IDEMPOTENCY_KEY.set(idem)
    try:
        from app.tools.express_client import runtime_agent_scope

        with runtime_agent_scope(agent):
            result = tool.invoke(invoke_args)
        if isinstance(result, str):
            return result[:8000]
        return _json_dump(result)
    except Exception as exc:  # noqa: BLE001
        return _json_dump(
            {
                "success": False,
                "error_code": "VALIDATION_ERROR",
                "message": str(exc),
                "retryable": False,
                "kind": "tool_execution_failed",
            }
        )
    finally:
        _IDEMPOTENCY_KEY.reset(token)
