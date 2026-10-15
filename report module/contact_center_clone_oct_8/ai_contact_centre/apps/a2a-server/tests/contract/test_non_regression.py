"""Non-regression: Copilot/Support Bot entrypoints remain independent of A2A."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_copilot_api_unchanged_by_a2a_imports() -> None:
    text = (ROOT / "nlp/src/app/api/copilot.py").read_text()
    assert "cc_a2a" not in text
    assert "a2a-server" not in text


def test_router_unchanged_by_a2a_imports() -> None:
    text = (ROOT / "nlp/src/app/runtime/router.py").read_text()
    assert "cc_a2a" not in text


def test_support_bot_surface_untouched() -> None:
    # Support bot definition still exists and A2A catalogue does not publish customer-channel tools.
    from app.agents.definitions import SUPPORT_BOT_DEFINITION
    from cc_a2a.catalog import skill_ids

    assert SUPPORT_BOT_DEFINITION.name == "support_bot"
    ids = skill_ids()
    assert not any("send_message" in skill_id for skill_id in ids)
    assert not any(skill_id.endswith(".transfer") for skill_id in ids)
