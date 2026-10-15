"""Integration: create-campaign WhatsApp template → confirm launch (chat path)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.create_campaign.memory_note import get_memory_note
from app.agents.create_campaign.tool_functions import handle_confirm_launch
from app.agents.template_library.channels.whatsapp.meta_rules import (
    build_meta_submit_components,
    validate_whatsapp_fields,
)

# Meta-safe body (≥80 chars, vars not at edges) like gallery sanitize produces.
_WA_BODY = (
    "Hi {{first_name}}, your Worktual daily report is ready for review. "
    "Open the link below to see metrics and follow up with your team when "
    "you have a moment today."
)


def test_agent_whatsapp_fields_pass_meta_and_build_submit() -> None:
    fields = {
        "name": "wa_daily_report_test",
        "language": "en",
        "category": "UTILITY",
        "body": _WA_BODY,
        "footer": "Worktual",
        "buttons": [
            {"type": "URL", "text": "Open report", "url": "{{campaign_url}}"},
        ],
    }
    ok, errors = validate_whatsapp_fields(fields, strict=True)
    assert ok, errors
    meta = build_meta_submit_components(fields)
    body = next(c for c in meta["components"] if c["type"] == "BODY")
    assert "{{1}}" in body["text"]
    assert body.get("example", {}).get("body_text")
    assert body["example"]["body_text"][0][0] == "Customer"
    buttons = next(c for c in meta["components"] if c["type"] == "BUTTONS")[
        "buttons"
    ]
    assert buttons[0]["type"] == "URL"
    assert "{{" in buttons[0]["url"] or buttons[0]["url"].startswith("https://")


@pytest.mark.asyncio
async def test_confirm_launch_whatsapp_sets_memory_and_outcomes() -> None:
    session_id = "wa-create-flow-test"
    token = "tok"
    built = build_meta_submit_components(
        {
            "name": "wa_daily_report_test",
            "language": "en",
            "category": "UTILITY",
            "body": _WA_BODY,
            "footer": "Worktual",
            "buttons": [],
        }
    )
    fields = {
        "name": "wa_daily_report_test",
        "language": "en",
        "category": "UTILITY",
        "body": _WA_BODY,
        "footer": "Worktual",
        "buttons": [],
        "components": built["components"],
        "body_placeholders": built["body_placeholders"],
    }

    session = {
        "channels": ["whatsapp"],
        "templates": [
            {
                "template_id": "tpl-wa-001",
                "channel": "whatsapp",
                "fields": fields,
            }
        ],
        "templates_finalized": True,
        "campaign": {"name": "WA daily", "goal": "report", "objective": "notify"},
        "launch_plan": {
            "schedule_mode": "now",
            "launch_channels": ["whatsapp"],
            "timezone": "Asia/Kolkata",
        },
        "audience": {"matched_count": 1},
    }

    saved_payload: dict = {}

    async def _capture_save(_sid, payload, token=None, **kwargs):
        saved_payload.update(payload or {})
        return {
            "campaign": {"id": "camp-wa-1"},
            "whatsapp_send_plan": {
                "scheduled": True,
                "whatsapp": {
                    "status": "pending",
                    "template_name": "wa_daily_report_test",
                    "agent_memory_line": (
                        'WhatsApp Meta: submitted for approval; status PENDING '
                        'template "wa_daily_report_test".'
                    ),
                },
            },
        }

    with patch(
        "app.agents.create_campaign.tool_functions.get_or_create_session",
        new_callable=AsyncMock,
        return_value=session,
    ):
        with patch(
            "app.agents.create_campaign.tool_functions.launch_readiness_message",
            return_value=None,
        ):
            with patch(
                "app.agents.create_campaign.tool_functions._hydrate_session_templates_from_db",
                new_callable=AsyncMock,
                side_effect=lambda s, _sid, **kw: s,
            ):
                with patch(
                    "app.agents.create_campaign.tool_functions._persist_canonical_email_templates",
                    new_callable=AsyncMock,
                    side_effect=lambda s, **_: s,
                ):
                    with patch(
                        "app.agents.create_campaign.tool_functions.load_audience_ids",
                        new_callable=AsyncMock,
                        return_value=["contact-1"],
                    ):
                        with patch(
                            "app.agents.create_campaign.tool_functions.save_campaign_from_session",
                            new_callable=AsyncMock,
                            side_effect=_capture_save,
                        ):
                            with patch(
                                "app.agents.create_campaign.tool_functions.save_session",
                                new_callable=AsyncMock,
                            ):
                                with patch(
                                    "app.agents.create_campaign.tool_functions._call_audience_insights",
                                    new_callable=AsyncMock,
                                    return_value={},
                                ):
                                    with patch(
                                        "app.integrations.email_launch_transport.email_channel_mailbox_block",
                                        new_callable=AsyncMock,
                                        return_value=None,
                                    ):
                                        out = await handle_confirm_launch(
                                        session_id,
                                        token,
                                            {"confirmed": True},
                                        )

    assert out.get("confirmed") is True
    ch_rows = saved_payload.get("channels") or []
    assert any(
        isinstance(c, dict) and c.get("channel") == "whatsapp" for c in ch_rows
    )
    assert out.get("whatsapp_meta_status") == "pending"
    note = get_memory_note(session)
    assert "WhatsApp Meta:" in note
    assert "PENDING" in note.upper() or "pending" in note.lower()
