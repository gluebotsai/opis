"""pipeline-forecast agent: heuristic fallback + LLM JSON normalization.

HITL: the agent only ever produces the forecast* overlay decision — it never
mutates Deal.stage/expectedCloseDate itself (see decide()/persist() in
forecast_audit_agent.py), so these tests cover the decision-shaping logic
only, not any stage/date mutation.
"""

from __future__ import annotations

import pytest

from app.agents.forecast_audit_agent import (
    _normalize_llm_forecast,
    decide_forecast_heuristic,
)


def test_normalize_accepts_well_formed_json():
    out = _normalize_llm_forecast(
        {
            "category": "Best_Case",
            "confidencePercent": 62.4,
            "flagged": False,
            "reason": "Quote sent, prospect engaged in last week.",
        }
    )
    assert out is not None
    assert out["category"] == "best_case"
    assert out["confidencePercent"] == 62
    assert out["flagged"] is False
    assert out["reason"]


def test_normalize_clamps_confidence_to_0_100():
    out = _normalize_llm_forecast(
        {
            "category": "commit",
            "confidencePercent": 140,
            "flagged": True,
            "reason": "Overdue close date.",
        }
    )
    assert out is not None
    assert out["confidencePercent"] == 100


def test_normalize_rejects_unknown_category():
    assert (
        _normalize_llm_forecast(
            {
                "category": "guaranteed",
                "confidencePercent": 90,
                "flagged": False,
                "reason": "Very sure.",
            }
        )
        is None
    )


def test_normalize_rejects_missing_reason():
    assert (
        _normalize_llm_forecast(
            {"category": "pipeline", "confidencePercent": 40, "flagged": False, "reason": ""}
        )
        is None
    )


def test_normalize_rejects_non_numeric_confidence():
    assert (
        _normalize_llm_forecast(
            {
                "category": "pipeline",
                "confidencePercent": "high",
                "flagged": False,
                "reason": "Some reason.",
            }
        )
        is None
    )


def test_heuristic_accepted_quote_is_commit():
    result = decide_forecast_heuristic(
        {
            "stage": "negotiate",
            "quotes": [{"status": "accepted"}],
            "signals": {},
            "daysSinceLastActivity": 2,
            "daysToExpectedClose": 10,
        }
    )
    assert result["category"] == "commit"
    assert result["confidencePercent"] >= 80
    assert result["flagged"] is False


def test_heuristic_flags_overdue_close_date_as_omitted():
    result = decide_forecast_heuristic(
        {
            "stage": "propose",
            "quotes": [],
            "signals": {},
            "daysSinceLastActivity": 5,
            "daysToExpectedClose": -3,
        }
    )
    assert result["flagged"] is True
    assert result["category"] == "omitted"
    assert result["confidencePercent"] <= 30
    assert "past" in result["reason"]


def test_heuristic_flags_silence_outpacing_time_to_close():
    result = decide_forecast_heuristic(
        {
            "stage": "discover",
            "quotes": [],
            "signals": {},
            "daysSinceLastActivity": 20,
            "daysToExpectedClose": 5,
        }
    )
    assert result["flagged"] is True
    assert result["confidencePercent"] <= 30


def test_heuristic_long_silence_without_close_date_flags_when_past_qualification():
    result = decide_forecast_heuristic(
        {
            "stage": "propose",
            "quotes": [],
            "signals": {},
            "daysSinceLastActivity": 25,
            "daysToExpectedClose": None,
        }
    )
    assert result["flagged"] is True
    assert "days" in result["reason"].lower()


def test_heuristic_quiet_qualification_stage_is_not_flagged():
    result = decide_forecast_heuristic(
        {
            "stage": "qualification",
            "quotes": [],
            "signals": {},
            "daysSinceLastActivity": 25,
            "daysToExpectedClose": None,
        }
    )
    assert result["flagged"] is False
    assert result["category"] == "pipeline"


def test_heuristic_always_returns_valid_shape():
    result = decide_forecast_heuristic(
        {
            "stage": "qualification",
            "quotes": [],
            "signals": {},
            "daysSinceLastActivity": None,
            "daysToExpectedClose": None,
        }
    )
    assert result["category"] in {"commit", "best_case", "pipeline", "omitted"}
    assert 0 <= result["confidencePercent"] <= 100
    assert isinstance(result["flagged"], bool)
    assert result["reason"]


@pytest.mark.asyncio
async def test_decide_uses_heuristic_when_llm_off(monkeypatch):
    from app.agents import forecast_audit_agent as mod

    async def _fake_decide_via_llm(_ctx):
        return None, "llm_unavailable"

    monkeypatch.setattr(mod, "decide_via_llm", _fake_decide_via_llm)

    state = await mod.decide(
        {
            "deal_id": "deal-1",
            "context": {
                "stage": "negotiate",
                "quotes": [{"status": "accepted"}],
                "signals": {},
                "daysSinceLastActivity": 1,
                "daysToExpectedClose": 8,
            },
            "status": "running",
        }
    )
    assert state["status"] == "decided"
    assert state["source"] == "heuristic"
    assert state["decision"]["category"] == "commit"
    assert state["decision"]["reason"]


@pytest.mark.asyncio
async def test_decide_skips_when_context_missing():
    from app.agents import forecast_audit_agent as mod

    state = await mod.decide({"deal_id": "deal-missing", "context": {}, "status": "running"})
    assert state["status"] == "skipped"
    assert state["reason"] == "deal_not_found"
    assert state["decision"] is None
