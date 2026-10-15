"""Optimization MAS — native executor loops and domain routing."""

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


def test_optimization_native_always_on():
    from app.mas.executors.shared.optimization_native import is_native_optimization
    from app.mas.runtime.flags import is_optimization_native_enabled

    assert is_native_optimization() is True
    assert is_optimization_native_enabled() is True


def test_tools_for_mas_optimization_executor_subsets():
    from app.agents.monitoring.tools.schemas import tools_for_mas_optimization_executor

    mon = {t["function"]["name"] for t in tools_for_mas_optimization_executor("monitoring")}
    rec = {t["function"]["name"] for t in tools_for_mas_optimization_executor("recovery")}
    ana = {t["function"]["name"] for t in tools_for_mas_optimization_executor("analytics")}
    assert "LIST_MONITOR_CAMPAIGNS" in mon
    assert "STOP_CHANNEL" in rec
    assert "query_analytics" in ana


def test_monitoring_spa_uses_native_loop():
    async def run():
        with patch(
            "app.mas.executors.monitoring.runner.run_native_optimization_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "listed",
                "mas_native_optimization": True,
            }
            from app.mas.executors.monitoring.runner import run_monitoring_executor

            return await run_monitoring_executor(
                {
                    "session_id": "s1",
                    "token": "tok",
                    "entry": "interactive",
                    "task_spec": {"query": "list live campaigns"},
                    "query": "list live campaigns",
                }
            ), mock_native

    out, mock_native = asyncio.run(run())
    assert out.get("mas_native_optimization") is True
    mock_native.assert_awaited_once()


def test_optimization_domain_module_hint_reports():
    session: dict = {"session_id": "s1", "module": "reports"}

    async def run():
        with patch(
            "app.mas.domains.optimization.runner.get_executor_runner",
        ) as mock_get:
            mock_runner = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "reply": "kpi",
                }
            )
            mock_get.return_value = mock_runner
            from app.mas.domains.optimization.runner import run_optimization_domain

            return await run_optimization_domain(
                {
                    "session": session,
                    "domain_id": "optimization",
                    "entry": "interactive",
                    "query": "open rate this week",
                    "module_hint": "reports",
                    "task_spec": {"query": "open rate this week", "module": "reports"},
                    "token": "tok",
                    "session_id": "s1",
                }
            ), mock_get, mock_runner

    out, mock_get, mock_runner = asyncio.run(run())
    assert out.get("executor_id") == "analytics"
    mock_get.assert_called_with("analytics")
    mock_runner.assert_awaited_once()


def test_reports_surface_skips_domain_direct_reply():
    session: dict = {"session_id": "s-rep", "module": "reports"}

    async def run():
        with patch(
            "app.mas.domains.optimization.runner.select_optimization_skill",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.optimization.runner.get_executor_runner",
        ) as mock_get:
            from app.mas.skills.selector import SkillPick

            mock_pick.return_value = SkillPick(
                ok=True,
                direct_reply="I cannot create campaigns on this surface.",
            )
            mock_runner = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "kind": "executor",
                    "reply": "Opening create campaign.",
                }
            )
            mock_get.return_value = mock_runner
            from app.mas.domains.optimization.runner import run_optimization_domain

            return await run_optimization_domain(
                {
                    "session": session,
                    "domain_id": "optimization",
                    "entry": "sticky_domain",
                    "query": "create a campaign",
                    "module_hint": "reports",
                    "task_spec": {"query": "create a campaign", "module": "reports"},
                    "token": "tok",
                    "session_id": "s-rep",
                }
            ), mock_get, mock_runner

    out, mock_get, mock_runner = asyncio.run(run())
    assert out.get("executor_id") == "analytics"
    mock_get.assert_called_with("analytics")
    mock_runner.assert_awaited_once()
    assert out.get("reply") == "Opening create campaign."


def test_monitoring_super_chain_mock():
    session: dict = {"session_id": "s-mon", "module": "monitoring"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.optimization.runner.llm_pick_optimization_executor",
            new_callable=AsyncMock,
        ) as mock_domain, patch(
            "app.mas.executors.monitoring.runner.run_native_optimization_executor",
            new_callable=AsyncMock,
        ) as mock_exec:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "optimization",
                "restated_query": "pause campaign",
            }
            mock_domain.return_value = {
                "ok": True,
                "executor_id": "monitoring",
                "restated_query": "pause campaign",
            }
            mock_exec.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "Which campaign?",
                "mas_native_optimization": True,
            }
            from app.mas.runtime.invoke import mas_invoke

            return await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "query": "pause campaign",
                    "session": session,
                    "session_id": "s-mon",
                    "token": "tok",
                    "module_hint": "monitoring",
                    "task_spec": {"query": "pause campaign", "module": "monitoring"},
                }
            ), mock_super, mock_domain, mock_exec

    out, mock_super, mock_domain, mock_exec = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "optimization"
    mock_super.assert_awaited_once()
    mock_domain.assert_not_called()
    mock_exec.assert_awaited_once()
