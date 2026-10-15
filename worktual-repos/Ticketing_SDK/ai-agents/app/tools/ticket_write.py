"""Ticket write tools — Express mutate APIs (or MCP when tools_transport=mcp)."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

from app.contracts import tool_err
from app.tools.express_client import express_request
from app.tools.transport import invoke_tool

PRECREATE_NOT_DUPLICATE = "not_duplicate"


def _duplicate_check_has_list_evidence(draft: dict[str, Any]) -> bool:
    evidence = draft.get("_precreate_duplicate_evidence")
    if not isinstance(evidence, dict):
        return False
    issue = str(draft.get("issue") or draft.get("description") or "").strip()
    checked_issue = str(evidence.get("issue") or "").strip()
    customer = str(
        draft.get("customerEmail")
        or draft.get("contact")
        or draft.get("customerName")
        or ""
    ).strip()
    checked_customer = str(evidence.get("customer") or "").strip()
    draft_oid = str(draft.get("orderId") or draft.get("order_id") or "").strip()
    checked_oid = str(evidence.get("orderId") or "").strip()
    return bool(
        issue
        and checked_issue == issue
        and customer
        and checked_customer.lower() == customer.lower()
        and checked_oid == draft_oid
    )


def _upload_attachment_urls(raw: Any) -> list[str]:
    """Schema repair: LLM sometimes sends a JSON string instead of a list."""
    src: Any = raw
    if isinstance(src, str):
        text = src.strip()
        if text.startswith("["):
            try:
                src = json.loads(text)
            except json.JSONDecodeError:
                src = [text] if text.startswith("/uploads/") else []
        elif text.startswith("/uploads/"):
            src = [text]
        else:
            src = []
    if not isinstance(src, list):
        return []
    out: list[str] = []
    for item in src:
        url = str(item or "").strip()
        if url.startswith("/uploads/") and ".." not in url and "\\" not in url:
            if url not in out:
                out.append(url)
    return out


def _truthy_draft_flag(raw: Any) -> bool:
    if raw is True:
        return True
    return str(raw or "").strip().lower() in {"true", "1", "yes"}


def precreate_order_check_blocked(draft: dict[str, Any] | None) -> dict[str, Any] | None:
    """When the Executor stamped a purchase check, require a successful order lookup."""
    blob = draft if isinstance(draft, dict) else {}
    if not _truthy_draft_flag(blob.get("needsOrderCheck")):
        return None
    if _truthy_draft_flag(blob.get("orderVerified")):
        return None
    return tool_err(
        "ORDER_CHECK_REQUIRED",
        "This filing is about a purchase. Call get_customer_order for this "
        "customer and organization with the order id they gave. File only after "
        "that tool result shows the order exists for them.",
        payload={
            "next_tool": "get_customer_order",
            "awaiting": "orderId",
        },
    )


def precreate_duplicate_blocked(draft: dict[str, Any] | None) -> dict[str, Any] | None:
    """Refuse create on a live ticket.create pin until list_tickets was stamped clear."""
    blob = draft if isinstance(draft, dict) else {}
    stamp = str(blob.get("precreate_duplicate_check") or "").strip().lower()
    if stamp == PRECREATE_NOT_DUPLICATE and _duplicate_check_has_list_evidence(blob):
        return None
    return tool_err(
        "DUPLICATE_CHECK_REQUIRED",
        "After the issue is collected, call list_tickets for this customer. "
        "Same issue, or the same listed orderId as this draft (even when the "
        "new issue text differs), and status "
        "is not Resolved or Closed: do not create — quote that listed ticket "
        "number. Same issue or same orderId and Resolved or Closed: ask "
        "whether to reopen that listed ticket; do not stamp not_duplicate "
        "until they decline reopen and still want a new file. If none match, "
        "patch_ticket_draft with precreate_duplicate_check=not_duplicate, "
        "then create.",
        payload={
            "next_tool": "list_tickets",
            "awaiting": "precreate_duplicate_check",
        },
    )


def _ticket_path(ticket_number: str) -> str | None:
    from app.tools.catalog_tools import entity_ref_invented

    tn = (ticket_number or "").strip()
    if not tn or entity_ref_invented(tn):
        return None
    # Keep leading # so Express decode matches UI ids like "#12938"
    if not tn.startswith("#") and tn.lstrip("#").isdigit():
        tn = f"#{tn.lstrip('#')}"
    return f"/api/tickets/{quote(tn, safe='')}"


def escalate_ticket(
    ticket_number: str,
    *,
    assignee: str | None = None,
    assignee_id: str | None = None,
    agent: str | None = None,
    agent_id: str | None = None,
    rationale: str | None = None,
) -> dict[str, Any]:
    """
    Escalate via POST /api/tickets/:id/escalate (same path as UI).

    Optional L1 agent_id/agent updates assignee when Express supports it.
    """
    path = _ticket_path(ticket_number)
    if not path:
        return tool_err("BAD_INPUT", "ticket_number is required")

    args: dict[str, Any] = {"ticket_number": (ticket_number or "").strip()}
    if assignee_id:
        args["assignee_id"] = assignee_id
    if assignee:
        args["assignee"] = assignee
    if agent_id:
        args["agent_id"] = agent_id
    if agent:
        args["agent"] = agent
    if rationale:
        args["rationale"] = rationale

    def _express() -> dict[str, Any]:
        body: dict[str, Any] = {}
        if assignee_id:
            body["assigneeId"] = assignee_id
        if assignee:
            body["assignee"] = assignee
            body["assigneeName"] = assignee
        if agent_id:
            body["agentId"] = agent_id
        if agent:
            body["agentName"] = agent
        if rationale:
            body["rationale"] = rationale
        return express_request("POST", f"{path}/escalate", json_body=body)

    return invoke_tool("escalate_ticket", args, express_call=_express)


def auto_assign_ticket(ticket_number: str) -> dict[str, Any]:
    """Route an existing ticket via Express POST /api/tickets/:id/auto-assign."""
    path = _ticket_path(ticket_number)
    if not path:
        return tool_err("BAD_INPUT", "ticket_number is required")

    def _express() -> dict[str, Any]:
        return express_request("POST", f"{path}/auto-assign", json_body={})

    return invoke_tool(
        "auto_assign_ticket",
        {"ticket_number": (ticket_number or "").strip()},
        express_call=_express,
    )


def create_ticket(payload: dict[str, Any]) -> dict[str, Any]:
    """Create via POST /api/tickets; canonical intake owns enrichment/triage."""
    if not isinstance(payload, dict) or not payload:
        return tool_err("BAD_INPUT", "create payload is required")
    body = {k: v for k, v in payload.items() if v is not None and v != ""}
    idempotency_key = str(body.pop("_idempotency_key", "") or "").strip()
    if not str(body.get("customerName") or "").strip() and not str(
        body.get("subject") or ""
    ).strip():
        return tool_err("BAD_INPUT", "customerName or subject is required")

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            "/api/tickets",
            json_body=body,
            extra_headers=(
                {"X-Idempotency-Key": idempotency_key}
                if idempotency_key
                else None
            ),
        )

    from app.memory import emit_workflow_event

    emit_workflow_event("tool_called", tool="create_ticket")
    result = invoke_tool("create_ticket", body, express_call=_express)
    emit_workflow_event(
        "tool_succeeded" if result.get("success") else "tool_failed",
        tool="create_ticket",
        error_code=result.get("error_code"),
    )
    # Surface assignment for the specialist reply (never invent "Unassigned").
    if isinstance(result, dict) and result.get("success"):
        payload_out = result.get("payload")
        if not isinstance(payload_out, dict):
            payload_out = {}
            result["payload"] = payload_out
        for key in (
            "assignee",
            "assigneeId",
            "assignee_id",
            "resolver",
            "resolverId",
            "resolver_id",
            "queue",
            "priority",
            "ticketNumber",
            "ticket_number",
            "id",
        ):
            if key in body and body[key] not in (None, "") and key not in payload_out:
                payload_out[key] = body[key]
        if body.get("assignee") and not payload_out.get("assignee"):
            payload_out["assignee"] = body.get("assignee")
        if body.get("resolver") and not payload_out.get("resolver"):
            payload_out["resolver"] = body.get("resolver")
    return result


def enrich_ticket(payload: dict[str, Any]) -> dict[str, Any]:
    """Confirm preview: in-process triage (categorize + prioritize + route).

    Same path as the old guided create flow (`_enrich_ticket_preview` /
    `run_triage_assign`). Avoid Express `/api/tickets/enrich` preview from
    inside ai-agents — that skips full triage and can deadlock uvicorn when
    Express calls back into `/tasks/triage-assign`.
    """
    from app.contracts import tool_ok
    from app.tasks.chat_commands import _enrich_ticket_preview
    from app.tools.express_client import get_tool_actor

    if not isinstance(payload, dict):
        return tool_err("VALIDATION_ERROR", "enrich payload is required")

    body = {
        key: value
        for key, value in payload.items()
        if key
        in {
            "customerName",
            "customerEmail",
            "customerPhone",
            "contact",
            "issue",
            "subject",
            "description",
            "priority",
            "queue",
        }
        and value not in (None, "")
    }
    # contact → email/phone for triage
    contact = str(body.pop("contact", "") or "").strip()
    if contact:
        if "@" in contact and not body.get("customerEmail"):
            body["customerEmail"] = contact
        elif not body.get("customerPhone"):
            body["customerPhone"] = contact

    if not body.get("customerName") or not body.get("issue"):
        return tool_err(
            "VALIDATION_ERROR", "customerName and issue are required for enrichment"
        )

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    if not org:
        return tool_err("FORBIDDEN", "organization_id is required for enrichment")

    from app.memory import emit_workflow_event

    emit_workflow_event("tool_called", tool="enrich_ticket")
    try:
        merged, enrichment_error = _enrich_ticket_preview(
            body,
            org,
            user_id=str(actor.user_id) if actor and actor.user_id else None,
            user_name=str(actor.user_name) if actor and actor.user_name else None,
            user_role=str(actor.user_role) if actor and actor.user_role else None,
        )
    except Exception as exc:  # noqa: BLE001
        emit_workflow_event(
            "tool_failed", tool="enrich_ticket", error_code="RETRYABLE"
        )
        return tool_err("RETRYABLE", f"Ticket enrichment failed: {exc}")

    if enrichment_error:
        emit_workflow_event(
            "tool_failed",
            tool="enrich_ticket",
            error_code=str(enrichment_error.get("code") or "RETRYABLE"),
        )
        return tool_err(
            str(enrichment_error.get("code") or "RETRYABLE"),
            str(enrichment_error.get("message") or "Ticket enrichment failed"),
        )

    emit_workflow_event("tool_succeeded", tool="enrich_ticket")
    return tool_ok(
        {
            **merged,
            "awaiting": "confirm",
            "enriched": True,
            "next_step": (
                "Confirm filing in natural, varied wording — do not reuse a stock "
                "\"I've prepared the ticket\" script. Facts must match the payload."
            ),
        }
    )


def verify_ticket_customer(payload: dict[str, Any]) -> dict[str, Any]:
    """Check CDP/directory for email or phone before continuing create-ticket."""
    from app.contracts import tool_err, tool_ok
    from app.tasks.chat_commands import _bind_directory_customer
    from app.tools.express_client import get_tool_actor
    from app.workflow_schemas import email_looks_valid, phone_looks_valid

    if not isinstance(payload, dict):
        return tool_err("VALIDATION_ERROR", "verify payload is required")

    body = {
        key: value
        for key, value in payload.items()
        if key
        in {
            "customerName",
            "customerEmail",
            "customerPhone",
            "contact",
            "email",
            "phone",
        }
        and value not in (None, "")
    }
    contact = str(body.pop("contact", "") or "").strip()
    if contact:
        # contact is a single email-or-phone field — never copy an email into phone.
        if "@" in contact:
            if not body.get("customerEmail"):
                body["customerEmail"] = contact
        elif not body.get("customerPhone"):
            body["customerPhone"] = contact
    if not body.get("customerEmail") and body.get("email"):
        body["customerEmail"] = body.pop("email")
    if not body.get("customerPhone") and body.get("phone"):
        body["customerPhone"] = body.pop("phone")
    # Drop phone values that are clearly emails (LLM often duplicates contact).
    phone_raw = str(body.get("customerPhone") or "").strip()
    if phone_raw and "@" in phone_raw:
        if not body.get("customerEmail"):
            body["customerEmail"] = phone_raw
        body.pop("customerPhone", None)

    email = str(body.get("customerEmail") or "").strip().lower()
    phone = str(body.get("customerPhone") or "").strip()
    if not email_looks_valid(email) and not phone_looks_valid(phone):
        return tool_err(
            "MISSING_FIELDS",
            "customerEmail or customerPhone is required to verify the customer in the directory.",
            payload={"missing": ["contact"], "awaiting": "contact"},
        )

    actor = get_tool_actor()
    org = str((actor.organization_id if actor else "") or "").strip()
    if not org:
        return tool_err("FORBIDDEN", "organization_id is required for directory lookup")

    merged, status, hits = _bind_directory_customer(
        body,
        org,
        user_id=str(actor.user_id) if actor and actor.user_id else None,
        user_name=str(actor.user_name) if actor and actor.user_name else None,
        user_role=str(actor.user_role) if actor and actor.user_role else None,
    )
    contact_label = email or phone or contact
    name = str(merged.get("customerName") or body.get("customerName") or "").strip()

    if status == "ok" and str(merged.get("customerId") or "").strip():
        return tool_ok(
            {
                "exists": True,
                "customerId": merged.get("customerId"),
                "customerName": merged.get("customerName") or name,
                "customerEmail": merged.get("customerEmail") or email,
                "customerPhone": merged.get("customerPhone") or phone,
                "customerDirectoryStatus": "verified",
                "message": (
                    "Verification complete (customerId in payload). "
                    "Do NOT ask the user to confirm the match. "
                    "Staff surface: speak to the staff agent in a fresh, polite "
                    "paragraph. Use customerName + contact from the payload, then "
                    "ask what to write up for that person. Do not greet the "
                    "customer as if they are in chat. Do not copy a stock line. "
                    "Portal surface: talk to the customer in new wording. Never "
                    "say directory, CDP, verified, customer found, or customerId. "
                    "Then set next_step=issue and call patch_ticket_draft with "
                    "awaiting=issue if needed (do not call enrich_ticket before "
                    "filing)."
                ),
                "next_step": "issue",
            }
        )

    if status == "many":
        matches = [
            {
                "id": h.get("id"),
                "name": h.get("name"),
                "email": h.get("email"),
                "phone": h.get("phone"),
            }
            for h in hits[:5]
            if isinstance(h, dict)
        ]
        return tool_ok(
            {
                "exists": False,
                "ambiguous": True,
                "matches": matches,
                "customerDirectoryStatus": "ambiguous",
                "message": (
                    "Multiple directory customers match that contact. Ask which one "
                    "they mean before continuing the ticket."
                ),
                "next_step": "clarify_customer",
            }
        )

    if status == "none":
        return tool_ok(
            {
                "exists": False,
                "cannot_create": True,
                "customerName": name,
                "customerEmail": merged.get("customerEmail") or email,
                "customerPhone": merged.get("customerPhone") or phone,
                "contactChecked": contact_label,
                "customerDirectoryStatus": "missing",
                "customer_not_found": True,
                "message": (
                    f"No matching person for {contact_label}. Cannot add them "
                    f"and cannot file a ticket. Write a polite paragraph from "
                    f"these facts only: the email or phone checked, that we have "
                    f"no matching person on file, and that a ticket needs someone "
                    f"already on file. Do not say CDP, directory, 360, or "
                    f"verified. Do not offer to add or edit them. Do not ask "
                    f"for the issue. A few complete sentences — not one clipped "
                    f"line and not an Alternatives list."
                ),
                "next_step": "stop",
            }
        )

    # status error / unexpected: do not instruct the model to retry forever
    return tool_err(
        "RETRYABLE",
        (
            "Directory lookup failed temporarily. Tell the user verification is "
            "unavailable right now and ask them to try again in a moment — do not "
            "call verify_ticket_customer again with the same arguments this turn."
        ),
        payload={"retryable": True, "status": status},
        retryable=True,
    )


def update_ticket(
    ticket_number: str,
    *,
    status: str | None = None,
    priority: str | None = None,
    assignee: str | None = None,
    resolver: str | None = None,
    subject: str | None = None,
    description: str | None = None,
    queue: str | None = None,
    category: str | None = None,
    ai_summary: str | None = None,
    attachments: list[str] | None = None,
) -> dict[str, Any]:
    """Update via PUT /api/tickets/:id (same fields as UI handleUpdateTicket)."""
    path = _ticket_path(ticket_number)
    if not path:
        return tool_err("BAD_INPUT", "ticket_number is required")
    body: dict[str, Any] = {}
    if status is not None and str(status).strip():
        body["status"] = str(status).strip()
    if priority is not None and str(priority).strip():
        body["priority"] = str(priority).strip()
    if assignee is not None or resolver is not None:
        from app.tools.catalog_tools import entity_ref_invented

        if assignee is not None:
            assignee_name = str(assignee).strip()
            if assignee_name and not entity_ref_invented(assignee_name):
                body["assignee"] = assignee_name
        if resolver is not None:
            resolver_name = str(resolver).strip()
            if resolver_name and not entity_ref_invented(resolver_name):
                body["resolver"] = resolver_name
    if subject is not None:
        body["subject"] = str(subject).strip()
    if description is not None:
        body["description"] = str(description).strip()
    if queue is not None:
        body["queue"] = str(queue).strip()
    if category is not None:
        body["category"] = str(category).strip()
    if ai_summary is not None:
        body["aiSummary"] = str(ai_summary).strip()
    urls = _upload_attachment_urls(attachments)
    if urls:
        body["attachments"] = urls
    if not body:
        return tool_err("BAD_INPUT", "at least one update field is required")

    args = {"ticket_number": (ticket_number or "").strip(), **body}

    def _express() -> dict[str, Any]:
        return express_request("PUT", path, json_body=body)

    return invoke_tool("update_ticket", args, express_call=_express)


def request_ticket_reassignment(
    ticket_number: str,
    *,
    person: str | None = None,
    resolver: str | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    """Resolver asks the ticket agent to approve an L2 move."""
    path = _ticket_path(ticket_number)
    if not path:
        return tool_err("BAD_INPUT", "ticket_number is required")
    target = str(resolver or person or "").strip()
    why = str(reason or "").strip()
    if not target:
        return tool_err("BAD_INPUT", "resolver name is required")
    if len(why) < 3:
        return tool_err("BAD_INPUT", "A reason is required.")
    body = {"resolver": target, "reason": why}

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            f"{path}/reassignment-requests",
            json_body=body,
        )

    return invoke_tool("request_ticket_reassignment", body, express_call=_express)


def decide_ticket_reassignment(
    request_id: str,
    *,
    accept: bool = True,
) -> dict[str, Any]:
    """Ticket agent approves or denies a pending reassignment request."""
    rid = str(request_id or "").strip()
    if not rid:
        return tool_err("BAD_INPUT", "request_id is required")
    body = {"accept": bool(accept)}

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            f"/api/reassignment-requests/{quote(rid, safe='')}/decide",
            json_body=body,
        )

    return invoke_tool("decide_ticket_reassignment", {**body, "request_id": rid}, express_call=_express)


def list_reassignment_requests() -> dict[str, Any]:
    def _express() -> dict[str, Any]:
        return express_request("GET", "/api/reassignment-requests")

    return invoke_tool("list_reassignment_requests", {}, express_call=_express)


def add_ticket_note(
    ticket_number: str,
    text: str,
    *,
    visibility: str = "internal",
    send_customer_email: bool = False,
) -> dict[str, Any]:
    """Add note via POST /api/tickets/:id/notes (same as TicketsView)."""
    path = _ticket_path(ticket_number)
    if not path:
        return tool_err("BAD_INPUT", "ticket_number is required")
    body_text = (text or "").strip()
    if not body_text:
        return tool_err("BAD_INPUT", "note text is required")
    vis = "public" if str(visibility or "").lower() == "public" else "internal"
    mail = bool(send_customer_email)
    args = {
        "ticket_number": (ticket_number or "").strip(),
        "text": body_text,
        "visibility": vis,
        "send_customer_email": mail,
    }
    json_body: dict[str, Any] = {"text": body_text, "visibility": vis}
    if mail:
        json_body["sendCustomerEmail"] = True

    def _express() -> dict[str, Any]:
        return express_request(
            "POST",
            f"{path}/notes",
            json_body=json_body,
        )

    return invoke_tool("add_ticket_note", args, express_call=_express)
