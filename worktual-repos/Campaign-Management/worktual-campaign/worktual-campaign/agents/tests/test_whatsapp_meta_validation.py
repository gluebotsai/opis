"""WhatsApp Meta field validation (approval-risk rules)."""

from app.agents.template_library.channels.whatsapp.meta_rules import (
    collect_whatsapp_meta_names,
    validate_whatsapp_fields,
)


def test_body_variable_at_start_fails_strict() -> None:
    fields = {
        "name": "spring_offer_2026",
        "language": "en",
        "category": "MARKETING",
        "body": "{{first_name}}, we saved a spot for you in our spring program.",
        "footer": "Reply STOP to opt out",
        "buttons": [],
    }
    ok, errors = validate_whatsapp_fields(fields, strict=True)
    assert not ok
    assert any("start or end" in e.lower() for e in errors)


def test_body_variable_at_end_fails_strict() -> None:
    fields = {
        "name": "spring_offer_2026_b",
        "language": "en",
        "category": "MARKETING",
        "body": "We saved a spot for you in our spring program, {{first_name}}",
        "footer": "Reply STOP to opt out",
        "buttons": [],
    }
    ok, errors = validate_whatsapp_fields(fields, strict=True)
    assert not ok
    assert any("start or end" in e.lower() for e in errors)


def test_collect_whatsapp_meta_names_dedupes() -> None:
    prior = [
        {"channel": "whatsapp", "fields": {"name": "offer_a"}},
        {"channel": "whatsapp", "fields": {"name": "offer_a"}},
        {"channel": "email", "fields": {"name": "ignored"}},
        {"channel": "whatsapp", "fields": {"name": "offer_b"}},
    ]
    names = collect_whatsapp_meta_names(prior)
    assert names == ["offer_a", "offer_b"]
