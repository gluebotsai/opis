"""VIEW_CONTACT unified handler — read-only panel modes."""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.memory_session_store import memory_put
from app.mas.skills import CONTACTS_MODULE, apply_skill_pick


@pytest.fixture
def session_id():
    return str(uuid.uuid4())


def _session(session_id: str) -> dict:
    return {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": None,
        "draft_contact": {},
        "module_skills": {},
    }


def test_view_skill_outcome_complete_on_view_contact():
    from app.mas.skills.harness import evaluate_skill_outcome

    outcome = evaluate_skill_outcome(
        "contact_view",
        tool_results=[("VIEW_CONTACT", {"ok": True, "count": 1})],
        user_text="show alex",
        ui_events=[{"type": "contact_candidates", "payload": {"mode": "view"}}],
    )
    assert outcome["complete"] is True


def test_view_skill_outcome_complete_on_query_contacts():
    from app.mas.skills.harness import evaluate_skill_outcome

    outcome = evaluate_skill_outcome(
        "contact_view",
        tool_results=[("QUERY_CONTACTS", {"ok": True, "matched_count": 5})],
        user_text="show contacts with email",
        ui_events=[{"type": "contact_candidates", "payload": {"mode": "view"}}],
    )
    assert outcome["complete"] is True


@pytest.mark.asyncio
async def test_view_contact_by_email_sets_view_mode(session_id):
    session = _session(session_id)
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_view",
        skill_action="new_task",
    )
    memory_put({**session, "session_id": session_id})

    contact = {
        "id": "cid-1",
        "first_name": "Alex",
        "last_name": "Morgan",
        "email": "alex@example.com",
        "phone": "+15551234567",
        "company_name": "Acme",
        "city": "London",
    }

    with patch(
        "app.agents.contacts.tools.handlers.get_or_create_session",
        new_callable=AsyncMock,
    ) as mock_get, patch(
        "app.agents.contacts.tools.handlers.save_session",
        new_callable=AsyncMock,
    ) as mock_save, patch(
        "app.agents.contacts.tools.handlers.httpx.AsyncClient"
    ) as mock_client:
        async def _get(sid, token=None, module=None):
            _ = token, module
            return memory_put({**session, "session_id": session_id})

        mock_get.side_effect = _get

        async def _save(s, token=None, sync_db=False):
            _ = token, sync_db
            return memory_put(s)

        mock_save.side_effect = _save

        from unittest.mock import MagicMock

        mock_resp = MagicMock()
        mock_resp.raise_for_status = lambda: None
        mock_resp.json.return_value = {"contacts": [contact]}
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(
            return_value=mock_resp
        )

        from app.agents.contacts.tools.handlers import handle_view_contact

        out = await handle_view_contact(
            session_id,
            "tok",
            {
                "email": "alex@example.com",
                "change_summary": "View by email",
            },
        )

    assert out["ok"] is True
    assert out["count"] == 1
    ui = out.get("ui_event") or {}
    assert ui.get("payload", {}).get("mode") == "view"
    assert ui.get("payload", {}).get("focus_contact_id") == "cid-1"
