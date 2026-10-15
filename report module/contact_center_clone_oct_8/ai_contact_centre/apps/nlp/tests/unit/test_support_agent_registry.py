"""Tests for support agent org routing."""

from app.agents.custom_booxoo_bot import CustomBooxooBotAgent
from app.agents.custom_booxoo_bot.email_agent import CustomBooxooEmailAgent
from app.agents.custom_lola_worktual import CustomLolaWorktualAgent
from app.agents.custom_lola_worktual.email_agent import CustomLolaEmailAgent
from app.agents.support_agent_registry import resolve_email_agent, resolve_support_agent
from app.agents.support_bot import SupportBotAgent
from app.config import get_settings
from app.mcp.registry import get_mcp_registry


def test_resolve_support_agent_routes_worktual_org(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "custom_lola_worktual_org_ids", "1003,1004")
    monkeypatch.setattr(settings, "custom_booxoo_bot_org_ids", "")
    assert isinstance(resolve_support_agent("1003"), CustomLolaWorktualAgent)
    assert isinstance(resolve_support_agent("999"), SupportBotAgent)


def test_resolve_support_agent_routes_booxoo_org(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "custom_booxoo_bot_org_ids", "1012")
    monkeypatch.setattr(settings, "custom_lola_worktual_org_ids", "1003")
    assert isinstance(resolve_support_agent("1012"), CustomBooxooBotAgent)
    assert isinstance(resolve_support_agent("1003"), CustomLolaWorktualAgent)
    assert isinstance(resolve_support_agent("999"), SupportBotAgent)


def test_resolve_email_agent_uses_booxoo_and_keeps_other_orgs_on_default(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "custom_booxoo_bot_org_ids", "1012")
    monkeypatch.setattr(settings, "custom_lola_worktual_org_ids", "1003")
    assert isinstance(resolve_email_agent("1012"), CustomBooxooEmailAgent)
    assert not isinstance(resolve_email_agent("1012"), CustomBooxooBotAgent)
    assert isinstance(resolve_email_agent("1003"), CustomLolaEmailAgent)
    assert not isinstance(resolve_email_agent("1003"), CustomLolaWorktualAgent)
    assert isinstance(resolve_email_agent("999"), SupportBotAgent)


def test_custom_booxoo_can_enrich_contacts_on_customer_channels() -> None:
    registry = get_mcp_registry()
    for surface in ("webchat", "whatsapp", "instagram", "facebook", "social", "email"):
        assert registry.is_authorized(
            server_name="contact",
            tool_name="contact_enrich",
            agent_name="custom_booxoo_bot",
            surface=surface,
            role="agent",
        )
