from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.agents.reports_analytics_agent import AnalyticsScope, run as run_reports


def test_analytics_scope_rejects_untrusted_extra_fields():
    with pytest.raises(ValidationError):
        AnalyticsScope(
            organization_id="1003",
            actor_id="42",
            role="admin",
            business_type="b2b",
            injected_scope="all_tenants",
        )


@pytest.mark.asyncio
async def test_run_delegates_structured_context_to_b2b_turn(monkeypatch):
    captured: dict = {}

    async def fake_turn(**kwargs):
        captured.update(kwargs)
        return {
            "assistantText": "You have 12 open deals.",
            "rows": [{"count": 12}],
            "plan": {
                "kind": "plan",
                "object": "deals",
                "tasks": [
                    {
                        "id": "t1",
                        "executor": "sql",
                        "kpi": "active_opportunities",
                        "answer_type": "scalar",
                    }
                ],
            },
            "had_kg": False,
            "progress": None,
            "reportsContextPatch": {
                "objectLock": "deals",
                "lastKpiId": "active_opportunities",
            },
        }

    monkeypatch.setattr("app.agents.reports_analytics_turn.run_turn", fake_turn)
    result = await run_reports(
        question="how many open deals?",
        organization_id="1003",
        actor_id="42",
        role="admin",
        business_type="b2b",
        time_phrase="this month",
        object_lock="deals",
    )
    assert result["ok"] is True
    assert "12" in result["assistantText"]
    assert result["analytics"]["audit"]["source"] == "reports_b2b"
    assert result["reportsContextPatch"]["objectLock"] == "deals"
    assert captured["time_phrase"] == "this month"
    assert captured["object_lock"] == "deals"


@pytest.mark.asyncio
async def test_run_turn_failure_returns_safe_message(monkeypatch):
    async def boom(**_kwargs):
        raise RuntimeError("warehouse detail that must not reach the user")

    monkeypatch.setattr("app.agents.reports_analytics_turn.run_turn", boom)
    result = await run_reports(
        question="how many open deals?",
        organization_id="1003",
        actor_id="42",
        role="admin",
        business_type="b2b",
    )
    assert result["ok"] is False
    assert result["analytics"] is None
    assert result["error"] == "reports_turn_failed"
    assert "warehouse detail" not in result["assistantText"]
