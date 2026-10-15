"""invoice-escalation agent: heuristic fallback + LLM JSON normalization.

HITL: the agent only ever produces the escalation* overlay decision — it
never marks an invoice paid/void and never changes dueAt/total itself (see
decide()/persist() in invoice_escalation_agent.py), and it never sends
customerDraft itself. These tests cover the decision-shaping logic only.
"""

from __future__ import annotations

import pytest

from app.agents.invoice_escalation_agent import (
    INVOICE_ESCALATION_MODULE_PATH,
    _normalize_llm_escalation,
    decide_invoice_escalation_heuristic,
)


def test_step_trace_posts_to_invoice_escalation_internal_route():
    assert INVOICE_ESCALATION_MODULE_PATH == "invoice-escalation"


def test_normalize_accepts_well_formed_json():
    out = _normalize_llm_escalation(
        {
            "severity": "Escalate",
            "reason": "18 days overdue, company averages 12d late.",
            "internalNote": "Follow up with the account owner.",
            "customerDraft": "Hi, this is a friendly reminder that your invoice is past due.",
        }
    )
    assert out is not None
    assert out["severity"] == "escalate"
    assert out["reason"]
    assert out["internalNote"]
    assert out["customerDraft"]


def test_normalize_rejects_unknown_severity():
    assert (
        _normalize_llm_escalation(
            {
                "severity": "critical",
                "reason": "Very overdue.",
                "internalNote": "Note.",
                "customerDraft": "Reminder.",
            }
        )
        is None
    )


def test_normalize_rejects_missing_reason():
    assert (
        _normalize_llm_escalation(
            {
                "severity": "watch",
                "reason": "",
                "internalNote": "Note.",
                "customerDraft": "Reminder.",
            }
        )
        is None
    )


def test_normalize_rejects_missing_customer_draft():
    assert (
        _normalize_llm_escalation(
            {
                "severity": "urgent",
                "reason": "Severely overdue.",
                "internalNote": "Note.",
                "customerDraft": "",
            }
        )
        is None
    )


def test_normalize_allows_missing_internal_note():
    out = _normalize_llm_escalation(
        {
            "severity": "watch",
            "reason": "Just past due.",
            "customerDraft": "Reminder.",
        }
    )
    assert out is not None
    assert out["internalNote"] is None


def test_heuristic_recent_overdue_is_watch():
    result = decide_invoice_escalation_heuristic(
        {
            "number": "INV-100",
            "daysOverdue": 5,
            "priorPaymentHistory": [],
        }
    )
    assert result["severity"] == "watch"
    assert "5" in result["reason"]


def test_heuristic_moderately_overdue_is_escalate():
    result = decide_invoice_escalation_heuristic(
        {
            "number": "INV-101",
            "daysOverdue": 20,
            "priorPaymentHistory": [],
        }
    )
    assert result["severity"] == "escalate"


def test_heuristic_severely_overdue_is_urgent():
    result = decide_invoice_escalation_heuristic(
        {
            "number": "INV-102",
            "daysOverdue": 45,
            "priorPaymentHistory": [],
        }
    )
    assert result["severity"] == "urgent"


def test_heuristic_bumps_watch_to_escalate_on_bad_payment_history():
    result = decide_invoice_escalation_heuristic(
        {
            "number": "INV-103",
            "daysOverdue": 3,
            "priorPaymentHistory": [{"daysLate": 20, "total": 500}, {"daysLate": 25, "total": 700}],
        }
    )
    assert result["severity"] == "escalate"


def test_heuristic_always_returns_valid_shape():
    result = decide_invoice_escalation_heuristic(
        {
            "number": "INV-104",
            "daysOverdue": 0,
            "priorPaymentHistory": [],
        }
    )
    assert result["severity"] in {"watch", "escalate", "urgent"}
    assert result["reason"]
    assert result["customerDraft"]


@pytest.mark.asyncio
async def test_decide_uses_heuristic_when_llm_off(monkeypatch):
    from app.agents import invoice_escalation_agent as mod

    async def _fake_decide_via_llm(_ctx):
        return None, "llm_unavailable"

    monkeypatch.setattr(mod, "decide_via_llm", _fake_decide_via_llm)

    state = await mod.decide(
        {
            "invoice_id": "inv-1",
            "context": {
                "number": "INV-1",
                "daysOverdue": 40,
                "priorPaymentHistory": [],
            },
            "status": "running",
        }
    )
    assert state["status"] == "decided"
    assert state["source"] == "heuristic"
    assert state["decision"]["severity"] == "urgent"
    assert state["decision"]["reason"]


@pytest.mark.asyncio
async def test_decide_skips_when_context_missing():
    from app.agents import invoice_escalation_agent as mod

    state = await mod.decide(
        {"invoice_id": "inv-missing", "context": {}, "status": "running"}
    )
    assert state["status"] == "skipped"
    assert state["reason"] == "invoice_not_found"
    assert state["decision"] is None
