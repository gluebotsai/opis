"""Whole-product MAS thinning — forms specialists, audience loops, super entry."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch


def test_form_theme_calls_specialist(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "forms")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.executors.form_theme.runner.is_native_forms",
            return_value=False,
        ), patch(
            "app.agents.forms.specialists.run_theme_specialist",
            new_callable=AsyncMock,
        ) as mock_theme, patch(
            "app.mas.executors.shared.form_specialist.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess, patch(
            "app.mas.executors.shared.form_specialist.public_state",
            return_value={"module": "forms"},
        ):
            mock_theme.return_value = {
                "ok": True,
                "change_summary": "Set primary color to blue",
                "ui_event": {"type": "form_design", "payload": {}},
            }
            mock_sess.return_value = {"session_id": "s1", "module": "forms"}
            from app.mas.executors.form_theme.runner import run_form_theme_executor

            return await run_form_theme_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "make the primary color blue"},
                    "entry": "interactive",
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_specialist") is True
    assert "blue" in (out.get("reply") or "").lower() or "primary" in (
        out.get("reply") or ""
    ).lower()
    get_settings.cache_clear()


def test_form_theme_falls_back_to_forms_turn_on_specialist_fail():
    async def run():
        with patch(
            "app.mas.executors.form_theme.runner.is_native_forms",
            return_value=False,
        ), patch(
            "app.agents.forms.specialists.run_theme_specialist",
            new_callable=AsyncMock,
        ) as mock_theme, patch(
            "app.agents.forms.agent.run_forms_turn",
            new_callable=AsyncMock,
        ) as mock_turn:
            mock_theme.return_value = {"ok": False, "error": "no json"}
            mock_turn.return_value = {
                "reply": "I can help with theme or fields.",
                "state": {},
                "ui_events": [],
            }
            from app.mas.executors.form_theme.runner import run_form_theme_executor

            return await run_form_theme_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "task_spec": {"query": "what can you do?"},
                    "entry": "interactive",
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_specialist") is False
    assert "help" in (out.get("reply") or "").lower()


def test_audience_selection_owns_native_loop(monkeypatch):
    monkeypatch.setenv("MAS_AUDIENCE_NATIVE", "true")

    async def run():
        with patch(
            "app.mas.executors.shared.audience_native.run_native_audience_executor",
            new_callable=AsyncMock,
        ) as mock_native:
            mock_native.return_value = {
                "ok": True,
                "action_status": "completed",
                "agent_id": "audience_selection",
                "reply": "bulk ready",
                "mas_owned_loop": True,
                "mas_native_audience": True,
                "ui_events": [],
            }
            from app.mas.executors.audience_selection.runner import (
                run_audience_selection_executor,
            )

            return await run_audience_selection_executor(
                {
                    "session_id": "s1",
                    "token": "t",
                    "query": "upload bulk contacts",
                    "entry": "interactive",
                    "task_spec": {"query": "upload bulk contacts"},
                }
            )

    out = asyncio.run(run())
    assert out.get("mas_owned_loop") is True
    assert out.get("mas_native_audience") is True
    assert out.get("agent_id") == "audience_selection"


def test_form_tools_allowlisted():
    from app.mas.runtime.tool_adapters import EXECUTOR_TOOL_ALLOWLIST

    assert "RUN_THEME_SPECIALIST" in EXECUTOR_TOOL_ALLOWLIST["form_theme"]
    assert "RUN_FIELDS_SPECIALIST" in EXECUTOR_TOOL_ALLOWLIST["form_fields"]
    assert "RUN_DESIGN_SPECIALIST" in EXECUTOR_TOOL_ALLOWLIST["form_design"]


def test_super_entry_disabled_message(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        from app.mas.socket_bridge import run_super_entry_via_mas_or_legacy

        return await run_super_entry_via_mas_or_legacy("s", "t", "hello")

    out = asyncio.run(run())
    assert out.get("mas") is False
    assert "not enabled" in (out.get("reply") or "").lower()
    get_settings.cache_clear()
