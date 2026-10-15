"""Pytest fixtures — thin; logic lives in helpers.py."""

from __future__ import annotations

import pytest

from tests.helpers import AdvancedFakeLLM, patch_llm, patch_no_db


@pytest.fixture(scope="session", autouse=True)
def _close_db_pool_on_exit():
    yield
    try:
        from app.db import close_pool

        close_pool()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def _agents_api_secret(monkeypatch):
    """All agents routes require X-Coworker-Tasks-Key; keep tests aligned.

    Unit tests mock Postgres. Disable HTTP persistence so existing suites
    keep using those mocks (production still defaults VIA_API=1).
    """
    monkeypatch.setenv("COWORKER_TASKS_SECRET", "worktual-tasks-dev-secret")
    monkeypatch.setenv("CONVERSATION_CONTEXT_VIA_API", "0")
    monkeypatch.setenv("AGENT_DATA_VIA_API", "0")
    monkeypatch.setenv("PROACTIVE_VIA_API", "0")
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def fresh_memory():
    from app.graph import get_compiled_graph
    from app.memory import reset_for_tests

    reset_for_tests()
    get_compiled_graph.cache_clear()
    yield
    reset_for_tests()
    get_compiled_graph.cache_clear()


@pytest.fixture
def llm(monkeypatch, fresh_memory):
    patch_no_db(monkeypatch)
    return patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))


@pytest.fixture
def capturing_llm(llm):
    """Back-compat alias for older suite names."""
    return llm


@pytest.fixture
def no_live_db(monkeypatch):
    patch_no_db(monkeypatch)
