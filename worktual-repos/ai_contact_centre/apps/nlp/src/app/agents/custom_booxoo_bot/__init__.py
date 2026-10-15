"""Booxoo custom support bot."""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agents.custom_booxoo_bot.agent import CustomBooxooBotAgent

__all__ = ["CustomBooxooBotAgent"]


def __getattr__(name: str):
    if name == "CustomBooxooBotAgent":
        from app.agents.custom_booxoo_bot.agent import CustomBooxooBotAgent

        return CustomBooxooBotAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
