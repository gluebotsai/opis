"""NativeLLM Gemma extras + reasoning extraction."""

from __future__ import annotations

from app.llm.client import _extract_reasoning


def test_extract_reasoning_from_message_field():
    assert (
        _extract_reasoning({"reasoning": "  User greeted; reply politely.  "}, {})
        == "User greeted; reply politely."
    )


def test_extract_reasoning_from_reasoning_content():
    assert (
        _extract_reasoning({"reasoning_content": "Need list_priorities next."}, None)
        == "Need list_priorities next."
    )


def test_extract_reasoning_none_when_missing():
    assert _extract_reasoning({"content": "Hello"}, {}) is None


def test_extract_reasoning_from_list_parts():
    msg = {
        "reasoning": [
            {"text": "Step 1"},
            {"content": "Step 2"},
        ]
    }
    assert _extract_reasoning(msg, {}) == "Step 1\nStep 2"
