"""Structured contacts session facts for Live session JSON — no generated instructions."""

from __future__ import annotations

from typing import Any

from app.mas.skills.state import (
    CONTACTS_MODULE,
    SkillStateStore,
    get_active_skill_id,
    is_active_contact_creation,
)


def _draft(session: dict[str, Any]) -> dict[str, Any]:
    raw = session.get("draft_contact")
    return dict(raw) if isinstance(raw, dict) else {}


def _profile_mode(session: dict[str, Any]) -> str:
    from app.industry_packs.loader import normalize_campaign_profile

    profile = normalize_campaign_profile(session.get("campaign_profile"))
    return str(profile.get("mode") or "b2b").strip().lower()


def _has_valid_email(draft: dict[str, Any]) -> bool:
    from app.agents.contacts.validation import is_valid_email

    email = str(draft.get("email") or "").strip()
    return bool(email) and is_valid_email(email)


def _has_valid_phone(draft: dict[str, Any]) -> bool:
    from app.agents.contacts.validation import parse_and_validate_phone

    phone = str(draft.get("phone") or "").strip()
    return bool(phone) and bool(parse_and_validate_phone(phone).get("ok"))


def live_session_facts(session: dict[str, Any] | None) -> dict[str, Any]:
    """Pure facts from session — injected into Live session JSON for the LLM."""
    if not isinstance(session, dict):
        return {}

    draft = _draft(session)
    mode = _profile_mode(session)
    store = SkillStateStore()
    skill_summary = store.summary_for_prompt(session, CONTACTS_MODULE)
    active_skill = get_active_skill_id(session, CONTACTS_MODULE)
    candidates = session.get("candidates") if isinstance(session.get("candidates"), list) else []

    from app.agents.contacts.draft_ingest import next_creation_prompt_field

    fn = str(draft.get("first_name") or "").strip()
    ln = str(draft.get("last_name") or "").strip()
    has_email = _has_valid_email(draft)
    has_phone = _has_valid_phone(draft)
    has_identity = has_email or has_phone

    facts: dict[str, Any] = {
        "profile_mode": mode,
        "draft_mode": str(session.get("draft_mode") or "").strip().lower() or None,
        "focus_contact_id": str(session.get("focus_contact_id") or "").strip() or None,
        "active_skill_id": active_skill,
        "contact_create_in_progress": is_active_contact_creation(session),
        "draft": {
            "first_name": fn,
            "last_name": ln,
            "email": str(draft.get("email") or "").strip(),
            "phone": str(draft.get("phone") or "").strip(),
            "company_name": str(draft.get("company_name") or "").strip(),
            "city": str(draft.get("city") or "").strip(),
            "pack_fields_skipped": [
                p.strip()
                for p in str(draft.get("pack_fields_skipped") or "").split(",")
                if p.strip()
            ],
        },
        "draft_flags": {
            "has_first_name": bool(fn),
            "has_last_name": bool(ln),
            "has_valid_email": has_email,
            "has_valid_phone": has_phone,
            "has_reachable_identity": has_identity,
            "next_field": next_creation_prompt_field(
                draft, campaign_profile=session.get("campaign_profile")
            ),
        },
        "candidates_count": len(candidates),
        "skill_state_summary": skill_summary,
    }

    note = str(session.get("chat_memory_note") or "").strip()
    if note:
        facts["chat_memory_note"] = note

    return facts


def contacts_setup_snapshot(session: dict[str, Any] | None) -> dict[str, Any]:
    """Alias for tests — same as live_session_facts."""
    return live_session_facts(session)


__all__ = ["contacts_setup_snapshot", "live_session_facts"]
