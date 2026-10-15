"""Resolve support bot implementation by organization."""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from app.agents.support_bot import SupportBotAgent
from app.config import get_settings

if TYPE_CHECKING:
    from app.agents.custom_booxoo_bot.agent import CustomBooxooBotAgent
    from app.agents.custom_booxoo_bot.email_agent import CustomBooxooEmailAgent
    from app.agents.custom_lola_worktual.agent import CustomLolaWorktualAgent
    from app.agents.custom_lola_worktual.email_agent import CustomLolaEmailAgent


class SupportBotProtocol:
    async def run_turn(self, *args, **kwargs):  # pragma: no cover - protocol
        raise NotImplementedError


@lru_cache
def get_default_support_bot_agent() -> SupportBotAgent:
    return SupportBotAgent()


@lru_cache
def get_custom_lola_worktual_agent() -> CustomLolaWorktualAgent:
    from app.agents.custom_lola_worktual.agent import CustomLolaWorktualAgent

    return CustomLolaWorktualAgent()


@lru_cache
def get_custom_booxoo_bot_agent() -> CustomBooxooBotAgent:
    from app.agents.custom_booxoo_bot.agent import CustomBooxooBotAgent

    return CustomBooxooBotAgent()


@lru_cache
def get_custom_booxoo_email_agent() -> CustomBooxooEmailAgent:
    from app.agents.custom_booxoo_bot.email_agent import CustomBooxooEmailAgent

    return CustomBooxooEmailAgent()


@lru_cache
def get_custom_lola_email_agent() -> CustomLolaEmailAgent:
    from app.agents.custom_lola_worktual.email_agent import CustomLolaEmailAgent

    return CustomLolaEmailAgent()


def resolve_support_agent(
    organization_id: str,
) -> SupportBotAgent | CustomLolaWorktualAgent | CustomBooxooBotAgent:
    settings = get_settings()
    if organization_id in settings.custom_booxoo_bot_org_id_set:
        return get_custom_booxoo_bot_agent()
    if organization_id in settings.custom_lola_worktual_org_id_set:
        return get_custom_lola_worktual_agent()
    return get_default_support_bot_agent()


def resolve_email_agent(
    organization_id: str,
) -> SupportBotAgent | CustomBooxooEmailAgent | CustomLolaEmailAgent:
    settings = get_settings()
    if organization_id in settings.custom_booxoo_bot_org_id_set:
        return get_custom_booxoo_email_agent()
    if organization_id in settings.custom_lola_worktual_org_id_set:
        return get_custom_lola_email_agent()
    return get_default_support_bot_agent()
