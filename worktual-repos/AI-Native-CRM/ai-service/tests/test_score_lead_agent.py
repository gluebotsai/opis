"""score-lead agent: normalize LLM JSON; no heuristic fallback."""

from __future__ import annotations

import pytest

from app.agents.score_lead_agent import _normalize_llm_score


def test_normalize_keeps_fit_and_intent():
    out = _normalize_llm_score(
        {
            "fitScore": 30,
            "intentScore": 20,
            "nextBestAction": "Send a short check-in email.",
        },
        {"hasEmail": True, "title": "VP Sales", "companyName": "Acme"},
    )
    assert out is not None
    assert out["fitScore"] == 30
    assert out["intentScore"] == 20
    assert out["score"] == 50
    assert out["band"] == "warm"
    assert out["nextBestAction"] == "Send a short check-in email."


def test_normalize_accepts_total_only():
    out = _normalize_llm_score({"score": 40}, {"hasEmail": True})
    assert out is not None
    assert out["score"] == 40
    assert out["fitScore"] == 0
    assert out["intentScore"] == 40
    assert out["grade"] == "C"
    assert out["band"] == "warm"


def test_normalize_profile_fit_without_activity():
    out = _normalize_llm_score(
        {
            "fitScore": 24,
            "intentScore": 0,
            "score": 24,
            "rationale": "Manager at Adidas with a phone, no engagement yet.",
        },
        {
            "title": "Manager",
            "companyName": "Adidas",
            "hasPhone": True,
            "hasEmail": False,
        },
    )
    assert out is not None
    assert out["fitScore"] == 24
    assert out["intentScore"] == 0
    assert out["score"] == 24
    assert out["band"] == "cold"


def test_normalize_allows_empty_next_best_action():
    out = _normalize_llm_score({"fitScore": 18, "intentScore": 0, "score": 18}, {"hasEmail": True})
    assert out is not None
    assert out["score"] == 18
    assert out["nextBestAction"] == ""


def test_normalize_rejects_empty():
    assert _normalize_llm_score({}, {}) is None


@pytest.mark.asyncio
async def test_compute_fails_when_llm_off(monkeypatch):
    from app.agents import score_lead_agent as mod

    monkeypatch.setattr(mod, "is_ai_configured", lambda: False)

    state = await mod.compute(
        {
            "context": {
                "hasEmail": True,
                "hasPhone": False,
                "title": "Director",
                "companyName": "Acme",
                "email": "d@acme.com",
                "recentActivityCount": 1,
                "leadStatus": "new",
                "contactType": "lead",
            },
            "status": "running",
        }
    )
    assert state["status"] == "failed"
    assert state["source"] == "ai"
    assert state["reason"] == "llm_not_configured"
    assert not state.get("result")
