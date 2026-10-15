"""Meta approval-first sanitize (category, footer, header, body opening)."""

from app.agents.template_library.channels.whatsapp.meta_rules import (
    sanitize_whatsapp_fields,
    validate_whatsapp_fields,
)


def test_delivery_update_becomes_utility_and_drops_text_header() -> None:
    raw = {
        "name": "booxoodeliveryupdate_2026",
        "language": "en",
        "category": "MARKETING",
        "header_format": "TEXT",
        "header": "Order Update",
        "body": (
            "Hi {{first_name}},\n\nWe wanted to share a quick update regarding "
            "your recent Booxoo order.\n\nIf your delivery attempt was unsuccessful, "
            "please check your tracking information for the next scheduled delivery date."
        ),
        "footer": "Booxoo Customer Care",
        "buttons": [],
    }
    out = sanitize_whatsapp_fields(
        raw,
        campaign={"goal": "order update", "objective": "delivery status"},
    )
    assert out["category"] == "UTILITY"
    assert out["header_format"] == "NONE"
    assert not str(out.get("header") or "").strip()
    assert "{{" not in str(out["body"])
    assert "order" in str(out["body"]).lower()
    ok, errors = validate_whatsapp_fields(out, strict=True)
    assert ok, errors
    body_comp = next(c for c in out["components"] if c["type"] == "BODY")
    assert "example" not in body_comp or not body_comp.get("example")


def test_marketing_gets_opt_out_footer() -> None:
    raw = {
        "name": "spring_promo_2026",
        "language": "en",
        "category": "MARKETING",
        "body": (
            "Spring savings are here for our loyal shoppers.\n\n"
            "Browse the collection and enjoy limited-time deals on selected styles."
        ),
        "footer": "Acme Retail",
        "buttons": [],
    }
    out = sanitize_whatsapp_fields(raw)
    assert "STOP" in str(out["footer"]).upper() or "opt out" in str(out["footer"]).lower()
