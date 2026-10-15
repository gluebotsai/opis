"""Scenario table for LLM-driven channel_visuals (no chat parsing)."""

from __future__ import annotations

from app.agents.image.channel_visual_orchestrator import (
    VISUAL_GENERATE,
    VISUAL_INHERIT_EMAIL_PRIMARY,
    VISUAL_NONE,
    VISUAL_SHARED,
    VISUAL_USE_UPLOAD,
    apply_inherit_from_email_templates,
    merge_channel_visuals,
)
from app.agents.template_library.create_payload import (
    apply_ready_image_urls,
    build_create_payload,
    channels_needing_image_generation_from_resolution,
    fan_out_shared_image_urls,
)


def _session(**kwargs):
    base = {
        "campaign": {"name": "Test", "goal": "Goal", "objective": "Obj"},
        "channels": ["email", "web"],
    }
    base.update(kwargs)
    return base


def test_explicit_none_on_web_only():
    session = _session()
    res = merge_channel_visuals(
        session,
        channels=["email", "web"],
        args={
            "wants_images": True,
            "channel_visuals": [
                {"channel": "email", "visual": "generate"},
                {"channel": "web", "visual": "none"},
            ],
        },
    )
    assert res.by_channel["email"].visual == VISUAL_GENERATE
    assert res.by_channel["web"].visual == VISUAL_NONE
    assert res.by_channel["web"].image_slice is None


def test_shared_mode_both_channels_generate_slice():
    session = _session()
    session["image_plan"] = {
        "wants_images": True,
        "channels": ["email", "web"],
        "mode": "shared",
    }
    res = merge_channel_visuals(
        session,
        channels=["email", "web"],
        args={"wants_images": True},
    )
    assert res.by_channel["email"].image_slice["mode"] == "generate"
    assert res.by_channel["web"].image_slice["mode"] == "generate"
    payload = build_create_payload(
        session, channels=["email", "web"], tool_args={"wants_images": True}
    )
    need = channels_needing_image_generation_from_resolution(
        payload, plan_mode="shared"
    )
    assert need == ["email"]


def test_inherit_email_primary_after_compose():
    session = _session()
    res = merge_channel_visuals(
        session,
        channels=["email", "web"],
        args={
            "channel_visuals": [
                {"channel": "email", "visual": "generate"},
                {"channel": "web", "visual": "inherit_email_primary"},
            ],
        },
    )
    assert res.by_channel["web"].image_slice["mode"] == "inherit_email_primary"
    payload = build_create_payload(
        session,
        channels=["email", "web"],
        tool_args={
            "channel_visuals": [
                {"channel": "email", "visual": "generate"},
                {"channel": "web", "visual": "inherit_email_primary"},
            ],
        },
    )
    updated = apply_inherit_from_email_templates(
        payload,
        [
            {
                "channel": "email",
                "fields": {
                    "sections": [
                        {
                            "type": "image",
                            "url": "https://example.com/api/media/hero.png",
                        }
                    ]
                },
            }
        ],
    )
    web_row = next(r for r in updated["channels"] if r["channel"] == "web")
    assert web_row["image"]["mode"] == "ready"
    assert "hero.png" in web_row["image"]["image_url"]


def test_shared_fan_out_email_and_web():
    payload = {
        "image_mode": "shared",
        "channels": [
            {"channel": "email", "image": {"mode": "generate", "visual": "shared"}},
            {"channel": "web", "image": {"mode": "generate", "visual": "shared"}},
        ],
    }
    need = channels_needing_image_generation_from_resolution(payload, plan_mode="shared")
    assert need == ["email"]
    spread = fan_out_shared_image_urls(
        {"email": "https://example.com/api/media/shared.png"},
        payload,
        plan_mode="shared",
    )
    assert spread["email"] == spread["web"]
    updated = apply_ready_image_urls(payload, {"email": spread["email"]})
    web_row = next(r for r in updated["channels"] if r["channel"] == "web")
    assert web_row["image"]["mode"] == "ready"
    assert "shared.png" in web_row["image"]["image_url"]


def test_per_channel_does_not_fan_out():
    payload = {
        "image_mode": "per_channel",
        "channels": [
            {"channel": "email", "image": {"mode": "generate"}},
            {"channel": "web", "image": {"mode": "generate"}},
        ],
    }
    spread = fan_out_shared_image_urls(
        {"email": "https://example.com/a.png", "web": "https://example.com/b.png"},
        payload,
        plan_mode="per_channel",
    )
    assert spread["email"] != spread.get("web") or spread["web"] == "https://example.com/b.png"


def test_use_upload_when_preferred_url_present():
    session = _session(
        confirmed_chat_images=[
            {
                "image_url": "https://example.com/api/media/up.png",
                "include_in_templates": True,
                "channels": ["web"],
            }
        ],
    )
    res = merge_channel_visuals(
        session,
        channels=["web"],
        args={"wants_images": True, "channel_visuals": [{"channel": "web", "visual": "use_upload"}]},
    )
    assert res.by_channel["web"].visual == VISUAL_USE_UPLOAD
    assert res.ready_urls["web"].endswith("up.png")


def test_upload_wins_over_image_mode_keep_on_regen():
    session = _session(
        templates=[
            {
                "channel": "email",
                "fields": {
                    "sections": [
                        {"type": "image", "url": "https://example.com/api/media/old.png"}
                    ]
                },
            },
        ],
        confirmed_chat_images=[
            {
                "image_url": "https://example.com/api/media/new-upload.png",
                "include_in_templates": True,
                "channels": ["email", "web"],
            }
        ],
    )
    res = merge_channel_visuals(
        session,
        channels=["email", "web"],
        args={"wants_images": True, "image_mode": "keep"},
    )
    assert res.by_channel["email"].visual == VISUAL_USE_UPLOAD
    assert res.by_channel["web"].visual == VISUAL_USE_UPLOAD
    assert "new-upload.png" in res.ready_urls["email"]
    assert res.by_channel["email"].image_slice["source"] == "upload_or_gallery"


def test_explicit_keep_still_uses_prior_not_upload():
    session = _session(
        templates=[
            {
                "channel": "email",
                "fields": {
                    "sections": [
                        {"type": "image", "url": "https://example.com/api/media/old.png"}
                    ]
                },
            },
        ],
        confirmed_chat_images=[
            {
                "image_url": "https://example.com/api/media/new-upload.png",
                "include_in_templates": True,
                "channels": ["email"],
            }
        ],
    )
    res = merge_channel_visuals(
        session,
        channels=["email"],
        args={
            "channel_visuals": [{"channel": "email", "visual": "keep"}],
        },
    )
    assert res.by_channel["email"].visual == "keep"
    assert "old.png" in res.ready_urls["email"]
    assert res.by_channel["email"].image_slice["source"] == "prior_template"


def test_mixed_upload_email_generate_web():
    session = _session(
        confirmed_chat_images=[
            {
                "image_url": "https://example.com/api/media/up.png",
                "include_in_templates": True,
                "channels": ["email"],
            }
        ],
        image_plan={
            "wants_images": True,
            "channels": ["email", "web"],
            "mode": "per_channel",
        },
    )
    res = merge_channel_visuals(
        session,
        channels=["email", "web"],
        args={
            "wants_images": True,
            "channel_visuals": [
                {"channel": "email", "visual": "use_upload"},
                {"channel": "web", "visual": "generate"},
            ],
        },
    )
    assert res.by_channel["email"].image_slice["mode"] == "ready"
    assert res.by_channel["web"].image_slice["mode"] == "generate"
    assert "web" in res.generate_channels
    assert "email" not in res.generate_channels
    payload = build_create_payload(
        session,
        channels=["email", "web"],
        tool_args={
            "channel_visuals": [
                {"channel": "email", "visual": "use_upload"},
                {"channel": "web", "visual": "generate"},
            ],
        },
    )
    email_row = next(r for r in payload["channels"] if r["channel"] == "email")
    web_row = next(r for r in payload["channels"] if r["channel"] == "web")
    assert email_row["image"]["image_url"].endswith("up.png")
    assert web_row["image"]["mode"] == "generate"
