"""Compliance & Privacy Control Agent: JSON-shape validation + skip conditions.

HITL: this agent only ever produces a classification + draft acknowledgment —
it never deletes data and never emails a customer itself, so these tests
cover normalization + the honest-skip paths only (there is no
heuristic-decision function to test, same as sales_coach_agent — see
compliance_privacy_agent.py's module docstring).
"""

from __future__ import annotations

import pytest

from app.agents.compliance_privacy_agent import normalize, normalize_classification


def test_normalize_classification_accepts_well_formed_json():
    out = normalize_classification(
        {
            "requestType": "Data_Deletion",
            "confidence": "High",
            "reason": "Customer explicitly asked to delete all personal data under GDPR.",
            "draftConfirmation": "Thanks for reaching out — we've received your request and will follow up shortly.",
        }
    )
    assert out is not None
    assert out["requestType"] == "data_deletion"
    assert out["confidence"] == "high"
    assert out["reason"]
    assert out["draftConfirmation"]


def test_normalize_classification_rejects_unknown_request_type():
    assert (
        normalize_classification(
            {
                "requestType": "cancel_subscription",
                "confidence": "high",
                "reason": "Customer wants to cancel.",
            }
        )
        is None
    )


def test_normalize_classification_rejects_unknown_confidence():
    assert (
        normalize_classification(
            {
                "requestType": "marketing_optout",
                "confidence": "certain",
                "reason": "Customer asked to stop marketing emails.",
            }
        )
        is None
    )


def test_normalize_classification_rejects_missing_reason():
    assert (
        normalize_classification(
            {
                "requestType": "data_access",
                "confidence": "medium",
                "reason": "",
            }
        )
        is None
    )


def test_normalize_classification_allows_null_draft_confirmation():
    out = normalize_classification(
        {
            "requestType": "not_a_privacy_request",
            "confidence": "low",
            "reason": "Email only mentions GDPR-compliant hosting in passing.",
            "draftConfirmation": None,
        }
    )
    assert out is not None
    assert out["draftConfirmation"] is None


@pytest.mark.asyncio
async def test_normalize_node_skips_empty_body():
    state = await normalize({"subject": "Data request", "body": "", "job_id": "job-1"})
    assert state["status"] == "skipped"
    assert state["reason"] == "empty_body"
    assert state["classification"] is None


@pytest.mark.asyncio
async def test_normalize_node_skips_when_llm_off(monkeypatch):
    monkeypatch.setattr(
        "app.agents.compliance_privacy_agent.is_ai_configured",
        lambda: False,
    )
    state = await normalize(
        {
            "subject": "Please delete my data",
            "body": "Under GDPR I am requesting deletion of all my personal data.",
            "job_id": "job-2",
        }
    )
    assert state["status"] == "skipped"
    assert state["reason"] == "llm_not_configured"
    assert state["classification"] is None


@pytest.mark.asyncio
async def test_normalize_node_proceeds_when_body_present_and_llm_on(monkeypatch):
    monkeypatch.setattr(
        "app.agents.compliance_privacy_agent.is_ai_configured",
        lambda: True,
    )
    state = await normalize(
        {
            "subject": "Please delete my data",
            "body": "Under GDPR I am requesting deletion of all my personal data.",
            "job_id": "job-3",
        }
    )
    assert state["status"] == "running"
    assert "GDPR" in state["cleaned"]


@pytest.mark.asyncio
async def test_pipeline_preserves_skip_contract(monkeypatch):
    monkeypatch.setattr(
        "app.agents.compliance_privacy_agent.is_ai_configured",
        lambda: False,
    )
    from app.agents.compliance_privacy_agent import run

    result = await run(
        subject="Please delete my data",
        body="Under GDPR I am requesting deletion of all my personal data.",
    )
    assert result == {
        "ok": False,
        "classification": None,
        "status": "skipped",
        "reason": "llm_not_configured",
    }
