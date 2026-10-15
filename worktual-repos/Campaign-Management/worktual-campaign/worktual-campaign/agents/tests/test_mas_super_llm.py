"""Tests for Super LLM routing and content channel executors."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.mas.runtime.invoke import mas_invoke
from app.mas.runtime.task_memory import get_mas_task


def test_super_uses_llm_even_when_domain_hint_present():
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
            out = await mas_invoke(
                {
                    "entry": "interactive",
                    "domain_id": "audience",
                    "query": "add contact",
                    "session": session,
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"executor_id": "contact", "query": "add contact"},
                }
            )
            return out, mock_llm

    with patch(
        "app.mas.domains.registry.get_domain_runner"
    ) as get_runner:
        mock_domain = AsyncMock(
            return_value={
                "ok": True,
                "action_status": "completed",
                "domain_id": "audience",
                "reply": "ok",
                "message": "ok",
                "ui_events": [],
            }
        )
        get_runner.return_value = mock_domain
        out, mock_llm = asyncio.run(run())

    assert out["ok"] is True
    assert out["domain_id"] == "audience"
    mock_llm.assert_awaited_once()
    mock_domain.assert_awaited()


def test_user_facing_domain_text_drops_routing_stub():
    from app.mas.super_agent.runner import _user_facing_domain_text

    assert _user_facing_domain_text({"message": "Routed to domain 'creation'."}) == ""
    assert (
        _user_facing_domain_text({"reply": "Email template is ready."})
        == "Email template is ready."
    )
    assert (
        _user_facing_domain_text(
            {
                "message": "Routed to domain 'creation'.",
                "reply": "Channels: Email. Want me to generate?",
            }
        )
        == "Channels: Email. Want me to generate?"
    )


def test_super_llm_routes_when_no_preferred_domain():
    session: dict = {}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_llm:
            mock_llm.return_value = {
                "ok": True,
                "domain_id": "optimization",
                "restated_query": "how is campaign X doing",
                "change_summary": "performance",
            }
            with patch(
                "app.mas.domains._common.get_executor_runner"
            ) as get_runner:
                mock_exec = AsyncMock(
                    return_value={
                        "ok": True,
                        "action_status": "completed",
                        "kind": "executor",
                        "agent_id": "monitoring",
                        "reply": "report",
                        "message": "report",
                        "ui_events": [],
                    }
                )
                get_runner.return_value = mock_exec
                out = await mas_invoke(
                    {
                        "entry": "interactive",
                        "query": "how is campaign X doing",
                        "session": session,
                        "session_id": "s1",
                        "token": "t",
                    }
                )
                return out, mock_llm

    out, mock_llm = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "optimization"
    assert out["route_meta"]["source"] == "llm_route_to_domain"
    mock_llm.assert_awaited_once()
    assert get_mas_task(session)["active_domain"] == "optimization"


def test_email_content_executor_calls_channel_agent():
    async def run():
        fake_agent = AsyncMock()
        fake_agent.generate = AsyncMock(return_value={"subject": "Hi", "body": "Hello"})
        with patch(
            "app.mas.executors.shared.channel_content.get_channel_agent",
            return_value=fake_agent,
        ):
            from app.mas.executors.email_content.runner import run_email_content_executor

            return await run_email_content_executor(
                {
                    "task_spec": {
                        "name": "Spring",
                        "goal": "sell",
                        "query": "promo",
                    },
                    "entry": "sticky_domain",
                }
            )

    out = asyncio.run(run())
    assert out["ok"] is True
    assert out["channel"] == "email"
    assert out["template"]["subject"] == "Hi"


def test_super_llm_failure_defaults_to_creation_on_create_campaign():
    session: dict = {"module": "create_campaign"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_llm, patch(
            "app.mas.domains.registry.get_domain_runner"
        ) as get_runner:
            mock_llm.return_value = {"ok": False, "error": "Super could not choose a domain"}
            mock_domain = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "completed",
                    "domain_id": "creation",
                    "reply": "ok",
                    "message": "ok",
                    "ui_events": [],
                }
            )
            get_runner.return_value = mock_domain
            from app.mas.super_agent.runner import run_super

            out = await run_super(
                session=session,
                query="hi",
                raw={"module_hint": "create_campaign", "session_id": "s1", "token": "t"},
            )
            return out, mock_llm, mock_domain

    out, mock_llm, mock_domain = asyncio.run(run())
    assert out["ok"] is True
    assert out["domain_id"] == "creation"
    assert out["route_meta"]["source"] == "module_scoped_fallback"
    mock_llm.assert_awaited_once()
    mock_domain.assert_awaited()


def test_super_corrects_content_to_creation_on_create_module():
    session: dict = {"module": "create_campaign"}

    async def run():
        with patch(
            "app.mas.super_agent.runner._llm_choose_domain",
            new_callable=AsyncMock,
        ) as mock_llm, patch(
            "app.mas.domains.registry.get_domain_runner"
        ) as get_runner:
            mock_llm.return_value = {
                "ok": True,
                "domain_id": "content",
                "restated_query": "generate template with image",
            }
            mock_domain = AsyncMock(
                return_value={
                    "ok": True,
                    "action_status": "needs_domain",
                    "domain_id": "creation",
                    "reply": "",
                    "ui_events": [],
                }
            )
            get_runner.return_value = mock_domain
            from app.mas.super_agent.runner import run_super

            out = await run_super(
                session=session,
                query="generate template with image",
                raw={"module_hint": "create_campaign", "session_id": "s1", "token": "t"},
            )
            return out, mock_llm

    out, mock_llm = asyncio.run(run())
    assert out["ok"] is True
    assert out["route_meta"]["source"] == "module_scoped_creation"
    assert out["route_meta"].get("super_correction") == "content"
    mock_llm.assert_awaited_once()


def test_email_content_blocks_create_campaign_without_templates():
    async def run():
        fake_agent = AsyncMock()
        fake_agent.generate = AsyncMock(return_value={"subject": "Hi", "body": "Hello"})
        with patch(
            "app.mas.executors.shared.channel_content.get_channel_agent",
            return_value=fake_agent,
        ):
            from app.mas.executors.email_content.runner import run_email_content_executor

            return await run_email_content_executor(
                {
                    "session": {"module": "create_campaign", "templates": []},
                    "module_hint": "create_campaign",
                    "task_spec": {
                        "name": "Spring",
                        "goal": "sell",
                        "query": "generate template with image",
                    },
                    "query": "generate template with image",
                    "entry": "interactive",
                }
            )

    out = asyncio.run(run())
    assert out.get("action_status") == "needs_domain"
    assert out["needs_domain"]["domain_id"] == "creation"
    assert out["needs_domain"]["preferred_executor"] == "campaign_content"
