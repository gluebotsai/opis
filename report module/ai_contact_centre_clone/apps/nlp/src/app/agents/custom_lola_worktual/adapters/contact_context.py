"""Build long-term contact context for Lola prompts."""

from __future__ import annotations

from typing import Any

from app.agents.custom_lola_worktual.adapters.cc_core_client import (
    get_conversation_state,
)
from app.agents.custom_lola_worktual.session import (
    get_session_long_term_summary,
    get_session_long_term_summary_contact_id,
    set_session_long_term_summary,
)
from app.services.contact_enrich_policy import ContactProfileSnapshot
from app.services.omnichannel_memory import fetch_contact_omnichannel_memory


def contact_profile_from_api(contact: dict[str, Any]) -> dict[str, Any]:
    return {
        "contactId": contact.get("id") or contact.get("contactId") or contact.get("contact_id"),
        "firstName": contact.get("firstName") or contact.get("first_name"),
        "lastName": contact.get("lastName") or contact.get("last_name"),
        "primaryEmail": contact.get("primaryEmail")
        or contact.get("primary_email")
        or contact.get("email"),
        "primaryPhone": contact.get("primaryPhone")
        or contact.get("primary_phone")
        or contact.get("phone"),
        "company": contact.get("company"),
        "city": contact.get("city"),
        "country": contact.get("country"),
    }


def contact_profile_from_tenant(tenant_context: dict[str, Any]) -> dict[str, Any]:
    raw = tenant_context.get("contact_profile")
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def merge_contact_profile_from_tenant(
    cached: dict[str, Any],
    tenant_context: dict[str, Any],
) -> dict[str, Any]:
    tenant_profile = contact_profile_from_tenant(tenant_context)
    if not tenant_profile:
        return dict(cached)

    merged = dict(cached) if cached else dict(tenant_profile)
    if not merged.get("contactId") and tenant_profile.get("contactId"):
        return {**tenant_profile, **{key: value for key, value in merged.items() if value}}

    for key, value in tenant_profile.items():
        if value and not merged.get(key):
            merged[key] = value
    return merged


async def fetch_contact_profile_for_turn(
    organization_id: str,
    conversation_id: str,
    tenant_context: dict[str, Any],
) -> dict[str, Any]:
    """Legacy helper kept for tests; production uses tenant_context + session cache."""
    fallback = contact_profile_from_tenant(tenant_context)
    try:
        state = await get_conversation_state(organization_id, conversation_id)
    except Exception:
        return fallback
    contact = state.get("contact") if isinstance(state, dict) else None
    if isinstance(contact, dict):
        return contact_profile_from_api(contact)
    return fallback


def profile_mapping_from_snapshot(profile: ContactProfileSnapshot) -> dict[str, Any]:
    return {
        "contactId": profile.contact_id,
        "firstName": profile.first_name,
        "lastName": profile.last_name,
        "primaryEmail": profile.primary_email,
        "primaryPhone": profile.primary_phone,
        "company": profile.company,
        "city": profile.city,
        "country": profile.country,
    }


def _profile_lines(profile: ContactProfileSnapshot) -> list[str]:
    lines: list[str] = []
    name = " ".join(
        part for part in [profile.first_name, profile.last_name] if part
    ).strip()
    if name:
        lines.append(f"Name: {name}")
    if profile.primary_email:
        lines.append(f"Email: {profile.primary_email}")
    if profile.primary_phone:
        lines.append(f"Phone: {profile.primary_phone}")
    if profile.company:
        lines.append(f"Company: {profile.company}")
    if profile.city or profile.country:
        lines.append(f"Location: {', '.join(p for p in [profile.city, profile.country] if p)}")
    return lines


def compose_long_term_summary_text(
    profile: ContactProfileSnapshot,
    channel_items: list[dict[str, Any]],
    tenant_context: dict[str, Any],
) -> str:
    sections: list[str] = []
    sections.extend(_profile_lines(profile))

    omni = tenant_context.get("omni_channel_summary") or tenant_context.get("omniChannelSummary")
    if isinstance(omni, str) and omni.strip():
        sections.append(f"Omni-channel summary: {omni.strip()}")

    for index, item in enumerate(channel_items[:8]):
        channel = item.get("channel") or item.get("channelType") or "channel"
        summary = item.get("summary") or item.get("body") or ""
        if str(summary).strip():
            label = "Latest previous interaction" if index == 0 else f"[{channel}]"
            occurred_at = str(item.get("occurredAt") or item.get("occurred_at") or "").strip()
            when = f" ({occurred_at})" if occurred_at and index == 0 else ""
            if index == 0:
                sections.append(
                    f"{label} [{channel}]{when}: {str(summary).strip()}"
                )
            else:
                sections.append(f"{label} {str(summary).strip()}")

        if index == 0:
            sentiment = item.get("sentiment")
            if isinstance(sentiment, dict):
                mood = str(
                    sentiment.get("customerLabel")
                    or sentiment.get("customer_label")
                    or ""
                ).strip()
                rationale = str(
                    sentiment.get("customerRationale")
                    or sentiment.get("customer_rationale")
                    or sentiment.get("summary")
                    or ""
                ).strip()
                if mood:
                    mood_line = f"Previous session mood: {mood}"
                    if rationale:
                        mood_line += f" ({rationale})"
                    sections.append(mood_line + ".")

    rolling = tenant_context.get("rolling_summary")
    if isinstance(rolling, str) and rolling.strip():
        sections.append(f"Conversation memory: {rolling.strip()}")

    facts = tenant_context.get("extracted_facts") or []
    if isinstance(facts, str):
        facts = [facts]
    if isinstance(facts, list):
        fact_lines = [str(fact).strip() for fact in facts if str(fact).strip()]
        if fact_lines:
            sections.append("Known facts: " + "; ".join(fact_lines[:20]))

    if not sections:
        return "No information provided"
    return "\n".join(sections)


async def ensure_session_long_term_summary(
    organization_id: str,
    conversation_id: str,
    profile: ContactProfileSnapshot,
    tenant_context: dict[str, Any],
) -> str:
    contact_id = profile.contact_id or ""
    cached = get_session_long_term_summary(conversation_id)
    cached_contact_id = get_session_long_term_summary_contact_id(conversation_id)
    if cached is not None and cached_contact_id == contact_id:
        return cached

    channel_items: list[dict[str, Any]] = []
    if profile.contact_id:
        try:
            memory = await fetch_contact_omnichannel_memory(organization_id, profile.contact_id)
            channel_items = memory.get("channel_items") or []
            omni = memory.get("omni_channel_summary")
            if isinstance(omni, str) and omni.strip():
                tenant_context["omni_channel_summary"] = omni.strip()
        except Exception:
            channel_items = []

    summary = compose_long_term_summary_text(profile, channel_items, tenant_context)
    set_session_long_term_summary(conversation_id, summary, contact_id=contact_id)
    return summary


async def build_long_term_summary(
    organization_id: str,
    conversation_id: str,
    tenant_context: dict[str, Any],
) -> str:
    """Backward-compatible wrapper for tests and legacy callers."""
    profile = ContactProfileSnapshot.from_mapping(tenant_context.get("contact_profile") or {})
    return await ensure_session_long_term_summary(
        organization_id,
        conversation_id,
        profile,
        tenant_context,
    )
