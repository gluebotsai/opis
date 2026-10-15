"""MAS reports skills — registry and live-ops harness completion."""

from __future__ import annotations

import app.mas.skills.registry as reg_mod
from app.mas.skills import REPORTS_MODULE, get_skill_registry
from app.mas.skills.harness import evaluate_skill_outcome, _COMPLETION_TOOLS, _REPORTS_SKILL_IDS


def _fresh_registry():
    reg_mod._default_registry = None
    return get_skill_registry()


def test_reports_registry_includes_dashboard_live_ops():
    registry = _fresh_registry()
    skills = registry.list_module(REPORTS_MODULE)
    ids = {s.skill_id for s in skills}
    assert "dashboard-live-ops" in ids
    assert "report_kpis" in ids


def test_dashboard_live_ops_in_harness_sets():
    assert "dashboard-live-ops" in _REPORTS_SKILL_IDS
    assert "GET_CAMPAIGN_LIVE_STATUS" in _COMPLETION_TOOLS["dashboard-live-ops"]


def test_evaluate_skill_outcome_complete_on_live_status():
    outcome = evaluate_skill_outcome(
        "dashboard-live-ops",
        tool_results=[("GET_CAMPAIGN_LIVE_STATUS", {"ok": True})],
        user_text="what is sending",
        ui_events=[],
    )
    assert outcome["complete"] is True
