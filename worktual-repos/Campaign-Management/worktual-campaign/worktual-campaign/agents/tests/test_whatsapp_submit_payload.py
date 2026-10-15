"""Meta submit payload mapping (examples, buttons, enrich)."""

from app.agents.template_library.channels.whatsapp.meta_rules import (
    build_meta_submit_components,
    example_value_for_placeholder,
    map_named_vars_for_meta,
    map_url_button_for_meta,
)


def test_example_values_not_alex() -> None:
    assert example_value_for_placeholder("first_name") == "Customer"
    assert example_value_for_placeholder("report_date") == "19 Sep 2026"


def test_body_maps_named_vars_and_examples() -> None:
    text, ph, ex = map_named_vars_for_meta(
        "Report for {{report_date}} — open {{campaign_url}}"
    )
    assert "{{1}}" in text and "{{2}}" in text
    assert ph == ["report_date", "campaign_url"]
    assert ex[0] == "19 Sep 2026"
    assert ex[1].startswith("https://")


def test_quick_reply_and_url_buttons() -> None:
    fields = {
        "body": (
            "Hi {{first_name}}, your Worktual daily report is ready. "
            "Review the summary and follow up with your team when convenient."
        ),
        "buttons": [
            {"type": "QUICK_REPLY", "text": "Support"},
            {"type": "URL", "text": "Open app", "url": "https://app.worktual.com"},
        ],
    }
    out = build_meta_submit_components(fields)
    buttons = next(c for c in out["components"] if c["type"] == "BUTTONS")[
        "buttons"
    ]
    assert buttons[0]["type"] == "QUICK_REPLY"
    assert buttons[1]["type"] == "URL"


def test_dynamic_url_button_mapping() -> None:
    url, ex, keys = map_url_button_for_meta("{{campaign_url}}")
    assert "{{1}}" in url
    assert ex and keys == ["campaign_url"]
