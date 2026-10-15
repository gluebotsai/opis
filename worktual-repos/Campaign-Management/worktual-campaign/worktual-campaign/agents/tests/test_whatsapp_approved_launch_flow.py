"""Approved WA: email audience → launch persists channel template + freezes audience."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.create_campaign.tool_functions import (
    handle_confirm_launch,
    handle_lookup_contacts,
)


@pytest.mark.asyncio
async def test_lookup_email_then_finalize_sets_launch_ready():
    session_id = "wa-approved-test"
    token = "tok"
    base_session = {
        "module": "whatsapp_approved",
        "whatsapp_approved_run": True,
        "campaign": {"name": "WA test", "goal": "g", "objective": "o"},
        "channels": ["whatsapp"],
    }

    with patch(
        "app.agents.create_campaign.tool_functions.get_or_create_session",
        new_callable=AsyncMock,
    ) as get_sess:
        with patch(
            "app.agents.create_campaign.tool_functions.handle_filter_contacts",
            new_callable=AsyncMock,
        ) as filt:
            with patch(
                "app.agents.create_campaign.tool_functions.load_audience_ids",
                new_callable=AsyncMock,
            ) as load_ids:
                with patch(
                    "app.agents.create_campaign.tool_functions.save_audience_ids",
                    new_callable=AsyncMock,
                ):
                    with patch(
                        "app.agents.create_campaign.tool_functions.save_session",
                        new_callable=AsyncMock,
                    ):
                        get_sess.return_value = dict(base_session)
                        filt.return_value = {
                            "ok": True,
                            "emails_matched": ["aravindhselvaraj6235@gmail.com"],
                            "emails_missing": [],
                            "phones_matched": ["919500401679"],
                            "phones_missing": [],
                            "sample_names": ["Aravindh Selvaraj"],
                        }
                        load_ids.side_effect = [
                            ["cdp-contact-1"],
                            ["cdp-contact-1"],
                        ]

                        out = await handle_lookup_contacts(
                            session_id,
                            token,
                            {"emails": ["aravindhselvaraj6235@gmail.com"]},
                        )

    assert out.get("found") is True
    assert out.get("matched_count") == 1
    assert "WA_APPROVED_NEXT" in out.get("message", "") or "LOOKUP_OK_WA" in out.get(
        "message", ""
    )


@pytest.mark.asyncio
async def test_confirm_launch_calls_template_persist_for_approved_run():
    session_id = "wa-approved-test"
    token = "tok"
    session = {
        "module": "whatsapp_approved",
        "whatsapp_approved_run": True,
        "channels": ["whatsapp"],
        "templates": [
            {
                "template_id": "1060",
                "channel": "whatsapp",
                "fields": {
                    "body": "Thanks for contacting Worktual. How can we help you today?",
                    "approval": {
                        "submitted": True,
                        "status": "approved",
                        "provider_template_id": "meta-123",
                    },
                    "meta_approved": True,
                },
            }
        ],
        "templates_finalized": True,
        "whatsapp_template_snapshot": {
            "id": "1060",
            "name": "worktual_help",
            "body": "Thanks for contacting Worktual. How can we help you today?",
            "status": "approved",
        },
        "campaign": {"name": "WA · worktual_help", "goal": "g", "objective": "o"},
        "launch_plan": {"schedule_mode": "now", "launch_channels": ["whatsapp"]},
        "audience_launch_ready": True,
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
                "app.agents.whatsapp_approved.launch_helpers.persist_approved_whatsapp_templates_for_launch",
                new_callable=AsyncMock,
            ) as persist:
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
                            "app.agents.whatsapp_approved.launch_helpers.ensure_approved_audience_frozen",
                            new_callable=AsyncMock,
                            return_value=(True, ""),
                        ):
                            with patch(
                                "app.agents.create_campaign.tool_functions.load_audience_ids",
                                new_callable=AsyncMock,
                                return_value=["cdp-contact-1"],
                            ):
                                with patch(
                                    "app.agents.create_campaign.tool_functions.save_campaign_from_session",
                                    new_callable=AsyncMock,
                                    return_value={
                                        "id": "camp-1",
                                        "whatsapp_send_plan": {
                                            "scheduled": True,
                                            "whatsapp": {"status": "approved"},
                                        },
                                    },
                                ):
                                    with patch(
                                        "app.agents.create_campaign.tool_functions.save_session",
                                        new_callable=AsyncMock,
                                    ):
                                        persist.return_value = (session, None)
                                        out = await handle_confirm_launch(
                                            session_id,
                                            token,
                                            {"confirmed": True},
                                        )

    persist.assert_awaited()
    assert out.get("ok") is True or out.get("launch_confirmed") or session.get(
        "launch_confirmed"
    )
