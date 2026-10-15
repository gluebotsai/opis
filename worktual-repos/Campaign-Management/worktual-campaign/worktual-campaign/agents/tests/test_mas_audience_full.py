"""Full MAS Audience — end-to-end routing, tool dispatch, panel state."""

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


def test_contacts_always_mas_even_when_domains_empty(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "")
    from app.mas.runtime.flags import is_module_mas_enabled

    assert is_module_mas_enabled("contacts") is True

    async def run():
        with patch(
            "app.mas.socket_bridge._run_module_mas_chat",
            new_callable=AsyncMock,
        ) as mock_super:
            mock_super.return_value = {"reply": "mas", "mas": True, "ui_events": []}
            from app.mas.socket_bridge import run_contacts_turn_via_mas_or_legacy

            return await run_contacts_turn_via_mas_or_legacy("s1", "t", "hello")

    out = asyncio.run(run())
    assert out["reply"] == "mas"


def test_create_contact_routing_super_domain_executor():
    session: dict = {"session_id": "s-create", "module": "contacts"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_super, patch(
            "app.mas.domains.audience.runner.select_audience_skill",
            new_callable=AsyncMock,
        ) as mock_domain, patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_exec:
            mock_super.return_value = {
                "ok": True,
                "domain_id": "audience",
                "restated_query": "create contact Ada",
            }
            from app.mas.skills.selector import SkillPick

            mock_domain.return_value = SkillPick(
                ok=True,
                executor_id="contact",
                skill_id="contact_creation",
                skill_action="new_task",
                restated_query="create contact Ada",
            )
            mock_exec.return_value = {
                "ok": True,
                "action_status": "completed",
                "reply": "What is Ada's email?",
                "ui_events": [{"type": "draft_updated", "payload": {"mode": "create"}}],
                "state": {"draft_mode": "create"},
                "mas_native_audience": True,
            }
            from app.mas.runtime.invoke import mas_invoke
            from app.mas.runtime.task_memory import get_mas_task

            out = await mas_invoke(
                {
                    "entry": "interactive",
                    "skip_super": False,
                    "query": "create contact Ada",
                    "session": session,
                    "session_id": "s-create",
                    "token": "tok",
                    "module_hint": "contacts",
                    "task_spec": {"query": "create contact Ada", "module": "contacts"},
                }
            )
            return out, mock_super, mock_domain, mock_exec, get_mas_task(session)

    out, mock_super, mock_domain, mock_exec, task = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "audience"
    mock_super.assert_awaited_once()
    mock_domain.assert_awaited_once()
    mock_exec.assert_awaited_once()
    assert task["active_domain"] == "audience"
    dr = out.get("domain_result") or {}
    assert dr.get("executor_id") == "contact"
    ui = dr.get("ui_events") or []
    assert ui and ui[0]["type"] == "draft_updated"


def test_update_contact_dispatches_update_tool():
    async def run():
        with patch(
            "app.agents.contacts.tools.handlers.dispatch_tool",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            mock_dispatch.return_value = {
                "ok": True,
                "message": "Contact updated",
                "ui_event": {"type": "draft_updated", "payload": {"mode": "update"}},
            }
            from app.mas.runtime.tool_adapters import dispatch_executor_tool

            return await dispatch_executor_tool(
                "contact",
                "UPDATE_SINGLE_CONTACT",
                {
                    "contact_id": "c-1",
                    "first_name": "Ada",
                    "user_confirmed": True,
                },
                session_id="s-upd",
                token="tok",
            ), mock_dispatch

    out, mock_dispatch = asyncio.run(run())
    assert out["ok"] is True
    mock_dispatch.assert_awaited_once()
    assert mock_dispatch.await_args.args[0] == "UPDATE_SINGLE_CONTACT"


def test_hub_create_uses_super_not_skip_binding():
    async def run():
        with patch(
            "app.mas.runtime.invoke.mas_invoke",
            new_callable=AsyncMock,
        ) as mock_invoke:
            mock_invoke.return_value = {
                "ok": True,
                "domain_result": {
                    "ok": True,
                    "action_status": "completed",
                    "contact_id": "c-hub",
                    "message": "created",
                    "result": {"contact_id": "c-hub"},
                },
            }
            from app.hub_super.registry import _contacts_via_mas_or_legacy

            return await _contacts_via_mas_or_legacy(
                {
                    "token": "tok",
                    "organization_id": "org1",
                    "payload": {
                        "first_name": "Ada",
                        "email": "ada@example.com",
                    },
                }
            ), mock_invoke

    out, mock_invoke = asyncio.run(run())
    assert out["ok"] is True
    assert out.get("mas") is True
    payload = mock_invoke.await_args.args[0]
    assert payload.get("skip_super") is False
    assert payload.get("entry") == "hub"
    assert payload.get("hub_skill") == "create_contact"
    assert payload["task_spec"]["force_super"] is True
    assert payload["task_spec"]["hub_create"] is True


def test_hub_create_executor_dispatches_create_contact():
    async def run():
        with patch(
            "app.mas.executors.contact.runner.dispatch_executor_tool",
            new_callable=AsyncMock,
        ) as mock_tool:
            mock_tool.return_value = {
                "ok": True,
                "message": "Contact created",
                "contact_id": "c-new",
                "contact": {"id": "c-new", "first_name": "Ada"},
            }
            from app.mas.executors.contact.runner import run_contact_executor

            return await run_contact_executor(
                {
                    "session_id": "hub-s1",
                    "token": "tok",
                    "task_spec": {
                        "hub_create": True,
                        "first_name": "Ada",
                        "email": "ada@example.com",
                    },
                }
            ), mock_tool

    out, mock_tool = asyncio.run(run())
    assert out.get("mas_hub_create") is True
    assert out.get("contact_id") == "c-new"
    mock_tool.assert_awaited_once()
    assert mock_tool.await_args.args[1] == "CREATE_CONTACT"
    assert mock_tool.await_args.kwargs["session_id"] == "hub-s1"


def test_set_draft_fields_emits_panel_event():
    async def run():
        with patch(
            "app.agents.contacts.tools.handlers.dispatch_tool",
            new_callable=AsyncMock,
        ) as mock_dispatch:
            mock_dispatch.return_value = {
                "ok": True,
                "message": "Draft updated",
                "ui_event": {
                    "type": "draft_updated",
                    "payload": {
                        "mode": "create",
                        "draft_contact": {"first_name": "Ada"},
                    },
                },
            }
            from app.mas.runtime.tool_adapters import dispatch_executor_tool

            return await dispatch_executor_tool(
                "contact",
                "SET_DRAFT_FIELDS",
                {"mode": "create", "first_name": "Ada"},
                session_id="s-panel",
                token="tok",
            )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["ui_event"]["type"] == "draft_updated"
    assert out["ui_event"]["payload"]["mode"] == "create"


def test_native_executor_bounded_tools_contact():
    from app.agents.contacts.tools.schemas import tools_for_mas_audience_executor

    names = {t["function"]["name"] for t in tools_for_mas_audience_executor("contact")}
    assert "SET_DRAFT_FIELDS" in names
    assert "CREATE_SINGLE_CONTACT" in names
    assert "UPDATE_SINGLE_CONTACT" in names
    assert "LAUNCH_CAMPAIGN" not in names


def test_super_corrects_non_audience_when_module_contacts():
    session: dict = {"module": "contacts", "session_id": "s1"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_llm:
            mock_llm.return_value = {
                "ok": True,
                "domain_id": "creation",
                "restated_query": "add contact",
            }
            with patch(
                "app.mas.domains.registry.get_domain_runner"
            ) as get_runner:
                mock_domain = AsyncMock(
                    return_value={
                        "ok": True,
                        "action_status": "completed",
                        "domain_id": "audience",
                        "reply": "ok",
                        "ui_events": [],
                    }
                )
                get_runner.return_value = mock_domain
                from app.mas.runtime.invoke import mas_invoke

                out = await mas_invoke(
                    {
                        "entry": "interactive",
                        "skip_super": False,
                        "query": "add contact",
                        "session": session,
                        "session_id": "s1",
                        "token": "t",
                        "module_hint": "contacts",
                        "task_spec": {"query": "add contact", "module": "contacts"},
                    }
                )
                return out

    out = asyncio.run(run())
    assert out.get("domain_id") == "audience"
    assert (out.get("route_meta") or {}).get("source") == "module_scoped_audience"
    assert (out.get("route_meta") or {}).get("super_correction") == "creation"


def test_super_routing_guidance_in_context():
    from app.mas.runtime.context import build_mas_runtime_context, super_routing_guidance

    text = build_mas_runtime_context({"session_id": "s", "module": "contacts"}, module_hint="contacts")
    assert "routing_guidance" in text
    assert "audience" in text
    assert super_routing_guidance("create_campaign")
    assert "creation" in super_routing_guidance("create_campaign")


def test_contact_executor_no_coordinator_fallback():
    async def run():
        with patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "reply": "native only",
                "mas_native_audience": True,
            }
            with patch(
                "app.agents.contacts.agent.run_coordinator",
                new_callable=AsyncMock,
            ) as mock_coord:
                from app.mas.executors.contact.runner import run_contact_executor

                out = await run_contact_executor(
                    {
                        "session_id": "s1",
                        "token": "t",
                        "task_spec": {"query": "hello"},
                        "entry": "interactive",
                    }
                )
                return out, mock_native, mock_coord

    out, mock_native, mock_coord = asyncio.run(run())
    assert out.get("mas_native_audience") is True
    mock_native.assert_awaited_once()
    mock_coord.assert_not_called()
