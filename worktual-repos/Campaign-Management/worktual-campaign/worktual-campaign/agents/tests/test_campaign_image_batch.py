"""Multi-channel campaign image plan + batch attach helpers."""

from __future__ import annotations

from app.agents.image.channel_image import (
    build_attach_fields_for_channel,
    eligible_image_channels,
    resolve_plan_channels,
    template_ids_by_channel,
)
from app.agents.image.plan import get_image_plan, set_image_plan


def test_eligible_image_channels_filters_push():
    session = {"channels": ["email", "whatsapp", "push", "web"]}
    assert eligible_image_channels(session) == ["email", "whatsapp", "web"]


def test_resolve_plan_all_eligible():
    session = {"channels": ["email", "whatsapp", "push"]}
    resolved = resolve_plan_channels(session, channels=None, scope="all_eligible")
    assert resolved == ["email", "whatsapp"]


def test_resolve_plan_subset():
    session = {"channels": ["email", "whatsapp", "push"]}
    resolved = resolve_plan_channels(session, channels=["email"], scope="subset")
    assert resolved == ["email"]


def test_set_image_plan_shared_all_eligible():
    session = {"channels": ["email", "whatsapp", "push"]}
    plan = set_image_plan(
        session,
        wants_images=True,
        mode="shared",
        scope="all_eligible",
    )
    assert plan["wants_images"] is True
    assert plan["mode"] == "shared"
    assert plan["channels"] == ["email", "whatsapp"]
    assert "push" in (plan.get("skipped_channels") or [])


def test_set_image_plan_per_channel_subset():
    session = {"channels": ["email", "whatsapp"]}
    plan = set_image_plan(
        session,
        wants_images=True,
        channels=["email", "whatsapp"],
        mode="per_channel",
        scope="subset",
    )
    assert plan["mode"] == "per_channel"
    assert plan["channels"] == ["email", "whatsapp"]
    assert get_image_plan(session)["status"] == "pending"


def test_template_ids_by_channel_from_session_index():
    session = {
        "template_ids_by_channel": {"email": "e1", "whatsapp": "w1"},
        "templates": [],
    }
    assert template_ids_by_channel(session) == {"email": "e1", "whatsapp": "w1"}


def test_build_attach_fields_whatsapp_sets_image_header():
    fields = build_attach_fields_for_channel(
        {"body": "Hello there, this is a long enough whatsapp marketing body for tests."},
        channel="whatsapp",
        image_url="https://cdn.example.com/h.png",
    )
    assert fields is not None
    assert fields["header_media_url"] == "https://cdn.example.com/h.png"
    assert fields["header_format"] == "IMAGE"
    assert "Hello there" in str(fields.get("body") or "")


def test_build_attach_fields_web_preserves_title_body():
    fields = build_attach_fields_for_channel(
        {
            "title": "Fresh Cap Alert",
            "body": "New trending caps are in stock — tap to shop today.",
            "cta_label": "Shop now",
        },
        channel="web",
        image_url="https://cdn.example.com/api/media/hero.png",
    )
    assert fields is not None
    assert fields.get("title") == "Fresh Cap Alert"
    assert len(str(fields.get("body") or "")) >= 12
    assert "hero.png" in str(fields.get("image_url") or "")


def test_build_attach_fields_email_header_image():
    fields = build_attach_fields_for_channel(
        {"subject": "Hi", "paragraphs": ["Body"]},
        channel="email",
        image_url="https://cdn.example.com/h.png",
    )
    assert fields is not None
    assert fields["header_image"] == "https://cdn.example.com/h.png"


def test_campaign_images_executor_in_catalog():
    from app.mas.catalog import executors_for_domain

    assert "campaign_images" in executors_for_domain("image")


def test_campaign_images_tool_allowlist():
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    names = EXECUTOR_TOOL_ALLOWLIST["campaign_images"]
    assert "PLAN_CAMPAIGN_IMAGES" in names
    assert "RUN_CAMPAIGN_IMAGE_PIPELINE" in names


def test_attach_only_current_generation_batch():
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents.image.batch import attach_campaign_images

    updated: list[str] = []

    async def fake_get(tid, token=None):
        return {
            "template": {
                "channel": "email",
                "fields": {"subject": tid, "paragraphs": ["Body"]},
            }
        }

    async def fake_update(tid, fields, token=None):
        updated.append(tid)
        base = {"subject": tid, "paragraphs": ["Body"]}
        return {"template": {"id": tid, "fields": {**base, **dict(fields or {})}}}

    session = {
        "module": "create_campaign",
        "channels": ["email"],
        "template_ids_by_channel": {"email": "e1"},
        "templates": [
            {
                "template_id": "e1",
                "channel": "email",
                "generation_batch_id": "b1",
                "fields": {"subject": "old"},
            },
            {
                "template_id": "e2",
                "channel": "email",
                "generation_batch_id": "b2",
                "fields": {"subject": "new"},
            },
        ],
    }

    async def run():
        with (
            patch(
                "app.agents.image.batch.get_template",
                new=AsyncMock(side_effect=fake_get),
            ),
            patch(
                "app.agents.image.batch.update_template_fields",
                new=AsyncMock(side_effect=fake_update),
            ),
        ):
            return await attach_campaign_images(
                session,
                token="t",
                images_by_channel={"email": "https://cdn.example.com/h.png"},
                generation_batch_id="b2",
            )

    out = asyncio.run(run())
    assert out.get("ok") is True
    assert "e1" not in updated
    assert updated == ["e2"]


def test_attach_mismatch_batch_id_does_not_write_previous_email():
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.agents.image.batch import attach_campaign_images

    updated: list[str] = []

    async def fake_get(tid, token=None):
        return {
            "template": {
                "channel": "email",
                "fields": {"subject": tid, "paragraphs": ["Body"]},
            }
        }

    async def fake_update(tid, fields, token=None):
        updated.append(tid)
        return {"template": {"id": tid, "fields": dict(fields or {})}}

    session = {
        "module": "create_campaign",
        "channels": ["email"],
        "template_ids_by_channel": {"email": "e1"},
        "templates": [
            {
                "template_id": "e1",
                "channel": "email",
                "generation_batch_id": "111",
                "fields": {"subject": "old"},
            },
            {
                "template_id": "e2",
                "channel": "email",
                "generation_batch_id": "222",
                "fields": {"subject": "new"},
            },
        ],
    }

    async def run():
        with (
            patch(
                "app.agents.image.batch.get_template",
                new=AsyncMock(side_effect=fake_get),
            ),
            patch(
                "app.agents.image.batch.update_template_fields",
                new=AsyncMock(side_effect=fake_update),
            ),
        ):
            return await attach_campaign_images(
                session,
                token="t",
                images_by_channel={"email": "https://cdn.example.com/h.png"},
                generation_batch_id="uuid-does-not-match-numeric",
            )

    out = asyncio.run(run())
    assert "e1" not in updated
    assert updated == ["e2"]
    assert out.get("ok") is True
