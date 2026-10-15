"""Phase 2 knowledge + brand_guidelines executors (inputs only; prompts frozen)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.mas.phase2_compose.executors import brand_guidelines, knowledge
from app.mas.phase2_compose.workspace import Workspace


@pytest.mark.asyncio
async def test_knowledge_from_campaign_and_pack() -> None:
    ws = Workspace()
    ws.query = "Diwali sale email"
    ctx = {
        "task_spec": {
            "campaign": {
                "name": "Diwali Festive",
                "goal": "Drive sales",
                "objective": "10% off clothing",
                "company_name": "Loom & Co",
            },
            "company_pack": {
                "seed_industry_type": "retail_apparel",
                "mode": "b2c",
                "brand": {"name": "Loom & Co", "voice": "warm festive"},
                "fields": [
                    {"label": "Tagline", "value": "Light up the season", "status": "active"}
                ],
            },
        }
    }
    out = await knowledge.run(ctx, ws)
    assert out["status"] == "completed"
    facts = (out.get("payload") or {}).get("knowledge") or {}
    assert facts.get("company") == "Loom & Co"
    assert facts.get("industry") == "retail_apparel"
    assert facts.get("campaign_name") == "Diwali Festive"
    assert facts.get("do_not_invent") is True
    assert facts.get("copy_mode") == "verified"
    assert (facts.get("pack_fields") or {}).get("Tagline") == "Light up the season"


@pytest.mark.asyncio
async def test_knowledge_merges_context_layer_hits() -> None:
    ws = Workspace()
    ws.query = "Pro Plan sale email"
    ctx = {
        "organization_id": "1003",
        "task_spec": {
            "organization_id": "1003",
            "campaign": {"name": "Pro Plan Sale", "goal": "Upgrade", "objective": "50% off"},
        },
    }

    async def fake_search(**kwargs: object) -> dict:
        assert kwargs.get("organization_id") == "1003"
        return {
            "ok": True,
            "results": [
                {
                    "text": "Track usage patterns to upsell higher plans.",
                    "file_name": "Worktual Sales KB.pdf",
                }
            ],
            "snippets": "[Worktual Sales KB.pdf] Track usage patterns to upsell higher plans.",
        }

    with patch(
        "app.integrations.context_layer.search_campaign_knowledge",
        new=fake_search,
    ):
        out = await knowledge.run(ctx, ws)
    facts = (out.get("payload") or {}).get("knowledge") or {}
    assert facts.get("campaign_name") == "Pro Plan Sale"
    assert facts.get("kb_snippets")
    assert "upsell" in str(facts.get("kb_snippets") or "").lower()


@pytest.mark.asyncio
async def test_knowledge_no_static_brand_stub() -> None:
    ws = Workspace()
    ws.query = "PayNest welcome letter for new users"
    out = await knowledge.run({}, ws)
    facts = (out.get("payload") or {}).get("knowledge") or {}
    assert facts.get("company") != "PayNest"
    assert facts.get("copy_mode") == "none"


@pytest.mark.asyncio
async def test_knowledge_empty_kb_uses_campaign_fields_only() -> None:
    ws = Workspace()
    ws.query = "Monthly Product Update newsletter"
    ctx = {
        "organization_name": "ZIFO",
        "industry": "professional services",
        "task_spec": {
            "campaign": {
                "name": "Monthly Product Update",
                "goal": "Keep users informed",
            }
        },
    }
    out = await knowledge.run(ctx, ws)
    facts = (out.get("payload") or {}).get("knowledge") or {}
    assert facts.get("copy_mode") == "campaign"
    assert facts.get("company") == "ZIFO"
    assert facts.get("industry") == "professional services"
    assert facts.get("campaign_name") == "Monthly Product Update"
    guidance = str(facts.get("copy_guidance") or "").lower()
    assert "invent" in guidance
    assert "placeholder" in guidance or "lorem" in guidance


@pytest.mark.asyncio
async def test_brand_guidelines_from_campaign_logo() -> None:
    ws = Workspace()
    ws.query = "sale email"
    ctx = {
        "task_spec": {
            "campaign": {
                "name": "Sale",
                "logo_url": "https://cdn.example.com/logo.png",
                "top_banner_url": "https://cdn.example.com/banner.png",
                "footer_text": "© Loom & Co",
                "website": "https://loom.example",
            }
        }
    }
    out = await brand_guidelines.run(ctx, ws)
    assert out["status"] == "completed"
    guide = (out.get("payload") or {}).get("brand_guidelines") or {}
    assert guide.get("logo_url") == "https://cdn.example.com/logo.png"
    assert guide.get("top_banner_url") == "https://cdn.example.com/banner.png"
    assert "Loom" in str(guide.get("footer_text") or "")


@pytest.mark.asyncio
async def test_brand_guidelines_empty_is_soft_fail() -> None:
    ws = Workspace()
    ws.query = "hello"
    out = await brand_guidelines.run({"task_spec": {}}, ws)
    assert out["status"] == "soft_fail"
    assert "brand_guidelines_empty" in (out.get("warnings") or [])
