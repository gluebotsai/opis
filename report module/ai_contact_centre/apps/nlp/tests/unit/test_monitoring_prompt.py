"""Monitoring-agent prompt and surface-rule regression tests."""

from app.prompts.coworker import build_surface_rules
from app.prompts.monitoring import MONITORING_AGENT_PROMPT


def normalized(text: str) -> str:
    return " ".join(text.split())


def test_monitoring_prompt_requires_live_snapshot_data() -> None:
    prompt = normalized(MONITORING_AGENT_PROMPT)
    assert "get_monitoring_snapshot" in prompt
    assert "Never invent counts" in prompt
    assert "create_callback_task" in prompt
    assert "force_agent_logout" in prompt
    assert "set_agent_presence" in prompt
    assert "Every turn must include a short HTML user-visible reply" in prompt
    assert "Never label a logged-in agent Offline" in prompt
    assert "session=offline only" in prompt


def test_monitoring_surface_rules_use_snapshot_tools() -> None:
    rules = normalized(build_surface_rules("monitoring"))
    assert "get_monitoring_snapshot" in rules
    assert "never call route_to_agent to monitoring" in rules.lower()
    assert "create_callback_task" in rules
    assert "Never finish with tool calls only" in rules
