"""Custom Lola Worktual LLM request shaping."""

from app.agents.custom_lola_worktual.llm import build_worktual_llm_extra_body


def test_build_worktual_llm_extra_body_sets_low_reasoning_effort() -> None:
    body = build_worktual_llm_extra_body(reasoning_effort="low")
    assert body["reasoning_effort"] == "low"
    assert body["chat_template_kwargs"] == {"enable_thinking": False}
    assert body["thinking"] == {"type": "disabled"}


def test_build_worktual_llm_extra_body_omits_blank_reasoning_effort() -> None:
    body = build_worktual_llm_extra_body(reasoning_effort="")
    assert "reasoning_effort" not in body
