"""Tests for creative context, design-plan image sync, and multi-slot attach."""

from __future__ import annotations

from app.agents.image.design_plan_sync import apply_design_plans_to_image_plan
from app.agents.image.hero_image import list_unfilled_image_section_indices
from app.agents.image.pipeline_ui import collect_image_pipeline_ui_events
from app.agents.image.plan import get_image_plan, should_run_pipeline_after_build
from app.agents.image.template_attach import build_attach_fields
from app.agents.template_generation_director.creative_context import (
    effective_wants_images,
    normalize_image_intent,
)


def test_normalize_image_intent_slots_imply_needed():
    out = normalize_image_intent(
        {
            "images_needed": False,
            "slots": [{"role": "hero", "aspect_ratio": "16:9"}],
        }
    )
    assert out["images_needed"] is True
    assert len(out["slots"]) == 1


def test_effective_wants_images_from_enhancer():
    assert effective_wants_images(
        tool_wants_images=False,
        enhancer={"image_intent": {"images_needed": True, "count_hint": 2}},
        image_plan={},
    )


def test_apply_design_plans_to_image_plan():
    session: dict = {"channels": ["email"], "templates": []}
    apply_design_plans_to_image_plan(
        session,
        [
            {
                "channel": "email",
                "image_slot_specs": [
                    {"role": "hero", "aspect_ratio": "16:9", "display": "full_width"},
                    {"role": "product", "aspect_ratio": "1:1", "display": "grid_cell"},
                ],
                "sections": ["headline", "image", "text", "image", "cta"],
            }
        ],
    )
    plan = get_image_plan(session)
    assert plan.get("wants_images") is True
    assert "email" in plan.get("channels", [])


def test_build_attach_fields_only_first_of_multiple_placeholders():
    existing = {
        "subject": "Sale",
        "sections": [
            {"type": "headline", "content": "Hi"},
            {"type": "image", "content": "[Hero image]"},
            {"type": "text", "content": "Body"},
            {"type": "image", "content": "[Product 1]"},
        ],
    }
    patch = build_attach_fields(
        existing,
        image_url="https://cdn.example.com/a.png",
        field_key="header_image",
    )
    sections = patch.get("sections") or []
    assert sections[1]["url"] == "https://cdn.example.com/a.png"
    assert "url" not in sections[3] or not str(sections[3].get("url", "")).startswith("http")


def test_should_run_pipeline_when_email_has_unfilled_sections():
    session = {
        "templates": [
            {
                "channel": "email",
                "fields": {
                    "sections": [
                        {"type": "image", "url": "https://cdn.example.com/hero.png"},
                        {"type": "image", "content": "[Product]"},
                    ],
                },
            }
        ],
    }
    from app.mas.runtime.task_memory import get_mas_task

    task = get_mas_task(session)
    task.setdefault("slots", {}).setdefault("image", {})["plan"] = {
        "wants_images": True,
        "channels": ["email"],
        "auto_after_build": True,
        "status": "attached",
    }
    assert should_run_pipeline_after_build(session) is True
    assert list_unfilled_image_section_indices(session["templates"][0]["fields"]) == [1]


def test_replace_product_image_keeps_hero_header():
    existing = {
        "subject": "Sale",
        "header_image": "https://cdn.example.com/hero.png",
        "sections": [
            {"type": "image", "url": "https://cdn.example.com/hero.png", "purpose": "hero"},
            {"type": "text", "content": "Body"},
            {
                "type": "image",
                "url": "https://cdn.example.com/p1.png",
                "purpose": "product",
            },
        ],
    }
    patch = build_attach_fields(
        existing,
        image_url="https://cdn.example.com/p2.png",
        only_section_index=2,
    )
    assert patch["sections"][2]["url"] == "https://cdn.example.com/p2.png"
    assert patch["header_image"] == "https://cdn.example.com/hero.png"


def test_collect_image_pipeline_ui_events_dedupes():
    pipeline = {
        "ui_events": [{"type": "template_image_attached", "template_id": "t1", "image_url": "u1"}],
        "attach": {
            "ui_events": [
                {"type": "template_image_attached", "template_id": "t1", "image_url": "u1"},
            ],
        },
        "email_slot_fill": {
            "ui_events": [
                {"type": "template_image_attached", "template_id": "t1", "image_url": "u2"},
            ],
        },
    }
    events = collect_image_pipeline_ui_events(pipeline)
    assert len(events) == 2
