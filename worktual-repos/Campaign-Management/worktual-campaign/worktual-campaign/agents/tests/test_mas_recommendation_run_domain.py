"""Recommendation Run domain — module routing and shared executors."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.catalog import MODULE_TO_DOMAIN, executors_for_domain


def test_recommendation_run_module_maps_to_domain():
    assert MODULE_TO_DOMAIN["recommendation_run"] == "recommendation_run"
    ex = executors_for_domain("recommendation_run")
    assert "brief_validation" in ex
    assert "campaign_content" in ex
    assert "launch_scheduling" in ex
    assert "recommendation" not in ex


def test_recommendation_run_domain_sets_active_domain(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "recommendation_run,creation")
    from app.config import get_settings

    get_settings.cache_clear()

    async def brief_exec(ctx):
        return {
            "ok": True,
            "action_status": "completed",
            "agent_id": "brief_validation",
            "reply": "plan updated",
            "message": "plan updated",
        }

    async def run():
        with patch(
            "app.mas.domains.recommendation_run.runner.llm_pick_recommendation_run_action",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.recommendation_run.runner.get_executor_runner",
        ) as mock_get:
            mock_pick.return_value = {
                "kind": "executor",
                "executor_id": "brief_validation",
                "restated_query": "drop whatsapp",
            }
            mock_get.return_value = brief_exec
            from app.mas.domains.registry import get_domain_runner

            runner = get_domain_runner("recommendation_run")
            return await runner(
                {
                    "entry": "interactive",
                    "session": {
                        "session_id": "rec-run-1",
                        "recommendation_run": True,
                        "source_recommendation_id": "seed-festive",
                        "recommendation_why": "Past Diwali campaigns performed well",
                        "campaign": {"name": "Festive Sale", "goal": "Boost sales"},
                        "channels": ["email", "whatsapp"],
                    },
                    "session_id": "rec-run-1",
                    "token": "t",
                    "task_spec": {"query": "drop whatsapp", "module": "recommendation_run"},
                    "module_hint": "recommendation_run",
                }
            )

    out = asyncio.run(run())
    assert out.get("domain_id") == "recommendation_run"
    assert out.get("reply") == "plan updated"
    get_settings.cache_clear()


def test_super_module_scoped_fallback_recommendation_run():
    from app.mas.super_agent.runner import _module_scoped_fallback

    fb = _module_scoped_fallback("recommendation_run", "run this plan")
    assert fb is not None
    assert fb["domain_id"] == "recommendation_run"
