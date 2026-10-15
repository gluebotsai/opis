"""Approved WA audience freeze — session memory + launch readiness."""

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.whatsapp_approved.launch_helpers import (
    ensure_approved_audience_frozen,
    finalize_whatsapp_approved_audience,
    mirror_campaign_audience_to_whatsapp,
)


def test_mirror_campaign_audience_to_whatsapp():
    session: dict = {
        "audience": {
            "filters": {"phones": ["919500401679"]},
            "sample_names": ["Aravindh Selvaraj"],
        }
    }
    mirror_campaign_audience_to_whatsapp(session, ["cid-1"])
    wa = session["whatsapp_audience"]
    assert wa["contact_ids"] == ["cid-1"]
    assert wa["phones"] == ["919500401679"]
    assert wa["contacts_sample"][0]["name"] == "Aravindh Selvaraj"


@pytest.mark.asyncio
async def test_ensure_frozen_from_pending_contact_ids():
    session = {
        "whatsapp_approved_run": True,
        "pending_contact_update": {"contact_ids": ["abc", "def"]},
        "audience": {"matched_count": 2, "filters": {"phones": ["919500401679"]}},
    }
    with patch(
        "app.agents.whatsapp_approved.launch_helpers.load_audience_ids",
        new_callable=AsyncMock,
    ) as load_ids:
        with patch(
            "app.agents.whatsapp_approved.launch_helpers.save_audience_ids",
            new_callable=AsyncMock,
        ) as save_ids:
            load_ids.side_effect = [[], ["abc", "def"]]
            ok, err = await ensure_approved_audience_frozen("sess", "tok", session)
    assert ok is True
    assert err == ""
    assert session.get("audience_launch_ready") is True
    save_ids.assert_awaited_once()
    assert session["whatsapp_audience"]["contact_ids"] == ["abc", "def"]


@pytest.mark.asyncio
async def test_finalize_skips_non_approved_module():
    with patch(
        "app.agents.whatsapp_approved.launch_helpers.get_or_create_session",
        new_callable=AsyncMock,
        return_value={"module": "create_campaign"},
    ):
        out = await finalize_whatsapp_approved_audience("sess", "tok")
    assert out.get("skipped") is True
