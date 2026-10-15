"""Native MAS Audience executors — bounded CRM tools, Super → Domain → Executor."""

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
    from app.mas.runtime.flags import is_audience_native_enabled

    assert is_audience_native_enabled() is True


def test_tools_for_mas_audience_executor_subsets():
    from app.agents.contacts.tools.schemas import tools_for_mas_audience_executor
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    for eid in ("contact", "audience_selection", "audience_pull"):
        names = [t["function"]["name"] for t in tools_for_mas_audience_executor(eid)]
        assert set(names) == set(EXECUTOR_TOOL_ALLOWLIST[eid])


def test_executor_prompt_includes_mas_context():
    from app.agents.contacts.prompts import build_contacts_executor_system_prompt

    session = {
        "session_id": "s-prompt",
        "module": "contacts",
        "draft_mode": "create",
        "draft_contact": {"first_name": "Ada"},
        "mas_task": {"active_domain": "audience", "active_executor": "contact", "steps": []},
    }
    prompt = build_contacts_executor_system_prompt(
        session, "contact", mas_task=session["mas_task"], module_hint="contacts"
    )
    assert "Executor scope (contact)" in prompt
    assert "draft_mode" in prompt
    assert "Ada" in prompt


def test_contact_executor_uses_native_loop(monkeypatch):
    monkeypatch.setenv("MAS_AUDIENCE_NATIVE", "true")

    async def run():
        with patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "agent_id": "contact",
                "reply": "panel open",
                "mas_native_audience": True,
            }
            from app.mas.executors.contact.runner import run_contact_executor

            return await run_contact_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "module_hint": "contacts",
                    "task_spec": {"query": "create contact Ada"},
                    "entry": "interactive",
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_native_audience") is True
    assert out.get("reply") == "panel open"


def test_contact_executor_always_native(monkeypatch):
    monkeypatch.setenv("MAS_AUDIENCE_NATIVE", "false")

    async def run():
        with patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "reply": "native",
                "mas_native_audience": True,
            }
            from app.mas.executors.contact.runner import run_contact_executor

            return await run_contact_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "hello"},
                    "entry": "interactive",
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_native_audience") is True


def test_contacts_socket_bridge_uses_super_not_skip(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "audience")

    async def run():
        with patch(
            "app.mas.socket_bridge._run_module_mas_chat",
            new_callable=AsyncMock,
        ) as mock_super:
            mock_super.return_value = {
                "reply": "via super",
                "state": {"draft_mode": "create"},
                "ui_events": [],
                "mas": True,
            }
            from app.mas.socket_bridge import run_contacts_turn_via_mas_or_legacy

            return await run_contacts_turn_via_mas_or_legacy("sid", "tok", "add contact")

    out = asyncio.run(run())
    assert out["reply"] == "via super"
    assert out.get("mas") is True


def test_super_always_llm_even_with_domain_hint():
    session: dict = {}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_llm:
            mock_llm.return_value = {
                "ok": True,
                "domain_id": "audience",
                "restated_query": "add contact",
            }
            with patch(
                "app.mas.domains.registry.get_domain_runner"
            ) as get_runner:
                mock_domain = AsyncMock(
                    return_value={
                        "ok": True,
                        "action_status": "completed",
                        "reply": "ok",
                        "ui_events": [],
                    }
                )
                get_runner.return_value = mock_domain
                from app.mas.runtime.invoke import mas_invoke

                out = await mas_invoke(
                    {
                        "entry": "interactive",
                        "domain_id": "audience",
                        "query": "add contact",
                        "session": session,
                        "session_id": "s1",
                        "token": "t",
                        "task_spec": {"query": "add contact", "executor_id": "contact"},
                    }
                )
                return out, mock_llm

    out, mock_llm = asyncio.run(run())
    assert out["ok"] is True
    mock_llm.assert_awaited_once()


def test_audience_domain_passes_through_executor_when_llm_fails():
    async def run():
        with patch(
            "app.mas.domains.audience.runner.select_audience_skill",
            new_callable=AsyncMock,
        ) as mock_pick, patch(
            "app.mas.domains.audience.runner._run_executor",
            new_callable=AsyncMock,
        ) as mock_exec:
            from app.mas.skills.selector import SkillPick

            mock_pick.return_value = SkillPick(ok=False, error="no tool")
            mock_exec.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "continuing",
                "executor_id": "contact",
            }
            from app.mas.domains.audience.runner import run_audience_domain
            from app.mas.skills import apply_skill_pick

            session = {
                "session_id": "s-fail",
                "module": "contacts",
                "draft_mode": "create",
                "draft_contact": {"first_name": "Pujitha"},
                "mas_task": {
                    "active_domain": "audience",
                    "active_executor": "contact",
                    "steps": [],
                },
            }
            apply_skill_pick(
                session,
                module="contacts",
                executor_id="contact",
                skill_id="contact_creation",
                skill_action="new_task",
            )
            return await run_audience_domain(
                {
                    "session": session,
                    "entry": "interactive",
                    "query": "what'",
                    "task_spec": {"query": "what'"},
                    "module_hint": "contacts",
                }
            )

    out = asyncio.run(run())
    assert out.get("reply") == "continuing"
    assert "single contact, audience list" not in str(out.get("message") or "")
