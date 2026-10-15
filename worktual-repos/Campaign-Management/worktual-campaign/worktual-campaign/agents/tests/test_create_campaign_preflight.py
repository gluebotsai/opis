"""Legacy preflight removed — guardrails cover channel vs audience instead."""

from app.agents.create_campaign.graph import run_coordinator


def test_graph_exports_coordinator():
    assert callable(run_coordinator)
