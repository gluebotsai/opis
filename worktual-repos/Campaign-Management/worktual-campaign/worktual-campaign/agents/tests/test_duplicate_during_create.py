"""Duplicate email/phone during contact create — preserve draft, stay on create mode."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.contacts.draft_ingest import empty_draft
from app.agents.contacts.tools.handlers import handle_lookup


@pytest.mark.asyncio
async def test_lookup_duplicate_email_preserves_create_draft():
    session_store: dict = {
        "session_id": "dup-create-1",
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {
            **empty_draft(),
            "first_name": "Priya",
            "email": "taken@example.com",
        },
        "focus_contact_id": None,
    }
    existing = {
        "id": "c-existing-1",
        "first_name": "Other",
        "last_name": "Person",
        "email": "taken@example.com",
        "phone": "+919876543210",
    }

    async def fake_get_or_create(session_id, token=None, module=None):
        return session_store

    async def fake_save(session, token=None):
        session_store.update(session)
        return None

    with patch(
        "app.agents.contacts.tools.handlers.get_or_create_session",
        side_effect=fake_get_or_create,
    ), patch(
        "app.agents.contacts.tools.handlers.save_session",
        side_effect=fake_save,
    ), patch(
        "app.agents.contacts.memory_note.append_memory_note",
        return_value=None,
    ), patch(
        "app.agents.contacts.tools.handlers.httpx.AsyncClient",
    ) as mock_client:
        mock_res = AsyncMock()
        mock_res.raise_for_status = lambda: None
        mock_res.json = lambda: {"contacts": [existing]}
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_res
        )

        out = await handle_lookup(
            "dup-create-1",
            "tok",
            {"email": "taken@example.com"},
        )

    assert out.get("ok") is True
    assert out.get("duplicate_during_create") is True
    assert session_store.get("draft_mode") == "create"
    assert session_store.get("focus_contact_id") is None
    draft = session_store.get("draft_contact") or {}
    assert draft.get("first_name") == "Priya"
    assert not str(draft.get("email") or "").strip()
    ui = out.get("ui_event") or {}
    payload = ui.get("payload") or {}
    assert payload.get("mode") == "create"
    assert payload.get("duplicate_during_create") is True
    assert len(payload.get("candidates") or []) == 1
    assert "duplicate_during_create=true" in str(out.get("message") or "")


@pytest.mark.asyncio
async def test_lookup_unique_email_during_create_is_quiet():
    session_store: dict = {
        "session_id": "uniq-create-1",
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {
            **empty_draft(),
            "first_name": "Priya",
            "email": "new@example.com",
        },
        "focus_contact_id": None,
    }

    async def fake_get_or_create(session_id, token=None, module=None):
        return session_store

    async def fake_save(session, token=None):
        session_store.update(session)
        return None

    with patch(
        "app.agents.contacts.tools.handlers.get_or_create_session",
        side_effect=fake_get_or_create,
    ), patch(
        "app.agents.contacts.tools.handlers.save_session",
        side_effect=fake_save,
    ), patch(
        "app.agents.contacts.memory_note.append_memory_note",
        return_value=None,
    ), patch(
        "app.agents.contacts.tools.handlers.httpx.AsyncClient",
    ) as mock_client:
        mock_res = AsyncMock()
        mock_res.raise_for_status = lambda: None
        mock_res.json = lambda: {"contacts": []}
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_res
        )

        out = await handle_lookup(
            "uniq-create-1",
            "tok",
            {"email": "new@example.com"},
        )

    assert out.get("ok") is True
    assert out.get("duplicate_during_create") is not True
    msg = str(out.get("message") or "").lower()
    assert "unique=true" in msg
    assert "no contact" not in msg
    assert "no matches" not in msg


@pytest.mark.asyncio
async def test_lookup_unique_during_create_ignores_view_skill():
    """Even if Domain wrongly set contact_view, create unique must not say not-found."""
    session_store: dict = {
        "session_id": "uniq-create-view",
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {
            **empty_draft(),
            "first_name": "Pujitha",
            "last_name": "Paleti",
            "email": "pujitha1234@gmail.com",
        },
        "focus_contact_id": None,
        "module_skills": {"contacts": {"active_skill_id": "contact_view"}},
    }

    async def fake_get_or_create(session_id, token=None, module=None):
        return session_store

    async def fake_save(session, token=None):
        session_store.update(session)
        return None

    with patch(
        "app.agents.contacts.tools.handlers.get_or_create_session",
        side_effect=fake_get_or_create,
    ), patch(
        "app.agents.contacts.tools.handlers.save_session",
        side_effect=fake_save,
    ), patch(
        "app.agents.contacts.memory_note.append_memory_note",
        return_value=None,
    ), patch(
        "app.agents.contacts.tools.handlers.httpx.AsyncClient",
    ) as mock_client:
        mock_res = AsyncMock()
        mock_res.raise_for_status = lambda: None
        mock_res.json = lambda: {"contacts": []}
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_res
        )

        out = await handle_lookup(
            "uniq-create-view",
            "tok",
            {"email": "pujitha1234@gmail.com", "_panel_mode": "view"},
        )

    msg = str(out.get("message") or "").lower()
    assert "unique=true" in msg
    assert "no contact" not in msg
    assert "matched" not in msg
    assert "not found" not in msg
    assert session_store.get("draft_mode") == "create"
    assert session_store["draft_contact"].get("email") == "pujitha1234@gmail.com"


def test_directory_check_reply_fallback_from_preflight_note():
    from app.agents.contacts.agent import _directory_check_reply_fallback

    note = (
        "duplicate_during_create=true field=phone "
        "match_count=1 matches=Aarav Mehta. "
        "Create draft kept; conflicting identity cleared from draft. "
        "Panel shows clickable match(es)."
    )
    reply = _directory_check_reply_fallback(
        ui_events=[],
        tool_results=[],
        session={"draft_contact": {"first_name": "Pujitha", "phone": ""}},
        preflight_note=note,
    )
    assert "Aarav Mehta" in reply
    assert "phone" in reply.lower()
    assert "different" in reply.lower()


def test_directory_check_reply_fallback_from_ui_candidates():
    from app.agents.contacts.agent import _directory_check_reply_fallback

    reply = _directory_check_reply_fallback(
        ui_events=[
            {
                "type": "contact_candidates",
                "payload": {
                    "duplicate_during_create": True,
                    "candidates": [
                        {
                            "first_name": "Aarav",
                            "last_name": "Mehta",
                            "email": "aarav.mehta@example.com",
                            "phone": "+919000010001",
                        }
                    ],
                },
            }
        ],
        tool_results=[],
        session={"draft_contact": {"first_name": "Pujitha", "phone": ""}},
    )
    assert "Aarav Mehta" in reply
    assert "phone" in reply.lower()


def test_ensure_create_directory_replaces_wrong_match_name():
    from app.agents.contacts.agent import _ensure_create_directory_user_reply

    note = (
        "duplicate_during_create=true field=email "
        "match_count=1 matches=Aarav Mehta. "
        "IMPORTANT: the email belongs to existing contact(s) [Aarav Mehta] — "
        "NOT to the in-progress create draft [Pujitha Paleti]."
    )
    bad = (
        "Actually, that email is already on file for Pujitha Paleti. "
        "Would you like me to update her profile?"
    )
    out = _ensure_create_directory_user_reply(
        bad,
        ui_events=[],
        tool_results=[],
        session={
            "draft_contact": {
                "first_name": "Pujitha",
                "last_name": "Paleti",
                "email": "",
            }
        },
        preflight_note=note,
    )
    assert "Aarav Mehta" in out
    assert "Pujitha" not in out or "different" in out.lower()


def test_ensure_create_directory_replaces_unique_search_language():
    from app.agents.contacts.agent import _ensure_create_directory_user_reply

    note = (
        "directory_check=ok unique=true create_mode=true. "
        "next_field=phone."
    )
    bad = (
        "I can't find that email in the directory. "
        "Could you double-check the address?"
    )
    out = _ensure_create_directory_user_reply(
        bad,
        ui_events=[],
        tool_results=[],
        session={"draft_contact": {"first_name": "Pujitha", "email": "pujitha123@gmail.com"}},
        preflight_note=note,
    )
    assert "can't find" not in out.lower()
    assert "phone" in out.lower() or "draft" in out.lower()


def test_ensure_create_directory_unique_from_tool_flag_without_preflight():
    from app.agents.contacts.agent import _ensure_create_directory_user_reply

    bad = (
        "I can't find a contact with that email in the directory. "
        "Could you double-check the address, or share a phone number or full name instead?"
    )
    out = _ensure_create_directory_user_reply(
        bad,
        ui_events=[],
        tool_results=[
            (
                "SET_DRAFT_FIELDS",
                {
                    "ok": True,
                    "directory_unique": True,
                    "next_field": "phone",
                    "message": "Draft updated. directory_check=ok unique=true create_mode=true.",
                    "draft_contact": {
                        "first_name": "Pujitha",
                        "last_name": "Paleti",
                        "email": "pujitha123@gmail.com",
                    },
                },
            )
        ],
        session={
            "draft_contact": {
                "first_name": "Pujitha",
                "last_name": "Paleti",
                "email": "pujitha123@gmail.com",
            }
        },
        preflight_note="",
    )
    assert "can't find" not in out.lower()
    assert "phone" in out.lower()


def test_strip_false_empty_after_draft_sync():
    from app.agents.contacts.agent import _strip_false_apology_after_draft_sync

    bad = (
        "No new information came through on your last message. "
        "To keep going with Pujitha Paleti, I just need her work email address."
    )
    out = _strip_false_apology_after_draft_sync(
        bad,
        [("SET_DRAFT_FIELDS", {"ok": True, "fields_updated": ["last_name"]})],
        preflight_synced=True,
        draft_contact={
            "first_name": "Pujitha",
            "last_name": "Paleti",
            "email": "",
            "phone": "",
        },
        session={
            "draft_contact": {
                "first_name": "Pujitha",
                "last_name": "Paleti",
                "email": "",
                "phone": "",
            }
        },
    )
    assert "no new information" not in out.lower()
    assert "email" in out.lower() or "form" in out.lower()


def test_mid_create_email_still_ingests_not_view():
    from app.agents.contacts.draft_ingest import (
        identity_view_args_from_turn,
        sync_draft_from_user_turn,
    )

    # Outside create interview, bare email can be view.
    assert identity_view_args_from_turn(
        "pujitha123@gmail.com",
        last_assistant="What would you like to do?",
    ) == {"email": "pujitha123@gmail.com"}

    session = {
        "draft_mode": "create",
        "focus_contact_id": None,
        "draft_contact": {
            "first_name": "Pujitha",
            "last_name": "Paleti",
            "email": "",
            "phone": "",
        },
    }
    pre = sync_draft_from_user_turn(
        session,
        "pujitha123@gmail.com",
        last_assistant="What's her email address?",
    )
    assert pre.get("changed") is True
    assert str((pre.get("draft_contact") or {}).get("email") or "") == "pujitha123@gmail.com"

    # Empty create draft + show email (not mid-interview) stays out of ingest.
    empty = {"draft_mode": "create", "draft_contact": {}, "focus_contact_id": None}
    skipped = sync_draft_from_user_turn(
        empty,
        "show ada@example.com",
        last_assistant="Welcome!",
    )
    assert skipped.get("changed") is False