"""Task-agent prompt and surface-rule regression tests."""

from app.prompts.coworker import build_surface_rules
from app.prompts.task import TASK_AGENT_PROMPT


def normalized(text: str) -> str:
    return " ".join(text.split())


def test_task_prompt_requires_live_data_and_workspace_rules() -> None:
    prompt = normalized(TASK_AGENT_PROMPT)
    assert "Never invent task counts" in prompt
    assert "2nd one" in prompt
    assert "open_task_workspace in the same turn" in prompt
    assert "never call route_to_agent to task" in prompt.lower()
    assert "may assign or create a conversation" in prompt
    assert "do not also call navigate" in prompt
    assert "Every turn must include a short HTML user-visible reply" in prompt


def test_task_list_surface_supports_ordinal_selection() -> None:
    rules = normalized(build_surface_rules("tasks-list"))
    assert "Use list_tasks for every question" in rules
    assert "2nd one" in rules
    assert "open_task_workspace in the same turn" in rules
    assert "never call route_to_agent to task" in rules.lower()
    assert "Never finish with tool calls only" in rules


def test_task_detail_surface_uses_selected_task_context() -> None:
    rules = normalized(build_surface_rules("tasks-detail"))
    assert "selected task is trusted page context" in rules
    assert "Use get_task" in rules
    assert "open_task_workspace when the user asks" in rules
    assert "never call route_to_agent to task" in rules.lower()
