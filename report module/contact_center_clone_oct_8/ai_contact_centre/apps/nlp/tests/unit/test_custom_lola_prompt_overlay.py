"""Social prompt overlay tests."""

from app.agents.custom_lola_worktual.prompt_overlay import (
    apply_social_overlay,
    build_social_overlay,
)
from app.agents.custom_lola_worktual.prompts import (
    BOOKING_SYSTEM_PROMPT,
    SALES_SYSTEM_PROMPT,
    SERVICE_SYSTEM_PROMPT,
)


def test_build_social_overlay_for_instagram() -> None:
    overlay = build_social_overlay("instagram")
    assert "Instagram" in overlay
    assert "short" in overlay.lower()


def test_apply_social_overlay_skips_webchat() -> None:
    prompt = "Base prompt"
    assert apply_social_overlay(prompt, "webchat") == prompt


def test_lola_prompts_format_long_term_memory() -> None:
    for template in (SALES_SYSTEM_PROMPT, BOOKING_SYSTEM_PROMPT, SERVICE_SYSTEM_PROMPT):
        rendered = template.format(
            current_date="2026-09-13",
            long_term_summary="Omni-channel summary: Refund in progress.",
        )
        assert "Refund in progress" in rendered
