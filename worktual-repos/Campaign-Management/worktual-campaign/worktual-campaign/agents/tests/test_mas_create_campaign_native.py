"""Native MAS create-campaign executors — bounded tools, parity handlers."""

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


def test_native_flag_default_true():
    from app.mas.runtime.flags import is_create_campaign_native_enabled

    assert is_create_campaign_native_enabled() is True


def test_tools_for_mas_executor_subsets():
    from app.agents.create_campaign.tools import tools_for_mas_executor

    brief = [t["function"]["name"] for t in tools_for_mas_executor("brief_validation")]
    assert "update_campaign_setup" in brief
    assert "set_email_ab" in brief

    launch = [t["function"]["name"] for t in tools_for_mas_executor("launch_scheduling")]
    assert launch == ["launch_campaign", "set_email_ab", "search_knowledge"]

    contact = [t["function"]["name"] for t in tools_for_mas_executor("contact")]
    assert set(contact) >= {
        "check_contacts",
        "create_contact",
        "upload_temporary_contacts",
        "update_contact",
    }

    email = [t["function"]["name"] for t in tools_for_mas_executor("email_content")]
    assert "build_campaign" in email
    assert "set_email_ab" in email

    rec = [t["function"]["name"] for t in tools_for_mas_executor("recommendation")]
    assert len(rec) >= 7
    assert "build_campaign" in rec
    assert "set_email_ab" in rec

def test_brief_validation_uses_native_loop(monkeypatch):
    monkeypatch.setenv("MAS_CREATE_CAMPAIGN_NATIVE", "true")

    async def run():
        with patch(
            "app.mas.executors.brief_validation.runner.run_native_create_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "agent_id": "brief_validation",
                "reply": "saved meta",
                "mas_native_create": True,
            }
            from app.mas.executors.brief_validation.runner import run_brief_validation_executor

            return await run_brief_validation_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "name it Spring Sale"},
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_native_create") is True
    assert out.get("reply") == "saved meta"


def test_brief_validation_legacy_when_flag_off(monkeypatch):
    monkeypatch.setenv("MAS_CREATE_CAMPAIGN_NATIVE", "false")

    async def run():
        with patch(
            "app.agents.create_campaign.agent.run_create_campaign_turn",
            new_callable=AsyncMock,
        ) as mock_legacy:
            mock_legacy.return_value = {"reply": "legacy", "state": {}, "ui_events": []}
            from app.mas.executors.brief_validation.runner import run_brief_validation_executor

            return await run_brief_validation_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "hello"},
                }
            )

    out = asyncio.run(run())
    assert out.get("reply") == "legacy"
    assert "mas_native_create" not in out


def test_audience_contact_uses_native_audience_not_create_handoff(monkeypatch):
    monkeypatch.setenv("MAS_CREATE_CAMPAIGN_NATIVE", "true")

    async def run():
        with patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "reply": "CRM contact flow",
                "mas_native_audience": True,
            }
            from app.mas.executors.contact.runner import run_contact_executor

            return await run_contact_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "entry": "sticky_domain",
                    "session": {"module": "create_campaign"},
                    "task_spec": {
                        "query": "add aravi@gmail.com",
                        "from_domain_handoff": True,
                    },
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_native_audience") is True
    assert out.get("reply") == "CRM contact flow"
    assert "mas_native_create" not in out


def test_channel_content_handoff_uses_build_campaign(monkeypatch):
    monkeypatch.setenv("MAS_CREATE_CAMPAIGN_NATIVE", "true")

    async def run():
        with patch(
            "app.mas.executors.shared.channel_content.run_native_create_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "reply": "templates built",
                "mas_native_create": True,
            }
            from app.mas.executors.shared.channel_content import run_channel_content_executor

            return await run_channel_content_executor(
                "email_content",
                {
                    "session_id": "s1",
                    "token": "t",
                    "session": {"module": "create_campaign"},
                    "task_spec": {
                        "query": "generate email template",
                        "from_domain_handoff": True,
                    },
                },
            )

    out = asyncio.run(run())
    assert out.get("mas_native_create") is True
    assert out.get("reply") == "templates built"


def test_creation_sticky_executor_skips_domain_llm(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "creation")

    async def run():
        with patch(
            "app.mas.domains.creation.runner.llm_pick_creation_action",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.creation.runner.get_executor_runner",
        ) as mock_get:
            async def launch_exec(ctx):
                return {
                    "ok": True,
                    "action_status": "completed",
                    "agent_id": "launch_scheduling",
                    "reply": "launch ok",
                }

            mock_get.return_value = launch_exec
            from app.mas.domains.creation.runner import run_creation_domain

            session = {
                "mas_task": {
                    "active_domain": "creation",
                    "active_executor": "launch_scheduling",
                }
            }
            out = await run_creation_domain(
                {
                    "entry": "sticky_domain",
                    "session": session,
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "send now"},
                    "module_hint": "create_campaign",
                }
            )
            return out, mock_pick

    out, mock_pick = asyncio.run(run())
    assert out.get("agent_id") == "launch_scheduling"
    assert out.get("reply") == "launch ok"
    mock_pick.assert_not_called()


def test_build_executor_system_prompt_includes_mas_task():
    from app.agents.create_campaign.prompts import build_executor_system_prompt

    prompt = build_executor_system_prompt(
        {"session_id": "s1", "campaign": {"name": "Test"}},
        "brief_validation",
        mas_task={"active_domain": "creation", "active_executor": "brief_validation"},
    )
    assert "mas_executor" in prompt or "brief_validation" in prompt
    assert "Test" in prompt or "campaign" in prompt.lower()


def test_handoff_source_domain_enables_campaign_tools():
    from app.mas.executors.shared.create_campaign_native import is_create_campaign_handoff

    assert is_create_campaign_handoff(
        {"task_spec": {"handoff_source_domain": "creation", "query": "build email"}}
    )


def test_creation_domain_includes_campaign_executors():
    from app.mas.catalog import executors_for_domain

    allowed = set(executors_for_domain("creation"))
    assert "campaign_audience" in allowed
    assert "campaign_content" in allowed
    assert "search_knowledge" in allowed


def test_handoff_preserves_module_and_resets_creation_sticky(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "creation,content")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.creation.runner.llm_pick_creation_action",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.creation.runner.get_executor_runner",
        ) as mock_get_runner:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "creation",
                "restated_query": "generate email template",
            }
            mock_pick.return_value = {
                "kind": "needs_domain",
                "domain_id": "content",
                "restated_query": "generate email template",
                "preferred_executor": "email_content",
            }
            mock_exec = AsyncMock(
                return_value={
                    "ok": True,
                    "reply": "templates built",
                    "action_status": "completed",
                    "state": {"templates_count": 1},
                    "mas_native_create": True,
                }
            )
            mock_get_runner.return_value = mock_exec
            from app.mas.runtime.invoke import mas_invoke
            from app.mas.runtime.task_memory import get_mas_task

            session = {"module": "create_campaign", "session_id": "s1"}
            out = await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "domain_id": "creation",
                    "query": "generate email template",
                    "session": session,
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "generate email template", "module": "create_campaign"},
                    "module_hint": "create_campaign",
                }
            )
            return out, session, mock_get_runner, mock_exec

    out, session, mock_get_runner, mock_exec = asyncio.run(run())
    from app.mas.runtime.task_memory import get_mas_task

    assert out.get("reply") == "templates built"
    mock_get_runner.assert_called_with("campaign_content")
    mock_exec.assert_awaited_once()
    call_ctx = mock_exec.await_args.args[0]
    task_spec = call_ctx.get("task_spec") or {}
    assert task_spec.get("handoff_source_domain") == "content"
    assert task_spec.get("module") == "create_campaign"
    assert get_mas_task(session)["active_domain"] == "creation"
    assert get_mas_task(session)["active_executor"] == "campaign_content"
    get_settings.cache_clear()


def test_socket_bridge_persists_session_after_mas_turn(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "creation")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.socket_bridge.mas_invoke",
            new_callable=AsyncMock,
        ) as mock_invoke, patch(
            "app.mas.socket_bridge.save_session",
            new_callable=AsyncMock,
        ) as mock_save, patch(
            "app.mas.socket_bridge.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess:
            session = {
                "session_id": "s1",
                "module": "create_campaign",
                "mas_task": {"active_domain": "creation", "active_executor": "brief_validation"},
            }
            mock_sess.return_value = session
            mock_invoke.return_value = {
                "reply": "saved",
                "state": {"campaign": {"name": "Spring"}},
            }
            mock_save.return_value = session
            from app.mas.socket_bridge import run_create_campaign_turn_via_mas_or_legacy

            out = await run_create_campaign_turn_via_mas_or_legacy("s1", "tok", "hello")
            return out, mock_save

    out, mock_save = asyncio.run(run())
    assert out.get("reply") == "saved"
    mock_save.assert_awaited()
    get_settings.cache_clear()
