"""End-to-end Booxoo chat session state through the real database.

Uses a disposable conversation id, then deletes that row.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.agents.custom_booxoo_assist.context_snapshot import CustomerContext
from app.agents.custom_booxoo_bot.clients.cdp_store import _connect_url, store_configured
from app.agents.custom_booxoo_bot.runner import _sessions, run_booxoo_turn
from app.agents.custom_booxoo_bot.tools.identity import send_otp, verify_otp
from app.config import get_settings
from app.services.contact_enrich_policy import ContactProfileSnapshot

_ORG = "1012"
_CONVERSATION = "990003147129"


def _connect():
    import psycopg

    return psycopg.connect(_connect_url(get_settings().database_url), connect_timeout=8)


def _delete_row() -> None:
    if not store_configured():
        return
    import psycopg

    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM ccass.conversation_session_state
                    WHERE organization_id = %s AND conversation_id = %s
                    """,
                    (int(_ORG), int(_CONVERSATION)),
                )
            conn.commit()
    except psycopg.errors.UndefinedTable:
        return


def _read_state() -> dict:
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT state, to_regclass('ccass.booxoo_chat_session')
                FROM ccass.conversation_session_state
                WHERE organization_id = %s AND conversation_id = %s
                """,
                (int(_ORG), int(_CONVERSATION)),
            )
            row = cur.fetchone()
        conn.commit()
    assert row is not None
    assert row[1] is None
    assert isinstance(row[0], dict)
    return row[0]


def test_booxoo_verification_survives_restart_in_shared_state(monkeypatch) -> None:
    if not store_configured():
        pytest.fail("database is not configured")

    seen: dict = {"sms": 0}
    _sessions.drop(f"{_ORG}:{_CONVERSATION}")
    _delete_row()

    def fake_sms(mobile: str, _code: str, _name: str) -> dict:
        seen["sms"] += 1
        seen["mobile"] = mobile
        return {"ok": True, "destination": mobile, "http_status": 200}

    class Router:
        current_agent = SimpleNamespace(name="SupportAgent")

        def refresh_prompts(self, _channel: str) -> None:
            return None

        def execute(self, _message, ctx) -> dict:
            if not ctx.session.authenticated:
                ctx.session.customer_found = True
                ctx.session.ticketing_verified = True
                blocked = send_otp(ctx, channel="sms")
                chosen = send_otp(ctx, channel="sms", phone="919150911820")
                verified = verify_otp(ctx, ctx.session.otp_code or "")
                seen["blocked"] = blocked
                seen["chosen"] = chosen
                seen["verified"] = verified
            else:
                seen["again"] = send_otp(ctx, channel="sms", phone="919150911820")
                seen["reloaded_lines"] = list(ctx.session.customer_lines)
                seen["reloaded_context"] = ctx.trusted_context
            return {"response_type": "general_response", "text": "ok"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.runner.build_router",
        lambda session, _llm: setattr(session, "router", Router()),
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.runner.load_customer_profile",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.runner.load_customer_context",
        lambda *_args, **_kwargs: CustomerContext(
            "Customer profile: found",
            True,
            "e2e-session@example.com",
            "+91 918778828184",
            ("e2e-session@example.com",),
            ("+91 918778828184", "+91 919150911820"),
        ),
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.identity.send_otp_sms",
        fake_sms,
    )
    profile = ContactProfileSnapshot(
        contact_id="CDP-e2e-session",
        first_name="Subaz",
        primary_email="e2e-session@example.com",
        primary_phone="+91 918778828184",
    )

    try:
        run_booxoo_turn(
            organization_id=_ORG,
            conversation_id=_CONVERSATION,
            message="I requested a refund 3 days ago",
            channel="webchat",
            tenant_context={"visitor_id": "visitor-e2e-session"},
            profile=profile,
        )
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ccass.conversation_session_state
                    SET state = state || %s::jsonb
                    WHERE organization_id = %s AND conversation_id = %s
                    """,
                    ('{"other_bot": {"keep": true}}', int(_ORG), int(_CONVERSATION)),
                )
            conn.commit()

        _sessions.drop(f"{_ORG}:{_CONVERSATION}")
        run_booxoo_turn(
            organization_id=_ORG,
            conversation_id=_CONVERSATION,
            message="please check the refund",
            channel="webchat",
            tenant_context={"visitor_id": "visitor-e2e-session"},
            profile=profile,
        )
        state = _read_state()
    finally:
        _sessions.drop(f"{_ORG}:{_CONVERSATION}")
        _delete_row()

    assert seen["blocked"]["sent"] is False
    assert seen["blocked"]["error"] == "sms_destination_required"
    assert seen["chosen"]["sent"] is True
    assert seen["chosen"]["destination"] == "+91 919150911820"
    assert seen["verified"]["authenticated"] is True
    assert seen["again"]["already_authenticated"] is True
    assert seen["again"]["sent"] is False
    assert seen["sms"] == 1
    assert seen["mobile"] == "+91 919150911820"
    assert seen["reloaded_lines"][:2] == [
        "I requested a refund 3 days ago",
        "please check the refund",
    ]
    assert "Session verification: verified once by sms to +91 919150911820." in seen["reloaded_context"]
    assert "I requested a refund 3 days ago" in seen["reloaded_context"]
    assert state["other_bot"] == {"keep": True}
    assert state["custom_booxoo_bot"]["verified"] is True
    assert state["custom_booxoo_bot"]["destination"] == "+91 919150911820"
    assert "I requested a refund 3 days ago" in state["custom_booxoo_bot"]["customer_lines"]
