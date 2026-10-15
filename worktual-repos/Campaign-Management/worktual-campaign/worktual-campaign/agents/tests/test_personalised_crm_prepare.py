"""Personalised CRM prepare: structured payload only, no Hub request_text parse."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.personalised_crm.prepare import (
    flatten_crm_people,
    prepare_personalised_crm_send,
)


def test_missing_channels_aborts_without_generation() -> None:
    result = asyncio.run(
        prepare_personalised_crm_send(
            {"emails": ["priya@acme.com"], "brief": "Follow up"}
        )
    )
    assert result["ok"] is False
    assert result["error_code"] == "missing_channels"
    assert result["aborted"] is True


def test_missing_identity_aborts_without_generation() -> None:
    result = asyncio.run(
        prepare_personalised_crm_send(
            {"channels": ["email"], "brief": "Follow up after the meeting"}
        )
    )
    assert result["ok"] is False
    assert result["error_code"] == "missing_contact_identity"
    assert result["aborted"] is True
    assert "Personalised CRM request" in result["error"]


def test_people_array_flattens_into_emails() -> None:
    body = flatten_crm_people(
        {
            "channels": ["email"],
            "people": [{"email": "ops@worktual.com", "contact_id": "CDP-1"}],
        }
    )
    assert body["emails"] == ["ops@worktual.com"]
    assert body["contact_ids"] == ["CDP-1"]


def test_prepare_uses_crm_channels_not_request_text() -> None:
    async def _run() -> dict:
        created = {
            "ok": True,
            "templates": [
                {
                    "channel": "email",
                    "fields": {
                        "subject": "Thanks for the chat",
                        "paragraphs": ["Happy to recap next steps."],
                    },
                    "how_it_works": "Personalised CRM email",
                    "fallback": False,
                }
            ],
            "errors": [],
        }
        with patch(
            "app.agents.personalised_crm.prepare.run_creation_agent",
            new=AsyncMock(return_value=created),
        ) as mocked:
            result = await prepare_personalised_crm_send(
                {
                    "name": "Post-demo",
                    "brief": "Recap the demo for Priya",
                    "channels": ["email"],
                    "emails": ["priya@acme.com"],
                    "request_text": "this Hub sentence must not be required",
                }
            )
            mocked.assert_awaited()
            kwargs = mocked.await_args.kwargs
            assert kwargs["channels"] == ["email"]
            return result

    result = asyncio.run(_run())
    assert result["ok"] is True
    assert result["channels"] == ["email"]
    assert result["templates"][0]["channel"] == "email"
    assert result["identity"]["emails"] == ["priya@acme.com"]
