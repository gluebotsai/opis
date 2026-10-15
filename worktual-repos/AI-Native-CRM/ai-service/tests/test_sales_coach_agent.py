"""Sales & Pre-sales Coach Agent: JSON-shape validation + skip conditions.

HITL: this agent only ever produces private coaching text for the rep — it
never writes a rating, never gates/blocks anything, so these tests cover
normalization + the honest-skip paths only (there is no heuristic-decision
function to test, unlike forecast_audit_agent — see sales_coach_agent.py's
module docstring).
"""

from __future__ import annotations

import pytest

from app.agents.sales_coach_agent import (
    MIN_TRANSCRIPT_CHARS,
    normalize,
    normalize_coaching_insight,
)


def test_normalize_insight_accepts_well_formed_json():
    out = normalize_coaching_insight(
        {
            "overallImpression": "Solid",
            "discoveryQuality": "Uncovered budget and timeline clearly.",
            "objectionHandling": "No objections came up.",
            "methodologyNote": "Followed open -> discover -> next steps.",
            "talkBalanceNote": "Rep held most of the airtime.",
            "strengths": ["Asked layered discovery questions"],
            "growthAreas": ["Could confirm decision process earlier"],
            "highlightedMoment": "Rep asked about budget directly at 12:03.",
            "coachingNote": "Nice work uncovering budget early — next time confirm the decision process too.",
        }
    )
    assert out is not None
    assert out["overallImpression"] == "solid"
    assert out["coachingNote"]
    assert out["strengths"] == ["Asked layered discovery questions"]
    assert out["growthAreas"] == ["Could confirm decision process earlier"]


def test_normalize_insight_rejects_unknown_impression():
    assert (
        normalize_coaching_insight(
            {
                "overallImpression": "excellent",
                "coachingNote": "Great job overall.",
            }
        )
        is None
    )


def test_normalize_insight_rejects_missing_coaching_note():
    assert (
        normalize_coaching_insight(
            {
                "overallImpression": "strong",
                "coachingNote": "",
            }
        )
        is None
    )


def test_normalize_insight_allows_null_talk_balance():
    out = normalize_coaching_insight(
        {
            "overallImpression": "needs_work",
            "coachingNote": "Focus on discovery before pitching next time.",
            "talkBalanceNote": None,
        }
    )
    assert out is not None
    assert out["talkBalanceNote"] is None


def test_normalize_insight_caps_list_lengths():
    out = normalize_coaching_insight(
        {
            "overallImpression": "strong",
            "coachingNote": "Great call.",
            "strengths": ["a", "b", "c", "d", "e"],
        }
    )
    assert out is not None
    assert len(out["strengths"]) == 3


@pytest.mark.asyncio
async def test_normalize_node_skips_short_transcript():
    state = await normalize({"transcript": "Hi, quick call.", "job_id": "job-1"})
    assert state["status"] == "skipped"
    assert state["reason"] == "too_short"
    assert state["insight"] is None


@pytest.mark.asyncio
async def test_normalize_node_skips_when_llm_off(monkeypatch):
    monkeypatch.setattr(
        "app.agents.sales_coach_agent.is_ai_configured",
        lambda: False,
    )
    long_transcript = "This is a substantive call transcript. " * 10
    assert len(long_transcript) >= MIN_TRANSCRIPT_CHARS
    state = await normalize({"transcript": long_transcript, "job_id": "job-2"})
    assert state["status"] == "skipped"
    assert state["reason"] == "llm_not_configured"
    assert state["insight"] is None


@pytest.mark.asyncio
async def test_normalize_node_proceeds_when_substantial_and_llm_on(monkeypatch):
    monkeypatch.setattr(
        "app.agents.sales_coach_agent.is_ai_configured",
        lambda: True,
    )
    long_transcript = "This is a substantive call transcript. " * 10
    state = await normalize({"transcript": long_transcript, "job_id": "job-3"})
    assert state["status"] == "running"
    assert len(state["cleaned"]) >= MIN_TRANSCRIPT_CHARS


@pytest.mark.asyncio
async def test_sales_coach_pipeline_preserves_skip_contract(monkeypatch):
    monkeypatch.setattr(
        "app.agents.sales_coach_agent.is_ai_configured",
        lambda: False,
    )
    from app.agents.sales_coach_agent import run

    result = await run(transcript="A substantive transcript. " * 20)
    assert result == {
        "ok": False,
        "insight": None,
        "status": "skipped",
        "reason": "llm_not_configured",
    }
