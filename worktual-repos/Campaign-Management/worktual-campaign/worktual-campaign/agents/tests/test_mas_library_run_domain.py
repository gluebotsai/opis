"""Library Run domain — module routing and isolated skills."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.catalog import MODULE_TO_DOMAIN, executors_for_domain
from app.mas.skills.create_campaign import CREATE_CAMPAIGN_MODULE
from app.mas.skills.library_run import LIBRARY_RUN_MODULE, register_library_run_skills
from app.mas.skills.registry import SkillRegistry, get_skill_registry
from app.mas.skills.selector import SkillPick


def test_library_run_module_maps_to_domain():
    assert MODULE_TO_DOMAIN["library_run"] == "library_run"
    ex = executors_for_domain("library_run")
    assert "brief_validation" in ex
    assert "campaign_content" in ex
    assert "launch_scheduling" in ex
    assert "recommendation" not in ex


def test_library_run_skills_isolated_from_create():
    reg = SkillRegistry()
    register_library_run_skills(reg)
    lib_ids = {s.skill_id for s in reg.list_module(LIBRARY_RUN_MODULE)}
    assert lib_ids == {
        "library_brief",
        "library_templates",
        "library_audience",
        "library_launch",
    }
    create_ids = {
        s.skill_id for s in get_skill_registry().list_module(CREATE_CAMPAIGN_MODULE)
    }
    assert "campaign_brief" in create_ids
    assert "library_brief" not in create_ids
    assert create_ids.isdisjoint(lib_ids)


def test_library_run_domain_sets_active_domain(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "library_run,creation")
    from app.config import get_settings

    get_settings.cache_clear()

    async def brief_exec(ctx):
        return {
            "ok": True,
            "action_status": "completed",
            "agent_id": "brief_validation",
            "reply": "baseline ready",
            "message": "baseline ready",
        }

    async def run():
        with patch(
            "app.mas.domains.library_run.runner.select_library_run_skill",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.library_run.runner.get_executor_runner",
        ) as mock_get:
            mock_pick.return_value = SkillPick(
                ok=True,
                skill_id="library_brief",
                skill_action="continue",
                executor_id="brief_validation",
                restated_query="same idea",
            )
            mock_get.return_value = brief_exec
            from app.mas.domains.registry import get_domain_runner

            runner = get_domain_runner("library_run")
            return await runner(
                {
                    "entry": "interactive",
                    "session": {
                        "session_id": "lib-run-1",
                        "library_run": True,
                        "library_baseline": {
                            "channels_selected": ["email"],
                            "channels_missing": [],
                            "templates": [
                                {"id": "t1", "channel": "email", "name": "Festive"}
                            ],
                        },
                        "selected_library_templates": [
                            {"channel": "email", "name": "Festive"}
                        ],
                        "campaign": {"name": "Festive Sale", "goal": "Boost sales"},
                        "channels": ["email"],
                    },
                    "session_id": "lib-run-1",
                    "token": "t",
                    "task_spec": {"query": "same idea", "module": "library_run"},
                    "module_hint": "library_run",
                }
            )

    out = asyncio.run(run())
    assert out.get("domain_id") == "library_run"
    assert out.get("reply") == "baseline ready"
    get_settings.cache_clear()


def test_super_module_scoped_fallback_library_run():
    from app.mas.super_agent.runner import _module_scoped_fallback

    fb = _module_scoped_fallback("library_run", "use this template")
    assert fb is not None
    assert fb["domain_id"] == "library_run"


def test_live_session_facts_include_library_baseline():
    from app.mas.runtime.campaign_setup_snapshot import live_session_facts

    facts = live_session_facts(
        {
            "library_run": True,
            "library_baseline": {
                "channels_selected": ["email", "whatsapp"],
                "channels_missing": ["push"],
                "templates": [{"id": "a", "channel": "email", "name": "A"}],
            },
            "campaign": {"name": "X", "goal": "Y", "objective": "Z"},
            "channels": ["email", "whatsapp"],
            "templates": [],
        }
    )
    assert facts.get("library_run") is True
    assert facts["library_baseline"]["channels_selected"] == ["email", "whatsapp"]
    assert facts["library_baseline"]["template_count"] == 1
