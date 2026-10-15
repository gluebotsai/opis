"""Contact enrich gating and profile context helpers (shared by support bot and coworker)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.schemas.bot import ContactEntities

_PROFILE_FIELDS = (
    "email",
    "phone",
    "firstName",
    "lastName",
    "company",
    "city",
    "country",
)


@dataclass(frozen=True)
class ContactProfileSnapshot:
    contact_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    primary_email: str | None = None
    primary_phone: str | None = None
    company: str | None = None
    city: str | None = None
    country: str | None = None

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> ContactProfileSnapshot:
        if not data:
            return cls()
        return cls(
            contact_id=_text(data.get("contactId") or data.get("id") or data.get("contact_id")),
            first_name=_text(data.get("firstName") or data.get("first_name")),
            last_name=_text(data.get("lastName") or data.get("last_name")),
            primary_email=_text(data.get("primaryEmail") or data.get("primary_email") or data.get("email")),
            primary_phone=_text(data.get("primaryPhone") or data.get("primary_phone") or data.get("phone")),
            company=_text(data.get("company")),
            city=_text(data.get("city")),
            country=_text(data.get("country")),
        )

    def flags(self) -> dict[str, bool]:
        return {
            "has_name": bool(self.first_name or self.last_name),
            "has_email": bool(self.primary_email),
            "has_phone": bool(self.primary_phone),
        }


@dataclass(frozen=True)
class EnrichDecision:
    action: str
    payload: dict[str, str] = field(default_factory=dict)
    reason: str = ""
    fields: list[str] = field(default_factory=list)
    confirmation_payload: dict[str, str] = field(default_factory=dict)
    confirmation_fields: list[str] = field(default_factory=list)


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def normalize_email(value: str | None) -> str | None:
    trimmed = _text(value)
    if not trimmed or "@" not in trimmed:
        return None
    return trimmed.lower()


def normalize_phone(value: str | None) -> str | None:
    trimmed = _text(value)
    if not trimmed:
        return None
    digits = re.sub(r"\D", "", trimmed)
    if len(digits) < 7:
        return None
    return digits


def normalize_name(value: str | None) -> str | None:
    trimmed = _text(value)
    if not trimmed:
        return None
    return re.sub(r"\s+", " ", trimmed).lower()


def format_contact_profile_block(profile: ContactProfileSnapshot) -> str:
    email_status = (
        "PRESENT — do not call contact_enrich for this email unless the customer asks to change it"
        if profile.primary_email
        else "MISSING — call contact_enrich when the customer states their email"
    )
    phone_status = (
        "PRESENT — do not call contact_enrich for this phone unless the customer asks to change it"
        if profile.primary_phone
        else "MISSING — call contact_enrich when the customer states their phone"
    )
    lines = [
        "AUTHORITATIVE CONTACT PROFILE (read-only; do not invent values):",
        f"contactId: {profile.contact_id or 'null'}",
        f"firstName: {profile.first_name or 'null'}",
        f"lastName: {profile.last_name or 'null'}",
        f"primaryEmail: {profile.primary_email or 'null'}",
        f"emailStatus: {email_status}",
        f"primaryPhone: {profile.primary_phone or 'null'}",
        f"phoneStatus: {phone_status}",
        f"company: {profile.company or 'null'}",
        f"city: {profile.city or 'null'}",
        f"country: {profile.country or 'null'}",
        "After a successful contact_enrich, treat the tool response contact as the updated profile.",
        "When asked, you may tell the customer their firstName, lastName, city, and company from this block.",
    ]
    return "\n".join(lines)


def _entity_payload(entities: ContactEntities) -> dict[str, str]:
    return {
        key: value
        for key, value in {
            "email": entities.email,
            "phone": entities.phone,
            "firstName": entities.first_name,
            "lastName": entities.last_name,
            "company": entities.company,
            "city": entities.city,
            "country": entities.country,
        }.items()
        if isinstance(value, str) and value.strip()
    }


def _profile_value(profile: ContactProfileSnapshot, field_name: str) -> str | None:
    if field_name == "email":
        return profile.primary_email
    if field_name == "phone":
        return profile.primary_phone
    if field_name == "firstName":
        return profile.first_name
    if field_name == "lastName":
        return profile.last_name
    if field_name == "company":
        return profile.company
    if field_name == "city":
        return profile.city
    if field_name == "country":
        return profile.country
    return None


def _values_match(field_name: str, proposed: str, existing: str | None) -> bool:
    if field_name == "email":
        return normalize_email(proposed) == normalize_email(existing)
    if field_name == "phone":
        return normalize_phone(proposed) == normalize_phone(existing)
    return normalize_name(proposed) == normalize_name(existing)


def _field_empty(profile: ContactProfileSnapshot, field_name: str) -> bool:
    return not _text(_profile_value(profile, field_name))


def decide_contact_enrichment(
    entities: ContactEntities,
    profile: ContactProfileSnapshot | None,
    *,
    confirmed: bool = False,
) -> EnrichDecision:
    payload = _entity_payload(entities)
    if not payload:
        return EnrichDecision(action="skip_empty", reason="no_entities")

    if not profile or not profile.contact_id:
        return EnrichDecision(
            action="call",
            payload=payload,
            reason="no_linked_profile",
            fields=list(payload.keys()),
        )

    to_apply: dict[str, str] = {}
    mismatches: list[str] = []

    for field_name, proposed in payload.items():
        existing = _profile_value(profile, field_name)
        if _field_empty(profile, field_name):
            to_apply[field_name] = proposed
            continue
        if _values_match(field_name, proposed, existing):
            continue
        mismatches.append(field_name)

    if mismatches and not confirmed:
        confirmation_payload = {
            key: payload[key] for key in mismatches if key in payload
        }
        return EnrichDecision(
            action="call",
            payload={**to_apply, **confirmation_payload},
            fields=list(to_apply.keys()),
            confirmation_payload=confirmation_payload,
            reason=(
                "partial_with_confirmation"
                if to_apply
                else "confirmation_required"
            ),
            confirmation_fields=mismatches,
        )

    if mismatches and confirmed:
        for field_name in mismatches:
            to_apply[field_name] = payload[field_name]

    if not to_apply:
        return EnrichDecision(action="skip_match", reason="already_on_profile")

    return EnrichDecision(
        action="call",
        payload=to_apply,
        reason="fill_or_update",
        fields=list(to_apply.keys()),
    )


def contact_enrich_already_called(messages: list[dict[str, Any]]) -> bool:
    for item in messages:
        if item.get("role") == "tool" and str(item.get("name") or "") == "contact_enrich":
            return True
        for call in item.get("tool_calls") or []:
            function = call.get("function") or {}
            if str(function.get("name") or "") == "contact_enrich":
                return True
    return False


def refresh_profile_from_tool_result(
    result: dict[str, Any] | None,
) -> tuple[ContactProfileSnapshot | None, str | None]:
    if not result or not isinstance(result, dict):
        return None, None
    nested = result.get("result")
    if isinstance(nested, dict):
        contact = nested.get("contact")
        canonical = nested.get("canonicalContactId") or nested.get("canonical_contact_id")
        if isinstance(contact, dict):
            profile = ContactProfileSnapshot.from_mapping(contact)
            contact_id = _text(canonical) or profile.contact_id
            if contact_id:
                return ContactProfileSnapshot(
                    contact_id=contact_id,
                    first_name=profile.first_name,
                    last_name=profile.last_name,
                    primary_email=profile.primary_email,
                    primary_phone=profile.primary_phone,
                    company=profile.company,
                    city=profile.city,
                    country=profile.country,
                ), contact_id
    contact = result.get("contact")
    if isinstance(contact, dict):
        profile = ContactProfileSnapshot.from_mapping(contact)
        return profile, profile.contact_id
    return None, None
