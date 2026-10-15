"""Fill missing Hub A2A fields from CRM/CDP when unambiguous."""

from __future__ import annotations

import re
from typing import Any, Mapping

from app.a2a.log import hub_instruction, log_a2a
from app.a2a.payload import lookup

_EMAIL_RE = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.I,
)

_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "contactId": ("contact_id", "contactId", "cdpId", "cdp_id"),
    "dealId": ("deal_id", "dealId"),
    "companyId": ("company_id", "companyId"),
    "instruction": ("instruction",),
    "body": ("body",),
}


def _has_value(payload: Mapping[str, Any], field: str) -> bool:
    if lookup(payload, field) not in (None, ""):
        return True
    for alias in _FIELD_ALIASES.get(field, (field,)):
        if payload.get(alias) not in (None, ""):
            return True
    return False


def _set_field(payload: dict[str, Any], field: str, value: str) -> None:
    payload[field] = value
    if field == "contactId":
        payload["contact_id"] = value
        payload["contactId"] = value
        payload.setdefault("cdpId", value)
    elif field == "dealId":
        payload["deal_id"] = value
        payload["dealId"] = value
    elif field == "companyId":
        payload["company_id"] = value
        payload["companyId"] = value
    elif field == "instruction":
        payload["instruction"] = value
    elif field == "body":
        payload["body"] = value


def extract_emails_from_text(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in _EMAIL_RE.finditer(text or ""):
        email = match.group(0).strip().lower()
        if email and email not in seen:
            seen.add(email)
            out.append(email)
    return out


def _local_text_hydrate(payload: dict[str, Any]) -> dict[str, str]:
    """No-network fills from instruction/description/text."""
    sources: dict[str, str] = {}
    if not _has_value(payload, "instruction"):
        for key in ("description", "text", "query", "task"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                _set_field(payload, "instruction", value.strip())
                sources["instruction"] = key
                break
    if not _has_value(payload, "body"):
        for key in ("instruction", "description", "text"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                _set_field(payload, "body", value.strip())
                sources["body"] = key
                break
    return sources


async def hydrate_hub_payload(
    payload: Mapping[str, Any],
    *,
    organization_id: str,
) -> dict[str, Any]:
    """Merge missing typed fields from CRM. Best-effort; never raises."""
    merged = dict(payload)
    local_sources = _local_text_hydrate(merged)

    text = " ".join(
        str(part or "").strip()
        for part in (
            merged.get("instruction"),
            merged.get("description"),
            merged.get("text"),
            merged.get("query"),
        )
        if part not in (None, "")
    )
    emails = extract_emails_from_text(text)

    try:
        from app.crm_client import CrmClient

        client = CrmClient(organization_id=organization_id)
        result = await client.resolve_hub_payload(
            {
                "contactId": lookup(merged, "contact_id") or merged.get("cdpId"),
                "dealId": lookup(merged, "deal_id"),
                "companyId": lookup(merged, "company_id"),
                "instruction": merged.get("instruction"),
                "description": merged.get("description"),
                "text": merged.get("text") or merged.get("query"),
                "body": merged.get("body"),
                "emails": emails,
            }
        )
        resolved = result.get("resolved") if isinstance(result, dict) else {}
        sources = result.get("sources") if isinstance(result, dict) else {}
        if not isinstance(resolved, dict):
            resolved = {}
        if not isinstance(sources, dict):
            sources = {}

        applied: dict[str, str] = dict(local_sources)
        for field, value in resolved.items():
            if not isinstance(value, str) or not value.strip():
                continue
            if _has_value(merged, field if field != "contactId" else "contact_id"):
                continue
            _set_field(merged, field, value.strip())
            source = str(sources.get(field) or "db")
            applied[field] = source

        if applied:
            log_a2a(
                step="hydrate",
                hub=hub_instruction(merged),
                crm={"applied": applied},
                message="Hub payload hydrated from CRM",
            )
    except Exception as exc:  # noqa: BLE001
        if local_sources:
            log_a2a(
                step="hydrate",
                hub=hub_instruction(merged),
                crm={"applied": local_sources, "apiError": str(exc)[:200]},
                message="Hub payload local hydrate only",
            )
    return merged
