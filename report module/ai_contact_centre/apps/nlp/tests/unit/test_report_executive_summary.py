import pytest
from pydantic import ValidationError

from app.schemas.reports import (
    AgentPerformanceSummaryRequest,
    ExecutiveSummaryRequest,
    build_agent_performance_summary_prompt,
    build_executive_summary_prompt,
)


def test_executive_summary_request_accepts_camel_case_aliases() -> None:
    payload = ExecutiveSummaryRequest.model_validate(
        {
            "periodLabel": "Aug 20, 2026",
            "scheduleLabel": "Daily",
            "orgKpis": {"handled": 10, "slaRate": 80},
            "topPerformers": [{"name": "Agent A", "handled": 5, "slaRate": 90}],
        }
    )
    assert payload.period_label == "Aug 20, 2026"
    assert payload.org_kpis["handled"] == 10


def test_executive_summary_request_rejects_bulk_agent_rows() -> None:
    with pytest.raises(ValidationError):
        ExecutiveSummaryRequest.model_validate(
            {
                "periodLabel": "Aug 20, 2026",
                "scheduleLabel": "Daily",
                "orgKpis": {"handled": 1},
                "agentRows": [{"name": f"A{i}"} for i in range(6)],
            }
        )


def test_prompt_builder_uses_only_grounded_payload_keys() -> None:
    payload = ExecutiveSummaryRequest.model_validate(
        {
            "periodLabel": "Aug 20, 2026",
            "scheduleLabel": "Daily",
            "orgKpis": {"handled": 12},
            "includedSections": ["dashboardKpis"],
        }
    )
    messages = build_executive_summary_prompt(payload)
    assert "agentRows" not in messages[1]["content"]
    assert "handled" in messages[1]["content"]


def test_agent_performance_summary_request_accepts_camel_case_aliases() -> None:
    payload = AgentPerformanceSummaryRequest.model_validate(
        {
            "periodLabel": "Aug 20, 2026",
            "scheduleLabel": "Daily",
            "agentName": "Agent A",
            "agentKpis": {"handled": 12, "slaRate": 88},
            "channelMixTop3": [{"channel": "Webchat", "sharePercent": 60}],
        }
    )
    assert payload.period_label == "Aug 20, 2026"
    assert payload.agent_kpis["handled"] == 12


def test_agent_performance_summary_request_rejects_empty_kpis() -> None:
    with pytest.raises(ValidationError):
        AgentPerformanceSummaryRequest.model_validate(
            {
                "periodLabel": "Aug 20, 2026",
                "scheduleLabel": "Daily",
                "agentName": "Agent A",
                "agentKpis": {},
            }
        )


def test_agent_prompt_builder_uses_only_grounded_payload_keys() -> None:
    payload = AgentPerformanceSummaryRequest.model_validate(
        {
            "periodLabel": "Aug 20, 2026",
            "scheduleLabel": "Daily",
            "agentName": "Agent A",
            "agentKpis": {"handled": 12},
            "includedSections": ["performanceKpis"],
        }
    )
    messages = build_agent_performance_summary_prompt(payload)
    assert "orgKpis" not in messages[1]["content"]
    assert "handled" in messages[1]["content"]
    assert "Agent A" in messages[1]["content"]
