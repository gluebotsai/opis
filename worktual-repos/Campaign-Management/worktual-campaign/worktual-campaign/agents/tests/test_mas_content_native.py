"""Content MAS — native executor loops and domain routing."""

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


def test_content_native_always_on():
    from app.mas.executors.shared.content_native import is_native_content
    from app.mas.runtime.flags import is_content_native_enabled

    assert is_native_content() is True
    assert is_content_native_enabled() is True


def test_tools_for_mas_content_executor_subsets():
    from app.mas.runtime.content_tools import tools_for_mas_content_executor

    wa = {t["function"]["name"] for t in tools_for_mas_content_executor("whatsapp_approved_send")}
    cv = {t["function"]["name"] for t in tools_for_mas_content_executor("content_verification")}
    assert "SEND_APPROVED_TEMPLATE" in wa
    assert "SUBMIT_FOR_APPROVAL" in cv


def test_whatsapp_approved_spa_uses_native_loop():
    async def run():
        with patch(
            "app.mas.executors.whatsapp_approved_send.runner.run_native_content_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "sent",
                "mas_native_content": True,
            }
            from app.mas.executors.whatsapp_approved_send.runner import (
                run_whatsapp_approved_send_executor,
            )

            return await run_whatsapp_approved_send_executor(
                {
                    "session_id": "s1",
                    "token": "tok",
                    "entry": "interactive",
                    "task_spec": {"query": "send to Priya"},
                    "query": "send to Priya",
                }
            ), mock_native

    out, mock_native = asyncio.run(run())
    assert out.get("mas_native_content") is True
    mock_native.assert_awaited_once()


def test_content_domain_module_hint_whatsapp_rejected():
    session: dict = {"session_id": "s1", "module": "whatsapp_rejected"}

    async def run():
        with patch(
            "app.mas.domains.content.runner.get_executor_runner",
        ) as mock_get:
            mock_runner = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "reply": "fixed",
                    "mas_native_content": True,
                }
            )
            mock_get.return_value = mock_runner
            from app.mas.domains.content.runner import run_content_domain

            return await run_content_domain(
                {
                    "session": session,
                    "domain_id": "content",
                    "entry": "interactive",
                    "query": "fix the body copy",
                    "module_hint": "whatsapp_rejected",
                    "task_spec": {"query": "fix the body copy", "module": "whatsapp_rejected"},
                    "token": "tok",
                    "session_id": "s1",
                }
            ), mock_get, mock_runner

    out, mock_get, mock_runner = asyncio.run(run())
    assert out.get("executor_id") == "content_verification"
    mock_get.assert_called_with("content_verification")
    mock_runner.assert_awaited_once()


def test_content_super_chain_mock():
    session: dict = {"session_id": "s-wa", "module": "whatsapp_approved"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.content.runner.llm_pick_content_executor",
            new_callable=AsyncMock,
        ) as mock_domain, patch(
            "app.mas.executors.whatsapp_approved_send.runner.run_native_content_executor",
            new_callable=AsyncMock,
        ) as mock_exec:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "content",
                "restated_query": "send template",
            }
            mock_domain.return_value = {
                "ok": True,
                "executor_id": "whatsapp_approved_send",
                "restated_query": "send template",
            }
            mock_exec.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "Who should receive it?",
                "mas_native_content": True,
            }
            from app.mas.runtime.invoke import mas_invoke

            return await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "query": "send template",
                    "session": session,
                    "session_id": "s-wa",
                    "token": "tok",
                    "module_hint": "whatsapp_approved",
                    "task_spec": {"query": "send template", "module": "whatsapp_approved"},
                }
            ), mock_super, mock_domain, mock_exec

    out, mock_super, mock_domain, mock_exec = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "content"
    mock_super.assert_awaited_once()
    mock_domain.assert_not_called()
    mock_exec.assert_awaited_once()
