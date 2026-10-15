"""WhatsApp Approved Run domain — module routing and executors."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.catalog import MODULE_TO_DOMAIN, executors_for_domain


def test_whatsapp_approved_skill_registry_tools():
    from app.mas.skills.registry import get_skill_registry

    reg = get_skill_registry()
    spec = reg.get("whatsapp_approved", "approved_audience")
    assert spec is not None
    tools = reg.tools_for_skill("whatsapp_approved", "approved_audience")
    names = {str(t["function"]["name"]) for t in tools}
    assert names == {"SET_AUDIENCE", "FILTER_CONTACTS", "UPLOAD_TEMPORARY_CONTACTS"}
    launch = reg.tools_for_skill("whatsapp_approved", "approved_launch")
    launch_names = {str(t["function"]["name"]) for t in launch}
    assert "SEND_APPROVED_TEMPLATE" in launch_names
    assert "LAUNCH_APPROVED_CAMPAIGN" in launch_names


def test_whatsapp_approved_module_maps_to_run_domain():
    assert MODULE_TO_DOMAIN["whatsapp_approved"] == "whatsapp_approved_run"
    ex = executors_for_domain("whatsapp_approved_run")
    assert "brief_validation" in ex
    assert "campaign_audience" in ex
    assert "launch_scheduling" in ex
    assert "whatsapp_approved_send" not in ex
    assert "campaign_content" not in ex


def test_whatsapp_approved_run_domain_sets_active_domain(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "whatsapp_approved_run,creation")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.domains.whatsapp_approved_run.runner.select_whatsapp_approved_run_skill",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.whatsapp_approved_run.runner.run_creation_executor_via_harness",
            new_callable=AsyncMock,
        ) as mock_harness:
            from app.mas.skills.selector import SkillPick

            mock_pick.return_value = SkillPick(
                ok=True,
                executor_id="campaign_audience",
                skill_id="campaign_audience",
                skill_action="continue",
                restated_query="give sample sheet",
            )
            mock_harness.return_value = {
                "ok": True,
                "action_status": "completed",
                "agent_id": "campaign_audience",
                "reply": "sample sheet linked",
                "message": "sample sheet linked",
            }
            from app.mas.domains.registry import get_domain_runner

            runner = get_domain_runner("whatsapp_approved_run")
            session = {
                "session_id": "wa-approved-t1",
                "whatsapp_approved_run": True,
                "whatsapp_template_snapshot": {"name": "promo_v1"},
                "campaign": {"name": "WA promo", "goal": "Send", "objective": "Reach"},
                "templates_finalized": True,
            }
            return await runner(
                {
                    "entry": "interactive",
                    "session": session,
                    "session_id": "wa-approved-t1",
                    "token": "t",
                    "task_spec": {"query": "give sample sheet", "module": "whatsapp_approved"},
                    "module_hint": "whatsapp_approved",
                }
            )

    out = asyncio.run(run())
    assert out.get("domain_id") == "whatsapp_approved_run"
    assert out.get("reply") == "sample sheet linked"
    get_settings.cache_clear()
