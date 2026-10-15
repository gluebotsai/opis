"""Tests for template edit merge + partial patch behavior."""

from __future__ import annotations

from app.agents.template_library.edit_postprocess import finalize_edit_result
from app.agents.template_library.fields import (
    apply_section_operations,
    merge_edit_fields,
)


def _sample_sections_email() -> dict:
    return {
        "subject": "Summer Sale",
        "preheader": "Big discounts",
        "pattern_id": "hero_stack",
        "theme_id": "blue",
        "header_image": "https://cdn.example/hero.jpg",
        "sections": [
            {"type": "headline", "content": "Save Big Today"},
            {"type": "image", "url": "https://cdn.example/hero.jpg"},
            {"type": "text", "content": "Hi {{first_name}}, shop our sale."},
            {"type": "benefits", "items": ["Free shipping", "30-day returns"]},
            {"type": "cta", "label": "Shop Now", "url": "https://shop.example.com"},
            {"type": "compliance_footer", "content": "Unsubscribe anytime"},
        ],
    }


def test_merge_subject_only_preserves_sections():
    current = _sample_sections_email()
    merged = merge_edit_fields("email", current, {"subject": "Winter Sale"})
    assert merged["subject"] == "Winter Sale"
    assert len(merged["sections"]) == len(current["sections"])
    assert merged["sections"][0]["content"] == "Save Big Today"
    assert merged.get("header_image") == current["header_image"]


def test_merge_partial_section_by_type():
    current = _sample_sections_email()
    merged = merge_edit_fields(
        "email",
        current,
        {"sections": [{"type": "headline", "content": "New Headline"}]},
    )
    assert merged["sections"][0]["content"] == "New Headline"
    assert merged["sections"][1]["type"] == "image"
    assert merged["subject"] == "Summer Sale"


def test_merge_equal_length_sections_keeps_image_slots():
    current = _sample_sections_email()
    equal = [dict(row) for row in current["sections"]]
    equal[3] = {
        "type": "image",
        "url": "https://cdn.example/product.jpg",
        "purpose": "product",
        "content": "https://cdn.example/product.jpg",
    }
    merged = merge_edit_fields("email", current, {"sections": equal})
    assert merged["sections"][1]["url"] == "https://cdn.example/hero.jpg"
    assert merged["sections"][3]["url"] == "https://cdn.example/product.jpg"


def test_move_image_to_top_by_type():
    current = _sample_sections_email()
    sections = apply_section_operations(
        list(current["sections"]),
        [{"op": "move", "from_type": "image", "to_index": 0}],
    )
    assert sections[0]["type"] == "image"
    assert sections[1]["type"] == "headline"


def test_insert_text_after_headline_type():
    current = _sample_sections_email()
    sections = apply_section_operations(
        list(current["sections"]),
        [
            {
                "op": "insert",
                "after_type": "headline",
                "type": "text",
                "content": "Extra offer line.",
            }
        ],
    )
    assert sections[1]["type"] == "text"
    assert "Extra offer" in sections[1]["content"]


def test_section_operations_remove_cta():
    current = _sample_sections_email()
    ops = [{"op": "remove", "type": "cta"}]
    sections = apply_section_operations(list(current["sections"]), ops)
    types = {row["type"] for row in sections}
    assert "cta" not in types
    assert "headline" in types


def test_finalize_partial_modify_merges():
    current = _sample_sections_email()
    out = finalize_edit_result(
        instruction="change subject to Winter Sale",
        channel="email",
        current_fields=current,
        result={
            "intent": "modify",
            "fields": {"subject": "Winter Sale"},
            "reply": "Updated the subject.",
        },
    )
    assert out["intent"] == "modify"
    assert out["persist_fields"] is True
    assert out["fields"]["subject"] == "Winter Sale"
    assert len(out["fields"]["sections"]) == 6


def test_merge_whatsapp_body_only():
    current = {
        "name": "summer_sale",
        "body": "Hello {{first_name}} — enjoy 20% off today.",
        "footer": "Reply STOP",
        "buttons": [{"type": "URL", "text": "Shop", "url": "https://shop.example.com"}],
    }
    merged = merge_edit_fields(
        "whatsapp",
        current,
        {"body": "Hello {{first_name}} — enjoy 30% off today."},
    )
    assert "30%" in merged["body"]
    assert merged["name"] == "summer_sale"
    assert len(merged["buttons"]) == 1


def test_merge_explicit_empty_header_image_clears_hero():
    current = _sample_sections_email()
    merged = merge_edit_fields(
        "email",
        current,
        {"header_image": ""},
    )
    assert not str(merged.get("header_image") or "").strip()


def test_clear_hero_image_fields_sets_empty_and_drops_image_section():
    from app.agents.image.template_attach import clear_hero_image_fields

    current = _sample_sections_email()
    out = clear_hero_image_fields(current)
    assert out["header_image"] == ""
    assert out["image_url"] == ""
    types = [row["type"] for row in out["sections"] if isinstance(row, dict)]
    assert "image" not in types
    assert "headline" in types
