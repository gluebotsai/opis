"""MAS Phase 1 — Audience adapters + Contact executor parity path."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.runtime.flags import parse_enabled_domains
from app.mas.runtime.invoke import mas_invoke
from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST, dispatch_executor_tool
from app.mas.socket_bridge import run_contacts_turn_via_mas_or_legacy


def test_contact_executor_allowlist_includes_create():
    assert "CREATE_CONTACT" in EXECUTOR_TOOL_ALLOWLIST["contact"]
    assert "SEARCH_CONTACTS" in EXECUTOR_TOOL_ALLOWLIST["audience_selection"]


def test_dispatch_forbidden_tool():
    async def run():
        return await dispatch_executor_tool(
            "contact",
            "LAUNCH_CAMPAIGN",
            {},
            session_id="s1",
            token="t",
        )

    out = asyncio.run(run())
    assert out["ok"] is False
    assert out["status"] == "forbidden_tool"


def test_dispatch_contact_tool_calls_legacy_handler():
    async def run():
        with patch(
            "app.agents.contacts.tools.handlers.dispatch_tool",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            mock_dispatch.return_value = {"ok": True, "message": "created"}
            return await dispatch_executor_tool(
                "contact",
                "CREATE_CONTACT",
                {"first_name": "Ada", "email": "a@b.com", "user_confirmed": True},
                session_id="s1",
                token="tok",
            ), mock_dispatch

    out, mock_dispatch = asyncio.run(run())
    assert out["ok"] is True
    mock_dispatch.assert_awaited_once()
    args = mock_dispatch.await_args
    assert args.args[0] == "CREATE_CONTACT"
    assert args.args[1] == "s1"
    assert args.args[2] == "tok"


def test_hub_create_via_mas_super_chain():
    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.audience.runner.select_audience_skill",
            new_callable=AsyncMock,
        ) as mock_domain, patch(
            "app.mas.executors.contact.runner.dispatch_executor_tool",
            new_callable=AsyncMock,
        ) as mock_tool:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "audience",
                "restated_query": "Create contact Ada ada@example.com",
            }
            from app.mas.skills.selector import SkillPick

            mock_domain.return_value = SkillPick(
                ok=True,
                executor_id="contact",
                skill_id="contact_creation",
                skill_action="new_task",
                restated_query="Create contact Ada ada@example.com",
            )
            mock_tool.return_value = {
                "ok": True,
                "message": "created",
                "contact_id": "c1",
                "contact": {"id": "c1", "first_name": "Ada"},
            }
            return await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "query": "Create contact Ada ada@example.com",
                    "token": "tok",
                    "session_id": "s-hub",
                    "task_spec": {
                        "force_super": True,
                        "hub_create": True,
                        "first_name": "Ada",
                        "email": "ada@example.com",
                        "query": "Create contact Ada ada@example.com",
                    },
                    "session": {},
                }
            ), mock_super, mock_domain, mock_tool

    out, mock_super, mock_domain, mock_tool = asyncio.run(run())
    assert out["ok"] is True
    dr = out.get("domain_result") or out
    assert dr.get("executor_id") == "contact" or dr.get("agent_id") == "contact"
    assert dr.get("contact_id") == "c1" or (dr.get("result") or {}).get("contact_id") == "c1"
    mock_super.assert_awaited_once()
    mock_domain.assert_not_called()
    mock_tool.assert_awaited_once()


def test_socket_bridge_uses_legacy_when_flag_off(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.socket_bridge._run_module_mas_chat",
            new_callable=AsyncMock,
        ) as mock_super:
            mock_super.return_value = {
                "reply": "mas",
                "state": {},
                "ui_events": [],
                "mas": True,
            }
            from app.mas import socket_bridge as bridge

            return await bridge.run_contacts_turn_via_mas_or_legacy(
                "sid", "tok", "hello"
            ), mock_super

    out, mock_super = asyncio.run(run())
    assert out["reply"] == "mas"
    assert out.get("mas") is True
    mock_super.assert_awaited_once()


def test_socket_bridge_uses_mas_when_audience_enabled(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "audience")
    from app.config import get_settings

    get_settings.cache_clear()
    assert "audience" in parse_enabled_domains()

    async def run():
        with patch(
            "app.mas.socket_bridge._run_module_mas_chat",
            new_callable=AsyncMock,
        ) as mock_super:
            mock_super.return_value = {
                "reply": "via mas",
                "state": {},
                "ui_events": [{"type": "draft_updated"}],
                "mas": True,
            }
            from app.mas import socket_bridge as bridge

            return await bridge.run_contacts_turn_via_mas_or_legacy(
                "sid", "tok", "create contact"
            ), mock_super

    out, mock_super = asyncio.run(run())
    assert out.get("mas") is True
    assert out["reply"] == "via mas"
    assert out["ui_events"][0]["type"] == "draft_updated"
    mock_super.assert_awaited_once()
    get_settings.cache_clear()
