import pytest
from unittest.mock import AsyncMock, patch

from app.agents.proposal_schemas import GeneratedDocumentTitle
from app.agents.proposal_title_agent import run as title_run


@pytest.mark.asyncio
async def test_title_agent_uses_llm_not_static_cover():
    model = GeneratedDocumentTitle(
        title="Customer Engagement & Proactive Contact Centre Solution",
        product_tags=["AI Chatbot", "AI Voicebot", "Proactive Contact Centre"],
    )
    with patch(
        "app.agents.proposal_title_agent.proposal_gemini_configured",
        return_value=True,
    ), patch(
        "app.agents.proposal_title_agent.generate_json",
        new=AsyncMock(return_value=model),
    ):
        out = await title_run(
            {
                "customerName": "Aspero",
                "allowedProducts": [
                    "AI Native Contact Centre (CCaaS)",
                    "AI Native CRM",
                ],
                "sections": [
                    {
                        "key": "executive_summary",
                        "title": "Executive Summary",
                        "body": "Aspero Markets needs a contact centre with AI chatbot and voicebot.",
                    }
                ],
            }
        )
    assert out["source"] == "ai"
    assert out["title"] == "Customer Engagement & Proactive Contact Centre Solution"
    assert "AI Native CRM" not in out["product_tags"]
    assert "Proactive Contact Centre" in out["product_tags"]


@pytest.mark.asyncio
async def test_title_agent_rejects_static_cover_phrase():
    model = GeneratedDocumentTitle(
        title="Commercial Proposal & Quotation",
        product_tags=[],
    )
    with patch(
        "app.agents.proposal_title_agent.proposal_gemini_configured",
        return_value=True,
    ), patch(
        "app.agents.proposal_title_agent.generate_json",
        new=AsyncMock(return_value=model),
    ):
        out = await title_run(
            {
                "customerName": "Aspero",
                "sections": [
                    {
                        "key": "executive_summary",
                        "title": "Executive Summary",
                        "body": "Aspero Markets needs a proactive contact centre for KYC and onboarding.",
                    }
                ],
            }
        )
    assert "Commercial Proposal" not in out["title"]
    assert "Aspero" in out["title"] or "contact" in out["title"].lower()


@pytest.mark.asyncio
async def test_title_agent_offline_fallback():
    with patch(
        "app.agents.proposal_title_agent.proposal_gemini_configured",
        return_value=False,
    ), patch(
        "app.agents.proposal_title_agent.is_ai_configured",
        return_value=False,
    ):
        out = await title_run(
            {
                "customerName": "Aspero",
                "sections": [
                    {
                        "key": "executive_summary",
                        "body": "Aspero needs an AI contact centre for bond-distribution support.",
                    }
                ],
            }
        )
    assert out["source"] == "heuristic"
    assert "Commercial Proposal" not in (out.get("title") or "")
