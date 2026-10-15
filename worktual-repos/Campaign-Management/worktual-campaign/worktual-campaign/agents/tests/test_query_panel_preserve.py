"""QUERY panel list survives opening one contact (handle_get)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_handle_get_preserves_query_panel_candidates():
    from app.agents.contacts.tools.handlers import handle_get

    panel = [
        {"id": "c1", "first_name": "A", "email": "a@b.com"},
        {"id": "c2", "first_name": "B", "email": "b@b.com"},
    ]
    session = {
        "session_id": "s1",
        "module": "contacts",
        "query_panel_candidates": panel,
        "query_panel_count": 2,
        "draft_mode": "view",
        "candidates": panel,
    }

    contact_body = {
        "contact": {
            "id": "c1",
            "first_name": "A",
            "last_name": "",
            "email": "a@b.com",
            "phone": "",
            "company_name": "",
            "city": "",
            "custom_fields": {},
        }
    }

    async def fake_get_or_create(session_id, token=..., module=...):
        _ = session_id, token, module
        return dict(session)

    with patch(
        "app.agents.contacts.tools.handlers.get_or_create_session",
        side_effect=fake_get_or_create,
    ), patch(
        "app.agents.contacts.tools.handlers.save_session",
        new_callable=AsyncMock,
        side_effect=lambda s, **kw: s,
    ), patch(
        "app.agents.contacts.tools.handlers._reconcile_contacts_update_session",
    ), patch(
        "app.agents.contacts.tools.handlers._sync_contact_skill_snapshot",
    ), patch(
        "app.agents.contacts.tools.handlers._is_contact_view_flow",
        return_value=True,
    ), patch("httpx.AsyncClient") as mock_client:
        inst = mock_client.return_value.__aenter__.return_value
        res = AsyncMock()
        res.raise_for_status = lambda: None
        res.json = lambda: contact_body
        inst.get = AsyncMock(return_value=res)

        out = await handle_get("s1", "tok", {"contact_id": "c1"})

    assert out.get("ok") is True
    assert len(session.get("candidates") or []) == 2
    assert session.get("focus_contact_id") == "c1"
