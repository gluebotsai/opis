"""Finance Assist cron agents: JSON normalization + offline heuristics only."""

from __future__ import annotations

import pytest

from app.agents.company_collection_risk_agent import (
    COLLECTION_RISK_MODULE_PATH,
    _normalize_llm_risk,
    decide_collection_risk_heuristic,
)
from app.agents.invoice_dunning_agent import (
    INVOICE_DUNNING_MODULE_PATH,
    _normalize_llm_dunning,
    decide_invoice_dunning_heuristic,
)
from app.agents.revenue_gap_forecast_agent import (
    REVENUE_GAP_MODULE_PATH,
    _normalize_llm_forecast,
    decide_revenue_gap_heuristic,
)


def test_collection_risk_module_path():
    assert COLLECTION_RISK_MODULE_PATH == "company-collection-risk"


def test_normalize_collection_risk():
    out = _normalize_llm_risk({"riskLevel": "Watch", "reason": "Late pattern."})
    assert out == {"riskLevel": "watch", "reason": "Late pattern."}


def test_normalize_collection_risk_rejects_bad_level():
    assert _normalize_llm_risk({"riskLevel": "critical", "reason": "x"}) is None


def test_collection_risk_heuristic_flags_severe_overdue():
    out = decide_collection_risk_heuristic(
        {"openInvoices": [{"daysOverdue": 50}], "invoiceHistory": []},
    )
    assert out["riskLevel"] == "risk"


def test_revenue_gap_module_path():
    assert REVENUE_GAP_MODULE_PATH == "revenue-gap-forecast"


def test_normalize_revenue_gap_forecast():
    out = _normalize_llm_forecast(
        {
            "hasTarget": True,
            "narrative": "Behind target.",
            "atRiskInvoiceIds": ["inv_a", "inv_b"],
            "gapScenario": "If Acme pays.",
        },
    )
    assert out is not None
    assert out["hasTarget"] is True
    assert out["atRiskInvoiceIds"] == ["inv_a", "inv_b"]


def test_revenue_gap_heuristic_without_target():
    out = decide_revenue_gap_heuristic({"atRiskInvoices": [], "collectedRevenue": 0})
    assert out["hasTarget"] is False
    assert "No revenue target" in out["narrative"]


def test_invoice_dunning_module_path():
    assert INVOICE_DUNNING_MODULE_PATH == "invoice-dunning"


def test_dunning_clamps_skip_ahead_stages():
    norm = _normalize_llm_dunning("reminder")
    out = norm(
        {
            "nextStage": "pause_notice",
            "reason": "Very overdue.",
            "message": "Please pay.",
        },
    )
    assert out is not None
    assert out["nextStage"] == "warning"


def test_dunning_heuristic_first_reminder():
    out = decide_invoice_dunning_heuristic(
        {"dunningStage": "none", "daysOverdue": 3, "number": "INV-9", "total": 500},
    )
    assert out["nextStage"] == "reminder"
    assert out["message"]


@pytest.mark.asyncio
async def test_collection_risk_decide_skips_empty_context():
    from app.agents import company_collection_risk_agent as mod

    state = await mod.decide(
        {"company_id": "co-1", "context": {}, "status": "running"},
    )
    assert state["status"] == "skipped"
    assert state["reason"] == "company_not_found"
