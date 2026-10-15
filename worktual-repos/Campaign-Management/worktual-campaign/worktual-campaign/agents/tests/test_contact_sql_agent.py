"""Contact view SQL agent — validation, retry, handler wiring."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.agents.contacts.contact_sql_agent import (
    account_org_param,
    validate_readonly_sql,
)


def test_account_org_param_maps_legacy_uuid():
    assert account_org_param("00000000-0000-4000-a000-000000000042") == "42"
    assert account_org_param("tenant-uuid-abc") == "tenant-uuid-abc"


def test_validate_rejects_mutating_sql():
    bad = "DELETE FROM cdp.customer_profile WHERE true"
    ok, err = validate_readonly_sql(bad)
    assert ok is False
    assert err


def test_validate_accepts_readonly_select():
    sql = """
    SELECT p.cdp_id AS id, p.first_name, p.last_name,
           email_k.key_value AS email, phone_k.key_value AS phone,
           p.company AS company_name, p.city, p.created_at,
           coalesce(p.custom_fields, '{}'::jsonb) AS custom_fields
    FROM cdp.customer_profile p
    LEFT JOIN LATERAL (
      SELECT ik.key_value FROM cdp.identity_keys ik
      WHERE ik.cdp_id::text = p.cdp_id::text
        AND ik.organization_id::text = p.organization_id::text
        AND lower(ik.key_type) IN ('email', 'primary_email')
      LIMIT 1
    ) email_k ON true
    LEFT JOIN LATERAL (
      SELECT ik.key_value FROM cdp.identity_keys ik
      WHERE ik.cdp_id::text = p.cdp_id::text
        AND ik.organization_id::text = p.organization_id::text
        AND lower(ik.key_type) IN ('phone', 'primary_phone', 'mobile')
      LIMIT 1
    ) phone_k ON true
    WHERE p.organization_id::text = $1
      AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false
      AND email_k.key_value IS NOT NULL
    LIMIT 100
    """
    ok, err = validate_readonly_sql(sql)
    assert ok is True, err


@pytest.mark.asyncio
async def test_run_contact_sql_query_succeeds_on_second_attempt():
    from app.agents.contacts.contact_sql_agent import run_contact_sql_query

    good_sql = (
        "SELECT p.cdp_id AS id FROM cdp.customer_profile p "
        "WHERE p.organization_id::text = $1 "
        "AND coalesce((p.custom_fields->>'campaign_deleted')::boolean, false) = false "
        "LIMIT 10"
    )
    bad_sql = "SELECT bad_column FROM cdp.customer_profile p LIMIT 10"

    async def fake_generate(*, user_request, memory, failures):
        _ = user_request, memory
        if failures:
            return good_sql, "fixed"
        return bad_sql, "first try"

    rows = [{"id": "c1", "first_name": "A", "last_name": "B", "email": "a@b.com"}]

    with patch(
        "app.agents.contacts.contact_sql_agent._generate_sql",
        side_effect=fake_generate,
    ), patch(
        "app.agents.contacts.contact_sql_agent._execute_sql",
        new_callable=AsyncMock,
        return_value=rows,
    ):
        out = await run_contact_sql_query(
            user_request="contacts with email",
            org_id="org-1",
            memory={},
        )

    assert out["ok"] is True
    assert out["count"] == 1
    assert out["attempts"] == 2


@pytest.fixture
def session_id():
    return str(uuid.uuid4())


@pytest.mark.asyncio
async def test_query_contacts_handler_sets_view_panel(session_id):
    from app.mas.skills import CONTACTS_MODULE, apply_skill_pick
    from app.memory_session_store import memory_put

    session = {
        "session_id": session_id,
        "module": "contacts",
        "draft_mode": None,
        "draft_contact": {},
        "module_skills": {},
    }
    apply_skill_pick(
        session,
        module=CONTACTS_MODULE,
        executor_id="contact",
        skill_id="contact_view",
        skill_action="new_task",
    )
    memory_put({**session, "session_id": session_id})

    rows = [
        {
            "id": "cid-1",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "email": "ada@example.com",
            "phone": None,
            "company_name": "Acme",
            "city": "Chennai",
            "custom_fields": {},
        }
    ]

    with patch(
        "app.agents.contacts.tools.handlers.get_or_create_session",
        new_callable=AsyncMock,
    ) as mock_get, patch(
        "app.agents.contacts.tools.handlers.save_session",
        new_callable=AsyncMock,
    ) as mock_save, patch(
        "app.agents.reports.org_context.resolve_organization_id",
        new_callable=AsyncMock,
        return_value="org-1",
    ), patch(
        "app.config.get_settings"
    ) as mock_settings, patch(
        "app.agents.contacts.contact_sql_agent.run_contact_sql_query",
        new_callable=AsyncMock,
        return_value={
            "ok": True,
            "rows": rows,
            "count": 1,
            "sql": "SELECT ...",
            "message": "1 contact",
        },
    ):
        mock_settings.return_value.account_database_url = "postgresql://x/y"

        async def _get(sid, token=None, module=None):
            _ = token, module
            return memory_put({**session, "session_id": session_id})

        mock_get.side_effect = _get

        async def _save(s, token=None, sync_db=False):
            _ = token, sync_db
            return memory_put(s)

        mock_save.side_effect = _save

        from app.agents.contacts.tools.handlers import handle_query_contacts

        out = await handle_query_contacts(
            session_id,
            "tok",
            {
                "user_request": "contacts from Chennai with email",
                "change_summary": "Chennai + email",
            },
        )

    assert out["ok"] is True
    assert out["count"] == 1
    ui = out.get("ui_event") or {}
    assert ui.get("payload", {}).get("mode") == "view"
    assert ui.get("payload", {}).get("focus_contact_id") == "cid-1"
