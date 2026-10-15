"""Forms MAS — native executor loops and domain routing."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_forms_native_always_on():
    from app.mas.executors.shared.forms_native import is_native_forms
    from app.mas.runtime.flags import is_forms_native_enabled

    assert is_native_forms() is True
    assert is_forms_native_enabled() is True


def test_tools_for_mas_forms_executor_subsets():
    from app.agents.forms.tools.schemas import tools_for_mas_forms_executor

    theme = {t["function"]["name"] for t in tools_for_mas_forms_executor("form_theme")}
    fields = {t["function"]["name"] for t in tools_for_mas_forms_executor("form_fields")}
    assert "RUN_THEME_SPECIALIST" in theme
    assert "RUN_FIELDS_SPECIALIST" in fields


def test_form_theme_spa_uses_native_loop():
    async def run():
        with patch(
            "app.mas.executors.form_theme.runner.run_native_forms_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "updated theme",
                "mas_native_forms": True,
            }
            from app.mas.executors.form_theme.runner import run_form_theme_executor

            return await run_form_theme_executor(
                {
                    "session_id": "s1",
                    "token": "tok",
                    "entry": "interactive",
                    "task_spec": {"query": "make buttons blue"},
                    "query": "make buttons blue",
                }
            ), mock_native

    out, mock_native = asyncio.run(run())
    assert out.get("mas_native_forms") is True
    mock_native.assert_awaited_once()


def test_forms_domain_form_focus_fields():
    session: dict = {"session_id": "s1", "module": "forms"}

    async def run():
        with patch(
            "app.mas.domains.forms.runner.get_executor_runner",
        ) as mock_get:
            mock_runner = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "reply": "added field",
                    "mas_native_forms": True,
                }
            )
            mock_get.return_value = mock_runner
            from app.mas.domains.forms.runner import run_forms_domain

            return await run_forms_domain(
                {
                    "session": session,
                    "domain_id": "forms",
                    "entry": "interactive",
                    "query": "add email field",
                    "module_hint": "forms",
                    "task_spec": {
                        "query": "add email field",
                        "module": "forms",
                        "form_focus": "fields",
                    },
                    "token": "tok",
                    "session_id": "s1",
                }
            ), mock_get, mock_runner

    out, mock_get, mock_runner = asyncio.run(run())
    assert out.get("executor_id") == "form_fields"
    mock_get.assert_called_with("form_fields")
    mock_runner.assert_awaited_once()


def test_forms_super_chain_mock():
    session: dict = {"session_id": "s-forms", "module": "forms"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.forms.runner.llm_pick_forms_executor",
            new_callable=AsyncMock,
        ) as mock_domain, patch(
            "app.mas.executors.form_theme.runner.run_native_forms_executor",
            new_callable=AsyncMock,
        ) as mock_exec:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "forms",
                "restated_query": "change background",
            }
            mock_domain.return_value = {
                "ok": True,
                "executor_id": "form_theme",
                "restated_query": "change background",
            }
            mock_exec.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "Updated background.",
                "mas_native_forms": True,
            }
            from app.mas.runtime.invoke import mas_invoke

            return await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "query": "change background",
                    "session": session,
                    "session_id": "s-forms",
                    "token": "tok",
                    "module_hint": "forms",
                    "task_spec": {"query": "change background", "module": "forms"},
                }
            ), mock_super, mock_domain, mock_exec

    out, mock_super, mock_domain, mock_exec = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "forms"
    mock_super.assert_awaited_once()
    mock_domain.assert_awaited_once()
    mock_exec.assert_awaited_once()
