"""Meta-help questions should skip router LLM + live DB dump."""

from __future__ import annotations

from app.tasks.chat_commands import (
    _is_meta_help,
    _should_skip_live_context,
)


def test_role_question_is_meta_help():
    assert _is_meta_help("what us your role here?")
    assert _is_meta_help("what is your role?")
    assert _is_meta_help("who are you?")
    assert _is_meta_help("what can you do?")
    assert _should_skip_live_context("what us your role here?")


def test_count_questions_still_need_live_data():
    assert not _is_meta_help("how many open tickets are there?")
    assert not _should_skip_live_context("how many tickets are assigned to me?")
    assert not _is_meta_help("show high priority tickets")
