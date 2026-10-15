from tests._load_agent_module import load_agent_module
import asyncio
import json

pair = load_agent_module("proposal_corpus_pair_agent.py")


PURITY_BRD = """
Business Requirement Document (BRD)
Client: Purity Harvest
Organic Cow Ghee & Farm-Fresh Milk Delivery
"""

PURITY_PROPOSAL = """
WORKTUAL  Commercial  Proposal  Prepared  for  Purity  Harvest
Organic  Cow  Ghee  &  Farm-Fresh  Milk  Delivery
"""


def test_normalize_collapses_google_docs_spacing():
    out = pair.normalize_pair_text("Purity  Harvest   Organic  Cow  Ghee")
    assert out == "Purity Harvest Organic Cow Ghee"


def test_clamp_percent_confidence():
    assert pair.clamp_confidence(86) == 0.86
    assert pair.clamp_confidence("0.91") == 0.91
    assert pair.clamp_confidence("nope") == 0.6


def test_offline_run_fails_closed_without_llm():
    out = asyncio.run(
        pair.run(
            {
                "requirements": [
                    {"itemId": "req", "filename": "a.pdf", "fullText": PURITY_BRD}
                ],
                "proposals": [
                    {"itemId": "prop", "filename": "b.pdf", "fullText": PURITY_PROPOSAL}
                ],
            }
        )
    )
    assert out["ok"] is False
    assert out["reason"] == "llm_not_configured"
    assert out["pairs"] == []


def test_llm_filename_ids_still_bind():
    async def fake_llm(**_kwargs):
        return json.dumps(
            {
                "pairs": [
                    {
                        "requirementItemId": "Purity Harvest (BRD).pdf",
                        "proposalItemId": "PURITY_HARVEST.pdf",
                        "confidence": 0.88,
                        "gaps": [],
                    }
                ]
            }
        )

    pair.is_ai_configured = lambda: True
    pair.proposal_llm_configured = lambda: False
    pair.generate_ai_text = fake_llm
    try:
        out = asyncio.run(
            pair.run(
                {
                    "requirements": [
                        {
                            "itemId": "req",
                            "filename": "Purity Harvest (BRD).pdf",
                            "fullText": PURITY_BRD,
                        }
                    ],
                    "proposals": [
                        {
                            "itemId": "prop",
                            "filename": "PURITY_HARVEST.pdf",
                            "fullText": PURITY_PROPOSAL,
                        }
                    ],
                }
            )
        )
    finally:
        pair.is_ai_configured = lambda: False
        pair.proposal_llm_configured = lambda: False
    assert out["ok"] is True
    assert out["source"] == "ai"
    assert out["pairs"][0]["requirementItemId"] == "req"
    assert out["pairs"][0]["proposalItemId"] == "prop"
    assert out["pairs"][0]["confidence"] == 0.88


def test_empty_llm_json_fails_closed():
    async def fake_llm(**_kwargs):
        return "not json"

    pair.is_ai_configured = lambda: True
    pair.proposal_llm_configured = lambda: False
    pair.generate_ai_text = fake_llm
    try:
        out = asyncio.run(
            pair.run(
                {
                    "requirements": [
                        {"itemId": "req", "filename": "a.pdf", "fullText": "need crm"}
                    ],
                    "proposals": [
                        {"itemId": "prop", "filename": "b.pdf", "fullText": "we propose"}
                    ],
                }
            )
        )
    finally:
        pair.is_ai_configured = lambda: False
        pair.proposal_llm_configured = lambda: False
    assert out["ok"] is False
    assert out["reason"] == "empty_llm_pairs"


if __name__ == "__main__":
    test_normalize_collapses_google_docs_spacing()
    test_clamp_percent_confidence()
    test_offline_run_fails_closed_without_llm()
    test_llm_filename_ids_still_bind()
    test_empty_llm_json_fails_closed()
    print("test_proposal_corpus_pair.py ok")
