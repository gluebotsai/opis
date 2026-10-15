"""expansion-matcher agent: heuristic fallback + LLM JSON normalization.

HITL: the agent only ever produces the expansion* overlay decision — it
never creates a deal/quote and never contacts the company itself (see
decide()/persist() in expansion_matcher_agent.py); outreachDraft is a
human-review-only draft. These tests cover the decision-shaping logic only.
"""

from __future__ import annotations

import pytest

from app.agents.expansion_matcher_agent import (
    _normalize_llm_expansion,
    decide_expansion_heuristic,
)


def test_normalize_accepts_well_formed_json():
    out = _normalize_llm_expansion(
        {
            "signal": "Opportunity",
            "reason": "3 closed-won deals with rising amounts, no open deal.",
            "outreachDraft": "Hi — given your recent growth, would you be open to discussing an add-on package?",
        }
    )
    assert out is not None
    assert out["signal"] == "opportunity"
    assert out["reason"]
    assert out["outreachDraft"]


def test_normalize_rejects_unknown_signal():
    assert (
        _normalize_llm_expansion(
            {
                "signal": "hot",
                "reason": "Very interested.",
                "outreachDraft": "Hi there.",
            }
        )
        is None
    )


def test_normalize_rejects_missing_reason():
    assert (
        _normalize_llm_expansion(
            {
                "signal": "watch",
                "reason": "",
                "outreachDraft": "Hi there.",
            }
        )
        is None
    )


def test_normalize_rejects_missing_draft_when_signal_not_none():
    assert (
        _normalize_llm_expansion(
            {
                "signal": "opportunity",
                "reason": "Clear expansion candidate.",
                "outreachDraft": "",
            }
        )
        is None
    )


def test_normalize_allows_missing_draft_when_signal_none():
    out = _normalize_llm_expansion(
        {
            "signal": "none",
            "reason": "Only one closed-won deal, recent close, no signal yet.",
            "outreachDraft": "",
        }
    )
    assert out is not None
    assert out["signal"] == "none"
    assert out["outreachDraft"] is None


def test_heuristic_open_deal_suppresses_signal():
    result = decide_expansion_heuristic(
        {
            "companyName": "Acme Co",
            "closedWonDealCount": 3,
            "openDealCount": 1,
            "daysSinceLastClosedWon": 400,
        }
    )
    assert result["signal"] == "none"
    assert result["outreachDraft"] is None


def test_heuristic_multiple_closed_won_is_opportunity():
    result = decide_expansion_heuristic(
        {
            "companyName": "Acme Co",
            "closedWonDealCount": 2,
            "openDealCount": 0,
            "daysSinceLastClosedWon": 60,
        }
    )
    assert result["signal"] == "opportunity"
    assert result["outreachDraft"]


def test_heuristic_single_old_closed_won_is_watch():
    result = decide_expansion_heuristic(
        {
            "companyName": "Acme Co",
            "closedWonDealCount": 1,
            "openDealCount": 0,
            "daysSinceLastClosedWon": 200,
        }
    )
    assert result["signal"] == "watch"
    assert result["outreachDraft"]


def test_heuristic_single_recent_closed_won_is_none():
    result = decide_expansion_heuristic(
        {
            "companyName": "Acme Co",
            "closedWonDealCount": 1,
            "openDealCount": 0,
            "daysSinceLastClosedWon": 30,
        }
    )
    assert result["signal"] == "none"
    assert result["outreachDraft"] is None


def test_heuristic_always_returns_valid_shape():
    result = decide_expansion_heuristic(
        {
            "companyName": "Acme Co",
            "closedWonDealCount": 0,
            "openDealCount": 0,
            "daysSinceLastClosedWon": None,
        }
    )
    assert result["signal"] in {"none", "watch", "opportunity"}
    assert result["reason"]


@pytest.mark.asyncio
async def test_decide_uses_heuristic_when_llm_off(monkeypatch):
    from app.agents import expansion_matcher_agent as mod

    async def _fake_decide_via_llm(_ctx):
        return None, "llm_unavailable"

    monkeypatch.setattr(mod, "decide_via_llm", _fake_decide_via_llm)

    state = await mod.decide(
        {
            "company_id": "company-1",
            "context": {
                "companyName": "Acme Co",
                "closedWonDealCount": 2,
                "openDealCount": 0,
                "daysSinceLastClosedWon": 60,
            },
            "status": "running",
        }
    )
    assert state["status"] == "decided"
    assert state["source"] == "heuristic"
    assert state["decision"]["signal"] == "opportunity"
    assert state["decision"]["reason"]


@pytest.mark.asyncio
async def test_decide_skips_when_context_missing():
    from app.agents import expansion_matcher_agent as mod

    state = await mod.decide(
        {"company_id": "company-missing", "context": {}, "status": "running"}
    )
    assert state["status"] == "skipped"
    assert state["reason"] == "company_not_found"
    assert state["decision"] is None
