"""Per-conversation session state for custom_lola_worktual."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

verified_contacts: dict[str, dict[str, Any]] = {}
_turn_context: dict[str, dict[str, Any]] = {}
_session_contact_profiles: dict[str, dict[str, Any]] = {}
_session_long_term_summaries: dict[str, str] = {}
_session_long_term_summary_contact_ids: dict[str, str] = {}
_long_term_summary_provider: Callable[[str, dict[str, Any]], str] | None = None


def set_turn_context(conversation_id: str, context: dict[str, Any]) -> None:
    _turn_context[conversation_id] = context


def get_turn_context(conversation_id: str) -> dict[str, Any]:
    return _turn_context.get(conversation_id, {})


def clear_turn_context(conversation_id: str) -> None:
    _turn_context.pop(conversation_id, None)


def get_session_contact_profile(conversation_id: str) -> dict[str, Any] | None:
    profile = _session_contact_profiles.get(conversation_id)
    return dict(profile) if isinstance(profile, dict) else None


def set_session_contact_profile(conversation_id: str, profile: dict[str, Any]) -> None:
    _session_contact_profiles[conversation_id] = dict(profile)


def get_session_long_term_summary(conversation_id: str) -> str | None:
    return _session_long_term_summaries.get(conversation_id)


def get_session_long_term_summary_contact_id(conversation_id: str) -> str | None:
    return _session_long_term_summary_contact_ids.get(conversation_id)


def set_session_long_term_summary(conversation_id: str, summary: str, *, contact_id: str | None = None) -> None:
    _session_long_term_summaries[conversation_id] = summary
    _session_long_term_summary_contact_ids[conversation_id] = contact_id or ""


def clear_session_state(conversation_id: str) -> None:
    clear_turn_context(conversation_id)
    _session_contact_profiles.pop(conversation_id, None)
    _session_long_term_summaries.pop(conversation_id, None)
    _session_long_term_summary_contact_ids.pop(conversation_id, None)
    verified_contacts.pop(conversation_id, None)


def set_long_term_summary_provider(
    provider: Callable[[str, dict[str, Any]], str],
) -> None:
    global _long_term_summary_provider
    _long_term_summary_provider = provider


def get_long_term_summary(conversation_id: str, tenant_context: dict[str, Any]) -> str:
    if _long_term_summary_provider is None:
        return "No information provided"
    return _long_term_summary_provider(conversation_id, tenant_context)


def get_verified_contact(conversation_id: str) -> dict[str, Any] | None:
    return verified_contacts.get(conversation_id)


def set_verified_contact(conversation_id: str, contact: dict[str, Any]) -> None:
    verified_contacts[conversation_id] = contact
