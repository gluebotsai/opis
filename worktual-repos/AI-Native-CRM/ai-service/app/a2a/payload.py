"""Normalize Hub Part.data / metadata into existing agent kwargs."""

from __future__ import annotations

from typing import Any, Mapping

from app.a2a.errors import InputRequiredError, SpokeRejectError

_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "contact_id": ("contact_id", "contactId", "cdpId", "cdp_id"),
    "organization_id": ("organization_id", "organizationId"),
    "owner_user_id": ("owner_user_id", "ownerUserId"),
    "activity_id": ("activity_id", "activityId"),
    "deal_id": ("deal_id", "dealId"),
    "invoice_id": ("invoice_id", "invoiceId"),
    "company_id": ("company_id", "companyId"),
    "location_id": ("location_id", "locationId"),
    "transcript_window": ("transcript_window", "transcriptWindow"),
    "contact_name": ("contact_name", "contactName"),
    "company_name": ("company_name", "companyName"),
    "context_pack": ("context_pack", "contextPack"),
    "product_catalog": ("product_catalog", "productCatalog"),
    "sender_organization_name": ("sender_organization_name", "senderOrganizationName"),
    "inbound_body": ("inbound_body", "inboundBody"),
    "is_reply": ("is_reply", "isReply"),
    "lead_summary": ("lead_summary", "leadSummary"),
    "reminder_window": ("reminder_window", "reminderWindow"),
    "participant_first_name": ("participant_first_name", "participantFirstName"),
    "organizer_name": ("organizer_name", "organizerName"),
    "when_label": ("when_label", "whenLabel"),
    "owner_name": ("owner_name", "ownerName"),
    "seller_name": ("seller_name", "sellerName"),
    "skill_id": ("skill_id", "skillId", "skill"),
    "business_type": ("business_type", "businessType"),
    "estimated_amount": ("estimated_amount", "estimatedAmount"),
    "action_type": ("action_type", "actionType"),
    "description": ("description",),
}

_ACTIVITY_ACTION_TYPES = {
    "notify": "note",
    "notification": "note",
    "note": "note",
    "call": "call",
    "phone": "call",
    "email": "email",
    "mail": "email",
    "meeting": "meeting",
    "appointment": "meeting",
    "task": "task",
    "open_task": "task",
    "create_task": "task",
    "sms": "sms",
}


def _first(data: Mapping[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data and data[key] not in (None, ""):
            return data[key]
    return None


def flatten_message(metadata: Mapping[str, Any] | None, data: Mapping[str, Any] | None) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    if metadata:
        merged.update(dict(metadata))
    if data:
        merged.update(dict(data))
    extra = merged.get("prior_context") or merged.get("priorContext")
    if isinstance(extra, dict):
        for key, value in extra.items():
            merged.setdefault(key, value)
    return merged


def _flatten_instruction(payload: dict[str, Any]) -> dict[str, Any]:
    """Lift Hub `instruction` objects so agents receive fields + a string command."""
    inst = payload.get("instruction")
    if not isinstance(inst, dict):
        return payload
    payload.setdefault("hubInstruction", inst)
    for key, value in inst.items():
        if key == "instruction":
            continue
        if payload.get(key) in (None, ""):
            payload[key] = value
    text = _first(inst, "description", "text", "body", "query", "task")
    if text not in (None, "") and not isinstance(text, (dict, list)):
        payload["instruction"] = str(text).strip()
    elif isinstance(payload.get("instruction"), dict):
        del payload["instruction"]
    return payload


def normalize_payload(raw: Mapping[str, Any]) -> dict[str, Any]:
    payload = _flatten_instruction(dict(raw))
    for canonical, aliases in _FIELD_ALIASES.items():
        if canonical in payload and payload[canonical] not in (None, ""):
            continue
        value = _first(payload, *aliases)
        if value not in (None, ""):
            payload[canonical] = value
    cdp = _first(payload, "cdpId", "cdp_id")
    if cdp and not payload.get("contact_id"):
        payload["contact_id"] = cdp
        payload.setdefault("contactId", cdp)
    if payload.get("contact_id") and not payload.get("contactId"):
        payload["contactId"] = payload["contact_id"]
    if payload.get("organization_id") and not payload.get("organizationId"):
        payload["organizationId"] = payload["organization_id"]
    return payload


def require_organization(payload: Mapping[str, Any]) -> str:
    org = str(payload.get("organization_id") or payload.get("organizationId") or "").strip()
    if not org:
        raise SpokeRejectError("organizationId is required on every Hub task", code="missing_org")
    return org


def _has_hub_goal(payload: Mapping[str, Any]) -> bool:
    for key in ("instruction", "description", "text", "query"):
        value = payload.get(key)
        if value not in (None, "") and not isinstance(value, dict):
            return True
    inst = payload.get("hubInstruction")
    if isinstance(inst, dict):
        for key in ("description", "text", "body", "query", "task"):
            if inst.get(key) not in (None, ""):
                return True
    action = str(payload.get("actionType") or payload.get("action_type") or "").strip()
    return bool(action)


def resolve_skill_id(payload: Mapping[str, Any]) -> str | None:
    """Optional Hub skillId hint. Required when there is no instruction for the supervisor."""
    skill = str(payload.get("skill_id") or payload.get("skillId") or "").strip()
    if skill:
        return skill
    if _has_hub_goal(payload):
        return None
    raise InputRequiredError(
        ["skillId"],
        "skillId or a Hub instruction is required so CRM can dispatch.",
    )


def require_skill_id(payload: Mapping[str, Any]) -> str:
    skill = resolve_skill_id(payload)
    if not skill:
        raise InputRequiredError(
            ["skillId"],
            "skillId is required when no Hub instruction is present.",
        )
    return skill


def _snake(name: str) -> str:
    out: list[str] = []
    for index, char in enumerate(name):
        if char.isupper() and index:
            out.append("_")
        out.append(char.lower())
    return "".join(out)


def lookup(payload: Mapping[str, Any], param: str) -> Any:
    if param in payload and payload[param] not in (None, ""):
        return payload[param]
    aliases = _FIELD_ALIASES.get(param) or _FIELD_ALIASES.get(_snake(param))
    if aliases:
        value = _first(payload, *aliases)
        if value not in (None, ""):
            return value
    camel = "".join(
        part.capitalize() if index else part for index, part in enumerate(param.split("_"))
    )
    snake = _snake(param)
    return _first(payload, camel, snake)


def is_delegated(payload: Mapping[str, Any]) -> bool:
    source = str(payload.get("source") or "").strip().lower()
    delegated = payload.get("delegated")
    return source == "hub" or delegated in (True, "true", "True", 1, "1")


def is_hub_execute(payload: Mapping[str, Any] | None) -> bool:
    data = payload or {}
    return is_delegated(data) or data.get("hubExecute") in (True, "true", "True", 1, "1")


def map_activity_action_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return "note"
    mapped = _ACTIVITY_ACTION_TYPES.get(raw)
    if mapped:
        return mapped
    return "note"


def hub_execute_text(payload: Mapping[str, Any], *, skill_id: str = "") -> str:
    """Turn a Hub instruction (string or object) into a do-not-ask command."""
    skill = skill_id or str(payload.get("skillId") or payload.get("skill_id") or "").strip()
    inst = payload.get("hubInstruction") if isinstance(payload.get("hubInstruction"), dict) else None
    if inst is None and isinstance(payload.get("instruction"), dict):
        inst = payload["instruction"]
    description = _first(payload, "text", "query", "task")
    if isinstance(payload.get("instruction"), str) and str(payload.get("instruction") or "").strip():
        description = description or payload["instruction"]
    if inst:
        description = description or _first(inst, "description", "text", "body", "query", "task")
    description = description or _first(payload, "description")
    contact = lookup(payload, "contact_id")
    deal = lookup(payload, "deal_id")
    action = _first(payload, "actionType", "action_type")
    if inst and action in (None, ""):
        action = _first(inst, "actionType", "action_type", "type")
    lines = [
        "Execute this Hub instruction now. Hub will not reply. "
        "Do not ask questions, do not ask for confirmation, and do not wait. "
        "Call the matching CRM tools and save immediately.",
        f"Skill: {skill or 'crm'}",
    ]
    if contact:
        lines.append(f"Contact cdpId: {contact}")
    if deal:
        lines.append(f"Deal id: {deal}")
    if action not in (None, ""):
        mapped = map_activity_action_type(action)
        label = str(action).strip()
        if mapped and mapped != label.lower():
            lines.append(f"Action type: {label} (log as {mapped})")
        else:
            lines.append(f"Action type: {label}")
    if description not in (None, "") and not isinstance(description, (dict, list)):
        lines.append(f"Instruction: {str(description).strip()}")
    else:
        lines.append(f"Run CRM skill {skill or 'the requested skill'} for this customer now.")
    return "\n".join(lines)


def hub_activity_draft(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    from datetime import datetime, timedelta, timezone

    contact = lookup(payload, "contact_id")
    if not contact:
        return None
    action = _first(payload, "actionType", "action_type", "type")
    inst = payload.get("hubInstruction") if isinstance(payload.get("hubInstruction"), dict) else None
    if inst and action in (None, ""):
        action = _first(inst, "actionType", "action_type", "type")
    description = _first(payload, "description", "subject", "text", "body")
    if isinstance(payload.get("instruction"), str) and not description:
        description = payload["instruction"]
    if inst and not description:
        description = _first(inst, "description", "text", "body")
    subject = str(description or "Hub notification").strip() or "Hub notification"
    activity_type = map_activity_action_type(action)
    draft: dict[str, Any] = {
        "contactId": str(contact),
        "type": activity_type,
        "subject": subject[:200],
        "body": subject[:4000],
    }
    assignee = _first(payload, "assigneeUserId", "assignee_user_id", "ownerUserId", "owner_user_id")
    if inst and assignee in (None, ""):
        assignee = _first(inst, "assigneeUserId", "assignee_user_id", "ownerUserId")
    if assignee not in (None, ""):
        draft["assigneeUserId"] = str(assignee).strip()
    if activity_type == "task":
        due = _first(payload, "dueAt", "due_at")
        if inst and due in (None, ""):
            due = _first(inst, "dueAt", "due_at")
        if due in (None, ""):
            due = (datetime.now(timezone.utc) + timedelta(days=2)).strftime(
                "%Y-%m-%dT%H:%M:%S.000Z"
            )
        draft["dueAt"] = str(due)
    else:
        draft["skippedOptional"] = ["dueAt"]
    return draft
