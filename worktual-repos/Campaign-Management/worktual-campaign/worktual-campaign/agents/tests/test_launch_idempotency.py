"""Refuse a second launch_campaign confirm on the same live session."""

from __future__ import annotations

from app.agents.create_campaign.tool_functions import (
    _already_launched_reply,
    _email_launch_retry_allowed,
    _launch_retry_allowed,
    _whatsapp_config_launch_retry_allowed,
)


def test_already_launched_blocks_second_confirm() -> None:
    out = _already_launched_reply(
        {
            "launch_confirmed": True,
            "campaign_id": "camp-1",
            "stage": "live",
        }
    )
    assert out is not None
    assert out["already_launched"] is True
    assert out["campaign_id"] == "camp-1"


def test_whatsapp_config_failure_allows_retry_flag() -> None:
    session = {
        "channels": ["whatsapp"],
        "soft_warnings": [
            "WhatsApp channel configuration was not found on CCaaS for this channelConfigId."
        ],
    }
    assert _whatsapp_config_launch_retry_allowed(session) is True


def test_not_launched_allows_confirm() -> None:
    assert _already_launched_reply({"launch_confirmed": False}) is None
    assert _already_launched_reply({"launch_confirmed": True, "stage": "draft"}) is None
    assert (
        _already_launched_reply(
            {"launch_confirmed": True, "campaign_id": "", "stage": "live"}
        )
        is None
    )


def test_email_suppression_allows_launch_retry() -> None:
    session = {
        "launch_confirmed": True,
        "campaign_id": "42",
        "stage": "live",
        "channels": ["email"],
        "launch_outcomes": {"email_queued": False, "email": "not queued — suppression"},
    }
    assert _email_launch_retry_allowed(session) is True
    assert _launch_retry_allowed(session) is True


def test_successful_email_launch_blocks_retry_without_warnings() -> None:
    session = {
        "launch_confirmed": True,
        "campaign_id": "42",
        "stage": "live",
        "channels": ["email"],
        "launch_outcomes": {"email_queued": True, "email": "queued"},
    }
    assert _email_launch_retry_allowed(session) is False
    assert _launch_retry_allowed(session) is False
