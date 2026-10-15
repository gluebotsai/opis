"""Tests for MAS creation pipeline — prompt-first (no post-turn auto orchestration)."""

from __future__ import annotations

import pytest

from app.mas.runtime.creation_context import image_attach_incomplete


@pytest.mark.asyncio
async def test_highway_is_no_op() -> None:
    from app.mas.runtime.creation_pipeline import complete_create_campaign_highway

    out = await complete_create_campaign_highway(
        session_id="s1",
        token="t",
        module="create_campaign",
        user_text="Diwali sale for VIP buyers",
    )
    assert out == {}


def test_image_attach_incomplete_when_plan_pending() -> None:
    session = {
        "channels": ["email"],
        "templates": [{"channel": "email", "template_id": "tid-1"}],
        "template_ids_by_channel": {"email": "tid-1"},
        "mas_task": {
            "slots": {
                "image": {
                    "plan": {
                        "wants_images": True,
                        "channels": ["email"],
                        "status": "pending",
                        "auto_after_build": True,
                    }
                }
            }
        },
    }
    assert image_attach_incomplete(session) is True


def test_image_attach_complete_when_attached() -> None:
    session = {
        "channels": ["email"],
        "templates": [{"channel": "email", "template_id": "tid-1"}],
        "template_ids_by_channel": {"email": "tid-1"},
        "mas_task": {
            "slots": {
                "image": {
                    "plan": {
                        "wants_images": True,
                        "channels": ["email"],
                        "status": "attached",
                    },
                    "images_by_channel": {"email": "https://cdn.example.com/h.png"},
                }
            }
        },
    }
    assert image_attach_incomplete(session) is False


def test_image_attach_complete_when_template_has_hero() -> None:
    session = {
        "channels": ["email"],
        "templates": [
            {
                "channel": "email",
                "template_id": "tid-1",
                "fields": {
                    "sections": [
                        {"type": "headline", "content": "Hi"},
                        {"type": "image", "url": "https://cdn.example.com/h.png"},
                    ]
                },
            }
        ],
        "template_ids_by_channel": {"email": "tid-1"},
        "mas_task": {
            "slots": {
                "image": {
                    "plan": {
                        "wants_images": True,
                        "channels": ["email"],
                        "status": "pending",
                    }
                }
            }
        },
    }
    assert image_attach_incomplete(session) is False
    assert session["mas_task"]["slots"]["image"]["plan"]["status"] == "attached"


def test_content_domain_redirects_create_module_without_templates() -> None:
    import asyncio

    session: dict = {
        "module": "create_campaign",
        "channels": ["email"],
        "templates": [],
    }

    async def run():
        from app.mas.domains.content.runner import run_content_domain

        return await run_content_domain(
            {
                "session": session,
                "domain_id": "content",
                "entry": "interactive",
                "query": "generate template with image",
                "module_hint": "create_campaign",
                "task_spec": {"query": "generate template with image"},
                "token": "t",
                "session_id": "s1",
            }
        )

    out = asyncio.run(run())
    assert out.get("action_status") == "needs_domain"
    assert out["needs_domain"]["domain_id"] == "creation"
    assert out["needs_domain"]["preferred_executor"] == "campaign_content"
    assert out["needs_domain"]["restated_query"] == "generate template with image"
