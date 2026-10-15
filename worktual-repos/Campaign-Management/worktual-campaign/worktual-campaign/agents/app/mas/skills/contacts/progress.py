"""Factual skill progress from draft — no field-order scripts."""

from __future__ import annotations

from typing import Any

from app.agents.contacts.draft_ingest import (
    missing_fields,
    next_creation_prompt_field,
    soft_missing_fields,
)


def creation_ready_for_confirm(session: dict[str, Any]) -> bool:
    """True when mandatory create fields are on the draft (first_name + email or phone)."""
    draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
    return not missing_fields(
        draft,
        campaign_profile=session.get("campaign_profile"),
    )


def contact_creation_progress(session: dict[str, Any]) -> dict[str, Any]:
    draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
    profile = session.get("campaign_profile")
    miss = missing_fields(draft, campaign_profile=profile)
    soft = soft_missing_fields(draft, campaign_profile=profile)
    skipped_raw = str(draft.get("pack_fields_skipped") or "")
    skipped = [p.strip() for p in skipped_raw.split(",") if p.strip()]
    return {
        "draft_mode": str(session.get("draft_mode") or "").strip().lower() or None,
        "missing_required": miss,
        "missing_optional": soft,
        "fields_skipped": skipped,
        "next_field": next_creation_prompt_field(draft, campaign_profile=profile),
        "ready_for_confirm": not miss,
        "collected": {
            k: str(draft.get(k) or "").strip()
            for k in (
                "first_name",
                "last_name",
                "email",
                "phone",
                "company_name",
                "city",
            )
            if str(draft.get(k) or "").strip()
        },
    }


def contact_update_progress(session: dict[str, Any]) -> dict[str, Any]:
    draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
    return {
        "draft_mode": str(session.get("draft_mode") or "").strip().lower() or None,
        "focus_contact_id": str(session.get("focus_contact_id") or "").strip() or None,
        "pending_changes": {
            k: str(draft.get(k) or "").strip()
            for k in (
                "first_name",
                "last_name",
                "email",
                "phone",
                "company_name",
                "city",
            )
            if str(draft.get(k) or "").strip()
        },
    }


def skill_progress(session: dict[str, Any], skill_id: str) -> dict[str, Any]:
    sid = str(skill_id or "").strip().lower()
    if sid == "contact_creation":
        return contact_creation_progress(session)
    if sid == "contact_update":
        return contact_update_progress(session)
    if sid == "contact_view":
        return {"mode": "read_only"}
    return {}


__all__ = [
    "contact_creation_progress",
    "contact_update_progress",
    "creation_ready_for_confirm",
    "skill_progress",
]
