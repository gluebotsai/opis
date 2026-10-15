"""MOM transcript cleanup and post-processing."""

from __future__ import annotations

from app.agents.meeting_mom_html import normalize_internal_mom, render_internal_mom_html
from app.agents.meeting_mom_postprocess import (
    clean_transcript,
    looks_like_transcript_quote,
    postprocess_mom,
)

META = {
    "contactName": "Nandha Kumar",
    "companyName": "Acme Corp",
    "topic": "Product Demo",
    "whenLabel": "Wed, Sep 9, 2026",
    "ownerName": "Manoj M.",
    "sellerName": "Worktual",
}


def test_clean_transcript_dedupes_and_fixes_asr() -> None:
    raw = (
        "Ashika A.: Because I need to buy, I need to serum.\n"
        "Ashika A.: Because I need to buy, I need to serum.\n"
        "Ashika A.: Now, I am currently using a traditional\n"
        "Nandha Kumar: Could you tell me the advantages of me"
    )
    cleaned = clean_transcript(raw)
    assert cleaned.count("Because I need to buy") == 1
    assert "CRM" in cleaned
    assert "Could you tell me the advantages of me" not in cleaned


def test_postprocess_proposal_next_best_action() -> None:
    mom = postprocess_mom(
        {
            "proposalRequested": True,
            "actionItems": [
                "Because I need to buy, I need to serum.",
                {"action": "Send proposal to Nandha Kumar", "owner": "", "dueDate": ""},
            ],
            "nextSteps": ["Now, I am currently using a traditional..."],
        },
        META,
    )
    assert mom["nextBestAction"].startswith("Prepare and send proposal")
    assert mom["actionItemsStructured"][0]["owner"] == "Manoj M."
    assert looks_like_transcript_quote("Because I need to buy, I need to serum.")


def test_internal_mom_buying_signals_and_nba_footer() -> None:
    mom = {
        "executiveSummary": "Customer evaluating Worktual vs incumbent.",
        "proposalRequested": True,
        "buyingIntent": "Need to buy CRM this quarter.",
        "currentSolution": "Traditional on-prem CRM.",
        "painPoints": ["Manual workflows"],
        "evaluationCriteria": ["Integration with Zendesk"],
        "nextBestAction": "Prepare and send proposal to Nandha Kumar.",
        "followUpBy": "Within 2 business days",
        "actionItems": [
            {
                "action": "Prepare and send proposal to Nandha Kumar",
                "owner": "Manoj M.",
                "dueDate": "",
            }
        ],
    }
    doc = normalize_internal_mom(mom, META)
    html = render_internal_mom_html(doc)
    assert "BUYING SIGNALS" in html
    assert "Prepare and send proposal" in html
    assert "Within 2 business days" in html
    assert "NEXT BEST ACTION" in html
    assert "Manoj M." in html
