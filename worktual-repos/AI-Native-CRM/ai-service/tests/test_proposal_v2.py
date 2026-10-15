from app.agents.proposal_corpus_ingest_agent import heading_sections_from_text, length_spec_from_pages
from app.agents.proposal_plan_agent import _fallback_lines
from app.agents.proposal_brief_agent import run as brief_run
from unittest.mock import patch
import asyncio


def test_heading_word_counts():
    text = "OVERVIEW\nThis is a short overview paragraph with enough words.\nCOMMERCIALS\nPricing table follows with more words here."
    rows = heading_sections_from_text(text)
    assert any(r["heading"] == "OVERVIEW" for r in rows)
    spec = length_spec_from_pages(
        [{"n": 1, "text": text}],
        text,
    )
    assert spec["documentWordCount"] > 0
    assert spec["schemaVersion"] == 1


def test_plan_fallback_qty_from_requirement():
    lines = _fallback_lines(
        {
            "requirementText": "Need 12 Voicebot seats for the contact centre.",
            "products": [{"id": "p1", "name": "Voicebot", "sku": "vb"}],
        }
    )
    assert lines[0]["quantity"] == 12


async def test_brief_fallback_without_llm():
    with patch(
        "app.agents.proposal_brief_agent.proposal_gemini_configured",
        return_value=False,
    ), patch(
        "app.agents.proposal_brief_agent.is_ai_configured",
        return_value=False,
    ):
        out = await brief_run({"requirementText": "Acme needs a voicebot for 40 agents."})
    assert out["source"] == "heuristic"
    assert "voicebot" in out["summary"].lower()


if __name__ == "__main__":
    test_heading_word_counts()
    test_plan_fallback_qty_from_requirement()
    asyncio.run(test_brief_fallback_without_llm())
    print("proposal v2 python tests ok")
