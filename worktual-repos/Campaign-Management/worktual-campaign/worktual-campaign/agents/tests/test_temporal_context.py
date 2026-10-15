"""Temporal context for MAS runtime prompts."""

from __future__ import annotations

from app.mas.runtime.context import build_mas_runtime_context
from app.mas.runtime.temporal_context import (
    build_temporal_context_block,
    resolve_session_timezone,
)


def test_resolve_session_timezone_prefers_client():
    session = {"client_timezone": "America/New_York", "launch_plan": {"timezone": "UTC"}}
    assert resolve_session_timezone(session) == "America/New_York"


def test_resolve_session_timezone_launch_plan_fallback():
    session = {"launch_plan": {"timezone": "Europe/London"}}
    assert resolve_session_timezone(session) == "Europe/London"


def test_build_temporal_context_block_contains_utc_and_local():
    block = build_temporal_context_block({"client_timezone": "Asia/Kolkata"})
    assert "current_datetime:" in block
    assert "utc:" in block
    assert "Asia/Kolkata" in block
    assert "scheduling_note:" in block


def test_mas_runtime_context_includes_temporal():
    text = build_mas_runtime_context({"module": "contacts", "client_timezone": "UTC"})
    assert "current_datetime:" in text
    assert "module_hint: contacts" in text
