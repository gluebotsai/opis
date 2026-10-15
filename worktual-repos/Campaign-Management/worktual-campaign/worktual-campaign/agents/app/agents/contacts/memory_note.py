"""Capped rolling chat_memory_note for contacts — tool facts only."""

from __future__ import annotations

from typing import Any

from app.agents.create_campaign.memory_note import append_memory_note, get_memory_note

__all__ = [
    "append_memory_note",
    "get_memory_note",
    "note_from_create_complete",
    "note_from_draft_fields",
    "note_from_lookup",
    "note_from_skill_start",
]


def note_from_draft_fields(
    draft: dict[str, Any] | None,
    *,
    mode: str = "",
    skipped: list[str] | None = None,
) -> str:
    d = draft if isinstance(draft, dict) else {}
    parts: list[str] = []
    for key, label in (
        ("first_name", "first"),
        ("last_name", "last"),
        ("email", "email"),
        ("phone", "phone"),
        ("company_name", "company"),
        ("city", "city"),
    ):
        val = str(d.get(key) or "").strip()
        if val:
            parts.append(f"{label}={val[:48]}")
    if not parts and not skipped:
        return ""
    bits = ["Draft saved"]
    if mode:
        bits[0] += f" ({mode})"
    if parts:
        bits.append("; ".join(parts))
    if skipped:
        bits.append("skipped: " + ", ".join(skipped))
    return ": ".join(bits) if len(bits) > 1 else bits[0]


def note_from_skill_start(skill_id: str, *, action: str = "new_task") -> str:
    sid = str(skill_id or "").strip().lower()
    if not sid:
        return ""
    return f"Skill {sid} ({action})"


def note_from_lookup(count: int, *, during_create: bool = False) -> str:
    if during_create:
        if count >= 1:
            return (
                f"Create directory check: duplicate — {count} existing contact(s) "
                "(panel EXISTING MATCH; do not attribute to the new draft name)"
            )
        return (
            "Create directory check: unique — value stays on create draft "
            "(continue create; never say not found / search)"
        )
    return f"Lookup: {count} match(es)"


def note_from_create_complete(contact_id: str = "", *, cite: str = "") -> str:
    cid = str(contact_id or "").strip()
    ref = str(cite or "").strip()
    if cid and ref:
        return f"Contact created id={cid} ({ref})"
    if cid:
        return f"Contact created id={cid}"
    if ref:
        return f"Contact created ({ref})"
    return "Contact created"
