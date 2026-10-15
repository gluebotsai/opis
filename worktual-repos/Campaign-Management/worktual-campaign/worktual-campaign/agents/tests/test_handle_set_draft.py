"""SET_DRAFT_FIELDS handler — draft merge and skip semantics."""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.contacts.draft_ingest import empty_draft
from app.memory_session_store import memory_get, memory_put


@pytest.fixture
def session_id():
    return str(uuid.uuid4())


async def _set_draft(session_id: str, session: dict, **args):
    memory_put({**session, "session_id": session_id, "module": "contacts"})
    from app.agents.contacts.tools.handlers import handle_set_draft

    with patch("app.agents.contacts.tools.handlers.get_or_create_session") as mock_get:
        async def _get(sid, token=None, module=None):
            _ = token, module
            return memory_get(sid) or memory_put(session)

        mock_get.side_effect = _get
        with patch("app.agents.contacts.tools.handlers.save_session") as mock_save:
            async def _save(s, token=None, sync_db=False):
                _ = token, sync_db
                return memory_put(s)

            mock_save.side_effect = _save
            with patch(
                "app.agents.contacts.tools.handlers.httpx.AsyncClient",
            ) as mock_client:
                mock_res = AsyncMock()
                mock_res.raise_for_status = lambda: None
                mock_res.json = lambda: {"contacts": []}
                mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                    return_value=mock_res
                )
                with patch(
                    "app.agents.contacts.memory_note.append_memory_note",
                    return_value=None,
                ):
                    return await handle_set_draft(
                        session_id, "tok", {"change_summary": "test", **args}
                    )


def test_skip_last_name_preserves_first_name(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {**empty_draft(), "first_name": "Pujitha"},
    }

    async def run():
        return await _set_draft(session_id, session, skip_field="last_name")

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["draft_contact"]["first_name"] == "Pujitha"
    assert "last_name" in str(out["draft_contact"].get("pack_fields_skipped") or "")
    assert out.get("next_field") == "email"


def test_next_field_after_email_skips_last_name(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {
            **empty_draft(),
            "first_name": "Pujitha",
            "email": "pujitha.test@example.com",
            "pack_fields_skipped": "last_name",
        },
    }

    async def run():
        return await _set_draft(session_id, session, change_summary="noop")

    out = asyncio.run(run())
    assert out.get("next_field") == "phone"
    assert out.get("next_field") != "last_name"


def test_skip_during_email_phase_not_push_skip(session_id):
    """Generic 'skip' must not hijack identity collection as web-push skip."""
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {**empty_draft(), "first_name": "Pujitha"},
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            skip_field="last_name",
            change_summary="User skipped last name.",
        )

    out = asyncio.run(run())
    assert out["draft_contact"]["first_name"] == "Pujitha"
    assert out["fields_updated"]


def test_set_draft_create_emits_candidates_when_email_duplicate(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {**empty_draft(), "first_name": "NewPerson"},
    }
    existing = {
        "id": "c-existing-99",
        "first_name": "Aravindh",
        "last_name": "Selvaraj",
        "email": "taken@example.com",
        "phone": "+919500401679",
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            email="taken@example.com",
        )

    with patch(
        "app.agents.contacts.tools.handlers.httpx.AsyncClient",
    ) as mock_client:
        mock_res = AsyncMock()
        mock_res.raise_for_status = lambda: None
        mock_res.json = lambda: {"contacts": [existing]}
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_res
        )
        with patch(
            "app.agents.contacts.memory_note.append_memory_note",
            return_value=None,
        ):
            memory_put({**session, "session_id": session_id, "module": "contacts"})
            from app.agents.contacts.tools.handlers import handle_set_draft

            with patch(
                "app.agents.contacts.tools.handlers.get_or_create_session"
            ) as mock_get:
                async def _get(sid, token=None, module=None):
                    _ = token, module
                    return memory_get(sid) or memory_put(session)

                mock_get.side_effect = _get
                with patch(
                    "app.agents.contacts.tools.handlers.save_session"
                ) as mock_save:
                    async def _save(s, token=None, sync_db=False):
                        _ = token, sync_db
                        return memory_put(s)

                    mock_save.side_effect = _save
                    out = asyncio.run(
                        handle_set_draft(
                            session_id,
                            "tok",
                            {
                                "change_summary": "test",
                                "email": "taken@example.com",
                            },
                        )
                    )

    assert out.get("duplicate_during_create") is True
    assert out["draft_contact"]["first_name"] == "NewPerson"
    assert not str(out["draft_contact"].get("email") or "").strip()
    ui_events = out.get("ui_events") or []
    cand = [
        e
        for e in ui_events
        if isinstance(e, dict) and e.get("type") == "contact_candidates"
    ]
    assert cand
    assert cand[0]["payload"].get("duplicate_during_create") is True


def test_partial_email_merge_keeps_first_name(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {**empty_draft(), "first_name": "Pujitha"},
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            email="pujitha.test@example.com",
        )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["draft_contact"]["first_name"] == "Pujitha"
    assert out["draft_contact"]["email"] == "pujitha.test@example.com"


def test_reset_draft_ignored_when_draft_has_progress(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {**empty_draft(), "first_name": "Ada"},
    }

    async def run():
        return await _set_draft(session_id, session, reset_draft=True)

    out = asyncio.run(run())
    assert out["draft_contact"]["first_name"] == "Ada"


def test_create_drops_mirror_last_name(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {**empty_draft(), "first_name": "Aravindh"},
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            mode="create",
            first_name="Aravindh",
            last_name="Aravindh",
        )

    out = asyncio.run(run())
    assert out["draft_contact"]["first_name"] == "Aravindh"
    assert not str(out["draft_contact"].get("last_name") or "").strip()


def test_multiword_first_name_splits(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": empty_draft(),
    }

    async def run():
        return await _set_draft(session_id, session, first_name="Priya Sharma")

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["draft_contact"]["first_name"] == "Priya"
    assert out["draft_contact"]["last_name"] == "Sharma"


def test_reset_draft_clears_when_no_progress(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": empty_draft(),
    }

    async def run():
        return await _set_draft(session_id, session, reset_draft=True, mode="create")

    out = asyncio.run(run())
    assert out["ok"] is True
    assert not str(out["draft_contact"].get("first_name") or "").strip()


def test_save_session_preserves_draft_when_stale_copy_saved(session_id):
    from app.session_store import save_session
    from app.memory_session_store import memory_get

    full = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "mas_task": {"active_domain": "audience", "steps": []},
        "draft_contact": {**empty_draft(), "first_name": "Pujitha", "email": "a@b.com"},
    }

    async def run():
        await save_session(full, token="tok")
        stale = {
            "session_id": session_id,
            "module": "contacts",
            "mas_task": {"active_domain": "audience", "steps": []},
            "draft_contact": {**empty_draft(), "phone": "+919876543210"},
        }
        await save_session(stale, token="tok")
        return memory_get(session_id)

    mem = asyncio.run(run())
    dc = mem.get("draft_contact") or {}
    assert dc.get("first_name") == "Pujitha"
    assert dc.get("email") == "a@b.com"
    assert dc.get("phone") == "+919876543210"


def test_set_draft_create_mode_clears_stale_focus(session_id):
    """LLM mode=create while a profile is focused starts a fresh create draft."""
    focus = "1830917733048487"
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "update",
        "focus_contact_id": focus,
        "draft_contact": {
            **empty_draft(),
            "first_name": "Aravindh",
            "email": "old@example.com",
            "phone": "12066409886",
        },
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            mode="create",
            reset_draft=True,
        )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out.get("mode") == "create"
    assert not out["draft_contact"].get("first_name")
    assert not out["draft_contact"].get("email")
    assert out.get("ui_event", {}).get("payload", {}).get("focus_contact_id") in (None, "")
    assert out.get("ui_event", {}).get("payload", {}).get("reset") is True
    nav = [
        e
        for e in (out.get("ui_events") or [])
        if isinstance(e, dict) and e.get("type") == "navigate"
    ]
    assert nav
    assert nav[0]["payload"].get("path") == "/audience/new"


def test_set_draft_create_typo_path_via_tool(session_id):
    """Same tool path for typo'd create requests — FE/agents do not regex the text."""
    focus = "CDP-whatsapp-org1003-12066409886"
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "update",
        "focus_contact_id": focus,
        "draft_contact": {
            **empty_draft(),
            "phone": "12066409886",
        },
    }

    async def run():
        # LLM understood "create a conatce" → calls create + reset, then name.
        await _set_draft(
            session_id,
            session,
            mode="create",
            reset_draft=True,
            change_summary="User wants a new contact",
        )
        return await _set_draft(
            session_id,
            session,
            first_name="aravindh",
            mode="create",
        )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out.get("mode") == "create"
    assert out["draft_contact"]["first_name"].lower() == "aravindh"
    assert out.get("ui_event", {}).get("payload", {}).get("focus_contact_id") in (None, "")


def test_set_draft_preserves_focus_during_update(session_id):
    focus = "contact-uuid-123"
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "update",
        "focus_contact_id": focus,
        "update_baseline": {"email": "alex@example.com", "phone": ""},
        "draft_contact": {
            **empty_draft(),
            "first_name": "Alex",
            "email": "alex@example.com",
            "city": "London",
        },
    }

    async def run():
        # Omit mode while editing — stay on update (do not send mode=create by mistake).
        return await _set_draft(session_id, session, city="Bengaluru")

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["draft_contact"]["city"] == "Bengaluru"
    assert out.get("mode") == "update"
    assert out.get("ui_event", {}).get("payload", {}).get("focus_contact_id") == focus


def test_set_draft_mode_create_leaves_open_contact(session_id):
    """Explicit mode=create + reset leaves the open profile for a new draft."""
    focus = "contact-uuid-789"
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "update",
        "focus_contact_id": focus,
        "update_baseline": {"email": "alex@example.com", "phone": "+15551234567"},
        "draft_contact": {
            **empty_draft(),
            "first_name": "Alex",
            "email": "alex@example.com",
            "phone": "+15551234567",
            "city": "London",
        },
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            reset_draft=True,
            mode="create",
        )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out.get("mode") == "create"
    assert out.get("ui_event", {}).get("payload", {}).get("focus_contact_id") in (None, "")
    assert not out["draft_contact"].get("first_name")


def test_save_session_preserves_focus_during_update(session_id):
    from app.session_store import save_session
    from app.memory_session_store import memory_get

    focus = "contact-uuid-456"
    full = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "update",
        "focus_contact_id": focus,
        "update_baseline": {"email": "a@b.com", "phone": ""},
        "draft_contact": {**empty_draft(), "first_name": "Alex", "email": "a@b.com", "city": "London"},
    }

    async def run():
        await save_session(full, token="tok")
        stale = {
            "session_id": session_id,
            "module": "contacts",
            "draft_contact": {**empty_draft(), "city": "Bengaluru"},
        }
        await save_session(stale, token="tok")
        return memory_get(session_id)

    mem = asyncio.run(run())
    assert mem.get("focus_contact_id") == focus
    assert mem.get("draft_mode") == "update"
    assert (mem.get("draft_contact") or {}).get("city") == "Bengaluru"


def test_set_draft_rejects_invalid_email_format(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "focus_contact_id": None,
        "draft_contact": {**empty_draft(), "first_name": "Pujitha"},
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            email="pujitha123gmail.co",
            mode="create",
            change_summary="User typed email",
        )

    out = asyncio.run(run())
    assert out["ok"] is False
    assert "invalid" in str(out.get("error") or out.get("message") or "").lower()
    assert "@" in str(out.get("message") or "")
    assert not str((out.get("draft_contact") or {}).get("email") or "").strip()


def test_email_during_create_defers_empty_last_name(session_id):
    """Jumping to email while last_name empty advances next_field past last_name."""
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "focus_contact_id": None,
        "draft_contact": {**empty_draft(), "first_name": "Pujitha"},
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            email="pujitha.unique@example.com",
            mode="create",
            change_summary="User typed email",
        )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert str((out.get("draft_contact") or {}).get("email") or "").endswith(
        "@example.com"
    )
    skipped = str((out.get("draft_contact") or {}).get("pack_fields_skipped") or "")
    assert "last_name" in skipped
    assert out.get("next_field") == "phone"
    assert out.get("directory_unique") is True or "unique=true" in str(
        out.get("message") or ""
    )


def test_later_last_name_clears_skip(session_id):
    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": "create",
        "focus_contact_id": None,
        "draft_contact": {
            **empty_draft(),
            "first_name": "Pujitha",
            "email": "pujitha.unique@example.com",
            "pack_fields_skipped": "last_name",
        },
    }

    async def run():
        return await _set_draft(
            session_id,
            session,
            last_name="Paleti",
            mode="create",
            change_summary="User gave last name",
        )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert (out.get("draft_contact") or {}).get("last_name") == "Paleti"
    skipped = str((out.get("draft_contact") or {}).get("pack_fields_skipped") or "")
    assert "last_name" not in skipped
