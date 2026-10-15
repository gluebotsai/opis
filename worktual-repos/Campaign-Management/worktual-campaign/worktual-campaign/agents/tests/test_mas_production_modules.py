"""Production MAS — every product module takes MAS path when enabled (mocked)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

# All SPA modules use Super-first routing via _run_module_mas_chat.
_MODULE_MAS_BRIDGES: list[tuple[str, str]] = [
    ("contacts", "run_contacts_turn_via_mas_or_legacy"),
    ("monitoring", "run_monitoring_turn_via_mas_or_legacy"),
    ("reports", "run_reports_turn_via_mas_or_legacy"),
    ("events_report", "run_events_report_turn_via_mas_or_legacy"),
    ("create_campaign", "run_create_campaign_turn_via_mas_or_legacy"),
    ("recommendations", "run_recommendations_turn_via_mas_or_legacy"),
    ("forms", "run_forms_turn_via_mas_or_legacy"),
    ("whatsapp_approved", "run_whatsapp_approved_turn_via_mas_or_legacy"),
    ("whatsapp_rejected", "run_whatsapp_rejected_turn_via_mas_or_legacy"),
]


@pytest.fixture(autouse=True)
def _mas_all(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "all")
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_all_domains_enabled_when_all():
    from app.mas.catalog import DOMAIN_IDS
    from app.mas.runtime.flags import is_domain_enabled, parse_enabled_domains

    assert parse_enabled_domains() == frozenset(DOMAIN_IDS)
    for did in DOMAIN_IDS:
        assert is_domain_enabled(did)


@pytest.mark.parametrize("module,fn_name", _MODULE_MAS_BRIDGES)
def test_module_bridge_uses_mas(module: str, fn_name: str):
    async def run():
        with patch(
            "app.mas.socket_bridge._run_module_mas_chat",
            new_callable=AsyncMock,
        ) as mock_chat:
            mock_chat.return_value = {
                "reply": f"mas-{module}",
                "state": {},
                "ui_events": [],
                "mas": True,
            }
            from app.mas import socket_bridge as bridge

            fn = getattr(bridge, fn_name)
            out = await fn("sid", "tok", f"hello {module}")
            return out, mock_chat

    out, mock_chat = asyncio.run(run())
    assert out.get("mas") is True
    assert out.get("reply") == f"mas-{module}"
    mock_chat.assert_awaited_once()
    kwargs = mock_chat.await_args.kwargs
    assert kwargs["module"] == module


def test_super_entry_invokes_mas_when_enabled():
    async def run():
        with patch(
            "app.mas.socket_bridge.get_or_create_session",
            new_callable=AsyncMock,
        ) as mock_sess, patch(
            "app.mas.socket_bridge.mas_invoke",
            new_callable=AsyncMock,
        ) as mock_invoke:
            mock_sess.return_value = {"session_id": "s1", "module": "mas"}
            mock_invoke.return_value = {
                "ok": True,
                "reply": "routed",
                "message": "routed",
                "domain_id": "audience",
                "ui_events": [],
            }
            from app.mas.socket_bridge import run_super_entry_via_mas_or_legacy

            return await run_super_entry_via_mas_or_legacy("s1", "tok", "add a contact")

    out = asyncio.run(run())
    assert out.get("mas") is True
    assert out.get("reply") == "routed"


def test_hub_bindings_resolve_for_product_skills():
    from app.mas.runtime.bindings import resolve_hub_binding

    assert resolve_hub_binding("create_contact")["domain_id"] == "audience"
    assert resolve_hub_binding("create_contact")["executor_id"] == "contact"
    assert resolve_hub_binding("campaign_report")["executor_id"] == "monitoring"
    assert resolve_hub_binding("on_demand_send")["executor_id"] == "launch_scheduling"
    assert resolve_hub_binding("stop_channel")["executor_id"] == "recovery"
    assert resolve_hub_binding("send-approved-whatsapp")["executor_id"] == "whatsapp_approved_send"
    assert resolve_hub_binding("generate_image")["executor_id"] == "image_generate"
    assert resolve_hub_binding("temp-audience-and-send")["executor_id"] == "launch_scheduling"


def test_executor_runners_importable():
    from app.mas.catalog import EXECUTOR_META
    from app.mas.executors.registry import get_executor_runner

    for eid in EXECUTOR_META:
        runner = get_executor_runner(eid)
        assert callable(runner), eid


def test_domain_runners_importable():
    from app.mas.catalog import DOMAIN_IDS
    from app.mas.domains.registry import get_domain_runner

    for did in DOMAIN_IDS:
        runner = get_domain_runner(did)
        assert callable(runner), did


def test_config_default_is_all():
    from app.config import Settings

    # Inspect field default without loading .env overrides.
    fields = getattr(Settings, "model_fields", None) or getattr(Settings, "__fields__", {})
    field = fields["mas_enabled_domains"]
    default = getattr(field, "default", None)
    if default is None and hasattr(field, "field_info"):
        default = field.field_info.default
    assert default == "all"
