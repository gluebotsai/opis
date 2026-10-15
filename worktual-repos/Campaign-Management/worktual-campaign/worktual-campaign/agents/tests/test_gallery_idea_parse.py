"""Gallery idea generation — LLM response parsing."""

from __future__ import annotations

from app.gallery.idea_generate import _llm_text, _normalize_ideas
from app.agents.template_library.shared import parse_json_object


def test_llm_text_from_dict() -> None:
    raw = {
        "content": '```json\n{"ideas":[{"title":"A","summary":"S","goal":"G"}]}\n```',
        "tool_calls": [],
    }
    text = _llm_text(raw)
    parsed = parse_json_object(text)
    assert parsed is not None
    ideas = _normalize_ideas(parsed.get("ideas") or [])
    assert len(ideas) == 1
    assert ideas[0]["title"] == "A"


def test_llm_text_plain_string() -> None:
    assert _llm_text('{"ideas":[]}') == '{"ideas":[]}'
