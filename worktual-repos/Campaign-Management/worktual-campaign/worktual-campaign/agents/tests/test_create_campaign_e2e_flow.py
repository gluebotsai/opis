"""Create-campaign flow guards — session facts, attach idempotency, prompt assembly."""

from __future__ import annotations

from app.mas.runtime.campaign_setup_snapshot import live_session_facts
from app.mas.runtime.creation_context import (
    campaign_meta_complete,
    channel_template_has_hero,
    image_attach_incomplete,
    selected_channels,
)


def test_diwali_session_meta_complete() -> None:
    session = {
        "campaign": {
            "name": "Diwali Sale",
            "goal": "Drive festival purchases",
            "objective": "Promote Diwali offers to VIP buyers",
        },
        "channels": ["email"],
        "audience": {"matched_count": 25},
        "templates": [{"channel": "email", "template_id": "t-email-1"}],
        "template_ids_by_channel": {"email": "t-email-1"},
    }
    facts = live_session_facts(session)
    assert facts["campaign"]["meta_complete"] is True
    assert facts["channels"] == ["email"]
    assert facts["audience"]["has_matched_contacts"] is True
    assert facts["templates"]["ready_for_channels"] is True
    assert campaign_meta_complete(session)
    assert not image_attach_incomplete(
        {
            **session,
            "mas_task": {
                "slots": {
                    "image": {
                        "plan": {
                            "wants_images": True,
                            "channels": ["email"],
                            "status": "attached",
                        }
                    }
                }
            },
        }
    )


def test_hero_on_template_skips_reattach() -> None:
    session = {
        "channels": ["email"],
        "templates": [
            {
                "channel": "email",
                "template_id": "t1",
                "fields": {
                    "sections": [
                        {"type": "headline", "content": "Diwali"},
                        {"type": "image", "url": "https://cdn.example.com/hero.png"},
                    ]
                },
            }
        ],
        "mas_task": {
            "slots": {
                "image": {
                    "plan": {"wants_images": True, "channels": ["email"], "status": "pending"}
                }
            }
        },
    }
    assert channel_template_has_hero(session, "email")
    assert image_attach_incomplete(session) is False


def test_meta_only_session_has_no_templates() -> None:
    """Meta-only turn must not imply templates exist — agents ask channels next."""
    from app.mas.runtime.campaign_setup_snapshot import live_session_facts

    session = {
        "campaign": {
            "name": "Diwali Sale",
            "goal": "Drive festival purchases",
            "objective": "Promote Diwali offers to VIP buyers",
        },
        "channels": [],
        "templates": [],
    }
    facts = live_session_facts(session)
    assert facts["campaign"]["meta_complete"] is True
    assert facts["channels"] == []
    assert facts["templates"]["ready_for_channels"] is False
    assert facts["templates"]["count"] == 0


def test_selected_channels_from_session() -> None:
    session = {"channels": ["email", "web"]}
    assert selected_channels(session) == ["email", "web"]

