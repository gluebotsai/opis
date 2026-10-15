"""Campaign setup snapshot — facts-only Live session struct."""

from __future__ import annotations

from app.mas.runtime.campaign_setup_snapshot import (
    campaign_setup_snapshot,
    live_session_facts,
)


def test_live_session_facts_meta_channels_audience() -> None:
    session = {
        "campaign": {"name": "Diwali", "goal": "Drive sales", "objective": "Promote offers"},
        "channels": ["email"],
        "audience": {"matched_count": 12, "description": "VIP buyers"},
        "templates": [{"channel": "email", "template_id": "t1"}],
        "template_ids_by_channel": {"email": "t1"},
    }
    facts = live_session_facts(session)
    assert facts["campaign"]["meta_complete"] is True
    assert facts["campaign"]["name"] == "Diwali"
    assert facts["channels"] == ["email"]
    assert facts["audience"]["has_matched_contacts"] is True
    assert facts["templates"]["ready_for_channels"] is True


def test_live_session_facts_empty_session() -> None:
    facts = live_session_facts({})
    assert facts["campaign"]["meta_complete"] is False
    assert facts["channels"] == []
    assert facts["audience"]["has_matched_contacts"] is False


def test_campaign_setup_snapshot_alias() -> None:
    session = {
        "campaign": {"name": "T", "goal": "G", "objective": "O"},
        "channels": ["email"],
    }
    assert campaign_setup_snapshot(session) == live_session_facts(session)
