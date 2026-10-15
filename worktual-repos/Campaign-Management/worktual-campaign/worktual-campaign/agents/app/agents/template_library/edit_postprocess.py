"""Normalize edit-agent tool results for persist/emit (no instruction intent parsing)."""

from __future__ import annotations

import copy
from typing import Any

from app.agents.template_library.fields import (
    canonicalize_email_fields,
    fields_ok_for_edit,
    merge_edit_fields,
    normalize_fields,
)


def mark_whatsapp_draft_after_edit(fields: dict[str, Any]) -> dict[str, Any]:
    """Keep Meta template name stable; clear stale approval after content edit."""
    updated = copy.deepcopy(fields)
    if isinstance(updated.get("approval"), dict):
        updated["approval"] = {
            "submitted": False,
            "status": "DRAFT",
            "provider_template_id": None,
            "submitted_at": None,
            "error": None,
            "message": (
                "Template edited — Meta approval runs when you confirm launch."
            ),
        }
    return updated


def _finalize_email_fields_for_persist(
    channel: str, fields: dict[str, Any]
) -> dict[str, Any]:
    if str(channel or "").strip().lower() != "email":
        return fields
    return canonicalize_email_fields(fields)


def _sanitize_whatsapp_fields(fields: dict[str, Any]) -> dict[str, Any]:
    try:
        from app.agents.template_library.channels.whatsapp.meta_rules import (
            sanitize_whatsapp_fields,
        )

        return sanitize_whatsapp_fields(fields)
    except Exception:  # noqa: BLE001
        return fields


def finalize_edit_result(
    *,
    instruction: str,
    channel: str,
    current_fields: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    """Normalize an edit-agent result for persist/emit.

    Intent and field changes come only from the LLM/tools in ``result``.
    """
    del instruction  # call-site compat; never used for intent
    intent = str(result.get("intent") or "general").strip().lower()
    reply = str(result.get("reply") or "").strip()
    fields = result.get("fields")
    current = normalize_fields(channel, current_fields)

    if intent == "show":
        return {
            "intent": "show",
            "fields": None,
            "reply": reply,
            "edit_outcome": "show",
            "reply_facts": {"action": "show"},
            "display_fields": current,
            "emit_template": True,
            "persist_fields": False,
        }

    if intent == "save":
        to_save = current
        if isinstance(fields, dict):
            candidate = normalize_fields(channel, fields)
            if fields_ok_for_edit(channel, candidate):
                to_save = candidate
        if channel == "whatsapp":
            prior_name = str(current.get("name") or "").strip()
            if prior_name:
                to_save = {**to_save, "name": prior_name}
            to_save = mark_whatsapp_draft_after_edit(to_save)
            to_save = _sanitize_whatsapp_fields(to_save)
        return {
            "intent": "save",
            "fields": to_save,
            "reply": reply,
            "edit_outcome": "save",
            "reply_facts": {"action": "save"},
            "display_fields": to_save,
            "emit_template": True,
            "persist_fields": True,
        }

    if intent == "launch":
        return {
            "intent": "launch",
            "fields": None,
            "reply": reply,
            "edit_outcome": "launch",
            "reply_facts": {"action": "launch"},
            "display_fields": None,
            "emit_template": False,
            "persist_fields": False,
            "launch_note": result.get("launch_note") or "",
            "launch_channels": list(result.get("launch_channels") or []),
            "schedule_mode": result.get("schedule_mode") or "",
            "schedule_at": result.get("schedule_at") or "",
        }

    if intent == "modify" and isinstance(fields, dict):
        updated = merge_edit_fields(channel, current, fields)
        if not fields_ok_for_edit(channel, updated):
            return {
                "intent": "clarify",
                "fields": None,
                "reply": reply,
                "edit_outcome": "clarify",
                "reply_facts": {"action": "modify_invalid"},
                "display_fields": None,
                "emit_template": False,
                "persist_fields": False,
            }
        if channel == "whatsapp":
            prior_name = str(current.get("name") or "").strip()
            if prior_name:
                updated["name"] = prior_name
            updated = mark_whatsapp_draft_after_edit(updated)
            updated = _sanitize_whatsapp_fields(updated)
        updated = _finalize_email_fields_for_persist(channel, updated)
        return {
            "intent": "modify",
            "fields": updated,
            "reply": reply,
            "edit_outcome": "modify",
            "reply_facts": {"action": "modify"},
            "display_fields": updated,
            "emit_template": True,
            "persist_fields": True,
        }

    return {
        "intent": intent if intent in {"clarify", "general"} else "general",
        "fields": None,
        "reply": reply,
        "edit_outcome": "general",
        "reply_facts": {"action": "none"},
        "display_fields": None,
        "emit_template": False,
        "persist_fields": False,
    }


__all__ = [
    "finalize_edit_result",
    "mark_whatsapp_draft_after_edit",
]
